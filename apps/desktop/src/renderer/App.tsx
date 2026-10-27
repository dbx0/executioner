import type { JSX } from 'react'
import { useEffect } from 'react'
import { Shell } from './app-shell/Shell.js'
import { installNativeContextMenuSuppression } from './lib/native-context-menu.js'
import { UpdateNotice } from './components/UpdateNotice.js'

export function App(): JSX.Element {
  // A desktop app has no use for the browser's Back/Reload/Inspect menu: the
  // app draws its own menus, and the OS one only appears where it was forgotten.
  useEffect(() => installNativeContextMenuSuppression(), [])

  return (
    <>
      <Shell />
      <UpdateNotice />
    </>
  )
}
