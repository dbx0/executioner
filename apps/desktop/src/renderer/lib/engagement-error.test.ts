import { describe, expect, it } from 'vitest'
import { engagementOpenError } from './engagement-error.js'

describe('engagementOpenError', () => {
  it('explains a folder that is not an engagement, without the plumbing', () => {
    const raw =
      "Error invoking remote method 'open-project': Error: engine exited before handshake (code 1): error: /home/me/Pwning/HACKERONE/IFOOD is not an Executioner project"
    expect(engagementOpenError(new Error(raw))).toBe(
      '"IFOOD" is not an engagement yet. Create one in that folder with New engagement, or open a folder that already has one.',
    )
  })

  it('names the folder for a Windows path too', () => {
    expect(engagementOpenError(new Error('C:\\work\\acme is not an Executioner project'))).toContain('"acme"')
  })

  it('keeps an unknown cause but drops the wrappers', () => {
    const raw = "Error invoking remote method 'open-project': Error: engine exited before handshake (code 1): error: database is locked"
    expect(engagementOpenError(new Error(raw))).toBe('Could not open the engagement: database is locked')
  })

  it('says the engine could not start when it gave no reason', () => {
    const raw = "Error invoking remote method 'open-project': Error: engine exited before handshake (code unknown)"
    expect(engagementOpenError(new Error(raw))).toMatch(/^The engine could not start/)
  })

  it('names the folder that failed when asked to', () => {
    expect(engagementOpenError(new Error('error: database is locked'), '/work/acme')).toBe(
      'Could not open "acme": database is locked',
    )
  })

  it('falls back when there is nothing to say', () => {
    expect(engagementOpenError(undefined)).toBe('Could not open the engagement.')
  })
})
