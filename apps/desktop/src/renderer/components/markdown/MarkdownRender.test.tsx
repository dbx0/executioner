import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownRender } from './MarkdownRender.js'

describe('MarkdownRender', () => {
  it('hides HTML comments instead of printing them', () => {
    const { container } = render(
      <MarkdownRender
        source={'<!-- executioner:briefing:start -->\n\n# Briefing\n\nbody <!-- inline --> text\n\n<!-- executioner:briefing:end -->\n'}
      />,
    )
    expect(container.textContent).not.toContain('executioner:briefing')
    expect(container.textContent).not.toContain('inline')
    expect(container.textContent).toContain('Briefing')
    expect(container.textContent).toContain('body')
  })
})
