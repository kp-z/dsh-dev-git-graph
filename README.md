# DSH Plugins

Plugins for **DeepSeek Harness** (`dsh`) — one package per plugin, in a pnpm monorepo.
Every package installs into a dsh profile on its own; this workspace exists so several plugins
can be developed, built and dogfooded side by side.

- Repository: <https://github.com/kp-z/dsh-plugins>
- 中文文档: [README.zh.md](README.zh.md)

## Plugins

`Add` is the argument to `dsh plugin --profile web add …` — see [Install](#install).

| Package | What it does | Add | npm | Docs |
| --- | --- | --- | --- | --- |
| `dsh-agent-world`<br>`0.1.0` | Multi-agent collaboration in a visual **3D town**: every real subagent is a walking character, every task a pickable work order, every dispatch a move through space. Content libraries, a module protocol and the simulation core are in place; what ships today is a 2D top-down debug view — the 3D scene is not wired up yet. | `file:packages/dsh-agent-world` | not published (`private`) | [README](packages/dsh-agent-world/README.md) |
| `dsh-contract-butler`<br>`0.1.0` | A contract keeper: extracts boundary contracts (the shape of inputs and outputs) back out of the code, watches them evolve across versions, and checks declared shapes against real runtime payloads — so "AI writes the implementation, humans own the agreement" has one reviewable source of truth. | `file:packages/dsh-contract-butler` | not published | [README](packages/dsh-contract-butler/README.md) |
| `@kpeace/dsh-daily`<br>`0.10.4` | A **daily news digest** that recommends proactively, is tunable in natural language, indexes both articles and videos (YouTube / Bilibili), and lives in the right sidebar as a real web page — click an item and you are there. | `@kpeace/dsh-daily` | 0.10.4 | [README](packages/dsh-daily/README.md) |
| `dsh-dev-git-graph`<br>`0.1.4` | A **Git Graph panel** in every conversation tab — a faithful port of [mhutchie/vscode-git-graph](https://github.com/mhutchie/vscode-git-graph) 1.30.0, auto-bound to the current session's workspace, with the commit graph (branch lanes, messages, dates, authors, refs) and the extension's full set of git operations on right-click. | `dsh-dev-git-graph` | 0.1.3 (this repo is at 0.1.4, unpublished) | [README](packages/dsh-dev-git-graph/README.md) |
| `dsh-feishu`<br>`0.20.1` | Feishu (Lark) sync: configure your own authorization, and tasks and documents are synced locally on a schedule; a synced task can be opened directly as a DSH session, and progress, expectations and collaboration results are written back to Feishu. | `file:packages/dsh-feishu` | not published (`private`; the `dsh-feishu` name on npm belongs to an unrelated package) | [README](packages/dsh-feishu/README.md) |
| `dsh-ios-skin`<br>`0.3.0` | An **iOS 26 Liquid Glass** theme for the DSH Web GUI — the official design tokens retuned plus a real frosted-material layer, with light/dark, reduced-transparency and high-contrast support. The current release is "Deep Fusion". | `dsh-ios-skin` | 0.1.0 (this repo is at 0.3.0, unpublished) | [README](packages/dsh-ios-skin/README.md) |
| `dsh-mermaid-comm`<br>`0.3.1` | Makes the AI **default to Mermaid diagrams** in development conversations: a checkbox in the chat input controls prompt guidance, `mermaid_validate` checks syntax, an output gate repairs or removes broken diagrams, and a Mermaid vault versions them in the workspace. Rendering is handled by [`dsh-mermaid`](https://github.com/MrmoLabs/dsh-mermaid). | `dsh-mermaid-comm` (+ `dsh-mermaid`) | 0.3.1 | [README](packages/dsh-mermaid-comm/README.md) |
| `dsh-spellbook`<br>`0.2.5` | The **spellbook**: a front-end effects library as a "Spellbook" right-sidebar tab. Each spell is a description of a mechanism plus code that really runs (the previews are live code, not recordings); one click sends a spell into the chat input, and the model can look one up with `spellbook_lookup`. | `dsh-spellbook` | 0.2.5 | [README](packages/dsh-spellbook/README.md) |
| `dsh-tab-split`<br>`0.1.0` | **Conversation view split**: adds a "split" view tab that arranges resident views (chat / Git graph / …) into side-by-side panes. The official single view stays the default — nothing changes until you press the split button. | `file:packages/dsh-tab-split` | not published | [README](packages/dsh-tab-split/README.md) |
| `dsh-example-tool`<br>`0.1.0` | The **minimal tool-plugin example**: registers `example_git_status` and `example_echo` with `defineTool`, and demonstrates the plugin module contract, config schema, and `output` / `render` declarations. Start here when writing a new plugin. | `file:packages/example-tool` | not published | [README](packages/example-tool/README.md) |

## Install

```bash
# install one plugin into a profile (web in the examples)
dsh plugin --profile web add <Add value from the table>

# remove it
dsh plugin --profile web remove <package name>

# restart dsh (or reload the plugin) so the new entry is picked up
```

- **From npm**: pass the npm name (`dsh plugin --profile web add @kpeace/dsh-daily`).
- **From a clone**: pass a path, e.g. `dsh plugin --profile web add file:packages/dsh-contract-butler`
  when run from the repository root (an absolute `file:/…` path works too).
- **Whole workspace at once**: `pnpm build && pnpm install:web` builds every package and installs
  all of them into the `web` profile; `pnpm remove:web` takes them back out.
- **Try things out in a throwaway profile** instead of your real one:
  `dsh plugin --profile devtest add <pkg>`, then `dsh --profile devtest`.
- A few packages document their own install path because they need something extra — check the
  package README before installing: `dsh-daily` (must be installed as a real directory, not a
  symlink), `dsh-feishu` (enable its bundle and authenticate the Feishu CLI), `dsh-dev-git-graph`
  (depends on `dsh-better-sidebar`), `dsh-mermaid-comm` (pairs with `dsh-mermaid`).

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/<name>/` | One directory per plugin — this is the layout and it is stable. Each package owns its `package.json`, `src/`, build output (`lib/`), assets and `README.md`. |
| `package.json` | Workspace root: aggregated scripts (`build` / `typecheck` / `install:web` / …). |
| `pnpm-workspace.yaml` | The pnpm workspace, `packages/*`. |
| `tsconfig.base.json` | Shared TypeScript baseline for the packages. |
| `docs/` | Directory and development conventions, the dsh plugin API reference, per-plugin design notes. |
| `scripts/` | Install / remove / sync / scaffold helpers, plus the Desktop compatibility check. |
| `templates/` | The `tool-plugin` template used by `scripts/new-plugin.sh`. |

A package only ever lives at `packages/<name>`, and its `package.json` name is what the profile
resolves — helper output (`pnpm build` → `lib/`) never moves the source.

## Development

The workspace is an **independent pnpm workspace**, not the dsh profile's own
`pnpm-workspace.yaml`. Packages resolve dependencies and joint-debug here during development;
release and installation go through `dsh plugin --profile <profile> add <pkg>` into
`$DSH_HOME/profiles/<profile>`. If a package must be referenced by dsh as a `file:` dependency you
could merge the profile directory in, but that drags the whole web app's dependency graph along —
keep it separate.

Node.js >= 22.

```bash
pnpm install        # resolve workspace dependencies
pnpm build          # build every package (pnpm -r run build)
pnpm typecheck      # type-check every package
pnpm install:web    # build and install all packages into the web profile
```

| Command | What it does |
| --- | --- |
| `pnpm build` | Build all plugin packages (each package emits `lib/` via `tsc` and copies its assets). |
| `pnpm typecheck` | Type-check all plugin packages. |
| `pnpm install:web` | Build and install all plugins into the `web` profile. |
| `pnpm sync:web` | Copy build output into the `web` profile, including new files the hard-linked copies do not have. |
| `pnpm sync:web:check` | Check only: exits 1 when a copy differs from source. |
| `pnpm remove:web` | Remove all plugins from the `web` profile. |
| `pnpm reinstall:web` | Reinstall (for iterative joint debugging). |
| `pnpm --filter <pkg> run dev` | Watch build for a single plugin. |
| `bash scripts/new-plugin.sh my-plugin` | Scaffold a new plugin package from `templates/`. |
| `pnpm dev:site` / `build:site` / `test:site` | Preview / build / test the spellbook site. |

Two conventions worth knowing before you edit anything:

- **New files need `pnpm sync:web`.** The profile holds hard-linked copies, so a file you add after
  the last sync does not appear there until you sync again.
- **`peerDependencies` are the compatibility gate.** On DSH Desktop (Electron), plugins that declare
  a `@deepseek-ai/dsh*` range rejecting the current runtime are silently `disabled` before the
  profile starts — the symptom is "my plugin disappeared", not an error. Check a profile with
  `node scripts/verify-desktop-plugin-gate.mjs`; it calls the App's production
  `evaluatePluginCompatibility()`, so it does not drift from real behaviour.

## Conventions and references

- [Directory conventions](docs/DIRECTORY.md)
- [Development conventions](docs/DEVELOPMENT.md) — plugin lifecycle, module contract, profile strategy, quality red lines
- [dsh plugin API reference](docs/REFERENCE.md)
