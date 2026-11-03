# Executioner Host (macOS `.app`)

Double-clickable bundle that starts `executioner-host` (engines + portable UI), opens the default browser at the token URL, and keeps the host running without a Terminal window. The MacOS entrypoint is a small Cocoa Mach-O stub (`launcher-stub.m`) that stays in the Dock, runs `Resources/launcher.sh`, and on reopen opens the UI again (Launch Services rejects a shell script as the bundle executable).

## Build

From the monorepo root:

```bash
pnpm host:app
```

Or:

```bash
pnpm --filter @exe/team-server pack:mac
```

Output: `apps/team-server/dist/Executioner Host.app`.

**Node.** The launcher uses `node` on your `PATH` (Node 24+). To ship a Node binary inside the app instead:

```bash
EXECUTIONER_NODE_BIN="$(command -v node)" pnpm host:app
```

## Run

```bash
open "apps/team-server/dist/Executioner Host.app"
```

Expect:

1. Host listens on `127.0.0.1:47821` (or the next free port if busy).
2. Browser opens `http://127.0.0.1:<port>/?token=…`.
3. A second double-click reopens that URL if the host is already healthy.

Logs: `~/Library/Logs/Executioner Host.log`.  
Bootstrap token (stable across relaunches): `~/Library/Application Support/Executioner Host/bootstrap.token`.

## First-run Gatekeeper

Unsigned local builds are blocked until you allow them. Right-click the app → Open → Open, or remove the quarantine flag after you trust the build:

```bash
xattr -dr com.apple.quarantine "apps/team-server/dist/Executioner Host.app"
```

Notarization and DMG packaging are out of scope for this packager.
