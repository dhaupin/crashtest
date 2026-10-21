// S1.5 - dogfood fixture: crashtest attacks its own fixture app.
// `fixtures/demo` models the smallest real agent-built API: a device
// registration surface with an admin panel and a session surface. TWO
// variants:
//   buildRoutes({ vulnerable: false }) - hardened: allow-lists, validation,
//     hygiene headers, header-blind admin gate. The committed baseline
//     (labs/crashledger.json) is cut against THIS variant.
//   buildRoutes({ vulnerable: true })  - the pre-hardening draft: trusts
//     fields/headers, bare 2xx writes. CI-material: proves the pipeline
//     TRIPS on it (fresh run -> exit 1).

const ENV_SPEC = {
  d1: {
    DB: {
      tables: {
        devices: {
          rows: [{ id: 1, key: 'seed', owner: 'rook' }],
          uniques: { key_unique: ['key'] },
        },
        // Session store for the login/me/logout surface. Vulkan-hard variant
        // rotates sids via last_row_id (deterministic across reruns); the
        // vulnerable variant never touches this table - it trusts the wire.
        sessions: {
          rows: [],
          uniques: { sid_unique: ['sid'] },
        },
        // Race surfaces: charges (idempotency by unique cid) and per-field
        // settings (unique user+field pair) + the whole-record blob table the
        // vulnerable variant stomps with. All session-adjacent stores.
        charges: {
          rows: [],
          uniques: { cid_unique: ['cid'] },
        },
        settings: {
          rows: [],
          uniques: { user_field_unique: ['user', 'field'] },
        },
        blobs: {
          rows: [],
          uniques: { user_unique: ['user'] },
        },
      },
    },
  },
  kv: {
    DEVICE_CACHE: { seed: { last: 'seed' } },
    // Upload store for the upload/ module surface - the hardened variant
    // writes only safe basenames here; the vulnerable variant trusts the
    // client filename verbatim.
    UPLOADS: {},
  },
  // Fake secrets - the auth/secret-watermark probe is armed by this key and
  // passes because NO route may echo env values. Keep placeholder-shaped.
  secrets: { CRASHTEST_SECRET: 'crashtest-fake-secret-do-not-echo' },
};

function insert(env, key, owner) {
  return env.DB.prepare('INSERT INTO devices (key, owner) VALUES (?, ?)').bind(key, owner).run();
}

function insertSession(env, sid, user) {
  return env.DB.prepare('INSERT INTO sessions (sid, user) VALUES (?, ?)').bind(sid, user).run();
}

function deleteSession(env, sid) {
  return env.DB.prepare('DELETE FROM sessions WHERE sid = ?').bind(sid).run();
}

function getSession(env, sid) {
  return env.DB.prepare('SELECT user FROM sessions WHERE sid = ?').bind(sid).first('user');
}

// Gameplay-cookie sid from the caller (fixtures don't get ctx.seed - the
// row id keeps it deterministic AND rotating: two logins never share a sid).
function sidFromRowId(rowId) {
  return `sid${rowId}-rook-session`;
}

function parseSid(request) {
  const cookie = request.headers.get('cookie') ?? '';
  const m = cookie.match(/(?:^|;\s*)sid=([^;]*)/);
  return m ? m[1] : null;
}

// Hardened login: validate the claimed user, mint a unique rotating sid,
// set the full hygiene flag family (Secure + HttpOnly + SameSite=Strict),
// no-store on the write. No flags missing = cookie-hygiene REFUSED.
//
// Determinism note: no clocks anywhere. The sid is derived from the D1 row
// id (rowid increments monotonically within a run), so two logins mint two
// distinct sids and the whole surface replays identically across runs.
const loginHard = conflictOr500(async ({ request, env }) => {
  let body;
  try { body = await request.json(); } catch { return new Response('bad json', { status: 400 }); }
  if (typeof body?.user !== 'string' || !/^[a-zA-Z0-9-]{1,32}$/.test(body.user)) {
    return new Response('invalid user', { status: 400 });
  }
  // Provisional row bid: insert once to learn the next row id, then swap
  // the provisional row for the real one - uniqueness sits on sid anyway.
  const PENDING_SID = 'sid-provisional';
  const provisioned = await insertSession(env, PENDING_SID, body.user);
  const sid = sidFromRowId(provisioned.meta.last_row_id + 1);
  await deleteSession(env, PENDING_SID);
  await insertSession(env, sid, body.user);
  return new Response('ok', {
    status: 200,
    headers: {
      'set-cookie': `sid=${sid}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`,
      'cache-control': 'no-store',
    },
  });
});

