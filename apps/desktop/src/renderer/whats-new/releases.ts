import type { Release } from '../lib/whats-new.js'
import tourClip from '../assets/whats-new/0.0.9.webm'

/**
 * The notes behind the "What's new" dialog, one entry per release that has
 * something worth showing. Add the entry for a release before bumping the
 * version; a release with no entry opens no dialog.
 *
 * `media` is the clip on top: import a webm, mp4 or gif from
 * assets/whats-new/ and keep it short and small, since it ships in the app.
 * Write the items for the person using the app, not as commit subjects.
 */
export const RELEASES: Release[] = [
  {
    version: '0.0.10',
    title: 'A new look: pitch black with floating glass',
    summary:
      'The whole app has been redrawn. The window is pure black, every page sits on floating glass panels, and the title bar and status bar are gone to leave more room for your work.',
    sections: [
      {
        title: 'New',
        items: [
          'Floating sidebar: your engagements, navigation, sessions and runs live in one glass panel, with account usage at the bottom.',
          'Collapse the sidebar and the engagement icons stay on screen, so switching engagement is always one click.',
          'Every page has its own toolbar with pill buttons, and you can drag the window from it.',
          'Tabs in the workspace are one capsule strip, and terminals, files and browsers sit on black cards that match the theme.',
          'Agent teams show as a strip of member chips above the terminal.',
          'Workflow editor: the palette, toolbar and zoom controls float over the canvas.',
          'Chat with the workflow assistant before the workflow has been saved.',
          'Search in Findings: narrow the list by title, content, severity, status or target as you type.',
          'Red team agents and a Red Team Ops team ship with every install.',
          'When an agent asks you something, the question opens as a dialog and the session is marked in the sidebar.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'The app version moved to the bottom of the Settings menu and the start screen.',
          'Open existing engagement: picking a folder opens it right away.',
          'A folder that is not an engagement now says so in plain words and tells you what to do next.',
          'Escape closes every dialog.',
          'Lists and panels show a loading placeholder instead of an empty space, and buttons show progress while they work.',
          'Critical and high severity findings have different colors.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'Keyboard focus rings and hover states were missing on many buttons and now show.',
          'Severity and status chips had no background color.',
          'The finding detail lines up on wide screens.',
        ],
      },
    ],
  },
  {
    version: '0.0.9',
    title: 'Actions run your recon for you',
    summary:
      'The new Actions page runs a workflow or a single tool when a target is added or on a schedule, for one engagement or for all of them.',
    media: {
      kind: 'video',
      src: tourClip,
      alt: 'A tour of this release: creating an action from a suggestion, the recon workflow and its new nodes, and running an agent with one session per target.',
    },
    sections: [
      {
        title: 'New',
        items: [
          'Actions page: run a workflow or a tool when a target is added or on a schedule, with defaults shared by every engagement.',
          'Attack surface: TLS certificates and DNS records are saved on the target, with new TLS Certificate, DNS Records, ASN Lookup and Cloud Buckets nodes.',
          'A Recon starter workflow built from nodes alone, with no scripts to maintain.',
          'Agent in the new session menu: choose any installed CLI, saved agent or team, then the targets and where it runs.',
          'One session per target: start a separate agent session for each selected target.',
          'Four specialist agents ship with every install: Recon Scout, Web Vuln Hunter, API & GraphQL Hunter and Mobile Recon.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'Workflows begin at a single Start node. Schedules and "when a target is added" moved to Actions.',
          'Loops can go over the rows a node returned and stop after a set number of items.',
          'httpx, nuclei and whatweb take custom headers and a rate limit.',
          'The workflow assistant builds with nodes and their settings instead of writing scripts.',
        ],
      },
    ],
  },
]
