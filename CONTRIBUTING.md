# Contributing to Executioner

Thanks for helping out. Bug reports, tool nodes, fixes and features are all welcome. This guide covers how work moves from an issue to a merged pull request.

Executioner is a tool for authorized security testing. Contributions that exist to attack systems without permission, evade detection for malicious use, or harm third parties will be closed.

## Ways to contribute

- **Ask a question or float an idea.** Use [Discussions](https://github.com/dbx0/executioner/discussions). Issues are for bugs and concrete, agreed work.
- **Report a bug.** Open a [bug report](https://github.com/dbx0/executioner/issues/new?template=bug_report.yml). Include your OS, the release you installed (for example `v0.0.3`) and the steps that trigger it.
- **Ask for a feature.** Open a [feature request](https://github.com/dbx0/executioner/issues/new?template=feature_request.yml) and describe the problem before the solution.
- **Add a tool.** Most tools are a single TOML manifest. Open a [tool node request](https://github.com/dbx0/executioner/issues/new?template=tool_node.yml), or send the manifest straight away (see [Adding a tool node](#adding-a-tool-node)).
- **Pick up an issue.** Issues labelled [`good first issue`](https://github.com/dbx0/executioner/labels/good%20first%20issue) are small and self-contained. [`help wanted`](https://github.com/dbx0/executioner/labels/help%20wanted) marks larger work the maintainer would like help with.

Found a security vulnerability in Executioner itself? Do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Before you start

For anything bigger than a small fix, comment on the issue (or open one) first so we can agree on the approach. It saves you from writing a PR that goes a different direction than the project. Say "I'd like to take this" on an issue and it will be assigned to you.

## Development setup

You need Node 24 and pnpm 12. `mise install` in the repo root pins both. On Linux you also need a C++ toolchain and Python to compile the terminal module (`node-pty`).

```bash
git clone https://github.com/<you>/executioner.git
cd executioner
pnpm install
pnpm -r build
pnpm --filter @exe/desktop dev
```

`pnpm -r build` compiles the packages the desktop app loads, including the engine. The dev server reloads renderer changes live. Changes to `apps/desktop/src/main` or to any package under `packages/` need a rebuild and an app restart.

### Keep your real data out of development

Workflows, connections, secrets and saved agents live in a user-level directory, `~/.executioner`, shared by every engagement. The test suite isolates it automatically. When you run the engine or the app by hand for testing, point it somewhere disposable:

```bash
EXECUTIONER_HOME="$(mktemp -d)" pnpm --filter @exe/desktop dev
```

### Repository layout

| Path | What lives there |
|---|---|
| `apps/desktop` | Electron app: `src/main` (main process), `src/preload`, `src/renderer` (React UI) |
| `packages/engine` | Local HTTP/WebSocket engine: workflow execution, scheduler, MCP tools, agents |
| `packages/graph` | Workflow graph schema, validation and the IF condition language |
| `packages/nodes` | Tool node manifests (`manifests/*.toml`) and the registry that loads them |
| `packages/db` | SQLite schema, migrations and repositories |
| `packages/project` | Engagement folders: opening, scaffolding, user-level data |
| `packages/protocol` | Types and helpers shared by the app and the engine |
| `packages/pty` | Terminal sessions |

## Making a change

1. Fork the repo and create a branch from `main`: `git checkout -b fix/scheduler-overlap`.
2. Make the change. Add or update tests next to the code (`*.test.ts` / `*.test.tsx`).
3. Run the same checks CI runs:

   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm --filter @exe/desktop test
   ```

4. Push and open a pull request against `main`. Fill in the template.

### Code style

- TypeScript everywhere, strict mode. ESLint and the type checker are the source of truth.
- Match the code around you: naming, comment density and structure.
- Comments explain *why*, not *what*.
- User-facing text is plain and direct. Do not use em dashes in UI strings.
- Never log, print or store secrets in plain output. API keys go through the secrets store and `{{ secrets.NAME }}` templates.

### Commit messages and PR titles

We use [Conventional Commits](https://www.conventionalcommits.org/). Pull requests are squash merged, and **the PR title becomes the commit on `main`**. Release notes are generated from those titles, so a CI check enforces the format:

```
type(scope): short description in the imperative
```

- **Types:** `feat`, `fix`, `perf`, `refactor`, `style`, `docs`, `build`, `ci`, `test`, `chore`, `revert`
- **Scope** (optional) is the area touched: `desktop`, `engine`, `nodes`, `db`, `graph`, ...
- Add `!` after the type for a breaking change: `feat(engine)!: drop the legacy run route`

Examples: `fix(engine): skip interval ticks while the previous run is going`, `feat(nodes): add katana manifest`.

Commits inside your branch can be whatever helps you work. Only the PR title has to follow the format.

## Adding a tool node

A command-line tool becomes a node with one TOML file in `packages/nodes/manifests/`. Copy a close match (`subfinder.toml` for discovery, `httpx.toml` for probing) and adjust it:

```toml
id = "subfinder"
name = "Subfinder"
description = "Passive subdomain enumeration"
category = "recon"
accepts = ["domain"]

[command]
program = "subfinder"
args = ["-silent", "-oJ", "-d", "{{ target.value }}"]
timeout_ms = 180000

[emit]
parser = "json"
source = "stdout"
records = "$"

[[emit.targets]]
kind = "subdomain"
value = "{{ record.host }}"
parent = "input"
```

- Prefer the tool's JSON output so `[emit]` can parse records reliably.
- Pass the target through `{{ target.value }}` as its own argument. Never build a shell string.
- Emit `targets` for new assets and `facts` for things learned about an existing one.
- Add a golden test: save real tool output under `packages/nodes/test/fixtures/` and check the parsed records with `runGoldenCase` (see `packages/nodes/src/golden.test.ts`). In the PR, say which tool version produced the fixture.

## Pull request review

- CI must pass before merge (typecheck, lint, tests and the PR title check).
- The maintainer reviews every PR. Expect questions. They are about the code, not about you.
- Keep PRs focused: one change per PR is much faster to review than a bundle.
- If `main` moves while your PR is open, rebase or merge `main` into your branch to resolve conflicts.
- Inactive PRs may be closed after a few weeks without response. You can always reopen them.

## Releases

The maintainer cuts releases by bumping the version, tagging `vX.Y.Z` and pushing the tag. CI builds the installers for every platform and publishes the GitHub release with notes generated from the commit titles since the previous tag.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
