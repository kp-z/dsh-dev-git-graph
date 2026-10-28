#!/usr/bin/env node
/**
 * dsh-ios-skin — runtime audit against a real DSH Web GUI.
 *
 * Loads the isolated dev profile's Web GUI in headless Chrome, switches the real
 * Appearance setting (the official palette path), and asserts the theme's token
 * and material layers against live computed style, geometry, media emulation and
 * a plugin-off baseline. Writes a JSON summary and full-page screenshots; exits
 * non-zero when any check fails.
 *
 * This model has no vision, so every verdict below comes from programmatic
 * evidence: getComputedStyle, getBoundingClientRect, CSSOM rule matching, CDP
 * media emulation, pixel-free alpha inspection and console events. Screenshots
 * are deliverables for humans, not inputs to the verdict.
 *
 * Usage (the matching dev server must already be running):
 *   # clean isolated profile (iosdev, port 3099) — original scenario
 *   node scripts/verify-ios-skin-runtime.mjs
 *
 *   # new UI profile (awteamfull: better-sidebar 0.28 + Agent Teams, port 3098)
 *   node scripts/verify-ios-skin-runtime.mjs --scenario newui
 *
 *   node scripts/verify-ios-skin-runtime.mjs --scenario newui --url "http://127.0.0.1:3098/?token=..."
 *
 * Options:
 *   --scenario <clean|newui>  Which GUI/profile to audit (default clean).
 *   --profile <name>          Alias hint: awteamfull ⇒ scenario newui.
 *   --url <url>          GUI URL with token. Defaults to $DSH_VERIFY_URL, then the
 *                        last `dsh web: http://...` line in the scenario's server log.
 *   --out-dir <dir>      Screenshot directory (default docs/assets/ios-skin).
 *   --json <file>        JSON summary path (default .tmp-ios-teams/runtime-audit.json).
 *   --dom-classes <file> Hashed-class inventory for the theme author
 *                        (clean: dom-classes.md; newui: dom-classes-newui.md; empty string disables).
 *   --profile-client <f> Installed client.js that the browser actually loads.
 *                        Scenario default: iosdev / awteamfull profile copies.
 *                        Expected token values are read from this artifact; a
 *                        warning is emitted when src/client.js is ahead of it.
 *   --headed             Show the browser (debugging).
 *
 * Exit codes: 0 all checks pass, 1 audit failures, 2 setup/automation error.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

/* ── CLI ────────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const [key, inline] = a.slice(2).split('=')
    if (key === 'headed') { out.headed = true; continue }
    out[key] = inline ?? argv[++i]
  }
  return out
}

const argv = parseArgs(process.argv.slice(2))

/**
 * Two audit scenarios over the same app version:
 *  - clean:  isolated iosdev profile, signed-out empty GUI (port 3099)
 *  - newui:  awteamfull profile with better-sidebar 0.28 + Agent Teams (port 3098)
 * The script is expected to stay green in BOTH; each has its own server log,
 * installed client artifact and screenshot prefix.
 */
const SCENARIO = argv.scenario || (String(argv.profile || '').includes('awteamfull') ? 'newui' : 'clean')
const SCENARIOS = {
  clean: {
    label: 'clean iosdev GUI',
    serverLog: 'server-3099.log',
    profileClient: '.tmp-ios-teams/home/profiles/iosdev/node_modules/dsh-ios-skin/lib/client.js',
    domClasses: '.tmp-ios-teams/dom-classes.md',
    shotPrefix: 'runtime',
    json: '.tmp-ios-teams/runtime-audit.json',
  },
  newui: {
    label: 'new UI (better-sidebar 0.28 + Agent Teams)',
    serverLog: 'server-3098.log',
    profileClient: '.tmp-ios-teams/home/profiles/awteamfull/node_modules/dsh-ios-skin/lib/client.js',
    domClasses: '.tmp-ios-teams/dom-classes-newui.md',
    shotPrefix: 'newui',
    json: '.tmp-ios-teams/runtime-audit-newui.json',
  },
}
if (!SCENARIOS[SCENARIO]) {
  console.error(`Unknown --scenario "${SCENARIO}". Use clean or newui.`)
  process.exit(2)
}
const SC = SCENARIOS[SCENARIO]
const URL_ARG = argv.url || process.env.DSH_VERIFY_URL || discoverUrl(SC.serverLog)
const OUT_DIR = path.resolve(ROOT, argv['out-dir'] || 'docs/assets/ios-skin')
const JSON_OUT = path.resolve(ROOT, argv.json || SC.json)
const DOM_CLASSES_OUT = argv['dom-classes'] === '' ? null
  : path.resolve(ROOT, argv['dom-classes'] || SC.domClasses)
const PLUGIN_SRC = path.join(ROOT, 'packages/dsh-ios-skin/src/client.js')
const PLUGIN_LIB = path.join(ROOT, 'packages/dsh-ios-skin/lib/client.js')
const PLUGIN_PKG = path.join(ROOT, 'packages/dsh-ios-skin/package.json')
// The artifact the browser actually loads. Expected token values must come from
// this file, not from source: the source may be ahead of the built profile while
// the theme author is working, and auditing source would then report phantom
// handover failures. Override with --profile-client / DSH_PROFILE_CLIENT.
const PROFILE_CLIENT = path.resolve(ROOT, argv['profile-client'] || process.env.DSH_PROFILE_CLIENT
  || SC.profileClient)
const PROFILE_PKG = path.join(path.dirname(path.dirname(PROFILE_CLIENT)), 'package.json')

const shot = (base) => `${SC.shotPrefix}-${base}.png`

function runtimeClientPath() {
  for (const candidate of [PROFILE_CLIENT, PLUGIN_LIB, PLUGIN_SRC]) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error('no dsh-ios-skin client artifact found (profile, lib, src)')
}

const md5 = (file) => (fs.existsSync(file) ? crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex') : null)

function profileSyncInfo() {
  const runtime = runtimeClientPath()
  const hashes = { runtime: md5(runtime), lib: md5(PLUGIN_LIB), src: md5(PLUGIN_SRC) }
  return {
    runtimeClient: path.relative(ROOT, runtime),
    runtimeVersion: pluginVersion(),
    hashes,
    runtimeMatchesLib: !!(hashes.runtime && hashes.runtime === hashes.lib),
    runtimeMatchesSrc: !!(hashes.runtime && hashes.runtime === hashes.src),
    sourceAhead: !!(hashes.src && hashes.runtime && hashes.src !== hashes.runtime),
  }
}

function discoverUrl(logName = SC.serverLog) {
  const log = path.join(ROOT, '.tmp-ios-teams', logName)
  if (!fs.existsSync(log)) return null
  const matches = [...fs.readFileSync(log, 'utf8').matchAll(/dsh web: (http:\/\/\S+)/g)]
  return matches.length ? matches[matches.length - 1][1] : null
}

if (!URL_ARG) {
  console.error(`No GUI URL for scenario "${SCENARIO}". Pass --url, set DSH_VERIFY_URL, or start the ${SCENARIO} server so .tmp-ios-teams/${SC.serverLog} has its URL.`)
  process.exit(2)
}

/* ── Plugin source parsing (single source of truth for expected tokens) ──── */

/**
 * Render the plugin's real stylesheet by executing its factory against a tiny
 * DOM stub (no theme service → the sheet carries the tokens as well). This is
 * the same trick the contract tests use, and it keeps the expected token values
 * sourced from the implementation instead of being duplicated in the audit.
 */
function readPluginCss(clientPath = runtimeClientPath()) {
  const src = fs.readFileSync(clientPath, 'utf8')
  const appended = []
  const document = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '', remove() {} }),
    head: { appendChild: (el) => { appended.push(el) } },
    querySelector: () => ({}),
    body: { classList: { add() {}, remove() {} } },
  }
  let loaded
  const window = { __ModuleLoader__: { load: (def) => { loaded = def.factory() } } }
  new Function('window', 'document', 'console', src)(window, document, { warn() {} })
  loaded.apply({ effect() {}, get() { throw new Error('no theme service in stub') } })
  const css = appended[0]?.textContent ?? ''
  if (css.length < 4000) throw new Error('failed to render the plugin stylesheet through its factory')
  return css
}

const LIGHT_ANCHOR = 'body.dsh-ios-skin{\n  color-scheme:light;'
const DARK_ANCHOR = 'body.dsh-ios-skin[data-ds-dark-theme]{\n  color-scheme:dark;'
const TOKEN_DECL = /^\s*(--dsw-[A-Za-z0-9-]+)\s*:\s*(.+?);\s*$/

function ruleBody(source, anchor) {
  const start = source.indexOf(anchor)
  if (start < 0) return null
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) return { from: open + 1, to: i } }
  }
  return null
}

function tokensIn(source, anchor) {
  const span = ruleBody(source, anchor)
  const found = {}
  if (!span) return found
  for (const line of source.slice(span.from, span.to).split('\n')) {
    const m = TOKEN_DECL.exec(line)
    if (m) found[m[1]] = m[2].trim()
  }
  return found
}

const CSS_SOURCE = readPluginCss()
const EXPECTED = { light: tokensIn(CSS_SOURCE, LIGHT_ANCHOR), dark: tokensIn(CSS_SOURCE, DARK_ANCHOR) }
if (Object.keys(EXPECTED.light).length < 80) {
  throw new Error(`expected ${Object.keys(EXPECTED.light).length} light tokens, source parse looks wrong`)
}
// The plugin hands every token over as a { light, dark } pair, repeating the
// declared value for the palette that does not declare it (pairedTokens()).
// The audit must model the same pairing, or light-only tokens such as
// --dsw-mask-blur look missing from the dark handover.
const PAIRED = {
  light: { ...EXPECTED.dark, ...EXPECTED.light },
  dark: { ...EXPECTED.light, ...EXPECTED.dark },
}

function pluginVersion() {
  for (const file of [PROFILE_PKG, PLUGIN_PKG]) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')).version } catch { /* try next */ }
  }
  return 'unknown'
}

/* ── Result model ───────────────────────────────────────────────────────── */

const checks = []
const consoleEvents = []
let phase = 'setup'

/**
 * Record one check. `severity` feeds the defect table when the check fails.
 * status: pass | fail | warn | info
 */
function record(id, scenario, title, status, detail = {}, severity = 'high') {
  checks.push({ id, scenario, title, status, severity, detail })
  const icon = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', info: 'INFO' }[status]
  console.log(`[${icon}] ${scenario}/${id} — ${title}${status === 'fail' ? `\n        ${JSON.stringify(detail).slice(0, 400)}` : ''}`)
}

function verify(id, scenario, title, cond, detail, severity = 'high') {
  record(id, scenario, title, cond ? 'pass' : 'fail', detail, severity)
  return cond
}

const normVal = (v) => String(v ?? '')
  .toLowerCase().replace(/\s+/g, '')
  .replace(/(\d*\.\d*?)0+(?=[,)])/g, (m, g) => (g.endsWith('.') ? g.slice(0, -1) : g))
  .replace(/(^|[(,])0\./g, '$1.')

const alphaOf = (color) => {
  const m = String(color).match(/rgba?\(([^)]+)\)/)
  if (!m) return String(color).trim() === 'transparent' ? 0 : 1
  const parts = m[1].split(',').map((s) => s.trim())
  return parts.length === 4 ? parseFloat(parts[3]) : 1
}

const blurOf = (bf) => {
  const m = String(bf).match(/blur\(([\d.]+)px\)/)
  return m ? parseFloat(m[1]) : 0
}

/* ── Browser page library (injected once; all evidence is read-only) ────── */

