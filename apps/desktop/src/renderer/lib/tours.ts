import type { HubTab, ViewId } from '../store.js'

/** One stop on a page tour. `target` names a `data-tour` anchor; without one the
 *  card sits in the middle of the screen with nothing highlighted. */
export interface TourStep {
  target?: string
  title: string
  body: string
}

export type TourId = 'about' | 'scope' | 'targets' | 'findings' | 'workflows' | 'agents' | 'tools' | 'settings'

/**
 * The first-visit walkthrough of each page. Keep steps short: a card is read in
 * a few seconds, and the user cannot do anything else until they move past it.
 */
export const TOURS: Record<TourId, readonly TourStep[]> = {
  about: [
    {
      title: 'Welcome to your engagement',
      body: 'This page sums up the engagement: assets in scope, what has been found and which agents are working. Every page has a short tour like this one the first time you open it.',
    },
    {
      target: 'nav',
      title: 'Find your way around',
      body: 'Engagement pages hold what you know about the target. Automation pages hold what runs against it: workflows, single tools and agents.',
    },
    {
      target: 'search',
      title: 'Jump anywhere',
      body: 'Search opens the command palette, where you can reach any page, target or finding. Ctrl+K (Cmd+K on macOS) opens it from anywhere.',
    },
    {
      target: 'about-close',
      title: 'Switching engagements',
      body: 'Close the engagement to go back to the landing screen and open another one. Its engine keeps running in the background.',
    },
  ],
  scope: [
    {
      title: 'Scope',
      body: 'Scope rules decide which assets you are allowed to touch. Every target is judged against them, and anything that does not match is flagged as unscoped.',
    },
    {
      target: 'scope-add',
      title: 'Add a rule',
      body: 'Include a domain, wildcard, IP or CIDR, or exclude one. Exclusions always win over inclusions.',
    },
    {
      target: 'scope-rules',
      title: 'Your rules',
      body: 'Existing rules are listed here. Removing one re-judges the targets it covered.',
    },
  ],
  targets: [
    {
      target: 'targets-add',
      title: 'Add a target',
      body: 'Start with a domain, IP, CIDR or URL. Workflows and tools add the hosts, ports and facts they discover underneath it.',
    },
    {
      target: 'targets-tree',
      title: 'The target tree',
      body: 'Click a target to see everything known about it. Right-click one to run a workflow or tool against it, or to change its scope.',
    },
    {
      target: 'targets-filter',
      title: 'Filter',
      body: 'Type here to narrow the tree. The tabs above the list filter it by scope status.',
    },
  ],
  findings: [
    {
      target: 'findings-list',
      title: 'Findings',
      body: 'Everything a run proved, plus the findings you write yourself. Pick one to read it, edit it and set its status.',
    },
    {
      target: 'findings-new',
      title: 'Write one yourself',
      body: 'Create a finding by hand for anything you confirmed outside a workflow.',
    },
    {
      target: 'findings-export',
      title: 'Export a report',
      body: 'Turn the findings into a report file for the engagement.',
    },
  ],
  workflows: [
    {
      target: 'workflows-list',
      title: 'Workflows',
      body: 'A workflow chains tools into a graph that runs against a target. Click one to preview or run it. Domain recon and Host scan are starters you can use or edit.',
    },
    {
      target: 'workflows-create',
      title: 'Build your own',
      body: 'Open the canvas and connect a trigger to tools, conditions and scripts.',
    },
    {
      target: 'workflows-schedules',
      title: 'Run them automatically',
      body: 'A schedule runs a workflow on an interval, or whenever a target of a given kind is created. Schedules belong to this engagement.',
    },
    {
      target: 'workflows-runs',
      title: 'Recent runs',
      body: 'Every run shows up here with its status. Open one to follow each step and its output.',
    },
  ],
  agents: [
    {
      target: 'agents-teams',
      title: 'Agents',
      body: 'Saved agents are AI launches you can reuse in any engagement. A team is a lead agent that hands work to its members.',
    },
    {
      target: 'agents-add-team',
      title: 'Add a team',
      body: 'Write a roster of members with their own prompts, models and tools.',
    },
    {
      target: 'agents-add',
      title: 'Add a single agent',
      body: 'Pick an agent CLI and give it a standing prompt, so you can launch the same setup again without retyping it.',
    },
  ],
  tools: [
    {
      target: 'tools-catalog',
      title: 'Tool catalog',
      body: 'Every tool you can run by itself, outside a workflow. Tools that are not installed on the selected machine are marked.',
    },
    {
      target: 'tools-run',
      title: 'Configure and run',
      body: 'Choose the targets and parameters, check the command it will run, then start it.',
    },
    {
      target: 'tools-output',
      title: 'Output',
      body: 'The live output appears here. Hosts, ports and facts it discovers are saved to the targets.',
    },
    {
      target: 'tools-connection',
      title: 'Where it runs',
      body: 'Run on this machine or on a saved SSH or Docker connection.',
    },
  ],
  settings: [
    {
      target: 'settings-nav',
      title: 'Settings',
      body: 'Connections, agents, skills, custom nodes and API keys are kept here and shared by every engagement. General has the button to replay these tours.',
    },
  ],
}

/** The tour for the page on screen, if it has one. Workflows and Agents share a
 *  view, told apart by the hub tab. */
export function tourIdFor(view: ViewId, hubTab: HubTab): TourId | null {
  if (view === 'workflows') return hubTab
  if (view === 'terminals') return null
  return view
}
