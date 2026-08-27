# dsh-mermaid-comm

Make the AI communicate with you using **Mermaid diagrams** by default in development conversations. · 让 AI 在开发交流中**默认用 Mermaid 图**表达。

[![npm](https://img.shields.io/npm/v/dsh-mermaid-comm)](https://www.npmjs.com/package/dsh-mermaid-comm)

## Features

| Pillar | What it does |
|---|---|
| **A. Behavior guidance** | Injects a `systemPrompt.section` that tells the model to **default to Mermaid** for architecture, data-flow, sequence, state, and dependency topics — preferring `flowchart` for architecture and `sequenceDiagram` for call/request flows. |
| **B. Chat rendering** | ` ```mermaid ` fences in chat messages render as **SVG diagrams** automatically (lazy-loaded mermaid chunk, ETag-cached). Streaming updates re-render. |
| **C. Syntax validation** | `mermaid_validate` tool lets the model self-check syntax before output, cutting render failures. |

## Install

```sh
dsh plugin --profile web add dsh-mermaid-comm
```

Restart `dsh web`. No extra configuration needed — it just works.

Requires the standard web profile (web-server + system-prompt + tools services).

## Usage

Ask anything about architecture, flows, sequences, states, or data models — the model answers with a Mermaid diagram by default:

- **Architecture / modules** → `flowchart` or `classDiagram`
- **Call chain / request timing** → `sequenceDiagram`
- **State flow / lifecycle** → `stateDiagram-v2`
- **Data model / table relations** → `erDiagram`
- **Branch strategy / git history** → `gitGraph`
- **Planning / schedule** → `gantt`

Diagrams render inline as clean SVG with **strict sanitization** (`securityLevel: strict`, `htmlLabels: false`, plus DOM-level stripping of scripts/events/foreign objects — safe against injection from untrusted diagram text). Light/dark theme follows `prefers-color-scheme`.

## How it works

```mermaid
flowchart LR
    A["```mermaid 围栏（模型输出）"] --> B[client.js MutationObserver]
    B --> C{发现 mermaid 块}
    C -->|首次| D[懒加载 mermaid chunk]
    D --> E[mermaid.render → SVG]
    C -->|后续| E
    E --> F[净化: 剥离 script/事件/foreignObject]
    F --> G[替换 pre 内容 → 对话里看到图]
```

- **Host bundle** (`lib/index.js`): registers the system-prompt section (A), the `mermaid_validate` tool (C), and the chunk route `/plugins/dsh-mermaid-comm/chunks/mermaid.js` (B).
- **Client bundle** (`lib/client.js`): `MutationObserver` scans `.md-code-block` blocks whose banner infostring says "mermaid" — the real DOM shape DSH renders for ` ```mermaid ` (the `code` element carries no `language-mermaid` class; the language lives in the banner). Extracts source from `pre > code`, lazily loads the chunk, renders a sanitized SVG into the `pre` (host node preserved so React reconciliation survives), and re-renders on streaming changes.
- **Lazy chunk** (`lib/client-mermaid.js`): bundles the full mermaid runtime + deps into a single file, registered under `globalThis.__dshChunks__['mermaid-comm']`. Loaded only when the first mermaid fence appears, so startup stays fast.

## Security

- Mermaid runs in **strict** security mode with `htmlLabels: false`.
- The rendered SVG is **further sanitized client-side**: foreign objects and script/event-bearing nodes (`script`, `iframe`, `object`, `embed`, `on*` attributes, `href` on shapes, etc.) are stripped before insertion.
- Validation is layered: strict parse for the diagram types `@mermaid-js/parser` supports, heuristic pre-check for the classic types (`flowchart`/`sequenceDiagram`/`classDiagram`/`stateDiagram-v2`/`erDiagram`/`gantt`).

## Development

```sh
pnpm install
pnpm build        # host (tsc) + client (tsdown)
pnpm typecheck
```

Install into a profile from a checkout: `dsh plugin --profile web add file:/path/to/packages/dsh-mermaid-comm`.

## License

MIT
