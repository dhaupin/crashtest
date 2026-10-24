/** AppLayout - the shell layout (no BrowserRouter ever in this file). */
import { Routes, Route, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { mountIslands } from './islands.js'
import { islands }      from './AppIslands.jsx'
import Nav from './components/Nav.jsx'
import Footer from './components/Footer.jsx'
import Home from './pages/Home.jsx'
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
          {/* add your routes here, one Route per ssr.config.js entry */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </>
  )
}
