# Portable host Mac parity plan

Move every Electron-only shell capability onto the team-server Host RPC so a Mac browser tab is a full Executioner client. Engines stay on the host. The UI stays the same React app. Stage 1 is macOS only. Windows and Linux stay on Electron or stubs until later. PR order is `PR-mac-host-native`, then `PR-mac-host-ssh`, then `PR-mac-host-browser`, then `PR-retire-electron-stubs`.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `skills/poteto-mode/playbooks/autopilot-stack.md` under the installed plugin. The operator reviews and lands each PR. Owners stop at STACK-READY. The root does not merge.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these from the installed plugin at program start. Re-read them at every tick.
  - [ ] `skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `skills/swarm/SKILL.md`
  - [ ] `$0/verify/SKILL.md` (Cursor verify skill for browser and portable UI)
  - [ ] `skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `skills/how/SKILL.md`
  - [ ] `skills/architect/SKILL.md`
  - [ ] `skills/principle-sequence-verifiable-units/SKILL.md`
  - [ ] `skills/principle-prove-it-works/SKILL.md`
- [ ] On the operator's go, arm the hourly audit tick as a real cadence with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from the installed plugin. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a lane only on affirmative failure evidence, and dispatch its replacement in the same tick. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges, or rebase its branch onto the parent's exact tip when the execution playbook stacks. A same-repository child PR targets its parent branch. A fork child PR targets trunk while retaining local parent ancestry. Freeze the bottom-to-top order because fork PR bases do not encode it.
  - [ ] `PR-mac-host-native` branches from `main`.
  - [ ] `PR-mac-host-ssh` after `PR-mac-host-native`.
  - [ ] `PR-mac-host-browser` after `PR-mac-host-ssh`.
  - [ ] `PR-retire-electron-stubs` after `PR-mac-host-browser`.
- [ ] Hold the file boundaries. `PR-mac-host-native` and `PR-mac-host-ssh` touch `apps/team-server/**`, `apps/desktop/src/renderer/host-bridge.ts`, and shared hint helpers only. `PR-mac-host-browser` may also touch `apps/desktop/src/renderer/views/terminals/BrowserPane.tsx` and new host browser packages. `PR-retire-electron-stubs` may delete or gate `apps/desktop` Electron entrypoints.
- [ ] Hold the review gate. `PR-mac-host-native`, `PR-mac-host-ssh`, and `PR-mac-host-browser` change an interaction. They wait for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Record the intended PR base repository as canonical `<base-repo>` and validate it through the active forge. Do not infer it from the checkout's default remote. Capture it as a shell variable and pass `--repo "$base_repo"` to every `gh pr` command. Resolve and validate `<head-url>` through Shipping step 1 and capture it as `head_url` for the live-lane fetch. When the head repository is a fork, validate its identity and record its owner and repository name as `<fork-owner>` and `<head-name>`. Never require `gt`.
- [ ] Open the PR before self-proof and follow the readiness rule in `skills/poteto-mode/playbooks/opening-a-pr.md`. Open it ready by default. When repository instructions require a draft until named evidence exists, keep it draft until that evidence is recorded. Use `origin pr create --status open --base "$base_branch"` or `gh pr create --base "$base_branch" --repo "$base_repo"` for a ready same-repository PR. A same-repository stack child targets its parent branch. Every fork PR targets trunk. With GitHub, capture the approved PR title and body as `<title>` and `<body>`, then create it with `gh api --method POST "repos/$base_repo/pulls" -f "title=$title" -f "body=$body" -f "head=$fork_owner:$branch" -f "head_repo=$head_name" -f "base=$trunk" --jq .html_url`; add `-F draft=true` when repository instructions require a draft. Otherwise use the resolved Origin command. Stacked fork branches retain local parent ancestry.
- [ ] Run the repo's lint and typecheck once before the PR-facing push. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every Bugbot and security-reviewer comment per `skills/poteto-mode/references/bugbot-triage.md` under the installed plugin.
- [ ] Rebase each independent PR and stack root onto current trunk before the code-ready report and babysit. Rebase each unmerged stack child onto its parent's exact tip. Keep that merge base in fix rounds. Rebase again only at merge prep, on a `git merge-tree` conflict with trunk, or on a CI failure that comes from a change on trunk. After its parent merges, use Shipping's explicit old-base-to-trunk rebase before the child's merge-ready report.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head. Run each full swarm per `skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner, including a defect that a lane filed as a note. A new head gets a fresh verdict, except for results that stay valid under the patch ID rule in `skills/poteto-mode/playbooks/shipping.md`.
- [ ] Autopilot-stack does not merge. The owner reports STACK-READY with the exact head SHA. The root appends the PR to the frozen bottom-to-top stack. The operator lands each PR through Shipping. Same-repository child PRs target parent branches. Record the verdict SHA, current landing SHA, recorded patch base, and patch ID rule from `skills/poteto-mode/playbooks/shipping.md`.

