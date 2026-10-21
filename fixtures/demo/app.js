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
      },
    },
  },
  kv: { DEVICE_CACHE: { seed: { last: 'seed' } } },
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
};  // Recursion round: the 'validate' surface. Hardened: length cap + a
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
  };
}

export { ENV_SPEC, buildRoutes };
