import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react'
import { errorFields, rlog } from '../lib/log.js'
import { Button } from './ui/button.js'

/** Logs a render crash with its component stack and shows a plain fallback instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    rlog.error('react', 'Render crash', { ...errorFields(error), componentStack: info.componentStack ?? '' })
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-6 text-center text-[13px]">
        <p>Something went wrong. Restart Executioner, then export the logs from Settings &gt; Logs.</p>
        <Button size="sm" onClick={() => window.location.reload()}>Reload</Button>
      </div>
    ) as JSX.Element
  }
}
