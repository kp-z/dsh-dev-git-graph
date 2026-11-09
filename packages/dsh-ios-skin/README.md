# dsh-ios-skin

**Deep Fusion** — a DeepSeek-branded Liquid Glass theme for the DeepSeek Harness Web GUI.

v0.3.0 is a full visual redesign. The architecture is unchanged (official token handover + a material layer), but the palette, the glass and the signature are rebuilt around DeepSeek's brand blue.

Current release **v0.3.0** — Deep Fusion. Built against `@deepseek-ai/dsh-client-ui-theme` **0.2.1-rc.2** (DSH 0.2.x).

## Screenshots

Screenshots have been removed to avoid exposing internal information. Runtime behavior and setup instructions remain below.

The theme works in two layers, which is what makes it comprehensive rather than a few restyled buttons:

1. **Token layer** — retunes the official `--dsw-*` design tokens (background, border, label, button, markdown, scrollbar, elevation, shadow, specific surfaces) to Deep Fusion values: flat `#F0F2F7` / `#12141A` canvas, DeepSeek brand blue, neutral bluish glass and matching separators. Official components read those tokens, so every surface in the app follows without the theme naming a single component. When the host exposes the theme service (`ctx.theme.overrideTokens`), the tokens are handed over as validated `{ light, dark }` pairs and released again on unload; without that service — or if it rejects the layer — the same declarations are injected with the plugin stylesheet. Either way `src/client.js` stays the single source of truth.
2. **Material layer** — supplies the glass itself: a neutral bluish backdrop blur, a 1px outer white rim plus a 1px inner brand rim, restrained elevation, and the Deep Fusion signature (a 1px brand-gradient light band on active dock surfaces). Surfaces are matched by component local class-name pattern *and* by semantic/ARIA hooks (`header`, `nav`, `aside`, `[role=dialog]`, `[role=menu]`, …). This layer is best-effort by design: it depends on internal component names (see [Known limitations](#known-limitations)), so one read-only probe at load warns loudly if none of them match.

## What it does and does not touch

| | |
|---|---|
| Paints | backgrounds, borders, blur, shadows, radii, colour, type family, brand rims and the signature light band |
| Never | structure, layout, sizes, positions, pointer events, scrolling |
| Dark mode | follows the host's `body[data-ds-dark-theme]`, no separate setting |
| Theme API | optional `ctx.theme.overrideTokens` handover for the tokens; whole-stylesheet fallback when unavailable |
| Signature | 1px brand-gradient light band on the top edge of an active dock pane / floating tab; 10–12% brand fill plus a 1px brand edge for selected states |
| Accessibility | `prefers-reduced-transparency`, `prefers-contrast: more`, `prefers-reduced-motion`, and a `@supports` fallback to solid materials |
| Readability | `pre`, `code`, `input`, `select`, `textarea` and `contenteditable` stay effectively opaque — glass never costs contrast where you read or type |
| Uninstall | removes its own `<style>` and body class, and releases the token layer; nothing else is left behind |

Boundaries that are deliberate, not gaps: the page-level header stays **flat** (it is the page plane, not a card), true circles — avatars, round icon buttons — keep `border-radius:50%`, and text-bearing/editable surfaces keep solid materials. The signature is painted only; it never adds geometry or intercepts input.

No React, no observers, no timers, no storage, no slots: the plugin injects one stylesheet, adds one class to `body`, and performs one read-only selector probe at load — only to report an inert material layer.

## Design language

- **Palette** — light: canvas `#F0F2F7`, raised surfaces `#F0F4FF`, text `#171A21`, brand `#4D6BFE`; dark: canvas `#12141A`, raised surfaces `#1C2230`, text `#F2F4F8`, brand `#6E87FF`. Selected states use a 10–12% brand fill plus a 1px brand edge; active labels use a stronger brand tone (`#2F4BD9` light / `#9DB0FF` dark) so a selected tab still clears AA contrast.
- **Materials** — three neutral-bluish glass densities: `thin` `rgba(240,244,255,.58)`, `regular` `rgba(240,244,255,.62)`, `thick` `rgba(244,247,255,.70)` (dark `rgba(28,34,48,.64)`, `rgba(28,34,48,.70)`, `rgba(34,41,58,.78)`), with `blur(30px)` in light and `blur(28px)` in dark. Overlays carry a 1px outer rim — white `rgba(255,255,255,.55)` light, brand `rgba(122,146,255,.22)` dark — plus a 1px inner rim (`rgba(77,107,254,.12)` light, `rgba(0,0,0,.35)` dark). Rails keep the thinnest material and no elevation.
- **Signature** — active dock panes (`data-dockkit-pane-active`) and floating dock tabs (`data-dockkit-float-active`) draw a 1px brand-gradient light band on their top edge (`#4D6BFE → #9BB0FF → transparent`, `background-size:100% 1px`). The band is decoration on an existing edge; it adds no layout, border or hit area. A default single-pane session may not show it until a tab is selected or dragged out.
- **The canvas** — one flat colour (`#F0F2F7` light, `#12141A` dark), with nothing moving behind it. Glass sits a step lighter and bluer than the canvas, so surfaces lift off on their own.
- **Geometry** — one corner radius for the whole app (`--dsh-ios-radius:14px`), shared by every rectangular surface; only true circles (avatars, round icon buttons) differ. The host already sets `--dsw-corner-shape: superellipse(1.5)`, so that radius renders as a squircle.
- **Desktop shell** — DSH Desktop can run with native macOS vibrancy, in which case the shell makes the page transparent (`data-dsh-desktop-mode="extended" | "advanced"`). The theme notices and leaves the rail transparent as well, so the real system material shows through instead of stacking a second backdrop on top of it. When the shell reports material `off`, the handoff is skipped and the rail keeps its own glass.

### How v0.3.0 differs from v0.2.2

| | v0.2.2 | v0.3.0 Deep Fusion |
|---|---|---|
| Palette | iOS system blue `#007aff` / `#0a84ff`, canvas `#e5e5ea` / `#000` | DeepSeek brand blue `#4D6BFE` / `#6E87FF`, canvas `#F0F2F7` / `#12141A`, neutral bluish labels |
| Glass | neutral white/black at `.60` / `.72` / `.86` | neutral **bluish** at `.58` / `.62` / `.70` (dark `.64` / `.70` / `.78`; thick `rgba(244,247,255,.70)` / `rgba(34,41,58,.78)`) |
| Rim / edge | 0.5px white specular rim | 1px outer rim (white → brand in dark) + 1px inner rim (brand → black in dark) |
| Signature | none | 1px brand-gradient light band on active dock surfaces; brand selected states |
| Architecture | token handover + material layer | unchanged (103 `overrideTokens` pairs, same groups, same accessibility fallbacks) |

## New UI compatibility

The current GUI adds two larger surfaces beyond the stock shell: **dsh-better-sidebar** (file tree, editor, tabs, changes/diff, tasks and side chat, plus its bottom workbench and floating windows) and the **Agent Teams** panel/roster. The material layer follows their published structure instead of guessing at hashes:

| New surface | Treatment |
|---|---|
| better-sidebar host and file tree (`[data-dsh-better-sidebar]` / `[data-dsh-panel-host]` subtrees) | the plugin keeps its own token surfaces; generic card/header/rail/bar rules are excluded from these subtrees |
| DSH right-sidebar content (dockkit pane body) | left to dockkit's own opaque token background; the theme adds only the right tab strip's `thin` glass |
| bottom workbench (`[data-dsh-bottom-panel]`) | `regular` glass fill and blur only — border, radius and shadow stay with better-sidebar |
| dockkit tab strip (`[role=tablist]`, `[data-dockkit-strip]`) | `thin` glass |
| dockkit floating tabs (`[data-dockkit-float]`), Agent Teams popover (`[data-team-panel]`), markdown TOC popover (`[data-dsh-md-toc-panel]`), better-sidebar floating windows (`role=dialog`) | `regular` glass with the double rim and float shadow |
| active dock pane / active floating tab (`data-dockkit-pane-active` / `data-dockkit-float-active`) | the 1px brand-gradient light band along its top edge |
| editor / diff / changes / tasks / side-chat / subagent panes | no extra glass — these are text-bearing views and keep their own token-based backgrounds (retuned by the theme), so reading contrast is untouched |
| tabs, tree rows and icon slots (`jJkEga_slot`), pane bodies/cards, editor-header buttons, roster rows/member text, inline triggers (e.g. the Agent Teams trigger) | flat — no glass or shadow of their own |
| navigation or tab bars nested inside a flat header (`header *`, `[role=banner] *`) | excluded from the thin/rail groups — a breadcrumb nav or session tab strip inside the header stays flat |
| page header, true circles, text/editable surfaces | unchanged boundaries: flat / 50% / opaque |

Matching uses the stable hooks the plugins publish for the surfaces above — better-sidebar's `data-dsh-*` attributes (`data-dsh-better-sidebar`, `data-dsh-bottom-panel`, `data-dsh-md-toc-panel`, …), dockkit's `data-dockkit-*`, Agent Teams' `data-team-panel`, and semantic roles such as `[role=tablist]`/`[role=dialog]`. Older DSH surfaces still match component-local class names, and the better-sidebar subtrees opt out of that generic matching on purpose. An upgrade that renames those internals can still drop a surface; the startup probe reports an inert material layer when nothing matches.

## Install

```sh
# from the workspace root: build first
pnpm --config.verify-deps-before-run=false --filter dsh-ios-skin build

# install the local package into a profile
dsh plugin --profile web add file:/path/to/dsh-plugins/packages/dsh-ios-skin
# restart dsh web
```

Local `file:` packages are installed as **hard-link copies**. A rebuild rewrites existing files in place, but newly added files are never linked into the profile — after `pnpm build`, run `pnpm sync:web` (or reinstall) or the profile copy silently goes stale. See `docs/DEVELOPMENT.md` §7.

Uninstall:

```sh
dsh plugin --profile web remove dsh-ios-skin
# restart dsh web
```

## Known limitations

- **The theme is not a built-in appearance setting.** Third-party theme ids are an in-process extension of the official theme package and do not cross the built-in settings schema. The skin appears nowhere in Settings → Appearance and does not persist as a preference; it applies whenever the plugin is loaded. Remove the plugin to turn it off.
- **The signature light band is activation-only.** It exists on active dock panes and floating tabs; a default single-pane session may show no band at all until a tab is selected or dragged out. It is paint-only and never changes geometry.
- **The material layer rides on internal component class names.** The official front end emits CSS-module hashes; an upgrade can rename those components and the glass will stop appearing. Nothing crashes — hence a one-time, read-only probe at load: if none of the known local names match, the console prints `[dsh-ios-skin] material layer is inert: …`. The token layer, accessibility fallbacks and readability floors keep working in that case; only the glass surface layer is affected.
- **New-UI coverage is intentionally narrow.** better-sidebar, dockkit and Agent Teams are plugins or front-end internals, not part of the official theme spec. The theme guarantees glass only for the surfaces listed above (bottom workbench, floating windows, tab strip, team panel); richer views — editor, diff, changes, tasks, side chat — keep their own token-based surfaces, and better-sidebar's internal layout keeps its token styling because the whole subtree opts out of generic class matching. A dockkit / better-sidebar upgrade that renames a hook can still return a surface to unthemed; the startup probe warns when nothing matches.
- **Not every surface is glassed.** The material layer covers bars, rails, panels, dialogs, menus, toasts, cards and the user bubble. The header is flat, true circles stay round, and text/editable surfaces stay opaque by design.
- **The type is only truly iOS on Apple platforms.** The font chain puts the font chosen in Settings first, then the iOS stack (`-apple-system` / SF Pro / SF Mono) as fallback; elsewhere that falls back to `system-ui` and the platform monospace, so the typography is close but not byte-identical.
- **Desktop vibrancy handoff is desktop-only.** It keys off `data-dsh-desktop-mode` / `data-dsh-desktop-material` set by the desktop shell; the browser build has no such attributes and simply keeps the rail's own glass.
- **New-UI hooks are current-contract only.** The `data-dsh-*` / `data-dockkit-*` hooks come from better-sidebar 0.28 and the DSH 0.2.1-rc.2 front end; an upgrade that renames them returns that surface to unthemed (the startup probe warns when nothing matches).
- **Floating dockkit tabs exist only after a tab is dragged out.** The default layout has no `[data-dockkit-float]` element, so the real-GUI audit does not exercise it in its default scenarios; the rule itself is covered by the selector and contract tests.
- **New-UI exclusions rely on Selectors 4.** The better-sidebar subtrees are excluded with `:not([data-dsh-better-sidebar] *):not([data-dsh-panel-host] *)`; this is verified in Chromium (DSH Desktop and Chrome) but not in Safari.
- **No options.** There is no config schema, toggle or per-appearance override; that simplicity is intentional.

## Development

```sh
pnpm --config.verify-deps-before-run=false --filter dsh-ios-skin typecheck
pnpm --config.verify-deps-before-run=false --filter dsh-ios-skin test
pnpm --config.verify-deps-before-run=false --filter dsh-ios-skin build

# rebuild the self-contained demo page from the real stylesheets
node scripts/build-glass-demo.mjs
```

`--config.verify-deps-before-run=false` is required in this workspace: pnpm's dependency check otherwise hits the local SQLITE store error before the script runs.

The demo generator extracts the official token layer from the installed theme bundle and the plugin stylesheet by running `src/client.js`, so `docs/ios-glass-demo.html` cannot drift from what the plugin ships. If the official package lives inside `app.asar` (where plain Node cannot read it), unpack it or point `DSH_THEME_CLIENT` at the unpacked path; the script lists the paths it tried.
