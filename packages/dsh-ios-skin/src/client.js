/**
 * dsh-ios-skin — client half: iOS 26 "Liquid Glass" theme for the DSH Web GUI,
 * "Deep Fusion" edition (v0.3.0): DeepSeek brand blue fused with iOS materials.
 *
 * Pure CSS: one injected stylesheet plus one body class. No framework code, no
 * DOM queries, no observers, no storage, no layout or interaction ownership.
 *
 * Two layers make the theme comprehensive rather than per-component:
 *
 *   1. TOKEN layer — retunes the official `--dsw-*` design tokens (background,
 *      border, label, button, markdown, scrollbar, elevation, shadow, specific)
 *      to the Deep Fusion palette. Official components read those tokens, so
 *      every surface follows without naming a single component.
 *   2. MATERIAL layer — a neutral blue-tinted glass (blur 30 / 28 in dark) with
 *      an outer white rim, an inner brand rim and the signature 1px brand
 *      gradient light band on the active dock pane / floating tab window.
 *
 * The plugin never hides, moves, resizes or captures pointer events on official
 * UI: it only paints. Uninstalling removes the stylesheet and the body class.
 */
window.__ModuleLoader__.load({
  id: "dsh-ios-skin",
  factory: () => {
    var module = { exports: {} };
    var STYLE_ID = "dsh-ios-skin-style";
    var CLASS_NAME = "dsh-ios-skin";

    var css = [
      /* ── 1. private Deep Fusion scale ─────────────────────────────────── */
      "body." + CLASS_NAME + "{",
      "  --dsh-ios-font:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Helvetica Neue',system-ui,sans-serif;",
      "  --dsh-ios-mono:ui-monospace,'SF Mono',SFMono-Regular,Menlo,monospace;",
      "  --dsh-ios-brand:#4D6BFE;",
      "  --dsh-ios-brand-strong:#2F4BD9;",
      "  --dsh-ios-brand-soft:rgba(77,107,254,.10);",
      "  --dsh-ios-brand-border:rgba(77,107,254,.38);",
      "  --dsh-ios-brand-band-end:#9BB0FF;",
      "  --dsh-ios-focus:rgba(77,107,254,.30);",
      "  --dsh-ios-radius:14px;",
      "  --dsh-ios-glass-thin:rgba(240,244,255,.58);",
      "  --dsh-ios-glass:rgba(240,244,255,.62);",
      "  --dsh-ios-glass-thick:rgba(244,247,255,.70);",
      "  --dsh-ios-rim:rgba(255,255,255,.55);",
      "  --dsh-ios-rim-inner:rgba(77,107,254,.12);",
      "  --dsh-ios-surface:#FFFFFF;",
      "  --dsh-ios-blur:30px;",
      "  --dsh-ios-sep:rgba(23,26,33,.20);",
      "  --dsh-ios-ink:rgba(20,24,34,.86);",
      "  --dsh-ios-shadow-soft:0 2px 12px rgba(20,30,60,.07),0 22px 56px rgba(20,30,60,.11);",
      "  --dsh-ios-shadow-float:0 6px 24px rgba(20,30,60,.10),0 40px 92px rgba(20,30,60,.16);",
      "  --dsh-ios-shadow-card:0 1px 2px rgba(20,30,60,.04),0 12px 32px rgba(20,30,60,.09);",
      "}",
      /* ── 1b. canvas ───────────────────────────────────────────────────── */
      /* One flat blue-grey colour, and nothing animating behind it. The brand
         signature lives on active surfaces (a 1px gradient light band), never in
         the canvas. */
      "body." + CLASS_NAME + "{",
      "  background-color:#F0F2F7;",
      "}",
      /* ── 2. official tokens — light ───────────────────────────────────── */
      "body." + CLASS_NAME + "{",
      "  color-scheme:light;",
      /* Deep Fusion palette: neutral blue-grey canvas, blue-tinted glass tiers,
         DeepSeek brand blue. Separators are neutral ink; the brand rim is a
         material property, not a token. */
      "  --dsw-alias-bg-base:#F0F2F7;",
      "  --dsw-alias-bg-layer-1:var(--dsh-ios-glass-thin);",
      "  --dsw-alias-bg-layer-2:var(--dsh-ios-glass);",
      "  --dsw-alias-bg-layer-3:var(--dsh-ios-glass-thick);",
      "  --dsw-alias-bg-overlay:var(--dsh-ios-glass);",
      "  --dsw-alias-bg-mask-1:rgba(0,0,0,.20);",
      "  --dsw-alias-bg-mask-2:rgba(0,0,0,.10);",
      "  --dsw-alias-bg-mask-3:rgba(0,0,0,.46);",
      "  --dsw-alias-bg-mask-drop:rgba(255,255,255,.62);",
      "  --dsw-alias-bg-module-platform:var(--dsh-ios-glass-thin);",
      "  --dsw-alias-bg-multi-select:rgba(77,107,254,.10);",
      "  --dsw-alias-bg-skeleton:rgba(118,118,128,.10);",
      "  --dsw-alias-border-l1:rgba(23,26,33,.10);",
      "  --dsw-alias-border-l2:rgba(23,26,33,.14);",
      "  --dsw-alias-border-l3:rgba(23,26,33,.20);",
      "  --dsw-alias-border-l4:rgba(23,26,33,.28);",
      "  --dsw-alias-border-l2-darkmode-thin:rgba(23,26,33,.10);",
      "  --dsw-alias-border-inverted:transparent;",
      "  --dsw-alias-border-inverted2:rgba(255,255,255,.65);",
      "  --dsw-font-family:var(--dsh-font-family-text,var(--dsh-ios-font)),var(--dsh-ios-font);",
      "  --ds-font-family-code:var(--dsh-font-family-code,var(--dsh-ios-mono)),var(--dsh-ios-mono);",
      "  --dsw-alias-label-primary:#171A21;",
      "  --dsw-alias-label-primary-foreground:#FFFFFF;",
      "  --dsw-alias-label-primary-inverted:#FFFFFF;",
      "  --dsw-alias-label-primary-dimmed:rgba(23,26,33,.55);",
      "  --dsw-alias-label-primary-bluish:#171A21;",
      "  --dsw-alias-label-secondary:rgba(23,26,33,.64);",
      "  --dsw-alias-label-tertiary:rgba(23,26,33,.50);",
      "  --dsw-alias-label-caption:rgba(23,26,33,.38);",
      "  --dsw-alias-label-dimmed:rgba(23,26,33,.28);",
      "  --dsw-alias-menu-icon:#363A45;",
      "  --dsw-alias-brand-primary:#4D6BFE;",
      "  --dsw-alias-brand-primary-invert:#4D6BFE;",
      "  --dsw-alias-brand-primary-new-colorprimary-new-color:#4D6BFE;",
      "  --dsw-alias-brand-text:#171A21;",
      "  --dsw-alias-link:#3B57E8;",
      "  --dsw-alias-state-business-primary:#4D6BFE;",
      "  --dsw-alias-state-business-tertiary:rgba(77,107,254,.10);",
      "  --dsw-alias-state-error-primary:#FF3B30;",
      "  --dsw-alias-state-error-secondary:#FF6961;",
      "  --dsw-alias-state-success-primary:#34C759;",
      "  --dsw-alias-state-success-secondary:#5ED67A;",
      "  --dsw-alias-state-success-tertiary:rgba(52,199,89,.16);",
      "  --dsw-alias-state-warn-primary:#FF9500;",
      "  --dsw-alias-state-warn-secondary:#FFB340;",
      "  --dsw-alias-state-warn-tertiary:rgba(255,149,0,.16);",
      "  --dsw-alias-state-warn-label:#A35200;",
      "  --dsw-alias-button-primary-fill:#4D6BFE;",
      "  --dsw-alias-button-primary-hover:#3B57E8;",
      "  --dsw-alias-button-primary-dimmed:rgba(0,122,255,.42);",
      "  --dsw-alias-button-contrast-fill:#1C1C1E;",
      "  --dsw-alias-button-elevated-fill:var(--dsh-ios-glass-thick);",
      "  --dsw-alias-button-floating-fill:var(--dsh-ios-glass);",
      "  --dsw-alias-button-floating-hover:rgba(255,255,255,.94);",
      "  --dsw-alias-button-ghost-active-fill:rgba(118,118,128,.14);",
      "  --dsw-alias-button-ghost-active-hover:rgba(118,118,128,.20);",
      "  --dsw-alias-button-ghost-active-border:rgba(23,26,33,.20);",
      "  --dsw-alias-button-info-fill:#4D6BFE;",
      "  --dsw-alias-button-info-hover:#3B57E8;",
      "  --dsw-alias-button-tool-bar-fill:rgba(255,255,255,.62);",
      "  --dsw-alias-button-tool-bar-fill-invisible:rgba(118,118,128,.16);",
      "  --dsw-alias-button-tool-bar-hover:rgba(255,255,255,.82);",
      "  --dsw-alias-switch-thumb:#FFFFFF;",
      "  --dsw-alias-interactive-bg-hover:rgba(118,118,128,.12);",
      "  --dsw-alias-interactive-bg-active:rgba(118,118,128,.20);",
      "  --dsw-alias-interactive-bg-hover-accent:rgba(77,107,254,.10);",
      "  --dsw-alias-interactive-bg-hover-danger:rgba(255,59,48,.14);",
      "  --dsw-alias-interactive-bg-hover-solid:rgba(118,118,128,.16);",
      "  --dsw-alias-markdown-code-block:rgba(118,118,128,.10);",
      "  --dsw-alias-markdown-code-block-banner:rgba(118,118,128,.07);",
      "  --dsw-alias-markdown-inline-code:rgba(118,118,128,.14);",
      "  --dsw-alias-markdown-code-segment-selected:var(--dsh-ios-glass-thick);",
      "  --dsw-alias-markdown-code-segment-unselected:transparent;",
      "  --dsw-alias-markdown-citation:rgba(118,118,128,.10);",
      "  --dsw-alias-markdown-placeholder:rgba(118,118,128,.18);",
      "  --dsw-alias-markdown-tag:rgba(118,118,128,.14);",
      "  --dsw-alias-tooltip-bg:rgba(20,24,34,.86);",
      "  --dsw-alias-toast-bg:rgba(255,255,255,.88);",
      "  --dsw-alias-toast-label:#171A21;",
      "  --dsw-alias-scrollbar-bg-l1:rgba(0,0,0,.18);",
      "  --dsw-alias-scrollbar-bg-l2:rgba(0,0,0,.22);",
      "  --dsw-alias-scrollbar-hover-l1:rgba(0,0,0,.30);",
      "  --dsw-alias-scrollbar-hover-l2:rgba(0,0,0,.34);",
      "  --dsh-scrollbar-thumb:rgba(0,0,0,.18);",
      "  --dsh-scrollbar-thumb-hover:rgba(0,0,0,.30);",
      "  --dsw-specific-menu:var(--dsh-ios-glass-thick);",
      "  --dsw-menu-surface-fill:var(--dsh-ios-glass);",
      "  --dsw-alias-menu-group-header-fill:var(--dsh-ios-glass-thick);",
      "  --dsw-menu-backdrop-filter:blur(30px) saturate(180%);",
      "  --dsw-specific-sidebar-fill:var(--dsh-ios-glass-thin);",
      "  --dsw-specific-sidebar-nav-item-hover:rgba(118,118,128,.12);",
      "  --dsw-specific-sidebar-nav-item-active:color-mix(in srgb,#4D6BFE 12%,transparent);",
      "  --dsw-specific-sidebar-nav-item-active-accent:color-mix(in srgb,#4D6BFE 18%,transparent);",
      "  --dsw-specific-input-major:#FFFFFF;",
      "  --dsw-specific-login-input:rgba(255,255,255,.86);",
      "  --dsw-specific-selector:rgba(118,118,128,.14);",
      "  --dsw-specific-tip:var(--dsh-ios-glass-thick);",
      "  --dsw-specific-bubble:rgba(77,107,254,.10);",
      "  --dsw-specific-bubble-highlight:color-mix(in srgb,#4D6BFE 18%,transparent);",
      "  --dsw-elevation-stroke-color:var(--dsh-ios-rim);",
      "  --dsw-shadow-lv1:0 1px 2px rgba(0,0,0,.05);",
      "  --dsw-shadow-lv1-blur:0 2px 10px rgba(0,0,0,.05);",
      "  --dsw-shadow-lv2:0 1px 3px rgba(0,0,0,.05),0 8px 20px rgba(0,0,0,.06);",
      "  --dsw-shadow-lv3:0 6px 24px rgba(20,30,60,.10),0 40px 92px rgba(20,30,60,.16);",
      "  --dsw-mask-blur:blur(30px) saturate(180%);",
      "  --dsw-hovercard-bg:var(--dsh-ios-glass-thick);",
      "}",
      /* ── 3. official tokens — dark ────────────────────────────────────── */
      "body." + CLASS_NAME + "[data-ds-dark-theme]{",
      "  color-scheme:dark;",
      "  --dsh-ios-brand:#6E87FF;",
      "  --dsh-ios-brand-strong:#9DB0FF;",
      "  --dsh-ios-brand-soft:rgba(110,135,255,.20);",
      "  --dsh-ios-brand-border:rgba(110,135,255,.44);",
      "  --dsh-ios-brand-band-end:#8CA0FF;",
      "  --dsh-ios-focus:rgba(110,135,255,.36);",
      "  --dsh-ios-glass-thin:rgba(28,34,48,.64);",
      "  --dsh-ios-glass:rgba(28,34,48,.70);",
      "  --dsh-ios-glass-thick:rgba(34,41,58,.78);",
      "  --dsh-ios-rim:rgba(122,146,255,.22);",
      "  --dsh-ios-rim-inner:rgba(0,0,0,.35);",
      "  --dsh-ios-surface:#1A1D26;",
      "  --dsh-ios-blur:28px;",
      "  --dsh-ios-sep:rgba(235,235,245,.20);",
      "  --dsh-ios-ink:rgba(34,41,58,.90);",
      "  --dsh-ios-shadow-soft:0 2px 14px rgba(0,0,0,.34),0 24px 62px rgba(0,0,0,.42);",
      "  --dsh-ios-shadow-float:0 8px 28px rgba(0,0,0,.42),0 44px 100px rgba(0,0,0,.52);",
      "  --dsh-ios-shadow-card:0 2px 10px rgba(0,0,0,.30),0 16px 40px rgba(0,0,0,.34);",
      "  background-color:#12141A;",
      "  --dsw-alias-bg-base:#12141A;",
      "  --dsw-alias-bg-overlay:var(--dsh-ios-glass);",
      "  --dsw-alias-bg-mask-1:rgba(0,0,0,.48);",
      "  --dsw-alias-bg-mask-2:rgba(0,0,0,.24);",
      "  --dsw-alias-bg-mask-3:rgba(0,0,0,.60);",
      "  --dsw-alias-bg-mask-drop:rgba(0,0,0,.45);",
      "  --dsw-alias-bg-multi-select:rgba(110,135,255,.20);",
      "  --dsw-alias-bg-skeleton:rgba(255,255,255,.08);",
      "  --dsw-alias-border-l1:rgba(235,235,245,.10);",
      "  --dsw-alias-border-l2:rgba(235,235,245,.14);",
      "  --dsw-alias-border-l3:rgba(235,235,245,.20);",
      "  --dsw-alias-border-l4:rgba(235,235,245,.28);",
      "  --dsw-alias-border-l2-darkmode-thin:rgba(235,235,245,.14);",
      "  --dsw-alias-border-inverted2:rgba(255,255,255,.16);",
      "  --dsw-alias-label-primary:#F2F4F8;",
      "  --dsw-alias-label-primary-foreground:#1A1D26;",
      "  --dsw-alias-label-primary-inverted:#1A1D26;",
      "  --dsw-alias-label-primary-dimmed:rgba(242,244,248,.55);",
      "  --dsw-alias-label-primary-bluish:#F2F4F8;",
      "  --dsw-alias-label-secondary:rgba(235,235,245,.66);",
      "  --dsw-alias-label-tertiary:rgba(235,235,245,.44);",
      "  --dsw-alias-label-caption:rgba(235,235,245,.38);",
      "  --dsw-alias-label-dimmed:rgba(235,235,245,.28);",
      "  --dsw-alias-menu-icon:rgba(235,235,245,.55);",
      "  --dsw-alias-brand-primary:#6E87FF;",
      "  --dsw-alias-brand-primary-invert:#6E87FF;",
      "  --dsw-alias-brand-primary-new-colorprimary-new-color:#6E87FF;",
      "  --dsw-alias-brand-text:#F2F4F8;",
      "  --dsw-alias-link:#9DB0FF;",
      "  --dsw-alias-state-business-primary:#6E87FF;",
      "  --dsw-alias-state-business-tertiary:rgba(110,135,255,.20);",
      "  --dsw-alias-state-error-primary:#FF453A;",
      "  --dsw-alias-state-error-secondary:#FF6961;",
      "  --dsw-alias-state-success-primary:#30D158;",
      "  --dsw-alias-state-success-secondary:#5ED67A;",
      "  --dsw-alias-state-success-tertiary:rgba(48,209,88,.22);",
      "  --dsw-alias-state-warn-primary:#FF9F0A;",
      "  --dsw-alias-state-warn-secondary:#FFB340;",
      "  --dsw-alias-state-warn-tertiary:rgba(255,159,10,.22);",
      "  --dsw-alias-state-warn-label:#FFB340;",
      "  --dsw-alias-button-primary-fill:#6E87FF;",
      "  --dsw-alias-button-primary-hover:#8CA0FF;",
      "  --dsw-alias-button-primary-dimmed:rgba(10,132,255,.42);",
      "  --dsw-alias-button-contrast-fill:#F2F2F7;",
      "  --dsw-alias-button-elevated-fill:var(--dsh-ios-glass-thick);",
      "  --dsw-alias-button-floating-fill:var(--dsh-ios-glass);",
      "  --dsw-alias-button-floating-hover:rgba(58,58,60,.92);",
      "  --dsw-alias-button-ghost-active-fill:rgba(118,118,128,.28);",
      "  --dsw-alias-button-ghost-active-hover:rgba(118,118,128,.36);",
      "  --dsw-alias-button-ghost-active-border:rgba(235,235,245,.28);",
      "  --dsw-alias-button-info-fill:#6E87FF;",
      "  --dsw-alias-button-info-hover:#8CA0FF;",
      "  --dsw-alias-button-tool-bar-fill:rgba(118,118,128,.32);",
      "  --dsw-alias-button-tool-bar-fill-invisible:rgba(118,118,128,.24);",
      "  --dsw-alias-button-tool-bar-hover:rgba(118,118,128,.44);",
      "  --dsw-alias-switch-thumb:#F2F4F8;",
      "  --dsw-alias-interactive-bg-hover:rgba(255,255,255,.10);",
      "  --dsw-alias-interactive-bg-active:rgba(255,255,255,.16);",
      "  --dsw-alias-interactive-bg-hover-accent:rgba(110,135,255,.20);",
      "  --dsw-alias-interactive-bg-hover-danger:rgba(255,69,58,.18);",
      "  --dsw-alias-interactive-bg-hover-solid:rgba(118,118,128,.28);",
      "  --dsw-alias-markdown-code-block:rgba(118,118,128,.22);",
      "  --dsw-alias-markdown-code-block-banner:rgba(118,118,128,.16);",
      "  --dsw-alias-markdown-inline-code:rgba(118,118,128,.26);",
      "  --dsw-alias-markdown-code-segment-selected:var(--dsh-ios-glass-thick);",
      "  --dsw-alias-markdown-citation:rgba(118,118,128,.22);",
      "  --dsw-alias-markdown-placeholder:rgba(118,118,128,.28);",
      "  --dsw-alias-markdown-tag:rgba(118,118,128,.26);",
      "  --dsw-alias-tooltip-bg:rgba(34,41,58,.90);",
      "  --dsw-alias-toast-bg:var(--dsh-ios-glass-thick);",
      "  --dsw-alias-toast-label:#F2F4F8;",
      "  --dsw-alias-scrollbar-bg-l1:rgba(255,255,255,.20);",
      "  --dsw-alias-scrollbar-bg-l2:rgba(255,255,255,.24);",
      "  --dsw-alias-scrollbar-hover-l1:rgba(255,255,255,.32);",
      "  --dsw-alias-scrollbar-hover-l2:rgba(255,255,255,.38);",
      "  --dsh-scrollbar-thumb:rgba(255,255,255,.20);",
      "  --dsh-scrollbar-thumb-hover:rgba(255,255,255,.32);",
      "  --dsw-specific-menu:var(--dsh-ios-glass-thick);",
      "  --dsw-specific-sidebar-fill:var(--dsh-ios-glass-thin);",
      "  --dsw-specific-sidebar-nav-item-hover:rgba(255,255,255,.10);",
      "  --dsw-specific-sidebar-nav-item-active:color-mix(in srgb,#6E87FF 22%,transparent);",
      "  --dsw-specific-sidebar-nav-item-active-accent:color-mix(in srgb,#6E87FF 30%,transparent);",
      "  --dsw-specific-input-major:#1A1D26;",
      "  --dsw-specific-login-input:rgba(255,255,255,.08);",
      "  --dsw-specific-selector:rgba(118,118,128,.28);",
      "  --dsw-specific-tip:var(--dsh-ios-glass-thick);",
      "  --dsw-specific-bubble:rgba(110,135,255,.16);",
      "  --dsw-specific-bubble-highlight:color-mix(in srgb,#6E87FF 30%,transparent);",
      "  --dsw-alias-bg-layer-1:var(--dsh-ios-glass-thin);",
      "  --dsw-alias-bg-layer-2:var(--dsh-ios-glass);",
      "  --dsw-alias-bg-layer-3:var(--dsh-ios-glass-thick);",
      "  --dsw-alias-bg-module-platform:var(--dsh-ios-glass-thin);",
      "  --dsw-alias-border-inverted:rgba(235,235,245,.14);",
      "  --dsw-shadow-lv1:0 1px 2px rgba(0,0,0,.28);",
      "  --dsw-shadow-lv1-blur:0 2px 12px rgba(0,0,0,.32);",
      "  --dsw-shadow-lv2:0 2px 6px rgba(0,0,0,.30),0 12px 28px rgba(0,0,0,.38);",
      "  --dsw-shadow-lv3:0 8px 28px rgba(0,0,0,.42),0 44px 100px rgba(0,0,0,.52);",
      "  --dsw-mask-blur:blur(28px) saturate(180%);",
      "  --dsw-menu-backdrop-filter:blur(28px) saturate(180%);",
      "}",
      /* ── 3b. elevation recipes, re-declared per element ────────────────── */
      /* The official gradient-shadow-text.css declares the derived elevation
         recipes on `body,body *`, so every surface re-resolves them against its
         own rebindable --dsw-elevation-stroke-color. A body-only override can
         never reach a descendant: the descendant's own declaration beats
         inheritance. Re-declare the recipes here exactly the way the official
         sheet does, so the iOS shadows actually apply; the stroke colour itself
         stays inherited (declared once on the palette blocks above), which is
         what keeps component-level rebinds (border-l1/l2/l3 on menus, cards,
         toolbars) working. */
      "body." + CLASS_NAME + ",body." + CLASS_NAME + " *{",
      "  --dsw-elevation-stroke:0 0 0 .5px var(--dsw-elevation-stroke-color);",
      "  --dsw-elevation-panel:var(--dsw-elevation-stroke),var(--dsh-ios-shadow-soft);",
      "  --dsw-elevation-prominent:var(--dsw-elevation-stroke),var(--dsh-ios-shadow-float);",
      "  --dsw-elevation-soft:var(--dsw-elevation-stroke),var(--dsh-ios-shadow-soft);",
      "}",

      /* ── 4. material layer: Deep Fusion glass on the chrome ───────────── */
      /* Three naming worlds meet here. DSH's own components use CSS-module
         locals (`_3WPZCG_panelList` in the static bundle, `hash_panelBody` in
         runtime-injected plugins); the new workbench plugins (better-sidebar,
         the dockkit tab split, Agent Teams) expose stable attributes on the
         surfaces that matter. The rules below:
           - only ever name a local, never a hash;
           - prefer `data-dsh-*` / `data-dockkit-*` / ARIA hooks for third-party
             UI, because its class names are build output;
           - switch the ambiguous DSH class assumptions off inside
             better-sidebar's tree (its own skin contract is tokens only);
           - keep the groups disjoint: `_pane`/`_surface`/`_slot`/`_strip`/
             `_float`/`_menu` are not matched as bare substrings, because the
             real DOM uses them for layout wrappers, icon slots and anchors.
         Deep Fusion chrome: outer 1px white rim + inner 1px brand rim are painted
         with box-shadow (never border, so 0.5px never changes layout); blur is
         30px light / 28px dark through --dsh-ios-blur. */
      /* Bars and strips: the thinnest material. The page-level header is
         deliberately not in this group — see the flat rule below. */
      "body." + CLASS_NAME + " [class*='_toolbar']:not([data-dsh-panel-host] *):not(header *):not([role='banner'] *),",
      "body." + CLASS_NAME + " [class*='_titlebar']:not([data-dsh-panel-host] *):not(header *):not([role='banner'] *),",
      "body." + CLASS_NAME + " [class*='_tabStrip']:not([data-dsh-panel-host] *):not(header *):not([role='banner'] *),",
      "body." + CLASS_NAME + " [role='tablist']:not(header *):not([role='banner'] *),",
      "body." + CLASS_NAME + " [data-dockkit-strip]:not(header *):not([role='banner'] *){",
      "  background-color:var(--dsh-ios-glass-thin);",
      "  -webkit-backdrop-filter:blur(var(--dsh-ios-blur)) saturate(180%);",
      "  backdrop-filter:blur(var(--dsh-ios-blur)) saturate(180%);",
      "  border-radius:var(--dsh-ios-radius);",
      "}",
      /* The header belongs to the page plane, not to a floating card: it is the
         same surface as the canvas, so no glass, no radius, no elevation. The
         better-sidebar tree keeps its own token-painted headers. */
      "body." + CLASS_NAME + " [class*='_header']:not([data-dsh-better-sidebar] *):not([data-dsh-panel-host] *),",
      "body." + CLASS_NAME + " :is(header,[role='banner']){",
      "  background-color:transparent;",
      "  -webkit-backdrop-filter:none;",
      "  backdrop-filter:none;",
      "  box-shadow:none;",
      "}",
      /* Rails, docks and panel hosts. No elevation here: a rail is a strip of
         material, not a card. */
      "body." + CLASS_NAME + " [class*='_panelList']:not([data-dsh-better-sidebar] *):not([data-dsh-panel-host] *),",
      "body." + CLASS_NAME + " [class*='_floatHost'],",
      "body." + CLASS_NAME + " [class*='_composerSeat'],",
      "body." + CLASS_NAME + " [class*='_composerStack'],",
      "body." + CLASS_NAME + " :is(.dshDesktopSidebarSurface,.dshDesktopRightbarSurface){",
      "  background-color:var(--dsh-ios-glass-thin);",
      "  -webkit-backdrop-filter:blur(var(--dsh-ios-blur)) saturate(180%);",
      "  backdrop-filter:blur(var(--dsh-ios-blur)) saturate(180%);",
      "  border-radius:var(--dsh-ios-radius);",
      "}",
      /* Overlays and floating surfaces: neutral blue glass, outer white rim,
         inner brand rim and the floating elevation. `_menu`, `_float` and
         `_dockHintCard` are deliberately absent (role/hook matching only). */
      "body." + CLASS_NAME + " [class*='_dialog'],",
      "body." + CLASS_NAME + " [class*='_toast'],",
      "body." + CLASS_NAME + " [class*='_viewport']{",
      "  background-color:var(--dsh-ios-glass);",
      "  -webkit-backdrop-filter:blur(var(--dsh-ios-blur)) saturate(180%);",
      "  backdrop-filter:blur(var(--dsh-ios-blur)) saturate(180%);",
      "  border-radius:var(--dsh-ios-radius);",
      "  box-shadow:0 0 0 1px var(--dsh-ios-rim),inset 0 0 0 1px var(--dsh-ios-rim-inner),var(--dsh-ios-shadow-float);",
      "}",
      /* Stable hooks on the new workbench UI: the dockkit floating tab window,
         the Agent Teams panel (also role=dialog) and the markdown TOC popover. */
      "body." + CLASS_NAME + " [data-dockkit-float],",
      "body." + CLASS_NAME + " [data-team-panel],",
      "body." + CLASS_NAME + " [data-dsh-md-toc-panel]{",
      "  background-color:var(--dsh-ios-glass);",
      "  -webkit-backdrop-filter:blur(var(--dsh-ios-blur)) saturate(180%);",
      "  backdrop-filter:blur(var(--dsh-ios-blur)) saturate(180%);",
      "  border-radius:var(--dsh-ios-radius);",
      "  box-shadow:0 0 0 1px var(--dsh-ios-rim),inset 0 0 0 1px var(--dsh-ios-rim-inner),var(--dsh-ios-shadow-float);",
      "}",
      /* better-sidebar's docked workbench: fill + blur only; its edge, radius and
         border belong to the plugin. */
      "body." + CLASS_NAME + " [data-dsh-bottom-panel]{",
      "  background-color:var(--dsh-ios-glass);",
      "  -webkit-backdrop-filter:blur(var(--dsh-ios-blur)) saturate(180%);",
      "  backdrop-filter:blur(var(--dsh-ios-blur)) saturate(180%);",
      "}",
      /* In-flow surfaces sit closer to the page: softer elevation only. */
      "body." + CLASS_NAME + " [class*='_card']:not([class*='_dockHintCard']):not([data-dsh-better-sidebar] *):not([data-dsh-panel-host] *){",
      "  background-color:var(--dsh-ios-glass);",
      "  -webkit-backdrop-filter:blur(var(--dsh-ios-blur)) saturate(180%);",
      "  backdrop-filter:blur(var(--dsh-ios-blur)) saturate(180%);",
      "  border-radius:var(--dsh-ios-radius);",
      "  box-shadow:0 0 0 1px var(--dsh-ios-rim),inset 0 0 0 1px var(--dsh-ios-rim-inner),var(--dsh-ios-shadow-card);",
      "}",
      /* The user's own message bubble, scoped under its row so the primitives
         tooltip — which shares the `_bubble` local name — is left alone. */
      "body." + CLASS_NAME + " :is([class*='_userRow'],[class*='_userStack']) [class*='_bubble']{",
      "  background-color:var(--dsh-ios-brand-soft);",
      "  border-radius:var(--dsh-ios-radius);",
      "  -webkit-backdrop-filter:blur(18px) saturate(160%);",
      "  backdrop-filter:blur(18px) saturate(160%);",
      "}",
      /* Structural coverage: semantic hooks keep the glass on the rail, the bars
         and every overlay. Headers and their descendants deliberately stay flat. */
      "body." + CLASS_NAME + " :is(nav,[role='navigation']):not(header *):not([role='banner'] *){",
      "  background-color:var(--dsh-ios-glass-thin);",
      "  -webkit-backdrop-filter:blur(var(--dsh-ios-blur)) saturate(180%);",
      "  backdrop-filter:blur(var(--dsh-ios-blur)) saturate(180%);",
      "  border-radius:var(--dsh-ios-radius);",
      "}",
      "body." + CLASS_NAME + " :is(aside,[role='complementary']):not(header *):not([role='banner'] *){",
      "  background-color:var(--dsh-ios-glass-thin);",
      "  -webkit-backdrop-filter:blur(var(--dsh-ios-blur)) saturate(180%);",
      "  backdrop-filter:blur(var(--dsh-ios-blur)) saturate(180%);",
      "  border-radius:var(--dsh-ios-radius);",
      "}",
      "body." + CLASS_NAME + " :is([role='dialog'],[role='alertdialog'],[role='menu'],[role='listbox'],[role='tooltip']){",
      "  background-color:var(--dsh-ios-glass);",
      "  -webkit-backdrop-filter:blur(var(--dsh-ios-blur)) saturate(180%);",
      "  backdrop-filter:blur(var(--dsh-ios-blur)) saturate(180%);",
      "  border-radius:var(--dsh-ios-radius);",
      "  box-shadow:0 0 0 1px var(--dsh-ios-rim),inset 0 0 0 1px var(--dsh-ios-rim-inner),var(--dsh-ios-shadow-float);",
      "}",

      /* ── 4b. Deep Fusion signature ────────────────────────────────────── */
      /* The active dock pane / floating tab window carries a 1px brand gradient
         light band on its top edge. Painted with background-image + size, not a
         pseudo-element or an extra node: zero layout impact. */
      "body." + CLASS_NAME + " [data-dockkit-pane-active],",
      "body." + CLASS_NAME + " [data-dockkit-float-active]{",
      "  background-image:linear-gradient(90deg,var(--dsh-ios-brand) 0%,var(--dsh-ios-brand-band-end) 55%,transparent 100%);",
      "  background-size:100% 1px;",
      "  background-repeat:no-repeat;",
      "  background-position:top left;",
      "}",
      /* Selected rows: 8–12% brand fill comes from the specific-sidebar tokens;
         the 1px brand edge is painted here without changing geometry. */
      "body." + CLASS_NAME + " [role='tab'][aria-selected='true'],",
      "body." + CLASS_NAME + " [aria-current='page']{",
      "  box-shadow:inset 0 0 0 1px var(--dsh-ios-brand-border);",
      "}",
      /* Active tab / current-page text uses the darker brand step so it stays AA
         on the light canvas (4.9:1+) while fills keep the vivid brand blue. */
      "body." + CLASS_NAME + " [class*='_tabActive'],",
      "body." + CLASS_NAME + " [class*='_tabActive'] *,",
      "body." + CLASS_NAME + " [role='tab'][aria-selected='true'],",
      "body." + CLASS_NAME + " [role='tab'][aria-selected='true'] *,",
      "body." + CLASS_NAME + " [aria-current='page'],",
      "body." + CLASS_NAME + " [aria-current='page'] *{",
      "  color:var(--dsh-ios-brand-strong);",
      "}",
      /* Agent Teams paints its roster "currentTag" with small brand-coloured text
         on a 10% brand fill; the vivid brand blue is only 3.9:1 there. This one
         label steps down to the AA-safe brand colour (colour only). */
      "body." + CLASS_NAME + " [data-team-panel] [class*='currentTag'],",
      "body." + CLASS_NAME + " [role='dialog'] [class*='currentTag']{",
      "  color:var(--dsh-ios-brand-strong);",
      "}",
      /* With real macOS vibrancy behind the page, keep the rail transparent so
         the native material shows through instead of stacking two backdrops. */
      "body." + CLASS_NAME + ":is([data-dsh-desktop-mode='extended'],[data-dsh-desktop-mode='advanced']):not([data-dsh-desktop-material='off']){",
      "  --dsw-specific-sidebar-fill:transparent;",
      "}",

      /* ── 5. controls ──────────────────────────────────────────────────── */
      /* Radius is deliberately NOT set here. Official circular controls are
         `border-radius:50%` paired with `corner-shape:round`, and a radius of
         ours on buttons would win on specificity and square those circles off. */
      "body." + CLASS_NAME + " :is(button,[role='button'],[role='tab'],[role='menuitem']){",
      "  transition:background-color .16s ease,box-shadow .16s ease;",
      "}",
      "body." + CLASS_NAME + " :is(button,[role='button']):focus-visible,",
      "body." + CLASS_NAME + " :is(input,textarea,select,[contenteditable='true']):focus-visible{",
      "  outline:none;",
      "  box-shadow:0 0 0 3px var(--dsh-ios-focus);",
      "}",
      "body." + CLASS_NAME + " :is(input,textarea,[contenteditable='true']){",
      "  border-radius:var(--dsh-ios-radius);",
      "}",
      /* Reduced motion: interaction feedback stops animating. Nothing
         decorative moves in the first place, so there is nothing else to still. */
      "@media (prefers-reduced-motion:reduce){",
      "  body." + CLASS_NAME + " :is(button,[role='button']){transition:none}",
      "}",

      /* ── 6. readability floors ────────────────────────────────────────── */
      /* Text-bearing and editable surfaces stay effectively opaque so the glass
         never costs contrast where the user is reading or typing. Deep Fusion
         paints them with the opaque --dsh-ios-surface, not a translucent tier. */
      "body." + CLASS_NAME + " :is(pre,code,input,select,textarea,[contenteditable='true']),",
      "body." + CLASS_NAME + " :is(.cm-editor,.cm-scroller,.xterm,.xterm-screen,.xterm-viewport),",
      "body." + CLASS_NAME + " [data-dsh-md-surface]{",
      "  -webkit-backdrop-filter:none;",
      "  backdrop-filter:none;",
      "}",
      "body." + CLASS_NAME + " :is(input,select,textarea),",
      "body." + CLASS_NAME + " [contenteditable='true'],",
      "body." + CLASS_NAME + " pre,",
      "body." + CLASS_NAME + " [class*='_code'],",
      "body." + CLASS_NAME + " [class*='md-code-block'],",
      "body." + CLASS_NAME + " [class*='_shiki'],",
      "body." + CLASS_NAME + " :is(.cm-editor,.xterm,.xterm-screen){",
      "  background-color:var(--dsh-ios-surface);",
      "}",

      /* ── 7. scrollbars ────────────────────────────────────────────────── */
      /* Retuned through the official --dsh-scrollbar-* tokens above, so the
         WebKit and Firefox rendering paths stay consistent and no scroll
         container's overflow or gutter is touched. */

      /* ── 8. accessibility fallbacks ───────────────────────────────────── */
      /* Both fallbacks flip the material tokens to opaque surfaces, which every
         glass rule and official surface reads. */
      "@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){",
      "  body." + CLASS_NAME + "{--dsh-ios-glass-thin:#FFFFFF;--dsh-ios-glass:#FFFFFF;--dsh-ios-glass-thick:#FFFFFF}",
      "  body." + CLASS_NAME + "[data-ds-dark-theme]{--dsh-ios-glass-thin:#1A1D26;--dsh-ios-glass:#1A1D26;--dsh-ios-glass-thick:#242A36}",
      "}",
      /* Transparency off (macOS "Reduce transparency"): drop the glass effect,
         keep the palette and geometry. */
      "@media (prefers-reduced-transparency:reduce){",
      "  body." + CLASS_NAME + "{--dsh-ios-glass-thin:#FFFFFF;--dsh-ios-glass:#FFFFFF;--dsh-ios-glass-thick:#FFFFFF}",
      "  body." + CLASS_NAME + "[data-ds-dark-theme]{--dsh-ios-glass-thin:#1A1D26;--dsh-ios-glass:#1A1D26;--dsh-ios-glass-thick:#242A36}",
      /* `!important` is deliberate: material rules use body.C [class*=…] (0,2,1)
         and would outrank a body.C * reset (0,1,1), leaving blur behind. */
      "  body." + CLASS_NAME + " *{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}",
      "}",
      /* Higher contrast: stronger separators and labels. `!important` is again
         deliberate: the theme service writes tokens as a normal inline style on
         body, and only author-level !important outranks that. */
      "@media (prefers-contrast:more){",
      "  body." + CLASS_NAME + "{",
      "    --dsw-alias-border-l1:rgba(23,26,33,.28)!important;",
      "    --dsw-alias-border-l2:rgba(23,26,33,.28)!important;",
      "    --dsw-alias-label-secondary:#171A21!important;",
      "    --dsw-alias-label-tertiary:rgba(23,26,33,.64)!important;",
      "  }",
      "  body." + CLASS_NAME + "[data-ds-dark-theme]{",
      "    --dsw-alias-border-l1:rgba(235,235,245,.28)!important;",
      "    --dsw-alias-border-l2:rgba(235,235,245,.28)!important;",
      "    --dsw-alias-label-secondary:#F2F4F8!important;",
      "    --dsw-alias-label-tertiary:rgba(235,235,245,.66)!important;",
      "  }",
      "}"
    ].join("\n");

    /* ── token layer handover ────────────────────────────────────────────────
       The theme plugin's contract says its token stylesheets are the single
       authority for colour, and it offers third parties
       `overrideTokens(source, tokens)` — validated, layered, disposed with the
       plugin, and applied per palette. When that service is reachable we hand it
       the tokens and inject only the material rules; when it is not, we inject
       the sheet whole, exactly as before. Either way the declarations above stay
       the single source of truth; nothing is duplicated. */
    var LIGHT_ANCHOR = "body." + CLASS_NAME + "{\n  color-scheme:light;";
    var DARK_ANCHOR = "body." + CLASS_NAME + "[data-ds-dark-theme]{\n  color-scheme:dark;";
    var TOKEN_DECL = /^\s*(--dsw-[A-Za-z0-9-]+)\s*:\s*(.+?);\s*$/;

    /** Character span of a rule's body, found by balancing braces from its anchor. */
    function ruleBody(source, anchor) {
      var start = source.indexOf(anchor);
      if (start < 0) return null;
      var open = source.indexOf("{", start);
      if (open < 0) return null;
      var depth = 0;
      for (var i = open; i < source.length; i++) {
        if (source[i] === "{") depth += 1;
        else if (source[i] === "}") { depth -= 1; if (depth === 0) return { from: open + 1, to: i }; }
      }
      return null;
    }

    /** Official token declarations inside one palette block. */
    function tokensIn(source, anchor) {
      var span = ruleBody(source, anchor);
      var found = {};
      if (!span) return found;
      var lines = source.slice(span.from, span.to).split("\n");
      for (var i = 0; i < lines.length; i++) {
        var m = TOKEN_DECL.exec(lines[i]);
        if (m) found[m[1]] = m[2];
      }
      return found;
    }

    /** Drop those declarations, leaving the private --dsh-ios-* scale and
        color-scheme behind (they are ours, and they are theme-scoped). */
    function withoutTokens(source, anchor) {
      var span = ruleBody(source, anchor);
      if (!span) return source;
      var kept = source.slice(span.from, span.to).split("\n")
        .filter(function (line) { return !TOKEN_DECL.test(line); }).join("\n");
      return source.slice(0, span.from) + kept + source.slice(span.to);
    }

    /** One { light, dark } pair per token, repeating a value when only one
        palette declares it — which is what the theme API's validator demands. */
    function pairedTokens(light, dark) {
      var out = {};
      var name;
      for (name in light) if (has(light, name)) {
        out[name] = { light: light[name], dark: has(dark, name) ? dark[name] : light[name] };
      }
      for (name in dark) if (has(dark, name) && !has(out, name)) {
        out[name] = { light: has(light, name) ? light[name] : dark[name], dark: dark[name] };
      }
      return out;
    }

    function has(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

    /** The theme service, probed defensively: cordis 4.x throws "cannot get
        property … without inject" from a bare property read as well as from
        ctx.get for an undeclared service name, and a theme must never fail to
        load over it. Both probes are therefore guarded. */
    function themeService(ctx) {
      if (!ctx) return null;
      try { if (ctx.theme) return ctx.theme; } catch (e) { /* undeclared: fall through */ }
      if (typeof ctx.get === "function") {
        try { return ctx.get("theme") || null; } catch (e) { return null; }
      }
      return null;
    }

    /* The material layer keys off build-hashed component class names, which are
       an implementation detail of the official front end. If an upgrade renames
       them the glass stops appearing and nothing anywhere reports it. One
       read-only probe at load turns that silent failure into a loud one. */
    /* The probe mirrors the material layer's two naming worlds: the DSH class
       locals and the workbench hooks the new UI exposes. Either one matching
       means the layer is live; only a total miss is worth a warning. */
    var PROBE = "[class*='_header'],[class*='_panelList'],[class*='_dialog'],[class*='_card'],"
      + "[data-dsh-bottom-panel],[data-dockkit-strip],[data-dockkit-float]";
    function warnIfInert() {
      if (typeof document.querySelector !== "function") return;
      try {
        if (document.querySelector(PROBE)) return;
        if (typeof console !== "undefined" && console.warn) {
          console.warn("[dsh-ios-skin] material layer is inert: none of " + PROBE
            + " matched. The official component class names likely changed in an upgrade.");
        }
      } catch (e) { /* a diagnostic must never be the thing that breaks the theme */ }
    }

    function installStyle(source) {
      var existing = document.getElementById(STYLE_ID);
      if (existing) { existing.textContent = source; return; }
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = source;
      document.head.appendChild(style);
    }

    function apply(ctx) {
      var light = tokensIn(css, LIGHT_ANCHOR);
      var dark = tokensIn(css, DARK_ANCHOR);
      var theme = themeService(ctx);
      var releaseTokens = null;
      var handedOver = false;

      if (theme && typeof theme.overrideTokens === "function") {
        try {
          releaseTokens = theme.overrideTokens("dsh-ios-skin", pairedTokens(light, dark));
          handedOver = true;
        } catch (e) {
          // A rejected layer must not cost the user the whole theme.
          handedOver = false;
          releaseTokens = null;
        }
      }

      installStyle(handedOver ? withoutTokens(withoutTokens(css, LIGHT_ANCHOR), DARK_ANCHOR) : css);
      if (document.body) document.body.classList.add(CLASS_NAME);
      warnIfInert();

      ctx.effect(function () { return function () {
        if (typeof releaseTokens === "function") releaseTokens();
        var style = document.getElementById(STYLE_ID);
        if (style) style.remove();
        if (document.body) document.body.classList.remove(CLASS_NAME);
      }; });
    }

    module.exports = { name: "ios-skin", inject: ["theme"], apply: apply };
    return module.exports;
  }
});