// Hardened me: the sid must exist server-side - a forged/canary cookie gets
// an honest 401, never a trust-the-wire 200.
const meHard = async ({ request, env }) => {
  const sid = parseSid(request);
  const user = sid ? await getSession(env, sid) : null;
  if (!user) return new Response('unauthenticated', { status: 401, headers: { 'cache-control': 'no-store' } });
  return Response.json({ user }, { headers: { 'cache-control': 'no-store' } });
};

// Hardened logout: delete the row AND clear the cookie. The logged-out sid
// is dead on arrival (logout-invalidates gate).
const logoutHard = async ({ request, env }) => {
  const sid = parseSid(request);
  if (sid) await deleteSession(env, sid);
  // 204 = no content by definition: WHATWG refuses a body-bearing Response
  // with status 204 (the request-shape flood was the first probe to grade
  // this live). Null body, honest headers.
  return new Response(null, {
    status: 204,
    headers: {
      'set-cookie': 'sid=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict',
      'cache-control': 'no-store',
    },
  });
};  // Race round: the concurrency surfaces. Hardened charge: INSERT with a
  // UNIQUE cid - the second same-key submission conflicts honestly (409) and
  // the store keeps exactly one row. Vulnerable charge: the classic TOCTOU
  // draft - an await-gapped SELECT-then-INSERT, both bursts see nothing...
  // both insert. Hardened profile: per-field rows, concurrent field-writers
  // never collide. Vulnerable profile: whole-record blob overwrite
  // (DELETE + INSERT), the last writer silently stomps the first.
  const chargeHard = conflictOr500(async ({ request, env }) => {
    let body;
    try { body = await request.json(); } catch { return new Response('bad json', { status: 400 }); }
    const idem = body?.idem;
    const cents = body?.cents;
    if (typeof idem !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(idem)) {
      return new Response('invalid idempotency key', { status: 400 });
    }
    if (!Number.isFinite(cents) || cents <= 0) return new Response('invalid cents', { status: 400 });
    const res = await env.DB.prepare('INSERT INTO charges (cid, user, cents) VALUES (?, ?, ?)').bind(idem, body.user ?? 'rook', cents).run();
    return new Response('charged', {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    });
  });

  const chargeVuln = conflictOr500(async ({ request, env }) => {
    const body = await request.json();
    // The await gap IS the race window: the second same-key submission
    // reads 'nothing yet' and inserts after the first one did.
    const dup = await env.DB.prepare('SELECT id FROM charges WHERE cid = ?').bind(body?.idem).first('id');
    if (dup != null) return new Response('already charged', { status: 409 });
    await env.DB.prepare('INSERT INTO charges (cid, user, cents) VALUES (?, ?, ?)').bind(body?.idem, body?.user ?? 'rook', body?.cents ?? 0).run();
    return new Response('charged', { status: 201 });
  });

  const profileHard = async ({ request, env }) => {
    let body;
    try { body = await request.json(); } catch { return new Response('bad json', { status: 400 }); }
    if (typeof body?.user !== 'string') return new Response('invalid user', { status: 400 });
    const allowed = ['name', 'beta', 'email', 'alpha'];
    for (const k of Object.keys(body)) {
      if (k === 'user') continue;
      if (!allowed.includes(k)) return new Response('unknown field (allowed: name, beta, email, alpha)', { status: 400 });
    }
    // Per-field rows: each field is its own (user, field) cell - concurrent
    // writers writing DIFFERENT fields never touch each other's rows.
    for (const k of Object.keys(body)) {
      if (k === 'user') continue;
      const prev = await env.DB.prepare('SELECT value FROM settings WHERE user = ? AND field = ?').bind(body.user, k).first('value');
      if (prev != null) {
        await env.DB.prepare('UPDATE settings SET value = ? WHERE user = ? AND field = ?').bind(String(body[k]), body.user, k).run();
      } else {
        await env.DB.prepare('INSERT INTO settings (user, field, value) VALUES (?, ?, ?)').bind(body.user, k, String(body[k])).run();
      }
    }
    return new Response('saved', { status: 201, headers: { 'cache-control': 'no-store' } });
  };

  const profileVuln = async ({ request, env }) => {
    const body = await request.json();
    // The classic draft: whole-record write - delete the row, insert the
    // fresh blob. A concurrent writer's fields vanish without a trace.
    await env.DB.prepare('DELETE FROM blobs WHERE user = ?').bind(body?.user ?? 'rook').run();
    await env.DB.prepare('INSERT INTO blobs (user, json) VALUES (?, ?)').bind(body?.user ?? 'rook', JSON.stringify(body)).run();
    return new Response('saved', { status: 201 });
  };

  // Upload round: the 'upload' surface. Hardened: safe-name grammar +
  // content-type allow-list + size cap, storage keyed by the DERIVED name.
  // Vulnerable: the classic LLM draft - filename and content type straight
  // from the wire, echoed back verbatim.
  const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
  const ALLOWED_EXT = ['png', 'jpg', 'jpeg', 'txt', 'csv', 'pdf'];
  const uploadHard = async ({ request, env }) => {
    let data;
    try { data = await request.formData(); } catch { return new Response('bad multipart', { status: 400 }); }
    const file = data.get('file');
    if (!file || typeof file.name !== 'string' || file.name === '') {
      return new Response('missing file field', { status: 400 });
    }
    const name = file.name;
    if (!SAFE_NAME.test(name) || name.includes('..') || name.startsWith('.')) {
      return new Response('unsafe filename', { status: 400 });
    }
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return new Response('forbidden extension', { status: 400 });
    const mime = file.type ?? '';
    if (!['image/png', 'image/jpeg', 'text/plain', 'text/csv', 'application/pdf'].includes(mime)) {
      return new Response('forbidden content type', { status: 400 });
    }
    const content = await file.text();
    if (content.length > 64 * 1024) return new Response('too big', { status: 413 });
    await env.UPLOADS.put(name, content);
    return new Response('stored', {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    });
  };

  const uploadVuln = async ({ request, env }) => {
    const data = await request.formData();
    const file = data.get('file');
    // The classic draft: filename and content type straight from the wire -
    // storage key = raw client filename, response echoes it verbatim.
    await env.UPLOADS.put(file.name, await file.text());
    return Response.json({ stored: file.name, type: file.type });
  };

  // Recursion round: the 'validate' surface. Hardened: length cap + a
  // LINEAR pattern (bounded, anchored) - the class redos-catastrophic-
  // pattern refuses. Vulnerable: the classic nested-quantifier pattern
  // riding attacker-controlled strings - catastrophic backtracking.
  const validateHard = async ({ request }) => {
    let body;
    try { body = await request.json(); } catch { return new Response('bad json', { status: 400 }); }
    const value = body?.value;
    if (typeof value !== 'string' || value.length > 64) {
      return new Response('invalid value', { status: 400 });
    }
    if (!/^[a-zA-Z0-9-]{0,64}$/.test(value)) return new Response('invalid value', { status: 400 });
    return new Response('ok', { headers: { 'cache-control': 'no-store' } });
  };

  const validateVuln = async ({ request }) => {
    const body = await request.json();
    const value = String(body?.value ?? '');
    // The classic draft: an UNANCHORED alternation-quantifier behind
    // attacker-controlled text - catastrophic on failing inputs.
    if (/((a|aa)+)$/.test(value)) return new Response('ok');
    return new Response('rejected', { status: 400 });
  };
