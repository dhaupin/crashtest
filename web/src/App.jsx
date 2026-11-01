/**
 * src/App.jsx
 * ===========
 * TEMPLATE FILE -- wire your AppLayout here, keep BrowserRouter in this file only.
 *
 * BrowserRouter must NOT be imported in AppLayout.jsx or any file it imports.
 * If it is, ssrLoadModule will initialize BrowserRouter against window.location
 * (which defaults to '/' in Node), and every route will prerender as the
 * homepage with no error message. See AGENTS.md for the full explanation.
 */

import { BrowserRouter } from 'react-router-dom'
import AppLayout from './AppLayout.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  )
}