function auditLib() {
  const MATERIAL_GROUPS = ['bars', 'flat', 'rails', 'overlays', 'inflow', 'bubble']
  const TOKENS = [
    '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
    '--dsw-alias-bg-overlay', '--dsw-alias-label-primary', '--dsw-alias-label-secondary',
    '--dsw-alias-label-tertiary', '--dsw-alias-label-caption', '--dsw-alias-border-l1',
    '--dsw-alias-border-l4', '--dsw-alias-brand-primary', '--dsw-alias-link',
    '--dsw-alias-button-primary-fill', '--dsw-alias-button-tool-bar-fill',
    '--dsw-specific-sidebar-fill', '--dsw-specific-menu', '--dsw-specific-input-major',
    '--dsw-elevation-stroke-color', '--dsw-elevation-panel', '--dsw-shadow-lv1',
    '--dsw-mask-blur', '--dsw-font-family', '--ds-font-family-code',
    '--dsw-alias-scrollbar-bg-l1', '--dsh-scrollbar-thumb',
    '--dsh-ios-radius', '--dsh-ios-glass-thin', '--dsh-ios-glass', '--dsh-ios-glass-thick',
    '--dsh-ios-rim', '--dsh-ios-rim-inner', '--dsh-ios-surface', '--dsh-ios-blur',
    '--dsh-ios-brand', '--dsh-ios-brand-strong', '--dsh-ios-brand-soft', '--dsh-ios-brand-border', '--dsh-ios-brand-band-end',
    '--dsh-ios-blue', '--dsh-ios-font',
  ]
  const SURFACES = {
    sidebarHost: "[class*='_panelList']",
    sidebarRow: "[class*='_panelRow']",
    panelTitle: "[class*='_panelTitle']",
    panelGlyph: "[class*='_panelGlyph']",
    menuAnchor: "[class*='_menuAnchor']",
    newSession: "[class*='_newSession']",
    composerSeat: "[class*='_composerSeat']",
    composerStack: "[class*='_composerStack']",
    header: "[class*='_header']",
    banner: "header,[role='banner']",
    iconButton: "[class*='_iconButton']",
    searchInput: "[class*='_searchInput']",
    centerCol: "[class*='_centerCol']",
    listArea: "[class*='_listArea']",
    footerActions: "[class*='_footerActions']",
    settingsArea: "[class*='_settingsArea']",
    dialog: "[role='dialog']",
    menu: "[role='menu']",
  }
  const READABLE = 'input,textarea,pre,code,[contenteditable="true"]'
  // Stable (data-*) and real component-class hooks of the new UI. The theme is
  // allowed to depend on the data hooks; the class prefixes are audit evidence
  // for the actual surfaces better-sidebar / dockkit / Agent Teams render.
  const NEWUI_HOOKS = {
    dshBetterSidebar: '[data-dsh-better-sidebar]',
    dshPanelHost: '[data-dsh-panel-host]',
    dshBottomPanel: '[data-dsh-bottom-panel]',
    dshPane: '[data-dsh-pane]',
    dockkitSurface: '[data-dockkit-surface]',
    dockkitPane: '[data-dockkit-pane]',
    dockkitStrip: '[data-dockkit-strip]',
    dockkitStripChrome: '[data-dockkit-strip-chrome]',
    dockkitFloat: '[data-dockkit-float]',
    teamPanel: '[data-team-panel]',
    teamAction: '[data-team-action]',
    sidebarRightPanel: '[data-sidebar-right-panel]',
    tablist: "[role='tablist']",
    bsIconSlot: "[class*='jJkEga_slot']",
    bsPaneCard: "[class*='nArs4W_paneCard']",
    bsPane: "[class*='nArs4W_pane']",
    bsPanelBody: "[class*='nArs4W_panelBody']",
    bsWorkbench: "[class*='nArs4W_workbench']",
    rightRailBody: "[class*='irMxjq_panelBody']",
    dockkitSurfaceClass: "[class*='_surface_6nhg2']",
    dockkitPaneClass: "[class*='_pane_6nhg2']",
    dockkitPaneBodyClass: "[class*='_paneBody_6nhg2']",
    dockkitStripTabs: "[class*='_stripTabs']",
    dockkitStripFill: "[class*='_stripFill']",
    dockkitStripChromeClass: "[class*='_stripChrome']",
    dockHintCard: "[class*='_dockHintCard']",
    teamPanelClass: "[class*='VoX2oq_panel']",
    teamMember: "[class~='VoX2oq_member']",
    teamTrigger: "[class*='VoX2oq_trigger']",
  }
  const LEAF = new Set(['span', 'svg', 'kbd', 'small', 'p', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'b', 'i', 'strong', 'em', 'code'])

  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const cs = (el, p) => getComputedStyle(el).getPropertyValue(p).trim()
  const rect = (el) => {
    const r = el.getBoundingClientRect()
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }
  }
  const clsOf = (el) => el.getAttribute('class') || (typeof el.className === 'string' ? el.className : '')
  const brief = (el) => ({
    tag: el.tagName.toLowerCase(), cls: clsOf(el).slice(0, 160),
    role: el.getAttribute('role'), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48),
    visible: vis(el), rect: rect(el),
  })
  const props = (el) => ({
    bg: cs(el, 'background-color'),
    backdrop: cs(el, 'backdrop-filter'),
    radius: cs(el, 'border-radius'),
    cornerShape: cs(el, 'corner-shape'),
    shadow: cs(el, 'box-shadow'),
    borderColor: cs(el, 'border-top-color'),
    borderWidth: cs(el, 'border-top-width'),
    color: cs(el, 'color'),
    fontFamily: cs(el, 'font-family'),
    transitionDuration: cs(el, 'transition-duration'),
    opacity: cs(el, 'opacity'),
    display: cs(el, 'display'),
    position: cs(el, 'position'),
  })

  function pluginStyleEl() { return document.getElementById('dsh-ios-skin-style') }

  function pluginRules() {
    const el = pluginStyleEl()
    if (!el || !el.sheet) return []
    const out = []
    const walk = (list, media) => {
      for (const r of list) {
        if (r.type === 4) { walk(r.cssRules, r.conditionText); continue }
        if (r.type !== 1) continue
        const decls = {}
        for (const m of r.cssText.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/g)) decls[m[1]] = m[2].trim()
        const active = media ? (typeof matchMedia === 'function' ? matchMedia(media).matches : true) : true
        out.push({ selector: r.selectorText, decls, media, active, group: groupOf(r.selectorText), order: out.length })
      }
    }
    walk(el.sheet.cssRules, null)
    return out
  }

  function groupOf(selector) {
    // Classify by the positive part of the selector: substrings inside
    // :not([class*='…']) are exclusions, not what the rule paints (e.g. the
    // _card rule's :not(_dockHintCard) must not classify it as an overlay).
    const s = (selector || '').replace(/:not\(([^()]*)\)/g, '')
    if (/_userRow|_userStack/.test(s)) return 'bubble'
    if (/prefers-reduced|@supports/.test(s)) return 'a11y'
    if (/_(toolbar|titlebar|tabStrip|strip)/.test(s)) return 'bars'
    if (/_header/.test(s)) return 'flat'
    if (/_(panelList|panelBody|floatHost|composerSeat|composerStack)|dshDesktopSidebarSurface|dshDesktopRightbarSurface|:is\(nav|:is\(aside/.test(s)) return 'rails'
    if (/_(dialog|menu|toast|float|hovercard|viewport|dockHintCard)|:is\(\[role=/.test(s)) return 'overlays'
    if (/_(card|pane|surface|slot)/.test(s)) return 'inflow'
    if (/:is\(pre,code|:is\(input|background-color:var\(--dsh-ios-glass-thick\)/.test(s)) return 'readable'
    if (/:is\(button|:is\(input,textarea,select/.test(s)) return 'controls'
    return 'other'
  }

  const matches = (el, selector) => { try { return el.matches(selector) } catch { return false } }
  const matchedRules = (el, rules) => rules.filter((r) => r.active !== false && matches(el, r.selector))
  const materialGroups = (el, rules) => [...new Set(
    matchedRules(el, rules).map((r) => r.group).filter((g) => MATERIAL_GROUPS.includes(g)))]
  const winner = (el, rules, prop) => {
    let hit = null
    for (const r of matchedRules(el, rules)) if (r.decls[prop]) hit = { selector: r.selector, group: r.group, value: r.decls[prop] }
    return hit
  }

  function inlineCustomProps() {
    const style = document.body.style
    const out = {}
    for (const name of style) if (name.startsWith('--')) out[name] = style.getPropertyValue(name).trim()
    return out
  }

  function officialCircleRules() {
    const out = []
    for (const sheet of document.styleSheets) {
      let list
      try { list = sheet.cssRules } catch { continue }
      const walk = (rules, media) => {
        for (const r of rules) {
          if (r.type === 4) { walk(r.cssRules, r.conditionText); continue }
          if (r.type !== 1 || !r.selectorText) continue
          const txt = r.cssText
          const round = /border-radius:\s*(50%|(?:[6-9]\d{2}|100)px)/.test(txt) || /corner-shape:\s*round/.test(txt)
          if (!round) continue
          if (/::/.test(r.selectorText)) continue // pseudo-elements have no element to match
          out.push({
            selector: r.selectorText.slice(0, 240), media,
            radius: (txt.match(/border-radius:[^;}]+/) || [''])[0].trim(),
            corner: (txt.match(/corner-shape:[^;}]+/) || [''])[0].trim(),
          })
        }
      }
      walk(list, null)
    }
    return out
  }

  function state(label) {
    const body = document.body
    const rules = pluginRules()
    const tokens = {}
    for (const t of TOKENS) tokens[t] = cs(body, t)
    const styleEl = pluginStyleEl()
    const styleText = styleEl ? styleEl.textContent || '' : ''
    const bodyStyle = body.getAttribute('style') || ''
    const surfaces = {}
    for (const [key, selector] of Object.entries(SURFACES)) {
      try {
        const els = [...document.querySelectorAll(selector)].filter(vis)
        surfaces[key] = {
          count: els.length,
          elements: els.slice(0, 6).map((el) => ({ ...brief(el), ...props(el), groups: materialGroups(el, rules) })),
        }
      } catch (e) { surfaces[key] = { count: 0, elements: [], error: String(e) } }
    }
    const groupCounts = {}
    const groupElements = {}
    for (const g of MATERIAL_GROUPS) {
      const els = [...document.querySelectorAll('*')].filter(vis).filter((el) => materialGroups(el, rules).includes(g))
      groupCounts[g] = els.length
      groupElements[g] = els.slice(0, 10).map((el) => ({ ...brief(el), ...props(el), groups: materialGroups(el, rules) }))
    }
    const headers = [...document.querySelectorAll("[class*='_header'],header,[role='banner']")].map((el) => ({
      ...brief(el), ...props(el), groups: materialGroups(el, rules),
      flatRule: matchedRules(el, rules).filter((r) => r.group === 'flat').map((r) => r.selector),
    }))
    // Shadow segments that are not `inset` are real elevation; an inset-only
    // ring (e.g. the selected tab's 1px brand rim) does not lift the plane.
    const hasOuterShadow = (shadow) => {
      if (!shadow || shadow === 'none') return false
      return shadow.split(/,(?![^()]*\))/).some((part) => !/inset/.test(part))
    }
    // Anything nested inside a flat header/banner must stay flat too: a toolbar
    // or tab strip inside the header must not turn back into a glass card.
    const headerNested = []
    for (const zone of document.querySelectorAll('header,[role=banner]')) {
      for (const el of zone.querySelectorAll('*')) {
        if (!vis(el)) continue
        const p = props(el)
        if (p.backdrop !== 'none' || hasOuterShadow(p.shadow)) headerNested.push({ ...brief(el), ...p, groups: materialGroups(el, rules) })
      }
    }
    const readables = [...document.querySelectorAll(READABLE)].filter(vis).slice(0, 20).map((el) => ({
      ...brief(el), ...props(el),
    }))
    const activeTabs = [...document.querySelectorAll("[class*='_tabActive'],[role='tab'][aria-selected='true'],[aria-current='page']")]
      .filter(vis).slice(0, 12).map((el) => ({ ...brief(el), ...props(el) }))
    // Elevation recipes are re-declared on `body, body *` so they reach real
    // descendants; a body-only inline value does not inherit its shadow recipe.
    const elevationProbe = [...document.querySelectorAll("body,[class*='_panelRow'],[class*='_panelTitle'],[class*='_composerSeat'],[class*='_menuAnchor']")]
      .slice(0, 6).map((el) => ({
        ...brief(el),
        elevationStroke: cs(el, '--dsw-elevation-stroke'),
        elevationPanel: cs(el, '--dsw-elevation-panel'),
        elevationProminent: cs(el, '--dsw-elevation-prominent'),
        elevationSoft: cs(el, '--dsw-elevation-soft'),
        shadowSoft: cs(el, '--dsh-ios-shadow-soft'),
      }))
    const blurred = [...document.querySelectorAll('*')].filter(vis)
      .filter((el) => cs(el, 'backdrop-filter') !== 'none')
      .slice(0, 40)
      .map((el) => ({ ...brief(el), ...props(el), groups: materialGroups(el, rules) }))
    // New UI surfaces/hooks: count all matches (some wrappers are 0×0) and keep
    // computed style for the visible ones.
    const newUi = {}
    for (const [key, selector] of Object.entries(NEWUI_HOOKS)) {
      let all = []
      try { all = [...document.querySelectorAll(selector)] } catch (e) { /* selector unsupported */ }
      const visible = all.filter(vis)
      newUi[key] = {
        countAll: all.length,
        countVisible: visible.length,
        elements: (visible.length ? visible : all).slice(0, 25).map((el) => ({ ...brief(el), ...props(el) })),
      }
    }
    const leaks = [...document.querySelectorAll('*')].filter(vis)
      .filter((el) => LEAF.has(el.tagName.toLowerCase()))
      .filter((el) => {
        const gs = materialGroups(el, rules)
        if (!gs.some((g) => ['bars', 'rails', 'overlays', 'inflow', 'bubble'].includes(g))) return false
        return cs(el, 'backdrop-filter') !== 'none' || cs(el, 'box-shadow') !== 'none'
      })
      .slice(0, 30)
      .map((el) => ({
        ...brief(el), ...props(el), groups: materialGroups(el, rules),
        winners: { bg: winner(el, rules, 'background-color'), backdrop: winner(el, rules, 'backdrop-filter'), shadow: winner(el, rules, 'box-shadow') },
      }))
    // selector overlap: any element (visible or not) matched by more than one material group
    const overlaps = []
    for (const el of document.querySelectorAll('*')) {
      const groups = materialGroups(el, rules)
      if (groups.length < 2) continue
      overlaps.push({
        ...brief(el), groups,
        winners: { bg: winner(el, rules, 'background-color'), backdrop: winner(el, rules, 'backdrop-filter'), shadow: winner(el, rules, 'box-shadow'), radius: winner(el, rules, 'border-radius') },
        computed: vis(el) ? props(el) : null,
      })
    }
    // official circular controls that the plugin must leave round
    const circleRuleList = officialCircleRules()
    const circleElements = []
    const seen = new Set()
    for (const rule of circleRuleList) {
      for (const sel of rule.selector.split(',').map((s) => s.trim()).filter(Boolean)) {
        let els = []
        try { els = [...document.querySelectorAll(sel)] } catch (e) { continue }
        for (const el of els) {
          if (seen.has(el)) continue
          seen.add(el)
          const p = props(el)
          circleElements.push({
            ...brief(el), radius: p.radius, cornerShape: p.cornerShape,
            rule: rule.selector, ruleRadius: rule.radius, square: Math.abs(rect(el).w - rect(el).h) < 1.5,
          })
        }
      }
    }

    // v0.3.0 design audit: visible-text contrast (alpha-composited approximation
    // of glass surfaces) and the brand light-band signature. Text sampling is
    // restricted to elements actually in the viewport and hit-testable, so stale
    // computed values from clipped/offscreen subtrees are not counted.
    const parseC = (v) => {
      if (!v) return null
      const t = v.trim()
      if (t === 'transparent' || t === 'rgba(0,0,0,0)') return [0, 0, 0, 0]
      let m = t.match(/^rgba?\(([^)]+)\)/)
      if (m) { const a = m[1].split(',').map(Number); return [a[0], a[1], a[2], a[3] === undefined ? 1 : a[3]] }
      m = t.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i)
      if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), m[2] ? parseInt(m[2], 16) / 255 : 1]
      m = t.match(/^#([0-9a-f]{3})$/i)
      if (m) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16), 1]
      return null
    }
    const overC = (top, bottom) => { if (!top) return bottom; const a = top[3]; return a >= 1 ? [top[0], top[1], top[2], 1] : [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1] }
    const effBgC = (el) => {
      const stack = []
      let e = el
      while (e && e !== document.documentElement) { const c = parseC(cs(e, 'background-color')); if (c && c[3] > 0) stack.push(c); e = e.parentElement }
      let base = parseC(cs(document.documentElement, 'background-color')) || [255, 255, 255, 1]
      const bc = parseC(cs(document.body, 'background-color'))
      if (bc && bc[3] >= 1) base = bc
      let cur = base
      for (let i = stack.length - 1; i >= 0; i--) cur = overC(stack[i], cur)
      return cur
    }
    const lumC = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
    const contrastC = (a, b) => { const l1 = lumC(a), l2 = lumC(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
    const inViewC = (el) => {
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) return false
      if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false
      const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2))
      const cy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2))
      const hit = document.elementFromPoint(cx, cy)
      return !!hit && (hit === el || el.contains(hit) || hit.contains(el))
    }
    const textLeaves = [...document.querySelectorAll('*')].filter(inViewC).filter((el) => {
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      if (!hasText) return false
      return cs(el, 'visibility') !== 'hidden' && parseFloat(cs(el, 'opacity')) >= 0.25
    })
    const contrastSamples = []
    for (const el of textLeaves) {
      const fgRaw = parseC(cs(el, 'color'))
      if (!fgRaw) continue
      const bg = effBgC(el)
      const fg = overC(fgRaw, bg)
      const ratio = contrastC(fg, bg)
      const size = parseFloat(cs(el, 'font-size'))
      const weight = parseInt(cs(el, 'font-weight')) || 400
      const large = size >= 24 || (size >= 18.66 && weight >= 700)
      const cat = fgRaw[3] < 0.75 ? 'secondary' : 'body'
      contrastSamples.push({ tag: el.tagName.toLowerCase(), cls: (el.getAttribute('class') || '').slice(0, 80), ratio: +ratio.toFixed(2), size, weight, large, cat })
    }
    const ratioStats = (arr) => {
      if (!arr.length) return { count: 0 }
      const rs = arr.map((x) => x.ratio).sort((a, b) => a - b)
      const q = (p) => rs[Math.min(rs.length - 1, Math.floor(p * rs.length))]
      return { count: rs.length, min: +rs[0].toFixed(2), median: +q(0.5).toFixed(2) }
    }
    const bodySamples = contrastSamples.filter((x) => !x.large && x.cat === 'body')
    const secondarySamples = contrastSamples.filter((x) => x.cat === 'secondary' && !x.large)
    const readability = {
      samples: contrastSamples.length,
      body: ratioStats(bodySamples),
      secondary: ratioStats(secondarySamples),
      bodyBelow45: bodySamples.filter((x) => x.ratio < 4.5).length,
      secondaryBelow3: secondarySamples.filter((x) => x.ratio < 3).length,
      worst: [...bodySamples.filter((x) => x.ratio < 4.5), ...secondarySamples.filter((x) => x.ratio < 3)].sort((a, b) => a.ratio - b.ratio).slice(0, 8),
    }
    // v0.3.0 signature: the 1px brand gradient band must only paint the active
    // dockkit pane (and an active floating pane when one exists).
    const bandEls = (sel) => [...document.querySelectorAll(sel)].map((el) => ({
      ...brief(el), rect: rect(el), bgImage: cs(el, 'background-image'), bgSize: cs(el, 'background-size'),
    }))
    const brandBand = {
      active: bandEls('[data-dockkit-pane-active]'),
      inactive: bandEls('[data-dockkit-pane]:not([data-dockkit-pane-active])'),
      floatActive: bandEls('[data-dockkit-float][data-dockkit-float-active]'),
      floatInactive: bandEls('[data-dockkit-float]:not([data-dockkit-float-active])'),
    }

    return {
      label,
      body: {
        className: body.className,
        dark: body.hasAttribute('data-ds-dark-theme'),
        attributes: [...body.attributes].map((a) => [a.name, a.value.slice(0, 120)]),
        colorScheme: cs(body, 'color-scheme'),
        backgroundColor: cs(body, 'background-color'),
        styleTokenCount: [...body.style].filter((n) => n.startsWith('--dsw-')).length,
        styleTokens: inlineCustomProps(),
      },
      plugin: {
        stylePresent: !!styleEl,
        styleLength: styleText.length,
        styleHasBaseToken: /--dsw-alias-bg-base\s*:/.test(styleText),
        probeMatched: !!document.querySelector("[class*='_header'],[class*='_panelList'],[class*='_dialog'],[class*='_card']"),
      },
      tokens,
      surfaces,
      newUi,
      groupCounts,
      groupElements,
      headers,
      headerNested,
      readables,
      activeTabs,
      readability,
      brandBand,
      elevationProbe,
      blurred,
      leaks,
      overlaps: overlaps.slice(0, 60),
      overlapCount: overlaps.length,
      circleElements: circleElements.slice(0, 40),
      circleRuleCount: circleRuleList.length,
      officialSheets: [...document.styleSheets].map((s) => s.href).filter(Boolean),
      dom: { elements: document.querySelectorAll('*').length, scrollHeight: document.documentElement.scrollHeight },
    }
  }

  function baseline(selectors) {
    const body = document.body
    const collect = () => {
      const out = []
      for (const sel of selectors) {
        let els = []
        try { els = [...document.querySelectorAll(sel)] } catch (e) { continue }
        let idx = 0
        for (const el of els) {
          if (!vis(el)) continue
          out.push({ key: sel, idx: idx++, ...brief(el), ...props(el) })
        }
      }
      return out
    }
    const tokenSnapshot = () => {
      const out = {}
      for (const t of ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-label-primary', '--dsw-alias-brand-primary', '--dsw-font-family', '--dsh-ios-glass-thin']) out[t] = cs(body, t)
      return out
    }
    const styleEl = pluginStyleEl()
    const savedStyle = styleEl ? styleEl.textContent || '' : ''
    const savedBodyStyle = body.getAttribute('style')
    const before = collect()
    const beforeTokens = tokenSnapshot()
    const savedScrollHeight = document.documentElement.scrollHeight

    // Plugin off: class, stylesheet and the theme service's inline handover.
    body.classList.remove('dsh-ios-skin')
    if (styleEl) styleEl.remove()
    body.removeAttribute('style')
    void document.body.offsetHeight
    const after = collect()
    const afterTokens = tokenSnapshot()
    const afterScrollHeight = document.documentElement.scrollHeight
    const bodyBackground = cs(body, 'background-color')

    // Restore exactly what was there and prove the round-trip.
    const restored = document.createElement('style')
    restored.id = 'dsh-ios-skin-style'
    restored.textContent = savedStyle
    document.head.appendChild(restored)
    body.classList.add('dsh-ios-skin')
    if (savedBodyStyle !== null) body.setAttribute('style', savedBodyStyle)
    void document.body.offsetHeight
    const restoredTokens = tokenSnapshot()
    return { before, after, beforeTokens, afterTokens, bodyBackground, restoredTokens, savedScrollHeight, afterScrollHeight }
  }

  function inventory() {
    const rules = pluginRules()

    // Precise token-level matching: does this real class name itself satisfy a
    // rule's attribute selector, including any :not([class*=...]) exclusion?
    // This tells the theme author whether a selector still hits a class,
    // independent of whatever other classes share the element.
    function tokenMatchesRule(token, selector) {
      for (const raw of selector.split(',')) {
        let part = raw.trim()
        if (!part.includes('[class*=')) continue
        const negatives = []
        part = part.replace(/:not\(([^()]*)\)/g, (_m, inner) => {
          for (const mm of inner.matchAll(/\[class\*=['"]([^'"]+)['"]\]/g)) negatives.push(mm[1])
          return ''
        })
        const positives = [...part.matchAll(/\[class\*=['"]([^'"]+)['"]\]/g)].map((m) => m[1])
        if (positives.length === 0) continue
        if (positives.every((p) => token.includes(p)) && !negatives.some((n) => token.includes(n))) return true
      }
      return false
    }

    const tokens = {}
    for (const el of document.querySelectorAll('*')) {
      const cls = clsOf(el)
      for (const token of cls.split(/\s+/).filter(Boolean)) {
        const t = tokens[token] || (tokens[token] = { token, count: 0, visible: 0, tags: {}, sampleText: '', groups: new Set(), selectors: new Set() })
        t.count++
        if (vis(el)) {
          t.visible++
          t.tags[el.tagName.toLowerCase()] = (t.tags[el.tagName.toLowerCase()] || 0) + 1
          if (!t.sampleText) t.sampleText = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)
          for (const g of materialGroups(el, rules)) t.groups.add(g)
          for (const r of matchedRules(el, rules)) t.selectors.add(r.selector)
        }
      }
    }
    const localName = (token) => {
      let t = token.replace(/^-/, '')
      if (t.startsWith('_')) t = t.slice(1)
      const parts = t.split('_')
      if (parts.length < 2) return null
      const hashLike = (s) => /[\dA-Z]/.test(s)
      if (hashLike(parts[0])) {
        // Some builds use a two-segment hash, e.g. ST7X_W_composerSeat.
        const twoSegmentHash = parts.length >= 3 && /^[A-Z0-9]{1,3}$/.test(parts[1])
        return parts.slice(twoSegmentHash ? 2 : 1).join('_')
      }
      return parts[0]
    }
    const rows = []
    for (const t of Object.values(tokens)) {
      const local = localName(t.token)
      if (!local || !t.token.includes('_')) continue
      rows.push({
        token: t.token, local, count: t.count, visible: t.visible,
        tags: Object.keys(t.tags), sampleText: t.sampleText,
        groups: [...t.groups], matchedSelectors: [...t.selectors].slice(0, 6),
        tokenHits: rules
          .map((r) => ({ selector: r.selector, group: r.group }))
          .filter((r) => r.group !== 'other' && tokenMatchesRule(t.token, r.selector))
          .slice(0, 8),
      })
    }
    rows.sort((a, b) => b.visible - a.visible || a.local.localeCompare(b.local))
    const groupCoverage = {}
    for (const g of MATERIAL_GROUPS) {
      groupCoverage[g] = [...document.querySelectorAll('*')].filter(vis)
        .filter((el) => materialGroups(el, rules).includes(g)).length
    }
    return {
      hashedClassCount: rows.length,
      rows,
      groupCoverage,
      // Token-level overlaps: the class name itself is hit by selectors from
      // more than one material group (the precise, unambiguous list).
      overlapSelectors: rows
        .map((r) => ({ ...r, tokenGroups: [...new Set((r.tokenHits || []).map((h) => h.group))] }))
        .filter((r) => r.tokenGroups.length > 1)
        .map((r) => ({ token: r.token, local: r.local, groups: r.tokenGroups, visible: r.visible })),
    }
  }

  window.__A = { state, baseline, inventory, vis }
}

