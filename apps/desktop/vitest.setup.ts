import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Monaco probes these during initialisation and jsdom implements neither.
// Stubbing them here keeps any test that renders the editor from throwing.
if (typeof document !== 'undefined') {
  if (typeof document.queryCommandSupported !== 'function') {
    document.queryCommandSupported = () => false
  }
  if (typeof document.execCommand !== 'function') {
    document.execCommand = () => false
  }
}

afterEach(() => {
  cleanup()
})