//   login: static sid every time (fixation classic) with ZERO hygiene flags
//   me:    trusts ANY sid cookie straight from the wire (forged = 200)
//   logout: a no-op 200 that neither deletes the row (there is none) nor
//           clears the cookie
const loginVuln = async () => new Response('ok', {
  status: 200,
  headers: { 'set-cookie': 'sid=rook-fixed-sid; Path=/' },
});

const meVuln = async ({ request }) => {
  if (!parseSid(request)) return new Response('401: send the sid cookie', { status: 401 });
  return Response.json({ user: 'trusted', from: 'cookie' });
};

const logoutVuln = async () => new Response(null, { status: 204 });

function conflictOr500(handler) {
  return async ({ request, env }) => {
    try {
      return await handler({ request, env });
    } catch (err) {
      if (String(err?.message).includes('UNIQUE')) {
        return new Response('key conflict', { status: 409, headers: { 'cache-control': 'no-store' } });
      }
      throw err;
    }
  };
}

function buildRoutes({ vulnerable = false } = {}) {
  // Hardened enroll: allow-list fields, validate shapes, no-store on writes.
  const enrollHard = conflictOr500(async ({ request, env }) => {
    let body;
    try { body = await request.json(); } catch { return new Response('bad json', { status: 400 }); }
    if (typeof body !== 'object' || body === null) return new Response('bad json', { status: 400 });
    for (const k of Object.keys(body)) {
      // Errors stay impersonal: never parrot attacker-controlled field names
      // back (a body field echoing its own name is the classic leak shape).
      if (!['key', 'owner'].includes(k)) return new Response('unknown field (allowed: key, owner)', { status: 400 });
    }
    if (typeof body.key !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(body.key)) {
      return new Response('invalid key', { status: 400 });
    }
    if (typeof body.owner !== 'string' || !/^[a-zA-Z0-9-]{1,32}$/.test(body.owner)) {
      return new Response('invalid owner', { status: 400 });
    }
    const res = await insert(env, body.key, body.owner);
    return Response.json({ ok: true, id: res.meta.last_row_id }, {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    });
  });

  // Vulnerable enroll: trusts everything, no hygiene (the LLM draft -
  // including the classic recursive merge that follows __proto__ keys).
  const mergeVulnerable = (target, sourceObj) => {
    for (const key of Object.keys(sourceObj)) {
      const value = sourceObj[key];
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        if (!target[key]) target[key] = {};
        mergeVulnerable(target[key], value);
      } else {
        target[key] = value;
      }
    }
    return target;
  };
  // Vulnerable enroll: trusts everything AND talks back - the error path
  // parrots the raw request text back (the classic LLM-draft leak shape that
  // taxonomy/errors-stay-impersonal pins), and malformed bodies escalate to
  // 500-shaped responses instead of honest 400s.
  const enrollVuln = async ({ request, env }) => {
    const text = await request.text();
    let body;
    try { body = JSON.parse(text); } catch {
      return new Response(`bad json: ${text.slice(0, 300)}`, { status: 500 });
    }
    if (typeof body !== 'object' || body === null) return new Response(`bad: ${text.slice(0, 300)}`, { status: 500 });
    const record = mergeVulnerable({}, body);
    const res = await insert(env, String(record.key), String(record.owner));
    return Response.json({ ok: true, id: res.meta.last_row_id });
  };

  const deviceHard = conflictOr500(async ({ request, env }) => {
    let body;
    try { body = await request.json(); } catch { return new Response('bad json', { status: 400 }); }
    for (const k of Object.keys(body ?? {})) {
      if (!['key', 'owner'].includes(k)) return new Response('unknown field (allowed: key, owner)', { status: 400 });
    }
    if (typeof body?.owner !== 'string' || !/^[a-zA-Z0-9-]{1,32}$/.test(body.owner)) {
      return new Response('invalid owner', { status: 400 });
    }
    // Server-side authority: the caller may only claim devices owned by itself.
    if (body.owner !== 'rook') return new Response('403: device writes are rook-scoped', { status: 403 });
    const res = await insert(env, body.key ?? 'provision', body.owner);
    return new Response('ok', { status: 201, headers: { 'cache-control': 'no-store' } });
  });

  // Vulnerable device: trusts the very field being written (owner==='admin' bypass).
  const deviceVuln = async ({ request, env }) => {
    const body = await request.json();
    if (body?.owner !== 'admin') return new Response('403: admins set their own owner', { status: 403 });
    await insert(env, String(body.key ?? 'provision'), String(body.owner));
    return new Response('ok', { status: 201 });
  };

  const adminHard = async () => new Response('403: admin only', { status: 403 });
  // Vulnerable admin: trusts identity headers straight from the wire AND -
  // the authz round - self-declared role bodies (the classic "role in the
  // body" draft: admin by body-declared role/admin/isAdmin field).
  const adminVuln = async ({ request, env }) => {
    let role = request.headers.get('x-is-admin') ?? request.headers.get('x-user-role');
    if (role !== 'admin' && role !== 'true') {
      try {
        const body = await request.json();
        role = body?.role ?? body?.isAdmin ?? body?.admin;
      } catch { /* no body - headers only, as the draft would do */ }
    }
    if (role === 'admin' || role === 'true') {
      const all = await env.DB.prepare('SELECT COUNT(*) FROM devices').first('count');
      return Response.json({ all: Number(all) });
    }
    return new Response('403: admin only', { status: 403 });
  };

  // The dev-debug leftover, both ways: the hardened app keeps the alias
  // route but it must deny IDENTICALLY to the primary admin gate (unauth
  // and spoofed); the vulnerable app's leftover is the trapdoor - same
  // count action, honors the identity headers the primary ignores.
  const devCheckHard = adminHard;
  const devCheckVuln = async ({ request, env }) => {
    let role = request.headers.get('x-is-admin') ?? request.headers.get('x-user-role');
    if (role === 'admin' || role === 'true') {
      const all = await env.DB.prepare('SELECT COUNT(*) FROM devices').first('count');
      return Response.json({ debugAll: Number(all), via: 'dev-check' });
    }
    return new Response('403: admin only (dev-check)', { status: 403 });
  };

  return {
    enroll: vulnerable ? enrollVuln : enrollHard,
    device: vulnerable ? deviceVuln : deviceHard,
    admin: vulnerable ? adminVuln : adminHard,
    'dev-check': vulnerable ? devCheckVuln : devCheckHard,
    burst: async () => new Response('accepted', { headers: { 'cache-control': 'no-store' } }),
    login: vulnerable ? loginVuln : loginHard,
    me: vulnerable ? meVuln : meHard,
    logout: vulnerable ? logoutVuln : logoutHard,
    validate: vulnerable ? validateVuln : validateHard,
    upload: vulnerable ? uploadVuln : uploadHard,
    charge: vulnerable ? chargeVuln : chargeHard,
    profile: vulnerable ? profileVuln : profileHard,
  };
}

export { ENV_SPEC, buildRoutes };