/* ── Playwright import (workspace has no playwright; the web profile does) ─ */

async function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    '/Users/kp/.dsh/profiles/web/node_modules/playwright/index.mjs',
    'playwright',
  ].filter(Boolean)
  const errors = []
  for (const candidate of candidates) {
    try {
      const spec = candidate.startsWith('/') ? pathToFileURL(candidate).href : candidate
      return await import(spec)
    } catch (e) { errors.push(`${candidate}: ${e.message}`) }
  }
  throw new Error(`cannot import playwright:\n  ${errors.join('\n  ')}`)
}

/* ── Playwright helpers (real GUI interaction) ──────────────────────────── */

const LABELS = { light: '浅色', dark: '深色', system: '跟随系统' }

async function dismissOnboarding(page) {
  for (let i = 0; i < 5; i++) {
    const cont = page.getByText('继续', { exact: true })
    if (await cont.count() === 0) break
    try { await cont.first().click({ timeout: 3000 }) } catch { break }
    await page.waitForTimeout(500)
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
}

async function closeOverlays(page) {
  for (let i = 0; i < 4; i++) {
    const open = await page.evaluate(() => [...document.querySelectorAll('[role=dialog],[role=menu]')]
      .some((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }))
    if (!open) break
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }
}

async function openSettings(page) {
  const dialogOpen = await page.evaluate(() => {
    const d = document.querySelector('[role=dialog]')
    if (!d) return false
    const r = d.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  })
  if (dialogOpen) return
  await closeOverlays(page)
  await page.locator('button', { hasText: '更多' }).first().click({ timeout: 8000 })
  await page.waitForTimeout(700)
  await page.getByText('设置', { exact: true }).first().click({ timeout: 8000 })
  await page.waitForFunction(() => {
    const d = document.querySelector('[role=dialog]')
    if (!d) return false
    const r = d.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }, null, { timeout: 8000 })
  await page.waitForTimeout(800)
}

/** Switch the official Appearance preference (the real palette path). */
async function setPreference(page, pref) {
  await openSettings(page)
  const button = page.locator('[role=dialog] button', { hasText: LABELS[pref] }).first()
  await button.click({ timeout: 8000 })
  await page.waitForFunction((p) => {
    const dark = document.body.hasAttribute('data-ds-dark-theme')
    return p === 'dark' ? dark : p === 'light' ? !dark : true
  }, pref, { timeout: 8000 })
  await page.waitForTimeout(700)
}

async function openMoreMenu(page) {
  await closeOverlays(page)
  await page.locator('button', { hasText: '更多' }).first().click({ timeout: 8000 })
  await page.waitForFunction(() => {
    const m = document.querySelector('[role=menu]')
    if (!m) return false
    const r = m.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }, null, { timeout: 8000 })
  await page.waitForTimeout(500)
}

async function screenshot(page, dir, name) {
  await page.waitForTimeout(350)
  const file = path.join(dir, name)
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled', caret: 'hide' })
  return file
}

/* ── Media emulation (CDP) ──────────────────────────────────────────────── */

async function emulateMedia(cdp, features) {
  await cdp.send('Emulation.setEmulatedMedia', { features })
}

const NO_PREF = [
  { name: 'prefers-reduced-transparency', value: 'no-preference' },
  { name: 'prefers-contrast', value: 'no-preference' },
  { name: 'prefers-reduced-motion', value: 'no-preference' },
]

/* ── Checks ─────────────────────────────────────────────────────────────── */

function checkPluginState(state, scenario) {
  verify('plugin-active', scenario, 'body.dsh-ios-skin + style#dsh-ios-skin-style are present',
    state.body.className.split(/\s+/).includes('dsh-ios-skin') && state.plugin.stylePresent,
    { bodyClass: state.body.className, stylePresent: state.plugin.stylePresent, styleLength: state.plugin.styleLength })
  verify('material-probe', scenario, 'the inert self-check probe matched real components (no inert warning expected)',
    state.plugin.probeMatched === true, { probeMatched: state.plugin.probeMatched })
  verify('dark-attribute', scenario, scenario === 'dark' ? 'body carries data-ds-dark-theme after the real Appearance switch' : 'body is not dark in light mode',
    scenario === 'dark' ? state.body.dark === true : state.body.dark === false,
    { dark: state.body.dark, colorScheme: state.body.colorScheme })
  verify('color-scheme', scenario, `color-scheme is ${scenario === 'dark' ? 'dark' : 'light'} with matching canvas`,
    normVal(state.body.colorScheme) === (scenario === 'dark' ? 'dark' : 'light') &&
    normVal(state.body.backgroundColor) === (scenario === 'dark' ? 'rgb(18,20,26)' : 'rgb(240,242,247)'),
    { colorScheme: state.body.colorScheme, bodyBackground: state.body.backgroundColor })
}

function checkTokens(state, scenario) {
  const expected = scenario === 'dark'
    ? {
        '--dsw-alias-bg-base': '#12141a',
        '--dsw-alias-bg-layer-1': 'rgba(28,34,48,.64)',
        '--dsw-alias-bg-layer-2': 'rgba(28,34,48,.70)',
        '--dsw-alias-bg-layer-3': 'rgba(34,41,58,.78)',
        '--dsw-alias-label-primary': '#f2f4f8',
        '--dsw-alias-label-secondary': 'rgba(235,235,245,.66)',
        '--dsw-alias-border-l1': 'rgba(235,235,245,.10)',
        '--dsw-alias-brand-primary': '#6e87ff',
        '--dsw-alias-button-primary-fill': '#6e87ff',
        '--dsw-specific-sidebar-fill': 'rgba(28,34,48,.64)',
        '--dsw-elevation-stroke-color': 'rgba(122,146,255,.22)',
        '--dsw-mask-blur': 'blur(28px) saturate(180%)',
        '--dsh-ios-radius': '14px',
        '--dsh-ios-glass-thin': 'rgba(28,34,48,.64)',
        '--dsh-ios-glass': 'rgba(28,34,48,.70)',
        '--dsh-ios-glass-thick': 'rgba(34,41,58,.78)',
        '--dsh-ios-rim': 'rgba(122,146,255,.22)',
        '--dsh-ios-rim-inner': 'rgba(0,0,0,.35)',
        '--dsh-ios-surface': '#1a1d26',
        '--dsh-ios-blur': '28px',
        '--dsh-ios-brand': '#6e87ff',
        '--dsh-ios-brand-strong': '#9db0ff',
        '--dsh-ios-brand-soft': 'rgba(110,135,255,.20)',
        '--dsh-ios-brand-border': 'rgba(110,135,255,.44)',
        '--dsh-ios-brand-band-end': '#8ca0ff',
      }
    : {
        '--dsw-alias-bg-base': '#f0f2f7',
        '--dsw-alias-bg-layer-1': 'rgba(240,244,255,.58)',
        '--dsw-alias-bg-layer-2': 'rgba(240,244,255,.62)',
        '--dsw-alias-bg-layer-3': 'rgba(244,247,255,.70)',
        '--dsw-alias-label-primary': '#171a21',
        '--dsw-alias-label-secondary': 'rgba(23,26,33,.64)',
        '--dsw-alias-border-l1': 'rgba(23,26,33,.10)',
        '--dsw-alias-brand-primary': '#4d6bfe',
        '--dsw-alias-button-primary-fill': '#4d6bfe',
        '--dsw-specific-sidebar-fill': 'rgba(240,244,255,.58)',
        '--dsw-elevation-stroke-color': 'rgba(255,255,255,.55)',
        '--dsw-mask-blur': 'blur(30px) saturate(180%)',
        '--dsh-ios-radius': '14px',
        '--dsh-ios-glass-thin': 'rgba(240,244,255,.58)',
        '--dsh-ios-glass': 'rgba(240,244,255,.62)',
        '--dsh-ios-glass-thick': 'rgba(244,247,255,.70)',
        '--dsh-ios-rim': 'rgba(255,255,255,.55)',
        '--dsh-ios-rim-inner': 'rgba(77,107,254,.12)',
        '--dsh-ios-surface': '#ffffff',
        '--dsh-ios-blur': '30px',
        '--dsh-ios-brand': '#4d6bfe',
        '--dsh-ios-brand-strong': '#2f4bd9',
        '--dsh-ios-brand-soft': 'rgba(77,107,254,.10)',
        '--dsh-ios-brand-border': 'rgba(77,107,254,.38)',
        '--dsh-ios-brand-band-end': '#9bb0ff',
      }
  const mismatches = Object.entries(expected)
    .filter(([token, value]) => normVal(state.tokens[token]) !== normVal(value))
    .map(([token, value]) => ({ token, expected: value, actual: state.tokens[token] }))
  verify('tokens-ios-values', scenario, `${scenario} token layer resolves to the iOS design values`,
    mismatches.length === 0, { mismatches })
  verify('font-family', scenario, 'text and code font families are the iOS stack',
    /-apple-system|sf pro/i.test(state.tokens['--dsw-font-family']) && /ui-monospace|sf mono/i.test(state.tokens['--ds-font-family-code']),
    { text: state.tokens['--dsw-font-family'], code: state.tokens['--ds-font-family-code'] })

  const expectedPalette = PAIRED[scenario]
  const names = Object.keys(expectedPalette)
  const inline = state.body.styleTokens
  const sampleNames = scenario === 'dark'
    ? ['--dsw-alias-bg-base', '--dsw-alias-brand-primary', '--dsw-alias-label-primary', '--dsw-alias-border-l1', '--dsw-specific-sidebar-fill', '--dsw-mask-blur', '--dsw-elevation-stroke-color', '--dsw-font-family']
    : ['--dsw-alias-bg-base', '--dsw-alias-brand-primary', '--dsw-alias-bg-layer-1', '--dsw-alias-label-secondary', '--dsw-specific-sidebar-fill', '--dsw-mask-blur', '--dsw-elevation-stroke-color', '--dsw-font-family']
  const sampleDiffs = sampleNames
    .filter((n) => !(n in inline) || normVal(inline[n]) !== normVal(expectedPalette[n]))
    .map((n) => ({ token: n, expected: expectedPalette[n], inline: inline[n] }))
  const coverage = names.filter((n) => n in inline).length
  verify('token-handover', scenario, 'theme service received the tokens per palette (inline handover, sheet holds no colour)',
    coverage >= Math.max(1, names.length - 1) && !state.plugin.styleHasBaseToken && sampleDiffs.length === 0,
    { expectedTokens: names.length, inlineCoverage: coverage, sampleDiffs, styleHasBaseToken: state.plugin.styleHasBaseToken })
}

function checkMaterial(state, scenario) {
  const need = [
    ['sidebarHost', 'rail host (sidebar panel list)'],
    ['composerSeat', 'composer seat'],
    ['composerStack', 'composer stack'],
  ]
  const missing = []
  for (const [key, label] of need) {
    const els = state.surfaces[key].elements
    const ok = els.some((e) => blurOf(e.backdrop) > 0)
    if (!ok) missing.push({ surface: key, label, count: state.surfaces[key].count, elements: els.map((e) => ({ cls: e.cls, backdrop: e.backdrop })) })
  }
  verify('material-groups-coverage', scenario, 'glass reaches the rail and composer surfaces in the real DOM',
    missing.length === 0, { missing, groupCounts: state.groupCounts })

  const railEls = state.surfaces.sidebarHost.elements
  verify('sidebar-flat-elevation', scenario, 'the sidebar rail host is a flat glass rail, not an elevated card',
    railEls.length === 0 || railEls.every((e) => e.shadow === 'none'),
    { sidebarHost: railEls.map((e) => ({ cls: e.cls, shadow: e.shadow, backdrop: e.backdrop, bg: e.bg, radius: e.radius })) })

  const rowEls = state.surfaces.sidebarRow.elements
  verify('sidebar-rows-flat', scenario, 'sidebar nav rows do not become floating glass cards (_panel* must not match the _pane group)',
    rowEls.length === 0 || rowEls.every((e) => e.backdrop === 'none' && e.shadow === 'none'),
    { sidebarRows: rowEls.map((e) => ({ cls: e.cls, backdrop: e.backdrop, shadow: e.shadow, bg: e.bg, radius: e.radius })) })

  verify('leaf-no-material', scenario, 'no text/svg leaf element gets backdrop-filter or shadow from the material layer',
    state.leaks.length === 0,
    { leaks: state.leaks.map((e) => ({ tag: e.tag, cls: e.cls, groups: e.groups, backdrop: e.backdrop, shadow: e.shadow, winners: e.winners })) })

  const anchors = state.surfaces.menuAnchor.elements
  verify('menu-anchor-flat', scenario, 'the menu anchor label stays flat (a bare _menu substring must not hit _menuAnchor)',
    anchors.length === 0 || anchors.every((e) => e.backdrop === 'none' && e.shadow === 'none'),
    { menuAnchors: anchors.map((e) => ({ cls: e.cls, text: e.text, backdrop: e.backdrop, shadow: e.shadow, bg: e.bg, radius: e.radius })) })

  const expectedShadow = scenario === 'dark' ? ['2px 14px', '24px 62px'] : ['2px 12px', '22px 56px']
  const elevationProbe = (state.elevationProbe || []).filter((e) => e.tag !== 'body')
  const elevationMissing = elevationProbe.filter((e) =>
    !expectedShadow.every((f) => (e.elevationPanel || '').includes(f)) || !(e.elevationPanel || '').includes('.5px'))
  verify('elevation-inherited', scenario, `iOS elevation recipes resolve on descendants (expected ${expectedShadow.join(' + ')} shadow)`,
    elevationProbe.length > 0 && elevationMissing.length === 0,
    {
      expectedShadow,
      probe: elevationProbe.map((e) => ({ tag: e.tag, cls: e.cls, panel: e.elevationPanel, stroke: e.elevationStroke })),
      missing: elevationMissing.map((e) => ({ tag: e.tag, cls: e.cls, panel: e.elevationPanel })),
    })

  const badHeaders = state.headers.filter((h) => h.backdrop !== 'none' || h.shadow !== 'none')
  verify('header-flat', scenario, 'headers stay on the page plane: no backdrop-filter, no elevation',
    badHeaders.length === 0,
    { headers: state.headers.map((h) => ({ tag: h.tag, cls: h.cls, visible: h.visible, backdrop: h.backdrop, shadow: h.shadow, bg: h.bg, flatRule: h.flatRule })) })

  verify('header-nested-flat', scenario, 'nothing nested inside a flat header/banner gets glass or elevation',
    (state.headerNested || []).length === 0,
    {
      offenders: (state.headerNested || []).slice(0, 12).map((e) => ({
        tag: e.tag, cls: e.cls, role: e.role, text: e.text, rect: e.rect, bg: e.bg, backdrop: e.backdrop, shadow: e.shadow, radius: e.radius, groups: e.groups,
      })),
    })

  const circles = state.circleElements.filter((c) => c.square)
  // The theme must not replace an official round radius with its 14px token.
  // `corner-shape: superellipse(1.5)` on a few better-sidebar 50% buttons comes
  // from the design system's universal corner-shape rule, not from this theme;
  // it is pre-existing host behavior, so it is recorded but not a failure.
  const squared = circles.filter((c) => {
    const px = parseFloat(c.radius)
    const half = Math.min(c.rect.w, c.rect.h) / 2
    return /%/.test(c.radius) ? parseFloat(c.radius) < 50 : px < half - 0.75
  })
  const squircleButStillRound = circles.filter((c) => normVal(c.cornerShape) === 'superellipse(1.5)')
  verify('true-circles-round', scenario, 'official circular controls keep a round radius (theme must not apply 14px to them)',
    squared.length === 0,
    {
      exercised: circles.length,
      officialCircleRules: state.circleRuleCount,
      squared: squared.map((c) => ({ tag: c.tag, cls: c.cls, rect: c.rect, radius: c.radius, cornerShape: c.cornerShape, rule: c.rule })),
      systemCornerShapeNotes: squircleButStillRound.map((c) => ({ cls: c.cls, radius: c.radius, cornerShape: c.cornerShape })),
    })

  const editables = state.readables.filter((r) => /^(input|textarea)$/.test(r.tag) || r.cls.includes('editable'))
  const glassEditable = state.readables.filter((r) => r.backdrop !== 'none')
  const translucentEditable = editables.filter((r) => alphaOf(r.bg) < 0.8)
  verify('readable-surfaces', scenario, 'text-bearing and editable surfaces stay off the glass and near-opaque',
    glassEditable.length === 0 && translucentEditable.length === 0,
    {
      glass: glassEditable.map((r) => ({ tag: r.tag, cls: r.cls, backdrop: r.backdrop })),
      translucentEditables: translucentEditable.map((r) => ({ tag: r.tag, cls: r.cls, bg: r.bg })),
      editables: editables.length,
    })
}

/** Dialogs and menus: the floating glass treatment (blur + rim + elevation). */
function checkOverlayMaterial(state, scenario) {
  const dialog = state.surfaces.dialog.elements
  const menu = state.surfaces.menu.elements
  const overlay = dialog.concat(menu)
  const noGlass = overlay.filter((e) => blurOf(e.backdrop) === 0)
  const noShadow = overlay.filter((e) => e.shadow === 'none')
  // v0.3.0 paints the rim with box-shadow (outer 1px + inset 1px), never border.
  const hasRimShadow = (e) => /0px 0px 0px 1px|0 0 0 1px/.test(e.shadow) && /inset/.test(e.shadow)
  const dialogNoRim = dialog.filter((e) => !hasRimShadow(e))
  verify('overlay-material', scenario, 'dialogs and menus get the floating glass treatment (blur + box-shadow rim + elevation)',
    overlay.length > 0 && noGlass.length === 0 && noShadow.length === 0 && dialogNoRim.length === 0,
    {
      overlayCount: overlay.length,
      noGlass: noGlass.map((e) => ({ tag: e.tag, cls: e.cls, backdrop: e.backdrop })),
      noShadow: noShadow.map((e) => ({ tag: e.tag, cls: e.cls, shadow: e.shadow })),
      dialogNoRim: dialogNoRim.map((e) => ({ tag: e.tag, cls: e.cls, shadow: e.shadow, borderWidth: e.borderWidth })),
      overlays: overlay.map((e) => ({ tag: e.tag, cls: e.cls, backdrop: e.backdrop, shadow: e.shadow, borderWidth: e.borderWidth, radius: e.radius })),
    })
}

/** New UI (better-sidebar + dockkit + Agent Teams) surface assertions. */
function checkNewUi(state, scenario, opts = {}) {
  const n = state.newUi || {}
  const els = (key) => (n[key]?.elements || [])
  const flat = (id, title, key) => {
    const list = els(key)
    const bad = list.filter((e) => e.backdrop !== 'none' || e.shadow !== 'none')
    verify(id, scenario, title, list.length === 0 || bad.length === 0, {
      hook: key,
      countAll: n[key]?.countAll ?? 0,
      countVisible: n[key]?.countVisible ?? 0,
      offenders: bad.map((e) => ({ tag: e.tag, cls: e.cls, bg: e.bg, backdrop: e.backdrop, shadow: e.shadow, radius: e.radius })),
    })
  }

  verify('newui-hooks-present', scenario, 'new UI data hooks are present (better-sidebar host, dockkit strip, bottom panel)',
    (n.dshBetterSidebar?.countAll || 0) > 0 && (n.dockkitStrip?.countAll || 0) > 0 && (n.dshBottomPanel?.countAll || 0) > 0,
    {
      dshBetterSidebar: n.dshBetterSidebar?.countAll ?? 0,
      dshPanelHost: n.dshPanelHost?.countAll ?? 0,
      dshBottomPanel: n.dshBottomPanel?.countAll ?? 0,
      dockkitStrip: n.dockkitStrip?.countAll ?? 0,
      dockkitPane: n.dockkitPane?.countAll ?? 0,
      dockkitFloat: n.dockkitFloat?.countAll ?? 0,
      teamPanel: n.teamPanel?.countAll ?? 0,
      teamAction: n.teamAction?.countAll ?? 0,
      sidebarRightPanel: n.sidebarRightPanel?.countAll ?? 0,
    })

  flat('newui-icon-slots-flat', 'new sidebar icon slots stay flat (no _slot material leak)', 'bsIconSlot')
  flat('newui-bs-pane-flat', 'better-sidebar pane cards stay flat', 'bsPaneCard')
  flat('newui-bs-paneall-flat', 'better-sidebar pane tree stays flat (nArs4W_pane*)', 'bsPane')
  flat('newui-bs-panelbody-flat', 'better-sidebar bottom panel body stays flat', 'bsPanelBody')
  flat('newui-dockkit-pane-flat', 'dockkit pane layout stays flat (no forced card geometry)', 'dockkitPaneClass')
  flat('newui-dockkit-panebody-flat', 'dockkit pane bodies stay flat', 'dockkitPaneBodyClass')
  flat('newui-dockkit-surface-flat', 'dockkit layout shell stays flat', 'dockkitSurfaceClass')
  flat('newui-strip-children-flat', 'dockkit strip children stay flat (no duplicate glass)', 'dockkitStripTabs')
  flat('newui-strip-fill-flat', 'dockkit strip fill stays flat', 'dockkitStripFill')
  flat('newui-strip-chrome-flat', 'dockkit strip chrome stays flat', 'dockkitStripChromeClass')
  flat('newui-dock-hint-flat', 'dock hint card is not turned into a solid glass card', 'dockHintCard')

  const bp = els('dshBottomPanel')
  verify('newui-bottom-panel-glass', scenario, 'bottom workbench gets glass fill + blur (geometry left to better-sidebar)',
    bp.length > 0 && bp.every((e) => blurOf(e.backdrop) > 0),
    { count: bp.length, panels: bp.map((e) => ({ cls: e.cls, bg: e.bg, backdrop: e.backdrop, shadow: e.shadow, radius: e.radius })) })
  verify('newui-bottom-panel-geometry', scenario, 'bottom workbench border/radius/shadow stay owned by better-sidebar',
    bp.length === 0 || bp.every((e) => e.shadow === 'none' && parseFloat(e.radius) === 0),
    { panels: bp.map((e) => ({ cls: e.cls, shadow: e.shadow, radius: e.radius, borderWidth: e.borderWidth })) })

  const strip = els('dockkitStrip')
  verify('newui-dockkit-strip-thin', scenario, 'dockkit tab strip gets the thin glass treatment',
    strip.length === 0 || strip.every((e) => blurOf(e.backdrop) > 0),
    { strips: strip.map((e) => ({ cls: e.cls, bg: e.bg, backdrop: e.backdrop, radius: e.radius })) })

  const team = (n.teamPanel?.elements?.length ? n.teamPanel.elements : (n.teamPanelClass?.elements || []))
  if (opts.teamOpen) {
    verify('newui-team-panel-overlay', scenario, 'Agent Teams panel gets the floating glass treatment (blur + elevation)',
      team.length > 0 && team.every((e) => blurOf(e.backdrop) > 0 && e.shadow !== 'none'),
      { panels: team.map((e) => ({ cls: e.cls, role: e.role, bg: e.bg, backdrop: e.backdrop, shadow: e.shadow, radius: e.radius })) })
  }
  const members = els('teamMember')
  if (members.length) {
    verify('newui-team-member-readable', scenario, 'Agent Teams roster member cards keep a readable near-opaque surface',
      members.every((e) => alphaOf(e.bg) >= 0.6),
      { members: members.slice(0, 8).map((e) => ({ cls: e.cls, bg: e.bg, color: e.color })) })
  }


  // v0.3.0 Deep Fusion signature + readability contracts.
  const band = state.brandBand || { active: [], inactive: [], floatInactive: [] }
  const hasBand = (e) => /linear-gradient/i.test(e.bgImage || '') && /1px/.test(e.bgSize || '')
  verify('v3-brand-band-active', scenario, 'v0.3.0 brand light-band appears only on the active dockkit pane (1px linear gradient)',
    band.active.length === 0 || band.active.some(hasBand),
    { active: band.active.map((e) => ({ cls: e.cls, bgImage: (e.bgImage || '').slice(0, 160), bgSize: e.bgSize, rect: e.rect })) })
  verify('v3-brand-band-inactive', scenario, 'inactive dockkit panes carry no brand light-band',
    band.inactive.every((e) => !/linear-gradient/i.test(e.bgImage || ''))
      && (band.floatInactive || []).every((e) => !/linear-gradient/i.test(e.bgImage || '')),
    {
      inactive: band.inactive.map((e) => ({ cls: e.cls, bgImage: (e.bgImage || '').slice(0, 100) })),
      floatInactive: (band.floatInactive || []).length,
    })
  const rd = state.readability || { body: { count: 0 }, secondary: { count: 0 }, bodyBelow45: 0, secondaryBelow3: 0 }
  verify('v3-text-contrast', scenario, 'v0.3.0 text palette meets AA (body >=4.5:1, secondary >=3:1)',
    (rd.bodyBelow45 || 0) === 0 && (rd.secondaryBelow3 || 0) === 0,
    { body: rd.body, secondary: rd.secondary, bodyBelow45: rd.bodyBelow45, secondaryBelow3: rd.secondaryBelow3, worst: rd.worst, samples: rd.samples })
  record('v3-text-contrast-margin', scenario, 'v0.3.0 contrast headroom above AA (comfort target body>=4.8, secondary>=3.1)',
    ((rd.body?.min ?? 0) >= 4.8 && (rd.secondary?.min ?? 0) >= 3.1) ? 'pass' : 'warn',
    { bodyMin: rd.body?.min, secondaryMin: rd.secondary?.min, aa: { body: 4.5, secondary: 3.0 }, comfort: { body: 4.8, secondary: 3.1 } }, 'low')

  const tabs = state.activeTabs || []
  const expectedTabColor = state.body.dark ? 'rgb(157,176,255)' : 'rgb(47,75,217)'
  const badTabs = tabs.filter((e) => normVal(e.color) !== normVal(expectedTabColor) || !/inset/.test(e.shadow) || !/1px/.test(e.shadow))
  verify('v3-active-tab-color', scenario, 'active tab text uses --dsh-ios-brand-strong and the selected state carries the 1px brand inset rim',
    tabs.length === 0 || badTabs.length === 0,
    {
      expectedColor: expectedTabColor,
      tabs: tabs.map((e) => ({ cls: e.cls, color: e.color, shadow: e.shadow, radius: e.radius })),
      offenders: badTabs.map((e) => ({ cls: e.cls, color: e.color, shadow: e.shadow })),
    })

  const rail = els('rightRailBody')
  record('newui-right-rail-material', scenario, 'dockkit right rail resolved material (informational)', 'info',
    { panels: rail.map((e) => ({ cls: e.cls, bg: e.bg, backdrop: e.backdrop, shadow: e.shadow, radius: e.radius })) }, 'low')
}

/** Console errors caused by copying a historical session without its git data. */
const ENV_CONSOLE_NOISE = [
  /Failed to load resource: the server responded with a status of 404/i,
  /api\/changes\.summary/i,
]

function checkA11y(state, scenario, expected) {
  if (scenario === 'reduced-transparency') {
    const stillBlurred = state.blurred.map((e) => ({ tag: e.tag, cls: e.cls, groups: e.groups, backdrop: e.backdrop }))
    const tokenAlpha = ['--dsh-ios-glass-thin', '--dsh-ios-glass', '--dsh-ios-glass-thick'].map((t) => ({ token: t, value: state.tokens[t], alpha: alphaOf(state.tokens[t]) }))
    const opaque = tokenAlpha.every((t) => t.alpha === 1)
    verify('reduced-transparency', scenario, 'reduced-transparency drops the glass effect: no backdrop blur, opaque material tokens',
      stillBlurred.length === 0 && opaque,
      { stillBlurred: stillBlurred.slice(0, 12), materialTokens: tokenAlpha })
  }
  if (scenario === 'contrast-more') {
    const pairs = [
      ['--dsw-alias-border-l1', expected.borderL1],
      ['--dsw-alias-label-secondary', expected.labelSecondary],
      ['--dsw-alias-label-tertiary', expected.labelTertiary],
    ]
    const diffs = pairs.filter(([token, value]) => normVal(state.tokens[token]) !== normVal(value))
      .map(([token, value]) => ({ token, expected: value, actual: state.tokens[token] }))
    verify('contrast-more', scenario, 'contrast:more strengthens separators and secondary labels',
      diffs.length === 0, { diffs, tokens: { borderL1: state.tokens['--dsw-alias-border-l1'], labelSecondary: state.tokens['--dsw-alias-label-secondary'] } })
  }
  if (scenario === 'reduced-motion') {
    const durations = state.surfaces.sidebarRow.elements.concat(state.surfaces.iconButton.elements)
    const animated = durations.filter((e) => e.transitionDuration !== '0s')
    verify('reduced-motion', scenario, 'reduced-motion stops interaction transitions on controls',
      animated.length === 0, { controls: durations.map((e) => ({ cls: e.cls, transitionDuration: e.transitionDuration })) })
  }
}

function checkBaseline(baseline, scenario, officialSample) {
  const rectDiffs = []
  const toleratedDiffs = []
  const propDiffs = []
  const STRUCTURAL = ['display', 'position', 'opacity', 'visibility', 'overflowX', 'overflowY', 'paddingTop', 'paddingLeft', 'marginTop', 'marginLeft', 'transform', 'zIndex']
  const PAINT = new Set(['bg', 'backdrop', 'radius', 'cornerShape', 'shadow', 'borderColor', 'borderWidth', 'color', 'fontFamily', 'transitionDuration'])
  const seen = new Set()
  for (const before of baseline.before) {
    const id = `${before.key}#${before.idx}`
    if (seen.has(id)) continue
    seen.add(id)
    const after = baseline.after.find((a) => a.key === before.key && a.idx === before.idx)
    if (!after) { rectDiffs.push({ key: before.key, missing: true }); continue }
    const dr = ['x', 'y', 'w', 'h'].reduce((acc, k) => acc + Math.abs(before.rect[k] - after.rect[k]), 0)
    // The theme deliberately changes font-family, so text-flow containers may
    // settle 1-2px differently. That is a font-metric effect, not a layout
    // takeover: structural properties must still be identical, and bigger
    // geometry changes are failures.
    if (dr > 4) rectDiffs.push({ key: before.key, cls: before.cls, text: before.text, before: before.rect, after: after.rect })
    else if (dr > 0) toleratedDiffs.push({ key: before.key, cls: before.cls, before: before.rect, after: after.rect, note: 'font-metric shift (≤2px/edge)' })
    for (const prop of Object.keys(before)) {
      if (STRUCTURAL.includes(prop)) {
        if (String(before[prop]) !== String(after[prop])) propDiffs.push({ key: before.key, cls: before.cls, prop, before: before[prop], after: after[prop] })
      }
    }
  }
  void PAINT
  verify('baseline-layout', scenario, 'removing the theme changes no structural layout geometry (text-metric shift ≤2px/edge allowed)',
    rectDiffs.length === 0 && baseline.savedScrollHeight === baseline.afterScrollHeight,
    { rectDiffs: rectDiffs.slice(0, 20), toleratedDiffs, scrollHeight: { themed: baseline.savedScrollHeight, baseline: baseline.afterScrollHeight } })
  verify('baseline-structural-props', scenario, 'removing the theme changes only paint properties, never structure',
    propDiffs.length === 0, { propDiffs: propDiffs.slice(0, 20) })

  const themedBase = baseline.beforeTokens['--dsw-alias-bg-base']
  const officialBase = baseline.afterTokens['--dsw-alias-bg-base']
  const themedBrand = baseline.beforeTokens['--dsw-alias-brand-primary']
  const officialBrand = baseline.afterTokens['--dsw-alias-brand-primary']
  verify('baseline-token-diff', scenario, 'themed tokens differ from the official theme tokens (the plugin actually overrode them)',
    normVal(themedBase) !== normVal(officialBase) && normVal(themedBrand) !== normVal(officialBrand),
    {
      themed: { base: themedBase, brand: themedBrand, font: baseline.beforeTokens['--dsw-font-family'] },
      official: { base: officialBase, brand: officialBrand, font: baseline.afterTokens['--dsw-font-family'] },
      sampleOfficial: officialSample,
    })
  verify('baseline-roundtrip', scenario, 'restoring the theme reproduces the themed computed tokens exactly',
    Object.keys(baseline.beforeTokens).every((t) => normVal(baseline.beforeTokens[t]) === normVal(baseline.restoredTokens[t])),
    { before: baseline.beforeTokens, restored: baseline.restoredTokens })
}

/* ── DOM class inventory report ─────────────────────────────────────────── */

function writeDomClasses(file, inventory, state) {
  if (!file) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const lines = [
    '# dsh-ios-skin — real GUI hashed class inventory',
    '',
    `Generated by \`scripts/verify-ios-skin-runtime.mjs\` from the live GUI (${new Date().toISOString()}).`,
    'Every class below exists in the real DOM; `local` is the CSS-module local name, `groups` are the',
    'material-layer groups that currently match the element carrying it, and `token hits` lists the',
    'class-substring selectors that match the class name itself (the precise overlap evidence).',
    '',
    '## Material group coverage (visible elements)',
    '',
    '| group | visible elements |',
    '|---|---|',
    ...Object.entries(inventory.groupCoverage).map(([g, n]) => `| ${g} | ${n} |`),
    '',
    '## Hashed classes (visible first)',
    '',
    '| token | local | total | visible | tags | token-level selector hits (group ← selector) | matched plugin selectors (element-level) | sample text |',
    '|---|---|---|---|---|---|---|---|',
    ...inventory.rows.slice(0, 200).map((r) =>
      `| \`${r.token}\` | ${r.local} | ${r.count} | ${r.visible} | ${r.tags.join(',')} | ${(r.tokenHits || []).map((h) => '`' + h.group + '` ← ' + '`' + h.selector.slice(0, 80) + '`').join('<br>') || '—'} | ${r.matchedSelectors.map((s) => '`' + s.slice(0, 90) + '`').join('<br>') || '—'} | ${(r.sampleText || '—').replace(/\|/g, '\\|')} |`),
    '',
    '## Classes matched by more than one material group',
    '',
    '| token | local | groups | visible |',
    '|---|---|---|---|',
    ...inventory.overlapSelectors.map((r) => `| \`${r.token}\` | ${r.local} | ${r.groups.join(', ')} | ${r.visible} |`),
    '',
    '## Key surfaces as found in the live DOM',
    '',
    '| surface | count | class | computed backdrop | computed shadow |',
    '|---|---|---|---|---|',
    ...Object.entries(state.surfaces).flatMap(([key, s]) => s.elements.slice(0, 1).map((e) =>
      `| ${key} | ${s.count} | \`${e.cls.slice(0, 120)}\` | ${e.backdrop} | ${e.shadow} |`)),
    ...(state.newUi ? [
      '',
      '## New UI stable hooks / surfaces (real DOM)',
      '',
      '| hook | all | visible | sample class | bg | backdrop | shadow | radius |',
      '|---|---|---|---|---|---|---|---|',
      ...Object.entries(state.newUi).map(([key, v]) => {
        const e = v.elements[0]
        return `| ${key} | ${v.countAll} | ${v.countVisible} | ${e ? '`' + e.cls.slice(0, 100) + '`' : '—'} | ${e ? e.bg : '—'} | ${e ? e.backdrop : '—'} | ${e ? e.shadow.slice(0, 60) : '—'} | ${e ? e.radius : '—'} |`
      }),
    ] : []),
    '',
  ]
  fs.writeFileSync(file, lines.join('\n'))
}

/* ── Defect metadata + summary writer (shared by every scenario) ────────── */

const DEFECT_META = {
  'plugin-active': { severity: 'blocker', area: 'activation', fix: 'ensure the client bundle is installed and the theme service is injected' },
  'material-probe': { severity: 'blocker', area: 'activation', fix: 'the official component class names likely changed; update the material selectors' },
  'tokens-ios-values': { severity: 'high', area: 'tokens', fix: 'correct the iOS token values in src/client.js' },
  'token-handover': { severity: 'high', area: 'tokens', fix: 'verify ctx.theme.overrideTokens receives a {light,dark} pair per token' },
  'dark-attribute': { severity: 'high', area: 'palette', fix: 'the official Appearance switch must resolve the dark palette' },
  'color-scheme': { severity: 'high', area: 'palette', fix: 'canvas/color-scheme must follow the active palette' },
  'material-groups-coverage': { severity: 'high', area: 'material', fix: 'add the real surface class names to the material groups' },
  'sidebar-flat-elevation': { severity: 'medium', area: 'material', fix: "same root cause as sidebar-rows-flat: [class*='_pane'] also matches _panelList, so the rail host inherits the in-flow card shadow; rails carry no elevation" },
  'sidebar-rows-flat': { severity: 'high', area: 'material', fix: "replace the broad [class*='_pane'] pattern (it matches _panelList/_panelRow/_panelTitle/_panelGlyph/_panelIcon) with a pattern that only hits real pane containers" },
  'leaf-no-material': { severity: 'high', area: 'material', fix: "narrow [class*='_pane'] (text/svg leaves) and [class*='_menu'] (it matches _menuAnchor, the '标准模式' trigger span) so material never lands on leaves" },
  'menu-anchor-flat': { severity: 'high', area: 'material', fix: "remove the bare [class*='_menu'] substring or exclude _menuAnchor; the real menu is covered by [role=menu]" },
  'elevation-inherited': { severity: 'high', area: 'tokens', fix: 'declare the --dsw-elevation-* recipes on body and descendants (official theme does body,body *); a body-only inline value never reaches components' },
  'header-flat': { severity: 'medium', area: 'material', fix: 'keep headers out of the glass groups' },
  'header-nested-flat': { severity: 'medium', area: 'new-ui', fix: 'exclude header/banner descendants from nav/tablist/bar/tool glass rules: a toolbar or tab strip nested inside the flat header must not become a glass card' },
  'true-circles-round': { severity: 'high', area: 'geometry', fix: 'never set border-radius on official circular controls' },
  'readable-surfaces': { severity: 'high', area: 'readability', fix: 'keep readable/editable surfaces opaque and off the glass' },
  'overlay-material': { severity: 'medium', area: 'material', fix: 'ensure dialogs/menus get the floating glass treatment' },
  'reduced-transparency': { severity: 'high', area: 'a11y', fix: 'raise the reduced-transparency blur reset above the material rules (specificity/!important) or flip material tokens only' },
  'contrast-more': { severity: 'high', area: 'a11y', fix: 'the inline token handover outranks @media (prefers-contrast:more); use !important or apply the contrast values through the handover path' },
  'reduced-motion': { severity: 'medium', area: 'a11y', fix: 'ensure controls lose their transitions under prefers-reduced-motion' },
  'baseline-layout': { severity: 'high', area: 'isolation', fix: 'the theme must not change layout geometry' },
  'baseline-structural-props': { severity: 'high', area: 'isolation', fix: 'the theme must not change structural properties' },
  'baseline-token-diff': { severity: 'high', area: 'tokens', fix: 'the plugin is not overriding the official tokens' },
  'baseline-roundtrip': { severity: 'medium', area: 'isolation', fix: 'the plugin must restore exactly what it added' },
  'console-clean': { severity: 'high', area: 'runtime', fix: 'fix the runtime error/warning reported in the console' },
  // new UI scenario
  'newui-hooks-present': { severity: 'high', area: 'new-ui', fix: 'the new UI stable hooks changed; refresh dom-classes-newui.md and update the audit selectors' },
  'newui-icon-slots-flat': { severity: 'high', area: 'new-ui', fix: "stop matching _slot (jJkEga_slot icon slots must stay flat)" },
  'newui-bs-pane-flat': { severity: 'high', area: 'new-ui', fix: 'exclude better-sidebar subtree from _card/_pane material' },
  'newui-bs-paneall-flat': { severity: 'high', area: 'new-ui', fix: 'exclude better-sidebar subtree from _card/_pane material' },
  'newui-bs-panelbody-flat': { severity: 'high', area: 'new-ui', fix: 'exclude better-sidebar subtree from rail/_panelBody material' },
  'newui-dockkit-pane-flat': { severity: 'high', area: 'new-ui', fix: 'dockkit pane layout must not get themed card geometry; keep hooks flat' },
  'newui-dockkit-panebody-flat': { severity: 'high', area: 'new-ui', fix: 'dockkit pane bodies must stay flat' },
  'newui-dockkit-surface-flat': { severity: 'high', area: 'new-ui', fix: 'dockkit layout shell must stay flat; paint only real strips/floats' },
  'newui-strip-children-flat': { severity: 'medium', area: 'new-ui', fix: 'only the strip root gets thin glass; its children stay flat' },
  'newui-strip-fill-flat': { severity: 'medium', area: 'new-ui', fix: 'only the strip root gets thin glass; its children stay flat' },
  'newui-strip-chrome-flat': { severity: 'medium', area: 'new-ui', fix: 'only the strip root gets thin glass; its children stay flat' },
  'newui-dock-hint-flat': { severity: 'medium', area: 'new-ui', fix: 'exclude _dockHintCard from the solid card group' },
  'newui-bottom-panel-glass': { severity: 'high', area: 'new-ui', fix: 'paint [data-dsh-bottom-panel] with glass fill + blur30' },
  'newui-bottom-panel-geometry': { severity: 'medium', area: 'new-ui', fix: 'do not set border/radius/shadow on [data-dsh-bottom-panel]; geometry is better-sidebar-owned' },
  'newui-dockkit-strip-thin': { severity: 'medium', area: 'new-ui', fix: 'paint [data-dockkit-strip] / [role=tablist] with the thin material' },
  'newui-team-panel-overlay': { severity: 'high', area: 'new-ui', fix: 'Agent Teams panel must get the overlay material (blur + rim/elevation)' },
  'newui-team-member-readable': { severity: 'medium', area: 'new-ui', fix: 'keep roster member cards near-opaque for text contrast' },
  'newui-right-rail-material': { severity: 'low', area: 'new-ui', fix: 'informational: dockkit right rail resolved material' },
}

function writeSummary({ shortUrl, screenshots, evidence }) {
  const failures = checks.filter((c) => c.status === 'fail')
  const warnings = checks.filter((c) => c.status === 'warn')
  const passes = checks.filter((c) => c.status === 'pass')
  const defectsById = new Map()
  for (const f of failures) {
    const meta = DEFECT_META[f.id] || {}
    const existing = defectsById.get(f.id)
    if (existing) {
      existing.scenarios.push(f.scenario)
      existing.evidenceByScenario[f.scenario] = f.detail
    } else {
      defectsById.set(f.id, {
        id: f.id,
        title: f.title,
        severity: meta.severity || f.severity || 'medium',
        area: meta.area || 'unknown',
        fix: meta.fix || '',
        scenarios: [f.scenario],
        evidence: f.detail,
        evidenceByScenario: { [f.scenario]: f.detail },
        repro: `node scripts/verify-ios-skin-runtime.mjs --scenario ${SCENARIO} --url "${shortUrl}"`,
      })
    }
  }
  const defects = [...defectsById.values()]
  const summary = {
    ok: failures.length === 0,
    scenario: SCENARIO,
    scenarioLabel: SC.label,
    generatedAt: new Date().toISOString(),
    url: shortUrl,
    pluginVersion: pluginVersion(),
    browser: 'Chrome (playwright channel=chrome, headless)',
    viewport: '1440x900 @1x',
    checks: { total: checks.length, pass: passes.length, fail: failures.length, warn: warnings.length, info: checks.filter((c) => c.status === 'info').length },
    scenarios: [...new Set(checks.map((c) => c.scenario))],
    defects,
    checksAll: checks,
    console: { total: consoleEvents.length, errors: consoleEvents.filter((e) => e.type === 'error' || e.type === 'pageerror'), warnings: consoleEventWarnings(consoleEvents) },
    screenshots,
    evidence,
  }
  fs.writeFileSync(JSON_OUT, JSON.stringify(summary, null, 2))
  console.log('\n────────────────────────────────────────')
  console.log(`scenario: ${SCENARIO} (${SC.label})`)
  console.log(`checks: ${passes.length} pass, ${failures.length} fail, ${warnings.length} warn, ${checks.length - passes.length - failures.length - warnings.length} info`)
  console.log(`screenshots: ${screenshots.join(', ')}`)
  console.log(`json: ${JSON_OUT}`)
  if (DOM_CLASSES_OUT) console.log(`dom classes: ${DOM_CLASSES_OUT}`)
  if (failures.length) {
    console.log('\ndefects:')
    for (const d of defects) console.log(`  - [${d.severity}] ${d.id} (${d.area}): ${d.title}`)
  }
  process.exitCode = failures.length ? 1 : 0
  return { defects, failures }
}

/* ── New UI scenario helpers ────────────────────────────────────────────── */

async function openNewUiSession(page) {
  const rowsAt = () => page.evaluate(() => [...document.querySelectorAll("[class*='jJkEga_sessionRow']")]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
    .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70)))
  let rows = await rowsAt()
  if (!rows.some((t) => t && !/^新会话/.test(t))) {
    // Expand a workspace that holds real sessions: try each project row.
    const projects = page.locator("[class*='jJkEga_projectRow']")
    const count = await projects.count()
    for (let i = 0; i < Math.min(count, 12); i++) {
      try { await projects.nth(i).click({ timeout: 2500 }) } catch { continue }
      await page.waitForTimeout(900)
      rows = await rowsAt()
      if (rows.some((t) => t && !/^新会话/.test(t))) break
      try { await projects.nth(i).click({ timeout: 1500 }) } catch { /* keep open state as-is */ }
      await page.waitForTimeout(300)
    }
  }
  const target = rows.find((t) => t && !/^新会话/.test(t)) || rows[0]
  if (!target) throw new Error('no session row in the new UI sidebar; workspace/session fixtures missing')
  await page.locator("[class*='jJkEga_sessionRow']", { hasText: target }).first().click({ timeout: 6000 })
  await page.waitForFunction(() => {
    const h = document.querySelector('header')
    return h && !h.className.includes('headerBlank') && h.getBoundingClientRect().height > 0
  }, null, { timeout: 15000 })
  await page.waitForTimeout(2500)
  return target
}

