# Executioner Host (macOS `.app`)

Double-clickable bundle that starts `executioner-host` (engines + portable UI), opens the default browser at the token URL, and keeps the host running without a Terminal window. The MacOS entrypoint is a small Cocoa Mach-O stub (`launcher-stub.m`) that stays in the Dock, runs `Resources/launcher.sh`, and on reopen opens the UI again (Launch Services rejects a shell script as the bundle executable).

Closing the browser tab does **not** stop the host. Engines stay up until you quit the app (Cobalt Strike–style).

## Quick start (no Electron)

From the monorepo root, after `pnpm install` and `pnpm -r build`:

```bash
pnpm host:start
```

Opens `Executioner Host.app` when it exists under `apps/team-server/dist/`. Otherwise runs `pnpm host:mac` in the foreground. Force the CLI path with `bash scripts/host-mac-start.sh --cli`.

```bash
pnpm host:stop
```

Quits the Dock app (if running) and frees `127.0.0.1:47821`–`47830`.

`pnpm host:mac` alone builds `@exe/team-server` and runs `executioner-host serve --open`. Stop that path with **Ctrl+C** in the terminal.

Optional flags via the CLI:

```bash
pnpm --filter @exe/team-server exec node dist/cli.js serve --open
pnpm --filter @exe/team-server exec node dist/cli.js serve --bind 127.0.0.1:47821 --open
```

## Build the `.app`

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

## Run the `.app`

```bash
open "apps/team-server/dist/Executioner Host.app"
```

Expect:

1. Host listens on `127.0.0.1:47821` (or the next free port if busy).
2. Browser opens `http://127.0.0.1:<port>/?token=…`.
3. A second double-click (or Dock click) reopens that URL if the host is already healthy.

## Stop the `.app`

- **Quit Executioner Host from the Dock** (right-click → Quit, or Cmd+Q while it is frontmost). That stops the host process and every engine it started.
- Closing the browser tab alone leaves the host running. Open the app again to get the UI back.
- From a terminal, if the Dock icon is gone but something is still listening:

```bash
# default bind; adjust the port if the log shows another
lsof -nP -iTCP:47821 -sTCP:LISTEN
kill "$(lsof -nP -iTCP:47821 -sTCP:LISTEN -t)"
```

## Logs and token

- Logs: `~/Library/Logs/Executioner Host.log`
- Bootstrap token (stable across relaunches): `~/Library/Application Support/Executioner Host/bootstrap.token`

## First-run Gatekeeper

Unsigned local builds are blocked until you allow them. Right-click the app → Open → Open, or remove the quarantine flag after you trust the build:

```bash
xattr -dr com.apple.quarantine "apps/team-server/dist/Executioner Host.app"
```

Notarization and DMG packaging are out of scope for this packager.
