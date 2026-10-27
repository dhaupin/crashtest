// The ONE door through which the app touches react-router-dom.
//
// WHY this shape exists (three-way loader dance - determinism first):
// react-router v7 ships BOTH dist/index.js (CJS main) and dist/index.mjs
// ("module" field), and this site needs the router loaded through TWO
// loaders that must agree:
//   1. vite's SSR lane (ssrLoadModule: AppLayout -> pages -> hooks),
//   2. the browser bundle (rollup build),
//   3. prestruct's prerender, which native-imports StaticRouter from the
//      package OUTSIDE the vite graph.
// The prerender StaticRouter and the app's useLocation() must attach to the
// SAME router context object, so the router module must be ONE instance.
// Vite 6 cannot lift named exports off its SSR-externalized CommonJS
// ("Named export 'useLocation' not found"), forces the ESM mjs leaf on the
// bundler lane, and neither lane exposes a stable named namespace on its
// own. So this file takes whichever shape the RUNNING lane provides:
//   - browser/rollup lane: resolves the "module" mjs - namespace carries
//     the real named exports;
//   - vite SSR lane: the package externalizes to its CJS leaf under node's
//     default conditions - namespace carries only "default" (= the CJS
//     singleton, which is WHY require and import share it: one module
//     instance across both node lanes, the same one prestruct's native
//     import sees).
// One context survives all three. Do NOT named-import 'react-router-dom'
// directly in app files; keeping the door here is what makes that stays.
import * as rrdomNs from 'react-router-dom'

const rrdom = rrdomNs?.useLocation
  ? rrdomNs
  : rrdomNs?.default?.useLocation
    ? rrdomNs.default
    : rrdomNs

const {
  BrowserRouter,
  HashRouter,
  MemoryRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  Link,
  NavLink,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} = rrdom

export {
  BrowserRouter,
  HashRouter,
  MemoryRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  Link,
  NavLink,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
}
