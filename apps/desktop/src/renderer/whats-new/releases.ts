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
