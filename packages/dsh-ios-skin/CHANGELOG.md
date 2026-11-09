# Changelog

All notable changes to **dsh-ios-skin**. Versioning follows [Semantic Versioning](https://semver.org/).
This is a theme plugin: "breaking" means an official DSH / `dsh-client-ui-theme` upgrade that changes tokens or component class names.

## [0.3.0] — 2026-10-22

**Deep Fusion** — a full visual redesign, not a reskin of the v0.2.x palette. The token API and material architecture are unchanged; the palette, glass recipe, rims and signature are new. Breaking in the visual sense only: no host API changes.

### Changed (breaking visual redesign)

- **Palette.** DeepSeek brand blue `#4D6BFE` (dark `#6E87FF`) replaces iOS system blue; canvas `#F0F2F7` / `#12141A` replaces `#e5e5ea` / `#000`; labels and separators move to neutral-bluish tones.
- **Glass.** Neutral-bluish materials `rgba(240,244,255,.58/.62/.70)` light and `rgba(28,34,48,.64/.70/.78)` dark, with `blur(30px)` / `blur(28px)`, replace the neutral white/black `.60/.72/.86` stack.
- **Rim.** A 1px outer rim (white `rgba(255,255,255,.55)` light, brand `rgba(122,146,255,.22)` dark) plus a 1px inner rim (`rgba(77,107,254,.12)` light, `rgba(0,0,0,.35)` dark) replaces the 0.5px white specular rim; rims are drawn with `box-shadow`, so no border/box geometry changes.
- **Signature.** Active dock panes (`[data-dockkit-pane-active]`) and floating tabs (`[data-dockkit-float-active]`) draw a 1px brand-gradient light band along their top edge. Selected states use 8–12% brand fill plus a 1px brand edge; active labels use a stronger brand tone for AA contrast.
- **Elevation.** Shadows are retuned to restrained neutral-bluish values.
- Demo page shell updated for the new UI (Agent Teams panel, dockkit strip, signature-ready surfaces) so the self-contained preview reflects the redesign.

### Kept

- Token API and `ctx.theme.overrideTokens` handover unchanged: 103 `{ light, dark }` pairs, released on unload, whole-sheet fallback when the service is absent or rejects the layer.
- Material groups and exclusions unchanged: better-sidebar subtrees opt out of generic matching, header (and anything nested in it) stays flat, `_dockHintCard` stays a dashed hint, true circles stay 50%, text/editable surfaces stay opaque, elevation recipes stay per-element.
- Accessibility fallbacks (`prefers-reduced-transparency`, `prefers-contrast: more`, `prefers-reduced-motion`, `@supports`) retained and adapted to the Deep Fusion palette.
- Paint-only contract: no layout, sizes, pointer events or structure.

### Documentation

- Bilingual READMEs rewritten for Deep Fusion: new design-language chapter, a v0.2.2 → v0.3.0 comparison table, brand rim + light-band rows in the new-UI table, updated known limitations.
- `docs/design-v3/README.md` records C as the chosen v0.3.0 direction; A/B stay as alternatives.
- Runtime demo rebuilt from the new `src`, release checklist and screenshots updated.

### Verification

- Build succeeds; `src/client.js = lib/client.js`, md5 `abc971af92ec0fe1b41dd89c55c205c1`; **37/37 contract tests** pass.
- Design-restoration audit against `docs/design-v3/direction-c.css` passes: active dock pane/float tab carries the 1px brand-gradient band and inactive surfaces carry none; active tab text uses the brand-strong colour; double rim (outer + inner), `blur(30px)`/`blur(28px)`, radius 14 and the `#F0F2F7` / `#12141A` canvas + brand blue all match the C preview computed values; body text contrast min 5.99:1 light / 7.75:1 dark after the currentTag fix.
- Runtime audit: new UI **127 checks — 122 pass / 0 fail / 0 warn / 5 info**; clean regression **51 checks — 50 pass / 0 fail / 0 warn / 1 info**; both exit 0, defects = 0.
- Screenshots refreshed for Deep Fusion: `newui-light/dark/agent-team/agent-team-dark/bottom-panel.png` plus the six `runtime-*.png`; v0.2.2 images are archived under `docs/assets/ios-skin/v022/`.

## [0.2.2] — 2026-10-20

New-UI adaptation for the current GUI: **dsh-better-sidebar 0.28** and the **Agent Teams** panel/roster. DSH App itself is still `0.2.1-rc.2`; this release adapts the material layer to the plugin surfaces layered on top of that shell. Token layer untouched (103 `overrideTokens` pairs, unchanged).

### Added

- **Material coverage for better-sidebar** — the bottom workbench (`[data-dsh-bottom-panel]`) gets the `regular` glass fill and blur without touching its geometry; its floating windows (`role=dialog`) get the rim and float shadow. The better-sidebar host and file tree (`[data-dsh-better-sidebar]` / `[data-dsh-panel-host]` subtrees) deliberately keep the plugin's own token surfaces and are excluded from the generic card/header/rail/bar rules. The DSH right-sidebar content pane is left to dockkit's opaque token background; the theme adds only the right tab strip's `thin` glass.
- **Material coverage for the new tabs and Agent Teams** — dockkit's tab strip (`[role=tablist]`, `[data-dockkit-strip]`) joins the `thin` group; floating dockkit tabs (`[data-dockkit-float]`), the Agent Teams popover (`[data-team-panel]`, also `role=dialog`) and the markdown TOC popover get the `regular` overlay treatment. Tabs, tree rows and icon slots, pane bodies/cards, roster rows/member text and the inline Agent Teams trigger stay flat.
- New contract assertions for the new-UI selectors: material groups disjoint on the real 0.2.x class inventory, stable hooks present, workbench paints-only rule, plus samples from the real DOM (`jJkEga_slot`, `nArs4W_pane*`, `_stripTabs`, `_dockHintCard`, `irMxjq_panelBody`). **30 contract tests total** (was 28).
- READMEs gain a "New UI compatibility" section and new-UI screenshots; the runtime audit gains a new-UI chapter with its own scenario, defects table and screenshot index.

### Changed

- New-UI matching now prefers published hooks — better-sidebar `data-dsh-*` (including the `data-dsh-better-sidebar` / `data-dsh-panel-host` exclusion anchors), dockkit `data-dockkit-*`, `[data-team-panel]`, `[role=tablist]`/`[role=dialog]` — instead of broad local-name suffixes.
- Removed the over-broad `_pane`, `_surface`, `_slot`, `_strip`, `_float` and `_dockHintCard` groups; they matched layout containers, sidebar icon slots, tab-strip parts and the dashed dock hint card.
- `_card`/`_header`/`_panelList`/bar rules exclude both better-sidebar subtrees (`[data-dsh-better-sidebar]`, `[data-dsh-panel-host]`); the `_panelBody` rail rule is gone: the right-sidebar body paints its own opaque pane content, so a second glass layer only greyed it out.
- The inert probe now also recognizes `[data-dsh-bottom-panel]`, `[data-dockkit-strip]` and `[data-dockkit-float]`, so a new-UI-only environment cannot report a false inert layer.

### Fixed

Six new-UI defects found across the audit passes (all verified fixed in the real GUI):

- **D1 — sidebar icon slots got glass.** `[class*='_slot']` matched 19 `jJkEga_slot` icon slots in the new sidebar; group removed.
- **D2 — better-sidebar panes were treated as DSH cards.** `_pane` / `_card` reached `nArs4W_paneCard/paneBody/cardBar/editorHeader`; both patterns now exclude the better-sidebar subtrees.
- **D3 — the dockkit layout shell got card material.** `[class*='_surface']` matched `_surface_6nhg2` (a flex layout wrapper); group removed.
- **D4 — right-sidebar double glass.** `_panelBody` stacked rail glass over dockkit's opaque pane content and greyed it out; rule removed (right rail content is dockkit-owned, only its tab strip is themed).
- **D5 — bottom workbench had no material.** The new `[data-dsh-bottom-panel]` surface matched no group; it now gets `glass` fill + `blur(30px)` while border/radius/shadow stay owned by better-sidebar.
- **D7 — header descendants got glass.** In the new session UI a breadcrumb `nav` and a `[role=tablist]` live inside the header, so the thin/rail groups painted them. Those groups now exclude `header *` / `[role=banner] *`; the header stays completely flat while navigation and tab strips outside headers keep their material.

### Verification

- Build succeeds; `src/client.js = lib/client.js`, md5 `298cc19b6cc34ea13a6fed276e417852` (build 2026-10-20 14:56 +08:00).
- **30/30 contract tests** pass (`node --test "test/*.test.js"`).
- Runtime audit, new-UI scenario (better-sidebar 0.28 + Agent Teams, profile `awteamfull`, port 3098): **107 checks — 102 pass / 0 fail / 0 warn / 5 info, exit 0**; screenshots `newui-light.png`, `newui-dark.png`, `newui-agent-team.png`, `newui-agent-team-dark.png`, `newui-bottom-panel.png`.
- Runtime audit, clean-profile regression (profile `iosdev`, port 3099): **51 checks — 50 pass / 0 fail / 0 warn / 1 info, exit 0**. Both scenarios are release gates.
- Demo page rebuilt from the final `src`: v0.2.2, 103 tokens, 36 rules incl. 10 glass rules, 30 contract tests; headless check confirms no console errors, flat header, 50% circles, flat better-sidebar leaves, thin dockkit strip and regular Agent Teams panel.

## [0.2.1] — 2026-10-20

The two-layer Liquid Glass rewrite. Targets `@deepseek-ai/dsh-client-ui-theme` **0.2.1-rc.2** (DSH 0.2.x).

### Added

- **Token layer through the official theme API.** The plugin hands **103** `--dsw-*` overrides to `ctx.theme.overrideTokens("dsh-ios-skin", …)` as validated `{ light, dark }` pairs, releases them on dispose, and falls back to an embedded stylesheet when the service is absent or rejects the layer. The sheet itself declares 107 `--dsw-*`; the four extra are the per-element elevation recipes, which must stay in CSS (see below). The private `--dsh-ios-*` scale and all material rules stay in the injected sheet either way.
- **Material layer with three densities.** `thin` for bars, rails, panel hosts and composer docks (no elevation); `regular` for overlays — dialogs, menus, toasts, floating cards — with a 0.5px specular rim and iOS float shadow; `thick` for menu/input/text-bearing token surfaces. One shared `--dsh-ios-radius:14px` renders as a squircle through the host's `--dsw-corner-shape`. Surfaces match both build-hashed local component names (static `_name_hash` and runtime `hash_name` formats) and semantic/ARIA hooks (`header`, `nav`, `aside`, `[role=dialog]`, `[role=menu]`, …).
- **Per-element elevation recipes.** The official sheet declares `--dsw-elevation-*` on `body, body *`; the plugin re-declares the same recipes the same way so descendants resolve the iOS stroke and shadow against their own surface (component-level `--dsw-elevation-stroke-color` rebinds keep working).
- **More semantic tokens**, including toast label, menu icon, switch thumb, menu surface fill, sticky menu-group-header fill and menu backdrop blur.
- **Startup inert probe.** One read-only `querySelector` at load; if none of the known component names match it logs `[dsh-ios-skin] material layer is inert: …` instead of failing silently after an official upgrade.
- **Accessibility fallbacks.** `prefers-reduced-transparency`, `prefers-contrast: more`, `prefers-reduced-motion`, and `@supports` fallback to solid materials. The reduced-transparency blur reset and the high-contrast token overrides use `!important` — they have to beat the material rules' higher specificity and the theme service's inline token declarations respectively.
- **Readability floors.** `pre`, `code`, `input`, `select`, `textarea` and `contenteditable` lose backdrop blur and keep near-opaque backgrounds.
- **Desktop shell handoff.** In `data-dsh-desktop-mode="extended" | "advanced"` (and not `data-dsh-desktop-material="off"`), the rail goes transparent so the native macOS vibrancy shows through.
- `docs/ios-glass-demo.html` generator now finds the current app layout (`app.asar` package unpacked to the workspace, or `DSH_THEME_CLIENT`) and derives version/token/rule/test counts from source instead of hardcoding them.
- Bilingual READMEs rewritten for this release (with runtime screenshots), plus `docs/RELEASE-dsh-ios-skin.md`, `docs/ios-skin-runtime-audit.md` and this changelog.

### Changed

- **Material selector groups are now explicitly disjoint.** `[class*='_pane']` excludes `_panel*` so sidebar rows, titles and icon leaves stay flat; the bare `_menu` substring is gone (real menus carry `[role='menu']`, and `_menuAnchor` is a flat inline trigger); `[class*='_float']` excludes `_floatHost` so docks stay thin; the sidebar rail carries material without elevation.
- The page-level header stays flat (page plane, no glass/radius/elevation) and true circles keep the official `border-radius:50%` — the theme no longer sets a radius on `button`, `[role=button]`, `[role=tab]` or `[role=menuitem]`.
- **Font chain** — the font chosen in Settings comes first, then the iOS stack (`-apple-system` / SF Pro / SF Mono) as fallback, so a user-customised font still wins.
- Scrollbars are retuned through the official `--dsh-scrollbar-*` tokens instead of styling `::-webkit-scrollbar`, so WebKit and Firefox share one look and no container's gutter is disturbed.
- Dark palette now declares every token the light palette does, which the `overrideTokens` validator requires (`{ light, dark }` pairs).

### Fixed

- **Activation crash on cordis 4.x.** Reading `ctx.theme` on a context that does not inject `theme` throws `cannot get property … without inject`, which used to abort `apply()` and kill the whole theme. Both service probes are now guarded; a strict context loads the sheet and the body class normally.
- **True circles no longer squared off** by a plugin radius on buttons/tabs/menuitems.
- **Five runtime-audit defects fixed**: sidebar leaves no longer receive card glass/shadow from the `_pane` substring; `_menuAnchor` no longer gets overlay material; the sidebar rail loses its card shadow; reduced-transparency now actually removes blur; `prefers-contrast: more` token overrides now win over the theme service's inline values.
- Demo page no longer reports an old version (`v0.2.0`) or an old test count (`12`) — all copy numbers now come from source.

### Verification

- `pnpm --config.verify-deps-before-run=false --filter dsh-ios-skin build` succeeds; `lib/client.js` is byte-identical to `src/client.js`.
- **28 contract tests pass** (`node --test "test/*.test.js"`), including new assertions for per-element elevation, the font chain, disjoint material groups, the accessibility `!important` rules and contrast floors.
- Headless check of `docs/ios-glass-demo.html`: no console errors; light/dark tokens resolve to iOS values; header flat; true circle 50%; rails flat; textarea/code blur off; skin toggle restores official defaults.
- Runtime audit against a real DSH Web GUI (light, dark, settings, menus, reduced transparency, high contrast, reduced motion): **49 checks, 48 pass / 0 fail / 0 warn / 1 info, exit 0** after the fixes above; the first pass had found the five defects, all now verified fixed in [docs/ios-skin-runtime-audit.md](../../docs/ios-skin-runtime-audit.md).

## [0.1.0] — 2026-09-13

Initial public npm release: token-level iOS skin with light/dark/system appearance and sidebar appearance controls. Superseded by 0.2.1; the sidebar controls were removed because third-party themes cannot persist through the built-in settings schema.
