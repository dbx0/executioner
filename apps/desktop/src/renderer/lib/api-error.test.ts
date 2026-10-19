import { describe, expect, it } from 'vitest'
import { apiErrorMessage } from './api-error.js'

describe('apiErrorMessage', () => {
  it('prefers what the engine said over what axios said', () => {
    // The engine knows the value was a wildcard; axios only knows it got a 400.
    const axiosish = {
      message: 'Request failed with status code 400',
      response: { status: 400, data: { error: '"*.bmw.com" is a wildcard: add it as a scope rule, not an asset' } },
    }
    expect(apiErrorMessage(axiosish)).toBe('"*.bmw.com" is a wildcard: add it as a scope rule, not an asset')
  })

  it('reads a message field too, since not every route names it error', () => {
    expect(apiErrorMessage({ message: 'nope', response: { data: { message: 'said so' } } })).toBe('said so')
  })

  it('falls back to the transport error when the body carries nothing useful', () => {
    expect(apiErrorMessage({ message: 'Network Error', response: { data: {} } })).toBe('Network Error')
  })

  it('falls back when there is no response at all', () => {
    expect(apiErrorMessage({ message: 'Network Error' })).toBe('Network Error')
  })

  it('takes a caller fallback for something that is not an error at all', () => {
    expect(apiErrorMessage(null, 'Could not save.')).toBe('Could not save.')
  })

  it('ignores a non-string error field rather than rendering an object', () => {
    expect(apiErrorMessage({ message: 'boom', response: { data: { error: { nested: true } } } })).toBe('boom')
  })
})
