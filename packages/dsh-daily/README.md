# dsh-daily

> A DeepSeek Harness (dsh) plugin: a **daily news digest** that recommends proactively, is
> **tunable in natural language**, indexes both **articles and videos (YouTube / Bilibili)**,
> and lives in the **right sidebar as a real web page** — click an item and you are there.

Chinese documentation: [README.zh.md](README.zh.md)

## What it does

| Requirement | How it is met |
|---|---|
| Proactive daily recommendations | A daily scheduled crawl builds a topic-grouped digest; a compact summary is injected into `systemPrompt`, so the model brings up "what's worth reading today" on its own |
| Tunable in natural language | A box in the sidebar, or just tell the model *"more AI-agent news, less crypto"* → preferences are persisted and the current day is **re-ranked immediately** |
| High-value index (web + YouTube + Bilibili) | 11 sources, cross-source scoring (freshness × source weight × topic match × keywords × heat signal), two-stage deduplication; video items carry cover, duration and view count |
| Presentation | A persistent 「日报」tab in the right sidebar; topic filters, search, unread-only, 👍/👎/read/hide, and a Markdown digest preview |

## Sources

Hacker News (via hnrss) · arXiv (cs.AI/CL/LG/CV) · GitHub Search API · **YouTube** (RSSHub mirror pool) ·
Bilibili trending + ranking · 少数派 · IT之家 · Solidot · 阮一峰's blog · any extra RSS you configure.

Direct access to the official YouTube feed, Invidious, Piped, Google News, HuggingFace and the GitHub
Trending HTML page **all time out from this machine**, which is why YouTube goes through a RSSHub mirror
pool, GitHub through the Search API, and English community heat through HN. Single-source failures are
isolated and surfaced explicitly in the digest — never silently dropped.

## Install

```bash
cd packages/dsh-daily
./node_modules/typescript/bin/tsc -p tsconfig.json && node scripts/copy-assets.mjs
node scripts/install-to-profile.mjs desktop   # installs a REAL directory, not a symlink
# then restart dsh
```

### Why not `dsh plugin add link:` (a pitfall worth reading)

dsh resolves plugin dependencies through `$DSH_HOME/profiles/node_modules`, where every `@deepseek-ai/*`
entry is a symlink into the dsh installation. Node resolves module specifiers through the **realpath**,
so a `link:`-ed plugin whose realpath lives in your workspace can never reach that chain and fails with
`Cannot find package '@deepseek-ai/dsh-tools'`. Install a real directory instead (`install-to-profile.mjs`
does this and idempotently maintains the profile's user-layer patch row).

Second pitfall: **Node caches failed module instantiations.** If the first attempt failed for the reason
above, the same module URL keeps reporting `failed to import` even after you fix it — rename the install
directory (changing the URL) or restart dsh.

Also note: `dsh plugin add` / the marketplace's `install_bundle` currently fail on this machine because the
profile's `node_modules` was linked from pnpm store v10 while pnpm now wants v11 (it asks for a full
reinstall). Hence the install script.

## Tools

`daily_brief` · `daily_digest` · `daily_search` · `daily_sources` (read-only) ·
`daily_tune` · `daily_feedback` · `daily_refresh` (write / network).

## Development

```bash
node scripts/probe-sources.mjs          # real crawl probe, writes nothing
node scripts/dev-server.mjs             # serve the sidebar page + API without dsh
node --test test/
./node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

See [README.zh.md](README.zh.md) for configuration, data layout, and known limitations.
