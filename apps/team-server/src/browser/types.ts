export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** Same shape Electron pushes on `browser-state`. */
export interface BrowserState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  crashed: boolean
}

export type OperatorOp = 'back' | 'forward' | 'reload' | 'stop' | { navigate: string }

export interface BrowserStateEvent {
  root: string
  id: string
  state: BrowserState
}

export const BROWSER_DARWIN_REQUIRED = 'Host browser requires macOS (Darwin)'

export const EMPTY_STATE: BrowserState = {
  url: 'about:blank',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  crashed: false,
}
