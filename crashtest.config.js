// crashtest dogfood target — attacks its own fixture app (fixtures/demo).
// The committed labs/crashledger.json baseline is cut against the HARDENED
// variant, so CI fails if the app or the attacker regresses. Swap the flag
// to `{ vulnerable: true }` locally to watch the fresh-run exit go 1.
import { ENV_SPEC, buildRoutes } from './fixtures/demo/app.js';

export default {
  baseUrl: 'https://dogfood.crashtest.local',
  env: ENV_SPEC,
  routes: buildRoutes({ vulnerable: false }),
  // The dogfood attacks ONLY the demo fixture — shipped packs (e.g.
  // wordpress-money, which needs a WP worker) never ride this run.
  packs: false,
  // attackCtx per-module defaults live here (route names etc.) when needed.
  seed: 0xC0FFEE,
};
