/** AppLayout - styled after prestruct's engine layout (no BrowserRouter ever). */
import { Routes, Route, useLocation } from './router-interop.js'
import { useEffect } from 'react'
import { mountIslands } from './islands.js'
import { islands }      from './AppIslands.jsx'
import Nav from './components/Nav.jsx'
import Footer from './components/Footer.jsx'
import Home from './pages/Home.jsx'
import Attacks from './pages/Attacks.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Status from './pages/Status.jsx'
import FAQ from './pages/FAQ.jsx'
import Terms from './pages/Terms.jsx'
import Privacy from './pages/Privacy.jsx'
import NotFound from './pages/NotFound.jsx'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'instant' })
    const t = setTimeout(() => mountIslands(islands), 0)
    return () => clearTimeout(t)
  }, [pathname])
  return null
}

export default function AppLayout() {
  return (
    <>
      <ScrollToTop />
      <Nav />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/attacks" element={<Attacks />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/status" element={<Status />} />
          <Route path="/faq" element={<FAQ />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </>
  )
}