async function ensureBottomPanel(page) {
  const collapsed = await page.evaluate(() => {
    const p = document.querySelector('[data-dsh-bottom-panel]')
    if (!p) return true
    const r = p.getBoundingClientRect()
    return p.classList.contains('bottomPanelHidden') || r.top >= window.innerHeight - 20
  })
  if (!collapsed) return
  try {
    await page.locator('button[aria-label="展开底部面板"]').first().click({ timeout: 4000 })
  } catch {
    try { await page.locator('[data-dsh-bottom-toggle]').first().click({ timeout: 3000 }) } catch { /* already open/unavailable */ }
  }
  await page.waitForTimeout(1400)
}

async function openTeamPanel(page) {
  try {
    await page.locator('button[aria-label="智能体团队"]').first().click({ timeout: 5000 })
  } catch {
    const trigger = page.locator("[class*='VoX2oq_trigger']").first()
    await trigger.click({ timeout: 5000 })
  }
  await page.waitForFunction(() => {
    const p = document.querySelector('[data-team-panel]')
    if (!p) return false
    const r = p.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }, null, { timeout: 8000 })
  await page.waitForTimeout(900)
}

async function closeNewUiOverlays(page) {
  for (let i = 0; i < 4; i++) {
    const open = await page.evaluate(() => !!document.querySelector('[data-team-panel]')
      || [...document.querySelectorAll('[role=dialog],[role=menu]')].some((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && !el.closest('[data-dsh-bottom-panel]')
      }))
    if (!open) break
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }
}