### Boot recipe, for every live lane

Each live lane is one `swarm workers` lane at the PR head, resolved through provider dispatch, in its own worktree or output directory, with its own receipt. Drive the surface only through the driver skill this plan names.

- [ ] `git fetch -- "$head_url" "refs/heads/$head_branch" && git checkout --detach "$head_sha"` in the lane's worktree.
- [ ] Start `executioner-host serve` on a free loopback port with a known bootstrap token. Wait until `GET /health` returns `{"ok":true,"role":"executioner-host"}`. Open the printed `portable UI` URL that includes `?token=`.
- [ ] Deliver input only through the verify skill's browser commands. Use CDP or accessibility snapshots as read-only diagnostics.
- [ ] Save every screenshot to `/tmp/exe-swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the receipt path.

## Wire Mac native host RPCs (PR-mac-host-native)

**Depends on.** None.

**Files.**

- [ ] Edit `apps/team-server/src/host.ts`.
- [ ] Create `apps/team-server/src/mac-dialogs.ts`.
- [ ] Create `apps/team-server/src/mac-dialogs.test.ts`.
- [ ] Create `apps/team-server/src/connection-hints.ts` or move shared parse helpers out of `apps/desktop/src/main/connection-hints.ts` into a package both shells import.
- [ ] Create `apps/team-server/src/engagement-photo.ts`.
- [ ] Edit `apps/desktop/src/renderer/host-bridge.ts`.
- [ ] Edit `apps/desktop/src/renderer/host-bridge.test.ts`.
- [ ] Edit `apps/team-server/src/cli.ts` only if platform guard messaging needs a Mac note.

**Build.**

- [ ] Add Host RPC `POST /host/dialogs/folder` that on Darwin runs a native folder chooser (`osascript` choose folder) and returns `{ path }` or `{ path: null }` when cancelled.
- [ ] Add Host RPC `GET /host/connection-hints` that returns the same shape as Electron `collectConnectionHints` from `~/.ssh` and local docker images.
- [ ] Add Host RPCs for engagement photo pick, read, write, and clear. Image pick uses a Mac file dialog. Encode to a square PNG with `sips` or an existing image helper, not Electron `nativeImage`.
- [ ] Point `host-bridge` `pickFolder`, `connectionHints`, and photo methods at those RPCs. Keep a clear error on non-Darwin instead of a silent stub.
- [ ] Rebuild portable assets with `pnpm --filter @exe/desktop build:web`.

**You see.**

- [ ] In the portable UI on Mac, Open engagement opens a native folder dialog. Connection onboarding shows SSH host hints from `~/.ssh/config`. An engagement photo can be picked and shown.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/team-server/src/mac-dialogs.test.ts` covers success, cancel, and non-Darwin refusal. Run `pnpm --filter @exe/team-server test`.
- [ ] `apps/desktop/src/renderer/host-bridge.test.ts` asserts the new Host paths and bearer header. Run `pnpm --filter @exe/desktop exec vitest run src/renderer/host-bridge.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` role at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. On trunk, Open engagement uses a path prompt and connection hints are empty. On head, Open engagement uses the native dialog path RPC and hints load. Save `native-vs-trunk.png`. Pass when head no longer shows the path-prompt-only flow for folder pick after a successful dialog RPC.
- [ ] Lane 2. Open printed `?token=` URL. Call folder pick and choose a real directory. Save `folder-pick.png`. Pass when the chosen absolute path appears in the open engagement flow.
- [ ] Lane 3. Cancel the folder dialog. Save `folder-cancel.png`. Pass when the UI stays on the landing state with no engagement opened.
- [ ] Lane 4. Load connection hints with a known `~/.ssh/config` Host alias present. Save `hints.png`. Pass when that alias is offered in the connection step.
- [ ] Lane 5. Pick an engagement photo PNG. Save `photo-pick.png`. Pass when the engagement badge shows the image.
- [ ] Lane 6. Clear the engagement photo. Save `photo-clear.png`. Pass when the badge returns to the default mark.
- [ ] Lane 7. Hit `GET /host/connection-hints` without a bearer. Save `hints-401.png` or log the status. Pass when the status is 401.
- [ ] Lane 8. Run host on Darwin and complete one folder RPC that returns null on cancel. Save `folder-rpc-null.png`. Pass when the JSON body is `{ "path": null }` and the host process stays up.
- [ ] Lane 9. Hard refresh without `?token=` after a prior token in `localStorage`. Save `token-persist.png`. Pass when folder pick still authorizes.
- [ ] Lane 10. Open engagement via New engagement after a native folder pick. Save `new-engagement.png`. Pass when the engine health path succeeds for that root.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from `POST /host/dialogs/folder` request start to JSON response when the dialog is auto-cancelled in a test harness, plus end-to-end time until the landing page is interactive after host start.
- [ ] Probe. Script a cancelled dialog RPC ten times at trunk stub vs head Mac handler interleaved. Record host `GET /` time to first paint separately.
- [ ] Baseline. Record trunk cancelled-stub median first.
- [ ] Rule. Head cancelled-dialog RPC p50 stays under 2000 ms. First paint after host start stays within 20 percent of trunk.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2 and lane 5 screenshots into `/tmp/exe-media/PR-mac-host-native-review-folder.png` and `/tmp/exe-media/PR-mac-host-native-review-photo.png`.
- [ ] Record a 30 to 60 second video of folder pick and photo pick on a live lane. Save it as `/tmp/exe-media/PR-mac-host-native-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] After the verdict, an owner merge uses Shipping step 4 to move the PR from its recorded patch base onto current trunk. An appended stack child keeps its recorded parent tip until that parent lands. Record the current landing SHA. Preserve the verdict only when the patch ID stays unchanged.
- [ ] Autopilot-stack. The owner does not squash-merge. The root appends `PR-mac-host-native` as stack bottom. The operator lands it first. Same-repository children target the parent branch.

## Wire Mac SSH enroll and backend test (PR-mac-host-ssh)

**Depends on.** `PR-mac-host-native`.

**Files.**

- [ ] Edit `apps/team-server/src/host.ts`.
- [ ] Create `apps/team-server/src/engine-cli.ts` helper for `ssh-enroll` and `backend-test`.
- [ ] Create `apps/team-server/src/engine-cli.test.ts`.
- [ ] Edit `apps/desktop/src/renderer/host-bridge.ts`.
- [ ] Edit `apps/desktop/src/renderer/host-bridge.test.ts`.

**Build.**

- [ ] Add Host RPC `POST /host/ssh/enroll` that runs the engine `ssh-enroll --key-dir <host-ssh-keys-dir>` with the same JSON stdin Electron uses.
- [ ] Add Host RPC `POST /host/backends/test` that runs engine `backend-test` the same way Electron `testBackend` does.
- [ ] Store generated keys under the host user-level ssh key dir, matching Electron `globalLayout.sshKeys()`.
- [ ] Wire `host-bridge` `enrollSsh` and `testBackend` to those RPCs.

**You see.**

- [ ] Portable onboarding SSH step can enroll a key and run a backend test without "Not available in the portable browser UI".

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/team-server/src/engine-cli.test.ts` stubs spawn and checks argv, stdin, and key-dir. Run `pnpm --filter @exe/team-server test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` role at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk enroll returns the portable stub error. Head enroll hits `/host/ssh/enroll`. Save `ssh-vs-trunk.png`. Pass when head no longer returns the stub error string.
- [ ] Lane 2. Enroll against a local test SSH listener or recorded fixture host. Save `ssh-enroll.png`. Pass when `identityFile` is a real path under the host key dir.
- [ ] Lane 3. Enroll with a bad password. Save `ssh-enroll-fail.png`. Pass when the UI shows the failed step detail.
- [ ] Lane 4. Backend test for a local profile. Save `backend-test.png`. Pass when steps include a passing connect result.
- [ ] Lane 5. Backend test for an invalid host. Save `backend-test-fail.png`. Pass when `ok` is false and a step names the failure.
- [ ] Lane 6. Unauthorized enroll call. Save `ssh-enroll-401.png` or the status log. Pass when status is 401.
- [ ] Lane 7. Complete SSH onboarding through workspace save. Save `ssh-onboard-done.png`. Pass when the connection appears in the engagement.
- [ ] Lane 8. Reuse an enrolled key on a second engagement open. Save `ssh-reuse.png`. Pass when the same identity file is offered.
- [ ] Lane 9. Skip SSH and finish local onboarding still works. Save `ssh-skip-local.png`. Pass when local engagement opens.
- [ ] Lane 10. Concurrent enroll requests serialize or return distinct key names without corrupting files. Save `ssh-enroll-concurrent.png` or the response log. Pass when both responses are well-formed JSON.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall time for a failing enroll (bad host) and for backend-test failure, plus UI time until the error shows.
- [ ] Probe. Run failing enroll five times at head. Trunk only has the instant stub. Use absolute budgets for head.
- [ ] Baseline. Record trunk stub latency first for reference only.
- [ ] Rule. Failing enroll returns within 15000 ms. Error visible in UI within 2000 ms of the RPC response.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2 and lane 4 screenshots into `/tmp/exe-media/PR-mac-host-ssh-review-enroll.png` and `/tmp/exe-media/PR-mac-host-ssh-review-test.png`.
- [ ] Record a 30 to 60 second video of SSH enroll plus backend test. Save `/tmp/exe-media/PR-mac-host-ssh-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] After the verdict, record landing SHA and patch base per Shipping.
- [ ] Autopilot-stack. Append after `PR-mac-host-native`. Operator lands second. Child targets parent branch.

## Host Chromium Browser pane on Mac (PR-mac-host-browser)

**Depends on.** `PR-mac-host-ssh`.

**Files.**

- [ ] Create `apps/team-server/src/browser/` or a small `@exe/host-browser` package for Mac Chromium session control.
- [ ] Edit `apps/team-server/src/host.ts` for browser Host RPC and WebSocket or SSE for browser state.
- [ ] Edit `apps/desktop/src/renderer/host-bridge.ts` `browser.*` methods.
- [ ] Edit `apps/desktop/src/renderer/views/terminals/BrowserPane.tsx` only if the portable path needs a screenshot or remote-frame surface instead of `BrowserView` bounds.
- [ ] Create host browser unit tests under the new package.

**Build.**

- [ ] On Darwin, launch or attach a Chromium-based browser the host controls with CDP, reusing as much of `apps/desktop/src/main/browser/` driver logic as possible without Electron `BrowserView`.
- [ ] Implement Host RPC for `place`, `setOccluded`, `operator`, and `onState` equivalents. Portable UI shows the remote page either as a streamed frame or a host-owned window keyed to the session, chosen in architect before code.
- [ ] Keep Electron BrowserView path working until `PR-retire-electron-stubs`.

**You see.**

- [ ] Portable Terminals Browser pane can navigate, show page state, and run operator actions on Mac without Electron.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Host browser unit tests cover place null, navigate, and state emission with a fake CDP. Run the package test command named in the PR.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` role at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk portable browser methods no-op. Head opens a real page. Save `browser-vs-trunk.png`. Pass when head shows navigated content or a host browser window for the session.
- [ ] Lane 2. Open Browser session and navigate to `https://example.com`. Save `browser-example.png`. Pass when title or URL state reflects example.com.
- [ ] Lane 3. Resize or place the pane. Save `browser-place.png`. Pass when place RPC succeeds and UI stays usable.
- [ ] Lane 4. Occlude and reveal. Save `browser-occlude.png`. Pass when state flips without crashing the host.
- [ ] Lane 5. Operator navigate to a second URL. Save `browser-op-nav.png`. Pass when state shows the second URL.
- [ ] Lane 6. Close the browser session. Save `browser-close.png`. Pass when host drops the session and RPC place null succeeds.
- [ ] Lane 7. Two browser sessions in one engagement. Save `browser-two.png`. Pass when both stay independently addressable.
- [ ] Lane 8. Kill Chromium under the host and reopen. Save `browser-recover.png`. Pass when a new session starts without restarting the host.
- [ ] Lane 9. Unauthorized browser RPC. Save `browser-401.png` or the status log. Pass when status is 401.
- [ ] Lane 10. Electron desktop path still opens BrowserView for the same engagement on Mac. Save `browser-electron-still.png`. Pass when Electron is unchanged in behavior.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time to first `onState` after open, and navigate round-trip to example.com.
- [ ] Probe. Open and navigate five times at head. Trunk has no real browser. Use absolute budgets.
- [ ] Baseline. Record the trunk open latency first. Trunk has no host browser, so record the stub no-op time and mark the real navigate metric as head-only with the absolute budgets in Rule.
- [ ] Rule. First state within 5000 ms of open. Navigate round-trip under 3000 ms on a warm local network.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2 and lane 7 screenshots into `/tmp/exe-media/PR-mac-host-browser-review-nav.png` and `/tmp/exe-media/PR-mac-host-browser-review-two.png`.
- [ ] Record a 30 to 60 second video of open, navigate, and second session. Save `/tmp/exe-media/PR-mac-host-browser-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] After the verdict, record landing SHA and patch base per Shipping.
- [ ] Autopilot-stack. Append third. Operator lands third. Child targets parent branch.

## Retire Electron stubs on Mac portable path (PR-retire-electron-stubs)

**Depends on.** `PR-mac-host-browser`.

**Files.**

- [ ] Edit `apps/desktop/src/renderer/host-bridge.ts` to remove portable stubs for capabilities now on the host.
- [ ] Edit docs and CLI help to say Mac portable is the supported full client path.
- [ ] Optionally gate or document Electron as legacy. Do not delete the Electron app in this PR unless every Host RPC used by the renderer is covered and live-verified.

**Build.**

- [ ] Assert `window.executioner` methods used by the renderer are real Host RPC calls on Darwin portable builds.
- [ ] Leave non-Darwin portable on explicit unsupported errors for native dialogs and browser.
- [ ] Update README or team-server usage to the Mac-first portable flow.

**You see.**

- [ ] A Mac operator can run Executioner through `executioner-host` without opening Electron for the flows covered above.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Host-bridge tests fail if any covered method still returns the old stub error string. Run `pnpm --filter @exe/desktop exec vitest run src/renderer/host-bridge.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` role at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Grep or runtime check that stub string is gone for folder, hints, ssh, testBackend, and browser operator. Save `stubs-gone.png`. Pass when none of those calls return the stub error.
- [ ] Lane 2. Cold start host, open printed URL, finish local onboarding with Claude. Save `full-local.png`. Pass when an engagement is open and a session can start.
- [ ] Lane 3. SSH path still works after stub retirement. Save `full-ssh.png`. Pass when enroll and test succeed.
- [ ] Lane 4. Browser pane still works. Save `full-browser.png`. Pass when example.com loads.
- [ ] Lane 5. Agent probe still shows Claude and Codex installed. Save `full-agents.png`. Pass when both cards are Installed.
- [ ] Lane 6. Host restart keeps engagement data on disk and can reopen the same dir. Save `full-reopen.png`. Pass when reopen succeeds.
- [ ] Lane 7. Non-Darwin CI or unit path still reports unsupported for Mac-only dialogs. Save `platform-guard.png` or the test output. Pass when tests assert the platform guard.
- [ ] Lane 8. Electron app still launches for operators who want it. Save `electron-still.png`. Pass when Electron opens an engagement.
- [ ] Lane 9. Unauthorized host calls still 401. Save `host-401.png` or the status log. Pass when status is 401.
- [ ] Lane 10. Memory smoke. Host RSS after open engagement plus browser session stays under an operator-agreed budget recorded in the receipt. Save `rss.png` or the rss log. Pass when under budget.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Host RSS after engagement open and one browser session, versus Electron RSS for the same flow.
- [ ] Probe. Measure both on the same Mac, interleaved, three runs each.
- [ ] Baseline. Record the trunk Electron median RSS first on the same Mac and the same engagement flow.
- [ ] Rule. Host-only path median RSS is at least 20 percent below Electron for that flow, or the PR documents why not and the operator accepts the number in review.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2 and lane 4 screenshots into `/tmp/exe-media/PR-retire-electron-stubs-review-local.png` and `/tmp/exe-media/PR-retire-electron-stubs-review-browser.png`.
- [ ] Record a 30 to 60 second video of the full portable Mac flow. Save `/tmp/exe-media/PR-retire-electron-stubs-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] After the verdict, record landing SHA and patch base per Shipping.
- [ ] Autopilot-stack. Append tip. Operator lands last.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

