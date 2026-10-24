/**
 * src/main.jsx - hydrate if prerendered SSR exists, fresh-mount otherwise.
 * (Engine logic per prestruct template; crashtest only adds the CSS import.)
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

const root = document.getElementById('root')

if (root && root.dataset.serverRendered) {
  ReactDOM.hydrateRoot(root, <React.StrictMode><App /></React.StrictMode>)
} else if (root) {
  ReactDOM.createRoot(root).render(<React.StrictMode><App /></React.StrictMode>)
}