/* ── New UI scenario ────────────────────────────────────────────────────── */

async function mainNewUi() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true })
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch({ channel: 'chrome', headless: !argv.headed })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' })
  const page = await context.newPage()
  const shortUrl = URL_ARG.replace(/token=[^&]+/, 'token=***')
  console.log(`dsh-ios-skin runtime audit [newui] — ${shortUrl}`)
  page.on('console', (m) => consoleEvents.push({ phase, type: m.type(), text: m.text().slice(0, 500) }))
  page.on('pageerror', (e) => consoleEvents.push({ phase, type: 'pageerror', text: String(e.message).slice(0, 500) }))
  const screenshots = []
  const evidence = {}

  const sync = profileSyncInfo()
  evidence.profileSync = sync
  record('profile-sync', 'setup', 'the installed profile artifact matches src/client.js',
    sync.runtimeMatchesSrc ? 'pass' : 'warn', { ...sync }, 'low')

  try {
    phase = 'boot'
    await page.goto(URL_ARG, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForFunction(() => document.body && document.body.classList.contains('dsh-ios-skin'), null, { timeout: 45000 })
    await page.waitForTimeout(7000)
    await dismissOnboarding(page)
    await page.addScriptTag({ content: `(${auditLib.toString()})()` })
    const cdp = await context.newCDPSession(page)

    phase = 'newui-session'
    const sessionTitle = await openNewUiSession(page)
    evidence.session = { title: sessionTitle }

    /* — Light: session view + Agent Teams + bottom workbench — */
    phase = 'newui-light'
    await setPreference(page, 'light')
    await closeNewUiOverlays(page)
    await page.waitForTimeout(700)
    const light = await page.evaluate(() => window.__A.state('newui-light'))
    evidence.light = light
    screenshots.push(await screenshot(page, OUT_DIR, shot('light')))
    checkPluginState(light, 'light')
    checkTokens(light, 'light')
    checkMaterial(light, 'light')
    checkNewUi(light, 'light')

    phase = 'newui-agent-team'
    await openTeamPanel(page)
    const team = await page.evaluate(() => window.__A.state('newui-team-open'))
    evidence.team = team
    screenshots.push(await screenshot(page, OUT_DIR, shot('agent-team')))
    checkNewUi(team, 'agent-team', { teamOpen: true })
    await closeNewUiOverlays(page)

    phase = 'newui-bottom'
    await ensureBottomPanel(page)
    const bottom = await page.evaluate(() => window.__A.state('newui-bottom-open'))
    evidence.bottom = bottom
    screenshots.push(await screenshot(page, OUT_DIR, shot('bottom-panel')))
    checkNewUi(bottom, 'bottom')

    /* — DOM inventory for the theme author — */
    phase = 'newui-inventory'
    const inventory = await page.evaluate(() => window.__A.inventory())
    evidence.inventory = inventory

    /* — Dark: session + Agent Teams panel — */
    phase = 'newui-dark'
    await closeNewUiOverlays(page)
    await setPreference(page, 'dark')
    await closeNewUiOverlays(page)
    await page.waitForTimeout(700)
    const dark = await page.evaluate(() => window.__A.state('newui-dark'))
    evidence.dark = dark
    screenshots.push(await screenshot(page, OUT_DIR, shot('dark')))
    checkPluginState(dark, 'dark')
    checkTokens(dark, 'dark')
    checkMaterial(dark, 'dark')

    phase = 'newui-agent-team-dark'
    await openTeamPanel(page)
    const teamDark = await page.evaluate(() => window.__A.state('newui-team-dark'))
    evidence.teamDark = teamDark
    screenshots.push(await screenshot(page, OUT_DIR, shot('agent-team-dark')))
    checkNewUi(teamDark, 'agent-team-dark', { teamOpen: true })
    await closeNewUiOverlays(page)

    /* — Accessibility on the new UI — */
    phase = 'newui-reduced-transparency'
    await emulateMedia(cdp, [{ name: 'prefers-reduced-transparency', value: 'reduce' }])
    await page.waitForTimeout(700)
    const reducedTransparency = await page.evaluate(() => window.__A.state('newui-reduced-transparency'))
    evidence.reducedTransparency = reducedTransparency
    checkA11y(reducedTransparency, 'reduced-transparency', {})

    phase = 'newui-contrast-more'
    await emulateMedia(cdp, NO_PREF)
    await setPreference(page, 'light')
    await closeNewUiOverlays(page)
    await emulateMedia(cdp, [{ name: 'prefers-contrast', value: 'more' }])
    await page.waitForTimeout(700)
    const contrastMore = await page.evaluate(() => window.__A.state('newui-contrast-more'))
    evidence.contrastMore = contrastMore
    checkA11y(contrastMore, 'contrast-more', {
      borderL1: 'rgba(23,26,33,.28)',
      labelSecondary: '#171A21',
      labelTertiary: 'rgba(23,26,33,.64)',
    })
    await emulateMedia(cdp, NO_PREF)

    /* — Console hygiene (known copied-session 404 is environment noise) — */
    phase = 'newui-console'
    const errors = consoleEvents.filter((e) => (e.type === 'error' || e.type === 'pageerror')
      && !ENV_CONSOLE_NOISE.some((rx) => rx.test(e.text)))
    const envNoise = consoleEvents.filter((e) => ENV_CONSOLE_NOISE.some((rx) => rx.test(e.text)))
    const themeWarnings = consoleEvents.filter((e) => e.type === 'warning' && /dsh-ios-skin/.test(e.text))
    verify('console-clean', 'all', 'the new UI boots with no theme-related console errors and no inert warning',
      errors.length === 0 && themeWarnings.length === 0,
      { errors: errors.slice(0, 10), themeWarnings, envNoise: envNoise.slice(0, 6), totalEvents: consoleEvents.length })

    record('newui-coverage', 'newui-light', 'new UI surface coverage on the signed-out profile', 'info',
      {
        groupCounts: light.groupCounts,
        hooks: Object.fromEntries(Object.entries(light.newUi || {}).map(([k, v]) => [k, v.countAll])),
        sessions: sessionTitle,
        dockkitFloat: 'no [data-dockkit-float] in the default layout; floating tab windows were not produced',
      }, 'low')

    phase = 'restore'
    try { await setPreference(page, 'system'); await closeNewUiOverlays(page) } catch (e) { console.log('restore preference failed:', e.message) }

    writeDomClasses(DOM_CLASSES_OUT, inventory, bottom)
    writeSummary({ shortUrl, screenshots, evidence })
  } catch (e) {
    console.error('\naudit automation error:', e)
    try {
      fs.writeFileSync(JSON_OUT, JSON.stringify({ ok: false, scenario: SCENARIO, automationError: String(e && e.stack || e), generatedAt: new Date().toISOString(), consoleEvents }, null, 2))
    } catch { /* nothing else to do */ }
    process.exitCode = 2
  } finally {
    await browser.close().catch(() => {})
  }
}