- Mac `osascript` availability. Ran `/usr/bin/osascript -e 'return "ok"'` on the operator Mac. Returned `ok`. Folder choose dialog itself is not auto-proven here. Live lanes in `PR-mac-host-native` must exercise a real choose-folder cancel and accept.
- Host agent probe and token URL already proven in prior work. `/host/agents` returns Claude and Codex installed when authorized. Bare URL without token 401s.
- Unproven before execution. Host Chromium vs host-owned window for the Browser pane. Settle with an architect pass and a short prototype inside `PR-mac-host-browser` before locking the frame transport.

## Appendix B. Alternatives rejected

- Keep Electron forever and only improve the stubbed browser client. Rejected. The operator wants full working portable execution.
- Drop Electron immediately and leave stubs. Rejected. Browser pane and SSH enroll would stay broken.
- Cross-platform native dialogs in stage 1. Rejected. Operator scoped stage 1 to Mac only.
- Autopilot-full with owner merges. Rejected. Work is sequenced and the operator keeps landing authority. Autopilot-stack fits.

## Appendix C. Risks

- Native dialogs block the host event loop if implemented inline. Watch in `PR-mac-host-native`. Run dialogs in a child process or async spawn.
- SSH enroll needs a reachable lab host for live lanes. Watch in `PR-mac-host-ssh`. Use a local sshd fixture when no remote lab exists.
- Browser pane parity may force a host-owned window instead of an in-tab frame. Watch in `PR-mac-host-browser`. Architect chooses before implementation.
- RSS win versus Electron may miss the 20 percent rule if Chromium is still spawned. Watch in `PR-retire-electron-stubs`. Operator can accept a documented miss in review.

## Appendix D. Links and reading list

- `apps/team-server/src/host.ts`
- `apps/desktop/src/renderer/host-bridge.ts`
- `apps/desktop/src/main/ipc.ts`
- `apps/desktop/src/main/connection-hints.ts`
- `apps/desktop/src/main/browser/manager.ts`
- `packages/engine/src/cli.ts` (`ssh-enroll`, `backend-test`)
- Run `skills/how/SKILL.md` before `PR-mac-host-browser`.
- Run `skills/architect/SKILL.md` before choosing frame transport in `PR-mac-host-browser`.
- Run `skills/interrogate/SKILL.md` if the browser transport choice is contested after architect.
- Keep a decision trail per `skills/show-me-your-work/SKILL.md` for the program.
