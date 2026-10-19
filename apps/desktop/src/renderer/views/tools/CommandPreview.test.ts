import { describe, expect, it } from 'vitest'
import { commandLine } from './CommandPreview.js'

describe('commandLine', () => {
  it('leaves plain args bare and quotes the ones a shell would split or expand', () => {
    expect(commandLine({ program: 'nmap', args: ['-p', '80,443', 'example.com'] })).toBe('nmap -p 80,443 example.com')
    expect(commandLine({ program: 'searchsploit', args: ['apache 2.4', "it's", ''] })).toBe(
      "searchsploit 'apache 2.4' 'it'\\''s' ''",
    )
  })

  it('shows the target stand-in as is', () => {
    expect(commandLine({ program: 'nmap', args: ['<target>'] })).toBe('nmap <target>')
  })
})