/* ── Main ───────────────────────────────────────────────────────────────── */

async function main() {
  if (SCENARIO === 'newui') return mainNewUi()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true })
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch({ channel: 'chrome', headless: !argv.headed })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' })
  const page = await context.newPage()
  const shortUrl = URL_ARG.replace(/token=[^&]+/, 'token=***')
  console.log(`dsh-ios-skin runtime audit — ${shortUrl}`)

  page.on('console', (m) => consoleEvents.push({ phase, type: m.type(), text: m.text().slice(0, 500) }))
  page.on('pageerror', (e) => consoleEvents.push({ phase, type: 'pageerror', text: String(e.message).slice(0, 500) }))

  const screenshots = []
  const evidence = {}

  // Audit the artifact the browser loads; flag source/profile drift instead of
  // silently deriving expectations from a source tree that is being edited.
  const sync = profileSyncInfo()
  evidence.profileSync = sync
  record('profile-sync', 'setup', 'the installed profile artifact matches src/client.js',
    sync.runtimeMatchesSrc ? 'pass' : 'warn',
    {
      ...sync,
      note: sync.sourceAhead
        ? 'src/client.js is ahead of the installed profile build. The audit is still valid for the artifact that is running, but rebuild + copy the profile before trusting the next run.'
        : undefined,
    }, 'low')

  try {
    phase = 'boot'
    await page.goto(URL_ARG, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForFunction(() => document.body && document.body.classList.contains('dsh-ios-skin'), null, { timeout: 45000 })
    await page.waitForTimeout(6000)
    await dismissOnboarding(page)
    await page.addScriptTag({ content: `(${auditLib.toString()})()` })

    const cdp = await context.newCDPSession(page)

    /* — Light — */
    phase = 'light'
    await setPreference(page, 'light')
    await closeOverlays(page)
    await page.waitForTimeout(700)
    const light = await page.evaluate(() => window.__A.state('light'))
    evidence.light = light
    screenshots.push(await screenshot(page, OUT_DIR, 'runtime-light.png'))

    checkPluginState(light, 'light')
    checkTokens(light, 'light')
    checkMaterial(light, 'light')

    // Overlays (real settings dialog + More menu) for the material layer report.
    phase = 'light-overlays'
    await openSettings(page)
    evidence.lightSettings = await page.evaluate(() => window.__A.state('light-settings-open'))
    screenshots.push(await screenshot(page, OUT_DIR, 'runtime-light-settings.png'))
    checkOverlayMaterial(evidence.lightSettings, 'light-settings')
    await closeOverlays(page)
    await openMoreMenu(page)
    evidence.lightMenu = await page.evaluate(() => window.__A.state('light-menu-open'))
    checkOverlayMaterial(evidence.lightMenu, 'light-menu')
    await closeOverlays(page)
    await page.waitForTimeout(500)

    // DOM class inventory while everything is themed and light.
    phase = 'light-inventory'
    const inventory = await page.evaluate(() => window.__A.inventory())
    evidence.inventory = inventory

    // Baseline: plugin off, official theme on.
    phase = 'baseline-light'
    const KEY_SELECTORS = [
      "[class*='_panelList']", "[class*='_panelRow']", "[class*='_composerSeat']", "[class*='_composerStack']",
      "[class*='_header']", "header", "[class*='_newSession']", "[class*='_iconButton']",
      "[class*='_searchInput']", "[class*='_centerCol']", "[class*='_listArea']", "[class*='_footerActions']",
    ]
    const baselineLight = await page.evaluate((sels) => window.__A.baseline(sels), KEY_SELECTORS)
    evidence.baselineLight = baselineLight
    checkBaseline(baselineLight, 'light', null)

    /* — Dark — */
    phase = 'dark'
    await setPreference(page, 'dark')
    await closeOverlays(page)
    await page.waitForTimeout(700)
    const dark = await page.evaluate(() => window.__A.state('dark'))
    evidence.dark = dark
    screenshots.push(await screenshot(page, OUT_DIR, 'runtime-dark.png'))

    checkPluginState(dark, 'dark')
    checkTokens(dark, 'dark')
    checkMaterial(dark, 'dark')

    phase = 'dark-overlays'
    await openSettings(page)
    evidence.darkSettings = await page.evaluate(() => window.__A.state('dark-settings-open'))
    screenshots.push(await screenshot(page, OUT_DIR, 'runtime-dark-settings.png'))
    checkOverlayMaterial(evidence.darkSettings, 'dark-settings')
    await closeOverlays(page)
    await page.waitForTimeout(400)

    phase = 'baseline-dark'
    const baselineDark = await page.evaluate((sels) => window.__A.baseline(sels), KEY_SELECTORS)
    evidence.baselineDark = baselineDark
    checkBaseline(baselineDark, 'dark', null)

    /* — Accessibility: reduced transparency (dark) — */
    phase = 'reduced-transparency'
    await emulateMedia(cdp, [{ name: 'prefers-reduced-transparency', value: 'reduce' }])
    await page.waitForTimeout(600)
    const reducedTransparency = await page.evaluate(() => window.__A.state('reduced-transparency'))
    evidence.reducedTransparency = reducedTransparency
    screenshots.push(await screenshot(page, OUT_DIR, 'runtime-dark-reduced-transparency.png'))
    checkA11y(reducedTransparency, 'reduced-transparency', {})

    /* — Accessibility: contrast more (light) — */
    phase = 'contrast-more'
    await emulateMedia(cdp, NO_PREF)
    await setPreference(page, 'light')
    await closeOverlays(page)
    await emulateMedia(cdp, [{ name: 'prefers-contrast', value: 'more' }])
    await page.waitForTimeout(600)
    const contrastMore = await page.evaluate(() => window.__A.state('contrast-more'))
    evidence.contrastMore = contrastMore
    screenshots.push(await screenshot(page, OUT_DIR, 'runtime-light-contrast-more.png'))
    checkA11y(contrastMore, 'contrast-more', {
      borderL1: 'rgba(23,26,33,.28)',
      labelSecondary: '#171A21',
      labelTertiary: 'rgba(23,26,33,.64)',
    })

    /* — Accessibility: reduced motion (light) — */
    phase = 'reduced-motion'
    await emulateMedia(cdp, [{ name: 'prefers-reduced-motion', value: 'reduce' }])
    await page.waitForTimeout(500)
    const reducedMotion = await page.evaluate(() => window.__A.state('reduced-motion'))
    evidence.reducedMotion = reducedMotion
    checkA11y(reducedMotion, 'reduced-motion', {})
    await emulateMedia(cdp, NO_PREF)

    /* — Console hygiene — */
    phase = 'console'
    const errors = consoleEvents.filter((e) => e.type === 'error' || e.type === 'pageerror')
    const themeWarnings = consoleEvents.filter((e) => e.type === 'warning' && /dsh-ios-skin/.test(e.text))
    verify('console-clean', 'all', 'the real GUI boots with no console errors and no inert-material warning',
      errors.length === 0 && themeWarnings.length === 0,
      { errors: errors.slice(0, 10), themeWarnings, totalEvents: consoleEvents.length })

    /* — Selector coverage summary (informational, not a hard gate) — */
    const coverage = light.groupCounts
    record('selector-coverage', 'light', 'material selector coverage on the signed-out GUI', 'info',
      { groupCounts: coverage, note: 'bars group has no element on this screen; exercised through the settings/menu overlays' },
      'low')

    /* — Restore the dev profile to the neutral appearance — */
    phase = 'restore'
    try { await setPreference(page, 'system'); await closeOverlays(page) } catch (e) { console.log('restore preference failed:', e.message) }

    /* — DOM class dump for the theme author — */
    writeDomClasses(DOM_CLASSES_OUT, inventory, light)

    /* — Write JSON + exit code — */
    writeSummary({ shortUrl, screenshots, evidence })
  } catch (e) {
    console.error('\naudit automation error:', e)
    try {
      fs.writeFileSync(JSON_OUT, JSON.stringify({ ok: false, automationError: String(e && e.stack || e), generatedAt: new Date().toISOString(), consoleEvents }, null, 2))
    } catch { /* nothing else to do */ }
    process.exitCode = 2
  } finally {
    await browser.close().catch(() => {})
  }
}

function consoleEventWarnings(events) {
  return events.filter((e) => e.type === 'warning').slice(0, 20)
}

main()
