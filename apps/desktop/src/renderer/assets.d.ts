// Ambient declarations for static asset imports handled by Vite. This file is a
// script (no imports/exports) so the wildcard module declarations are global.
declare module '*.png' {
  const src: string
  export default src
}

declare module '*.svg' {
  const src: string
  export default src
}
