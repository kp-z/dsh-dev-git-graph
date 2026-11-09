# dsh-dev-git-graph

A [DeepSeek Harness](https://github.com/DeepSeek-ai/deepseek-harness) (dsh) plugin that adds a **Git Graph panel** to every conversation tab in the DSH Web GUI — a faithful port of [mhutchie/vscode-git-graph](https://github.com/mhutchie/vscode-git-graph) 1.30.0.

It automatically binds to the **current session's workspace** and renders the commit graph (branch lanes, commit messages, dates, authors, refs), with the full set of git operations from the original extension available via right-click: checkout, merge, rebase, push/pull, tag, stash, and more.

[中文文档](README.zh.md)

## Features

- **Session tab**: a "Git 树" tab appears alongside Chat / Trajectory for any conversation with a workspace.
- **Auto-bound repo**: the graph is loaded for the session's working directory; no manual repo selection needed.
- **Full git operations**: checkout, cherry-pick, revert, merge, rebase, push, fetch, tag, stash — driven by the original extension's ~60 commands, executed directly against your local git.
- **Theming**: maps DSH design tokens (`--dsw-alias-*`) onto the graph UI; follows the host's light / dark mode.
- **No external processes**: the host runs `git` directly via `child_process.spawn` (array args, no shell injection) and serves the frontend same-origin.

## Install

```sh
dsh plugin --profile web add dsh-dev-git-graph
# restart `dsh web`, then open any conversation — a "Git 树" tab shows the workspace's commit graph
```

### Better Sidebar integration (required)

This plugin's only UI entry is a native **Git Graph** tab inside [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar)'s right sidebar (+ menu, single-instance, auto-bound to the session workspace via `scope.repoRoot`/`scope.cwd`; clicking a file's diff opens the built-in DiffTab). Install better-sidebar first — without it the plugin registers no UI.

```sh
# full one-line install (better-sidebar first, then this plugin)
cd ~/.dsh && dsh plugin --profile web add dsh-better-sidebar && dsh plugin --profile web add dsh-dev-git-graph
```

## How it works

```mermaid
flowchart LR
  subgraph GUI["DSH Web GUI"]
    TAB["conversation.view tab Git 树"] --> IFRAME["iframe /dsh-dev-git-graph/gg/index.html?repo=cwd"]
  end
  subgraph HOST["dsh web host plugin"]
    R1["GET /dsh-dev-git-graph/gg/* static + inject boot data"] -.-> IFRAME
    IFRAME -->|postMessage bridge| R2["POST /dsh-dev-git-graph/gg/api ~60 commands"]
    R2 --> DS["vendored dataSource.ts child_process.spawn git"] --> REPO[("local git repo = session workspace")]
  end
```

- **Static**: `GET /dsh-dev-git-graph/gg/` serves the bundled frontend (`media/`), injecting `window.__DSH_GG_BOOT__` with `{ apiBase, repo, initialState, ... }`.
- **API**: `POST /dsh-dev-git-graph/gg/api` mirrors the original extension's `gitGraphView.respondToMessage` command set.
- **Data**: `vendor/git-graph/dataSource.ts` runs git via `child_process.spawn` with array arguments.

## Differences from vscode-git-graph

| Area | Behaviour |
|---|---|
| VS Code-only commands | `openFile` / `openTerminal` / `createPullRequest` / `createArchive` return "not supported" (`viewDiff` is supported, see below) |
| View state persistence | localStorage (the extension used workspaceState); `setGlobalViewState` etc. are ACKed |
| Repo source | auto-bound to the current session's workspace |

## Opening a diff (click a file / a commit)

Clicking a file in the commit tree (either under **Uncommitted Changes** or inside a commit) opens the
**native dsh-better-sidebar DiffTab** — the same plumbing the sidebar's 「文件变动」tab uses for its
files and commits (same `SidebarDiffRef` and same tab-id grammar), so **the same file focuses the same
tab across both surfaces** instead of opening a duplicate.

| Click target | Tab | Diff content |
|---|---|---|
| Uncommitted Changes → file | `diff:w:<repo>:u:<path>`, titled with the file name | that file's worktree diff (`git diff -- <path>`; untracked files render as a full addition) |
| Inside a commit → file | `diff:c:<repo>:<hash>`, titled `<short-hash> <subject>` | the whole commit patch (`git show`), identical to previewing that commit in 「文件变动」 |

Known limits (capabilities of better-sidebar 0.19.1, not regressions of this plugin):

- **Clicking a file inside a commit still shows that commit's full patch**: the native commit ref has no
  path field and `git.commit-diff` takes no pathspec — and 「文件变动」's own commit preview is the full
  patch too. Showing a single file would require a plugin-rendered diff view (not implemented).
- **No staged/unstaged split**: git-graph does not track the index state of uncommitted changes, so files
  open as unstaged; the native DiffTab falls back to the other side when a diff is empty.
- **Commit comparisons** show the `to` commit's patch.
- The **View Diff with Working File** context action shows that file's current worktree changes (the
  native contract can express "worktree changes" or "full commit patch", but not "commit vs working file").

## Security

- Git is executed with **array arguments** (no shell), so repo paths / refs can't be used for shell injection.
- Static file serving sanitizes filenames against a whitelist.
- The API only acts on the repo path supplied by the host's own boot payload (the session cwd).

## Development

```sh
pnpm --filter dsh-dev-git-graph build      # build:web (tsc + pack) -> build:host (tsc) -> cp client.js
pnpm --filter dsh-dev-git-graph typecheck  # two tsconfigs: host (NodeNext) + web (DOM)
pnpm --filter dsh-dev-git-graph test       # diff-ref mapping + diff-bridge contract tests
```

## License

MIT. The frontend and data layer are derived from **mhutchie/vscode-git-graph** (MIT), see `vendor/git-graph/LICENSE`.
