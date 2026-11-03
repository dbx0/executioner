import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { installHostBridge, resolveHostBridgeConfig } from './host-bridge.js'
import './index.css'

// Electron preload installs window.executioner before this module runs. In the
// portable browser build there is no preload, so the Host RPC bridge fills in.
if (typeof window.executioner === 'undefined') {
  installHostBridge(resolveHostBridgeConfig())
}

const root = document.getElementById('root')
if (root !== null) createRoot(root).render(<StrictMode><App /></StrictMode>)
