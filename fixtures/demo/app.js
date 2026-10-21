// S1.5 - dogfood fixture: crashtest attacks its own fixture app.
// `fixtures/demo` models the smallest real agent-built API: a device
// registration surface with an admin panel. TWO variants:
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
  // Vulnerable admin: trusts identity headers straight from the wire.
  const adminVuln = async ({ request, env }) => {
    const role = request.headers.get('x-is-admin') ?? request.headers.get('x-user-role');
    if (role === 'admin' || role === 'true') {
      const all = await env.DB.prepare('SELECT COUNT(*) FROM devices').first('count');
      return Response.json({ all: Number(all) });
    }
    return new Response('403: admin only', { status: 403 });
  };

  return {
    enroll: vulnerable ? enrollVuln : enrollHard,
    device: vulnerable ? deviceVuln : deviceHard,
    admin: vulnerable ? adminVuln : adminHard,
    burst: async () => new Response('accepted', { headers: { 'cache-control': 'no-store' } }),
  };
}

export { ENV_SPEC, buildRoutes };
