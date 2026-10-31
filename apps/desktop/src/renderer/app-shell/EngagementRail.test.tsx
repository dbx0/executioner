import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '../components/ui/tooltip.js'
import { useApp } from '../store.js'
import { EngagementRail } from './EngagementRail.js'

const engagement = (root: string, browserAsks: Record<string, string>) => ({ root, name: root, browserAsks }) as never

describe('EngagementRail', () => {
  it('marks an engagement whose agent is waiting on the operator in a browser', () => {
    useApp.setState({ open: [engagement('/a', {}), engagement('/b', { b1: 'Solve the captcha' })], activeRoot: '/a' })
    const { container } = render(
      <TooltipProvider>
        <EngagementRail />
      </TooltipProvider>,
    )
    expect(container.querySelectorAll('[data-engagement-ask]')).toHaveLength(1)
  })
})
