# dsh-mermaid-comm

Make the AI **default to Mermaid diagrams** in development conversations. Rendering is handled by [`dsh-mermaid`](https://github.com/MrmoLabs/dsh-mermaid); this plugin focuses on prompt guidance, syntax validation, and output safety.

[![npm](https://img.shields.io/npm/v/dsh-mermaid-comm)](https://www.npmjs.com/package/dsh-mermaid-comm)

## Features

| Capability | What it does |
|---|---|
| **A. Behavior guidance** | Injects a `systemPrompt.section`: architecture, data flow, sequence, state, and dependency topics default to Mermaid — diagram first, then a short explanation. **Controlled by a checkbox in the chat input; off by default** (see below). |
| **B. Syntax validation** | Registers the `mermaid_validate` tool: dangerous-character scan first, then real parsing via the same-version `mermaid-runtime` shipped with dsh-mermaid. |
| **C. Output gate** | Listens for assistant message events; auto-fixes Unicode arrows / dangerous labels in Mermaid fences, and removes broken diagrams from the visible surface when they cannot be confirmed. |
| **D. Mermaid Vault** | Persists validated diagrams to `<workspace>/.dsh/mermaid/` as versioned assets: `<name>.mmd` (current version) + `<name>.history.md` (evolution history) + `INDEX.md`. The index is injected into the system prompt so later conversations evolve existing diagrams instead of redrawing from scratch. |

## The injection switch — a checkbox in the chat input

As of 0.3.0 prompt injection is **off by default** and driven by a checkbox at the left of the composer tool row:

| State | Behavior |
|---|---|
| Unchecked (default) | Neither the guidance nor the vault index is injected — the model sees no Mermaid guidance at all |
| Checked | Injected from the next turn on; the system prompt is re-assembled every turn, so the change takes effect immediately |

**The host owns the truth** (`ctx.settings`, namespace `mermaid-comm-inject`), and it is **globally sticky**: check it once, every conversation follows, and it survives a restart. The button in the composer is only the switch's remote control — it lives in a per-session slot that the official renderer remounts on every session change (its own rule: component-local state must not leak between sessions), so the state cannot live in the component.

`promptLevel` has three states: `toggle` (default, driven by the button) / `global` (always inject, button hides itself) / `off` (never inject, button hides itself).

The tools (`mermaid_validate` and the four vault tools) and the output gate are **unaffected by the switch** and always available: injection is "nudging the model to draw", the tools are "checking the drawing once it is drawn" — two separate concerns.

## Mermaid Vault (diagram persistence)

New in 0.2.0. Diagrams worth keeping — architecture, data models, core flows — are saved to the vault as a **same-topic versioned series**:

```
<workspace>/.dsh/mermaid/
├── INDEX.md                 # vault index (topic/type/version/updatedAt)
├── payment-flow.mmd         # current active version (always renderable)
└── payment-flow.history.md  # v1/v2/... with per-version change notes
```

Four model-visible tools:

- `mermaid_vault_list` — list the vault index (optional type filter)
- `mermaid_vault_read` — read a topic: current code + evolution history
- `mermaid_vault_save` — save/update a diagram (forced real-parser validation; syntax errors are rejected, so the vault only ever holds renderable diagrams)
- `mermaid_vault_delete` — delete a topic (main file + history + index entry)

The vault index is injected into the system prompt (lightweight table only — diagram contents are read on demand via `mermaid_vault_read`). When a topic already exists, the model is guided to read its history and evolve it with `save` (creating v2/v3/...) rather than redrawing from zero — that is how later conversations see the diagram's continuous change and stay consistent with earlier work.

Safety: topic names are sanitized to `[a-zA-Z0-9-_]` (no path traversal), writes are locked inside the vault directory, files are written atomically, and size/version limits prevent unbounded growth.

## Installation

```sh
dsh plugin --profile web add dsh-mermaid-comm dsh-mermaid
```

**One command, two packages.** They split the work, and both are needed:

| Package | Responsibility | Why it must be installed separately |
|---|---|---|
| `dsh-mermaid-comm` | prompt injection, `mermaid_validate`, the vault, the output gate | this plugin |
| `dsh-mermaid` | renders mermaid fences in the chat transcript | **it is only mounted if it is in `dsh.profile.bundles`** |

`dsh-mermaid` is also declared as a regular dependency of this plugin, so installing this plugin alone does pull its code into `node_modules` — but "installed" is not "mounted": dsh only applies the `cordis.patch.yml` of packages listed in `dsh.profile.bundles`, so a package outside the roster is never mounted and nothing gets rendered. Hence the two-package command.

> Why doesn't this plugin mount `dsh-mermaid` for you? It tried (the v0.3.0 CARRIER approach) and **it cannot boot**: `dsh-mermaid` ships its own `dsh.bundle.patch`, so the moment it becomes a profile-level dependency it is auto-promoted into `dsh.profile.bundles`, where its patch and this plugin's carrier row insert the same entry id `ui-mermaid`. Cordis **hard-fails on a duplicate loader entry id** (the whole tree refuses to start, and the error names neither plugin): `duplicate loader entry id "ui-mermaid"`. That is not a boundary documentation can avoid — it is a design conflict, so v0.3.1 dropped it in favour of the two-package command above.

Restart `dsh web` (both the plugin roster and the client bundle load at startup). To self-check the composition: `dsh --profile web --dump-config` should show `ui-mermaid` and `mermaid-comm` exactly once each.

## Usage

The model defaults to Mermaid output for:

- Architecture / module relationships → `flowchart` or `classDiagram`
- Call chains / request sequences → `sequenceDiagram`
- State / lifecycle → `stateDiagram-v2`
- Data models / table relationships → `erDiagram`
- Branching strategy / Git history → `gitGraph`
- Plans / schedules → `gantt`

## Validation rules

`mermaid_validate` returns:

- `ok`: whether the current code passes;
- `built`: the code after rule-based fixes;
- `fixes`: the fixes applied;
- `errors`: dangerous characters, missing runtime, or parse errors;
- `mode: "true-runtime"`: mode marker for backward compatibility with older callers.

The output gate supports both ` ```mermaid ` and ` ```mermaidd ` fences. Each broken block is independently re-evaluated; a fixed version that passes the same runtime parser replaces the original block, and blocks that still fail are replaced with a safe notice instead of being handed to the renderer.

## Safety boundary

- Unicode arrows, unpaired quotes, and subgraph special characters are scanned/fixed first;
- Real parsing uses dsh-mermaid's `lib/mermaid-runtime.js` directly — no reliance on the error-prone `.hash` field;
- Original events stay in the transcript; the fixed version overrides the visible message via a surface `replace`;
- The output gate only handles `assistant/message` append events and uses a `gateFixed` marker to prevent reprocessing.

## Development

```sh
pnpm install
pnpm --filter dsh-mermaid-comm build
pnpm --filter dsh-mermaid-comm typecheck
```

Install from a checkout:

```sh
dsh plugin --profile web add file:/path/to/packages/dsh-mermaid-comm
```

## License

MIT
