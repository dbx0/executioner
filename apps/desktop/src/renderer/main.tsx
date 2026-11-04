import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { ErrorBoundary } from './components/ErrorBoundary.js'
import { installRendererErrorCapture } from './lib/log.js'
import './index.css'

installRendererErrorCapture()
const root = document.getElementById('root')
if (root !== null) createRoot(root).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>)
