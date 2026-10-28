#!/usr/bin/env node
/**
 * Builds docs/ios-glass-demo.html — a single self-contained page that renders
 * the REAL dsh-ios-skin stylesheet over the REAL official DSH token layer.
 *
 * Nothing about the look is re-typed here: both stylesheets are extracted from
 * source at build time, so the demo cannot drift from what the plugin ships.
 *
 *   node scripts/build-glass-demo.mjs
 *
 * The official theme lives inside the installed app, so its path is probed;
 * override with DSH_THEME_CLIENT=/path/to/dsh-client-ui-theme/lib/client.js
 * (a path inside app.asar is not readable by plain Node — unpack it first).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'docs/ios-glass-demo.html');
const PKG_DIR = path.join(root, 'packages/dsh-ios-skin');

/**
 * Where the installed official theme may live. The app ships it inside
 * app.asar (`…/app.asar/dsh/node_modules/…`); plain fs cannot read that, so the
 * workspace copy unpacked for development is tried as well. DSH_THEME_CLIENT
 * may point at either the directory or lib/client.js.
 */
const THEME_SUFFIX = 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js';
const THEME_CANDIDATES = [
  process.env.DSH_THEME_CLIENT,
  path.join(root, '.tmp-ios-teams/official/dsh-client-ui-theme/lib/client.js'),
  `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/${THEME_SUFFIX}`,
  `/Applications/DeepSeek Harness.app/Contents/Resources/app/${THEME_SUFFIX}`,
  `/Applications/DSH Desktop.app/Contents/Resources/app/${THEME_SUFFIX}`,
  path.join(process.env.HOME ?? '', `.dsh/${THEME_SUFFIX}`),
  path.join(process.env.HOME ?? '', `.dsh/profiles/${THEME_SUFFIX}`),
].filter(Boolean);

/** Accept either the package directory or its lib/client.js. */
function themeClientFile(candidate) {
  try {
    if (fs.statSync(candidate).isDirectory()) return path.join(candidate, 'lib/client.js');
  } catch { /* not there; keep the path as given for the error message */ }
  return candidate;
}

const explicit = process.env.DSH_THEME_CLIENT;
const explicitPath = explicit ? themeClientFile(explicit) : null;
if (explicit && !fs.existsSync(explicitPath)) {
  console.error(`DSH_THEME_CLIENT is set but does not exist: ${explicitPath}`);
  process.exit(1);
}

// Profiles installed with `dsh plugin add` keep tree-external packages here.
const profileRoots = [
  path.join(process.env.HOME ?? '', '.dsh/profiles'),
  path.join(process.env.DSH_HOME ?? '', 'profiles'),
].filter((p) => p !== 'profiles');
for (const profiles of profileRoots) {
  try {
    for (const name of fs.readdirSync(profiles)) {
      THEME_CANDIDATES.push(path.join(profiles, name, THEME_SUFFIX));
    }
  } catch { /* no such profile root on this machine */ }
}

const themePath = explicitPath
  ?? THEME_CANDIDATES.map(themeClientFile).find((p) => fs.existsSync(p));
if (!themePath) {
  console.error('Could not find dsh-client-ui-theme/lib/client.js. Tried:');
  for (const p of THEME_CANDIDATES) console.error(`  - ${themeClientFile(p)}`);
  console.error('Set DSH_THEME_CLIENT=/path/to/dsh-client-ui-theme[/lib/client.js].');
  console.error('If the package is only inside app.asar, unpack it first, e.g.:');
  console.error('  npx @electron/asar extract "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar" .tmp-asar');
  console.error('  DSH_THEME_CLIENT=.tmp-asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme node scripts/build-glass-demo.mjs');
  process.exit(1);
}

/** Unescape a JS double-quoted string literal body. */
function unescapeJs(body) {
  try {
    return JSON.parse(`"${body}"`);
  } catch {
    return body.replace(/\\(["\\/bfnrt])/g, (_, c) =>
      ({ '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' })[c]);
  }
}

/* 1. official token layer, straight out of the shipped theme bundle --------- */
const themeSrc = fs.readFileSync(themePath, 'utf8');
const officialSheets = [...themeSrc.matchAll(/var\s+([a-z0-9_]+)_css_default\s*=\s*"((?:[^"\\]|\\.)*)"/g)]
  .map(([, name, body]) => ({ name, css: unescapeJs(body) }));
const official = officialSheets.map(({ name, css }) => `/* ${name} */\n${css}`).join('\n');
if (officialSheets.length < 5 || official.length < 10_000) {
  console.error(`Extracted only ${officialSheets.length} official stylesheet(s) from ${themePath}.`);
  console.error('The official theme bundle layout likely changed; update the extraction regex first.');
  process.exit(1);
}

/* 2. the plugin's real stylesheet, by running its client module -------------
   The demo passes a theme-service stub, so it exercises the same handover a
   real app performs when the theme plugin is present: the plugin gives its
   official tokens to the service and injects only the material rules. */
const clientSrc = fs.readFileSync(path.join(root, 'packages/dsh-ios-skin/src/client.js'), 'utf8');
const appended = [];
const documentStub = {
  getElementById: (id) => appended.find((e) => e.id === id) ?? null,
  createElement: () => ({ id: '', textContent: '', remove() {} }),
  head: { appendChild: (e) => appended.push(e) },
  querySelector: () => ({}),
  body: { classList: { add() {}, remove() {} } },
};
let mod = null;
let handover = null;
const windowStub = { __ModuleLoader__: { load: (def) => { mod = def.factory(); } } };
new Function('window', 'document', clientSrc)(windowStub, documentStub);
const themeStub = {
  overrideTokens(source, tokens) {
    handover = { source, tokens };
    return () => {};
  },
};
mod.apply({ effect: () => {}, theme: themeStub });
const skin = appended[0].textContent;

if (!handover) throw new Error('expected the plugin to hand its tokens to the theme service');
// Rebuild the two palette blocks from what the service was given, so the demo
// paints the tokens through the same path a real app would.
const pairNames = Object.keys(handover.tokens);
const paletteBlock = (mode) => 'body.dsh-ios-skin' + (mode === 'dark' ? '[data-ds-dark-theme]' : '') + '{\n'
  + pairNames.map((name) => `  ${name}:${handover.tokens[name][mode]};`).join('\n') + '\n}';
const handoverCss = `/* token layer, delivered through overrideTokens("${handover.source}") */\n`
  + paletteBlock('light') + '\n' + paletteBlock('dark');

/* 2b. numbers in the page copy come from source, never typed by hand -------- */
const rules = (skin.match(/\{/g) ?? []).length;
const tokens = pairNames.length;
// Rules that actually install a backdrop blur (the material layer).
const materialRules = (skin.match(/[^{}]+\{[^{}]*backdrop-filter:blur\([^{}]*\}/g) ?? []).length;
const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));
const contractTests = (
  fs.readFileSync(path.join(PKG_DIR, 'test/client-contract.test.js'), 'utf8').match(/^test\(/gm) ?? []
).length;
const themeVersion = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.dirname(themePath), '../package.json'), 'utf8')).version;
  } catch { return 'unknown'; }
})();

/* 3. the demo shell -------------------------------------------------------- */
const shell = `
/* demo shell — a DSH-shaped page that consumes only official tokens, so the
   theme's token layer is what makes it move. Every corner uses the theme's one
   radius token (with a fallback so the un-skinned view still looks normal). */
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;height:100%}
body{
  background:var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-primary);
  font-family:var(--dsw-font-family);
  font-size:14px;line-height:1.5;
  letter-spacing:-.011em;
  overflow:hidden;
  display:grid;grid-template-rows:30px minmax(0,1fr);
}
.note{display:flex;align-items:center;gap:8px;padding:0 12px;font-size:11.5px;border-radius:var(--dsh-ios-radius,14px);
  background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.note b{color:var(--dsw-alias-label-primary);font-weight:640}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{
  background:var(--dsh-scrollbar-thumb,rgba(0,0,0,.22));
  border-radius:var(--dsh-ios-radius,14px);border:2px solid transparent;background-clip:content-box;
}

.shell{display:grid;grid-template-columns:252px minmax(0,1fr) 296px;min-height:0}
.rail{border-right:1px solid var(--dsw-alias-border-l1);padding:14px 12px;display:flex;flex-direction:column;gap:6px;min-width:0;border-radius:var(--dsh-ios-radius,14px)}
.rail-right{border-right:0;border-left:1px solid var(--dsw-alias-border-l1)}
.brand{display:flex;align-items:center;gap:9px;padding:4px 8px 14px;font-weight:650;letter-spacing:-.02em}
.brand i{display:grid;place-items:center;width:26px;height:26px;border-radius:var(--dsh-ios-radius,14px);color:#fff;font-style:normal;font-size:13px;
  background:var(--dsw-alias-brand-primary)}
.rail .grp{padding:12px 8px 5px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.row{display:flex;align-items:center;gap:9px;width:100%;padding:7px 9px;border-radius:var(--dsh-ios-radius,14px);color:var(--dsw-alias-label-secondary);text-align:left}
.row:hover{background:var(--dsw-specific-sidebar-nav-item-hover)}
.row.on{background:var(--dsw-specific-sidebar-nav-item-active);color:var(--dsw-alias-label-primary)}
.row .dot{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.5;flex:0 0 auto}
.row .grow{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .meta{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.rail footer{margin-top:auto;padding:9px 10px;border-radius:var(--dsh-ios-radius,14px);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary)}

.main{display:grid;grid-template-rows:auto minmax(0,1fr) auto;min-width:0}
/* The main pane's header is part of the page plane: no card, no border, no
   radius — it is the same surface as the canvas behind it. */
.bar{display:flex;align-items:center;gap:10px;height:52px;padding:0 16px}
.bar h1{margin:0;font-size:14.5px;font-weight:640;letter-spacing:-.02em}
.bar .sub{margin-left:2px;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.bar .spacer{flex:1 1 auto}
.chip{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:var(--dsh-ios-radius,14px);font-size:11.5px;
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.ico{display:grid;place-items:center;width:29px;height:29px;border-radius:50%;color:var(--dsw-alias-label-secondary)}
.ico:hover{background:var(--dsw-alias-interactive-bg-hover)}

.scroll{padding:26px clamp(16px,4vw,64px) 8px;overflow:auto}
.flowItem{max-width:760px;margin:0 auto 20px}
.who{display:flex;align-items:center;gap:8px;margin-bottom:7px;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.av{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;font-size:10px;font-weight:700;color:#fff}
.av.u{background:#8e6bf0}
.av.a{background:var(--dsw-alias-brand-primary)}
.uRow{display:flex;justify-content:flex-end}
.uBubble{max-width:78%;padding:9px 13px;border-radius:var(--dsh-ios-radius,14px);
  background:var(--dsw-specific-bubble);border:.5px solid var(--dsw-alias-border-l1)}
.md p{margin:0 0 10px}
.md h2{margin:2px 0 9px;font-size:15px;letter-spacing:-.02em}
.md ul{margin:0 0 10px;padding-left:19px}
.md code{font-family:var(--ds-font-family-code);font-size:12.5px;padding:1.5px 5px;border-radius:var(--dsh-ios-radius,14px);background:var(--dsw-alias-markdown-inline-code)}
.md pre{margin:0 0 12px;padding:12px 13px;border-radius:var(--dsh-ios-radius,14px);background:var(--dsw-alias-markdown-code-block);
  border:1px solid var(--dsw-alias-border-l1);overflow:auto;font-family:var(--ds-font-family-code);font-size:12.5px;line-height:1.55}
.md pre .ban{margin:-12px -13px 10px;padding:6px 13px;font-size:11.5px;color:var(--dsw-alias-label-tertiary);
  background:var(--dsw-alias-markdown-code-block-banner);border-bottom:1px solid var(--dsw-alias-border-l1)}
.card{padding:12px 13px;border-radius:var(--dsh-ios-radius,14px);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}
.card h3{margin:0 0 5px;font-size:12.5px;font-weight:640}
.card .ln{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary);padding:3px 0}
.ok{color:var(--dsw-alias-state-success-primary)}

.dock{padding:10px clamp(16px,4vw,64px) 16px}
.dockInner{max-width:760px;margin:0 auto;display:flex;align-items:flex-end;gap:9px;padding:9px 10px 9px 14px;
  border-radius:var(--dsh-ios-radius,14px);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);
  box-shadow:var(--dsw-elevation-panel)}
.dockInner textarea{flex:1 1 auto;min-height:26px;max-height:120px;padding:3px 0;border:0;outline:0;resize:none;
  background:transparent;color:inherit;font:inherit}
.dockInner textarea::placeholder{color:var(--dsw-alias-label-tertiary)}
.send{display:grid;place-items:center;width:31px;height:31px;border-radius:50%;flex:0 0 auto;
  background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.hint{margin:7px auto 0;max-width:760px;font-size:11px;color:var(--dsw-alias-label-tertiary);display:flex;gap:10px}

.tabStrip{display:flex;gap:3px;padding:9px 10px 0}
.tab{padding:5px 10px;border-radius:var(--dsh-ios-radius,14px);font-size:12px;color:var(--dsw-alias-label-secondary)}
.tab.on{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}
/* new-UI demo: an Agent Teams popover (glass comes from [data-team-panel]; the
   roster inside stays flat, exactly like the real panel where member cards use
   token surfaces only). */
.teamPanel{position:fixed;right:330px;top:74px;z-index:120;width:320px;padding:10px 12px 12px;
  border-radius:var(--dsh-ios-radius,14px)}
.tpHead{display:flex;align-items:center;gap:8px;padding:2px 2px 9px;font-size:12.5px;font-weight:640}
.tpCount{color:var(--dsw-alias-label-tertiary);font-size:11.5px;font-weight:500}
.roster{display:grid;gap:6px}
.member{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:calc(var(--dsh-ios-radius,14px) - 4px);
  background:var(--dsw-alias-bg-layer-2)}
.mdot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary);flex:0 0 auto}
.mname{font-size:12px;font-weight:600}
.mmodel{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.tpTask{display:flex;align-items:center;gap:7px;margin-top:9px;padding:7px 8px;font-size:11.5px;color:var(--dsw-alias-label-secondary);
  border-radius:calc(var(--dsh-ios-radius,14px) - 4px);background:var(--dsw-alias-bg-layer-1)}
.tpState{margin-left:auto;color:var(--dsw-alias-state-warn-primary)}
@media(max-width:1120px){.teamPanel{right:18px;top:66px}}
.panelBody{padding:12px;display:flex;flex-direction:column;gap:10px;min-height:0;overflow:auto}
.kv{font-size:12px;color:var(--dsw-alias-label-secondary)}
.kv b{color:var(--dsw-alias-label-primary);font-weight:620}

/* overlays, rendered open so the glass is visible */
.menu{position:fixed;left:262px;top:190px;width:216px;padding:6px;border-radius:var(--dsh-ios-radius,14px);z-index:70;
  background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-elevation-prominent)}
.menu button{display:flex;width:100%;gap:9px;align-items:center;padding:7px 9px;border-radius:var(--dsh-ios-radius,14px);font-size:12.5px;text-align:left}
.menu button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.menu hr{margin:5px 6px;border:0;border-top:1px solid var(--dsw-alias-border-l1)}
.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:1100;display:flex;align-items:center;gap:9px;
  padding:9px 14px;border-radius:var(--dsh-ios-radius,14px);font-size:12.5px;
  background:var(--dsw-alias-toast-bg);border:1px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent)}
/* Floating window, deliberately without a scrim: a full-screen mask would
   frost over the very UI this page exists to show. */
.dialog{position:fixed;left:18px;bottom:18px;z-index:200;width:min(350px,calc(100vw - 36px));padding:18px;border-radius:var(--dsh-ios-radius,14px);
  background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-elevation-prominent)}
.dialog h2{margin:0 0 6px;font-size:15px}
.dialog p{margin:0 0 14px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.dialog .acts{display:flex;justify-content:flex-end;gap:8px}
.btn{padding:6px 13px;border-radius:var(--dsh-ios-radius,14px);font-size:12.5px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.btn.pri{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}

/* preview controls (theme-agnostic, so they stay usable with the skin off) */
.controls{position:fixed;right:18px;bottom:18px;z-index:2000;display:flex;gap:6px;align-items:center;
  padding:7px;border-radius:var(--dsh-ios-radius,14px);background:var(--dsw-alias-bg-layer-3,#1c1c1e);color:var(--dsw-alias-label-primary,#fff);font-size:12px;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.2));box-shadow:var(--dsw-elevation-prominent,0 10px 30px rgba(0,0,0,.28))}
.controls button{padding:5px 11px;border-radius:var(--dsh-ios-radius,14px);color:inherit;opacity:.6}
.controls button.on{background:var(--dsw-alias-interactive-bg-hover,rgba(120,120,128,.24));opacity:1}
.controls .sep{width:1px;height:16px;background:var(--dsw-alias-border-l2,rgba(120,120,128,.4))}
.controls .flag{margin-left:22px;opacity:.6;font-size:11px}
@media(max-width:1120px){.shell{grid-template-columns:252px minmax(0,1fr)}.rail-right{display:none}}
@media(max-width:800px){.shell{grid-template-columns:minmax(0,1fr)}.rail-left{display:none}.menu{left:16px}}
`;

const dom = `
<div class="note">
  <b>真样式表预览</b>
  <span>官方 token 层与 dsh-ios-skin 都是构建时从源码抽取，不是重画的仿制品。</span>
  <span>· 右下角 <b>主题：开/关</b> 对比同一页面在插件前后的差异。</span>
  <span>· 新 UI：右侧 <b>Agent Teams</b> 浮层带 <code>data-team-panel</code>，右栏标签条带 <code>data-dockkit-strip</code>，主 pane 带 <code>data-dockkit-pane-active</code> 以展示激活光带。</span>
</div>
<div class="shell">
  <div class="rail rail-left _panelList_pl1_2">
    <div class="brand"><i>D</i> DeepSeek Harness</div>
    <button class="row on"><span class="dot"></span><span class="grow">新会话</span></button>
    <button class="row"><span class="dot"></span><span class="grow">知识节点</span></button>
    <button class="row"><span class="dot"></span><span class="grow">任务看板</span></button>
    <div class="grp">今天</div>
    <button class="row on"><span class="grow">玻璃主题 token 重调</span></button>
    <button class="row"><span class="grow">git-graph 右侧栏入驻</span><span class="meta">12:41</span></button>
    <button class="row"><span class="grow">mermaid 语法校验</span><span class="meta">11:07</span></button>
    <div class="grp">昨天</div>
    <button class="row"><span class="grow">taskboard 计划模式</span></button>
    <footer>Agent 模式 · 工作区 /Users/kp/DEV/dsh-plugins</footer>
  </div>

  <div class="main" data-dockkit-pane-active="">
    <header class="bar _header_hd1_3">
      <h1>玻璃主题 token 重调</h1>
      <span class="sub">dsh-plugins</span>
      <span class="spacer"></span>
      <span class="chip">deepseek-v4-flash-tencent</span>
      <button class="ico">◐</button>
      <button class="ico">⋯</button>
    </header>

    <div class="scroll _scrollBody_sb1_4">
      <div class="flowItem uRow _userRow_ur1_5">
        <div class="_userStack_us1_6">
          <div class="who" style="justify-content:flex-end">你 · 14:02</div>
          <div class="uBubble xIFHsG_bubble">把 dsh-ios-skin 做成全面液态玻璃，别只改几个按钮。</div>
        </div>
      </div>

      <div class="flowItem">
        <div class="who"><span class="av a">D</span> DeepSeek · 14:03</div>
        <div class="md">
          <p>主题改成两层：<b>token 层</b>重调官方 <code>--dsw-*</code>，<b>材质层</b>给框架表面加真玻璃。</p>
          <pre class="xIFHsG_code"><span class="ban">bash</span>pnpm --filter dsh-ios-skin test   <span class="ok"># ${contractTests} passed</span>
pnpm --filter dsh-ios-skin build  <span class="ok"># ok</span></pre>
          <ul>
            <li>Token 层：${tokens} 个官方 token，全应用一起变</li>
            <li>材质层：${materialRules} 条 <code>backdrop-filter</code> 玻璃规则</li>
            <li>无障碍：降低透明度 / 无 blur 支持 → 三个材质 token 翻成不透明</li>
          </ul>
        </div>
      </div>

      <div class="flowItem">
        <div class="card _card_cd1_7">
          <h3>v0.2.2 · 新 UI 材质分组</h3>
          <div class="ln"><span>dockkit 标签条 / 浮动标签页 → data-dockkit-strip / float</span><span class="ok">thin / regular</span></div>
          <div class="ln"><span>Agent Teams 面板 → role=dialog + data-team-panel</span><span class="ok">regular</span></div>
          <div class="ln"><span>better-sidebar 子树退出泛类名匹配，保留自己的 token 表面</span><span class="ok">excluded</span></div>
        </div>
      </div>
    </div>

    <div class="dock _composerSeat_cp1_8">
      <div class="dockInner _composerStack_cp2_9">
        <textarea rows="1" placeholder="输入消息，或用 / 呼出命令……"></textarea>
        <button class="send">↑</button>
      </div>
      <div class="hint"><span>Enter 发送 · Shift+Enter 换行</span><span>·</span><span>权限：workspace-write</span></div>
    </div>
  </div>

  <aside class="rail rail-right">
    <div class="tabStrip _tabStrip_ts1_10" role="tablist" data-dockkit-strip="">
      <div class="tab on" role="tab" aria-selected="true">Git 树</div><div class="tab" role="tab">轨迹</div><div class="tab" role="tab">文件</div>
    </div>
    <div class="panelBody _panelBody_pb1_11">
      <div class="card">
        <h3>工作区状态</h3>
        <div class="ln"><span>dsh-ios-skin v${pkg.version}</span><span class="ok">已构建</span></div>
        <div class="ln"><span>未提交改动</span><span>5 个文件</span></div>
        <div class="ln"><span>市场索引</span><span>2 个已上架</span></div>
      </div>
      <div class="kv">右侧栏本身也是玻璃：它由 <b>[class*='_panelBody']</b> 和语义 <b>aside</b> 双重命中。</div>
    </div>
  </aside>
</div>

<div class="menu _menu_mn1_12" role="menu">
  <button role="menuitem"><span style="width:16px">◍</span> 复制</button>
  <button role="menuitem"><span style="width:16px">↻</span> 重新生成</button>
  <hr>
  <button role="menuitem"><span style="width:16px">⌫</span> 删除这一轮</button>
</div>

<div class="teamPanel" role="dialog" data-team-panel="" aria-label="Agent Teams">
  <div class="tpHead"><span class="tpTitle">Agent Teams</span><span class="tpCount">3 名成员</span></div>
  <div class="roster">
    <div class="member"><span class="mdot"></span><span class="mname">lead</span><span class="mmodel">v4-flash · captain</span></div>
    <div class="member"><span class="mdot"></span><span class="mname">theme-dev</span><span class="mmodel">v4-flash · working</span></div>
    <div class="member"><span class="mdot"></span><span class="mname">verifier</span><span class="mmodel">v4-flash · running</span></div>
  </div>
  <div class="tpTask"><span class="ok">●</span> v0.2.2 新 UI 适配 <span class="tpState">in_progress</span></div>
</div>

<div class="dialog _dialog_dg1_13" role="dialog">
  <h2>启用液态玻璃</h2>
  <p>会重调 ${tokens} 个官方设计 token，并给栏、面板、浮层加磨砂材质。结构、布局与交互完全不动。</p>
  <div class="acts"><button class="btn">稍后</button><button class="btn pri">启用</button></div>
</div>

<div class="toast _toast_t1_14" role="status"><span class="ok">●</span> 主题已应用 · ${contractTests} 个契约测试通过</div>

<div class="controls">
  <button id="t-skin" class="on">主题：开</button>
  <span class="sep"></span>
  <button id="t-light" class="on">浅色</button>
  <button id="t-dark">深色</button>
  <span class="flag">类名故意混用两套格式 / 语义 / ARIA</span>
</div>

<script>
  var body = document.body;
  var skin = document.getElementById('t-skin');
  var light = document.getElementById('t-light');
  var dark = document.getElementById('t-dark');

  function setSkin(on) {
    body.classList.toggle('dsh-ios-skin', on);
    skin.classList.toggle('on', on);
    skin.textContent = '主题：' + (on ? '开' : '关');
  }
  function setTheme(mode) {
    if (mode === 'dark') body.setAttribute('data-ds-dark-theme', '');
    else body.removeAttribute('data-ds-dark-theme');
    light.classList.toggle('on', mode === 'light');
    dark.classList.toggle('on', mode === 'dark');
  }
  skin.addEventListener('click', function () { setSkin(!body.classList.contains('dsh-ios-skin')); });
  light.addEventListener('click', function () { setTheme('light'); });
  dark.addEventListener('click', function () { setTheme('dark'); });
</script>
`;

const html = `<!doctype html>
<!-- generated by scripts/build-glass-demo.mjs; do not edit by hand.
     sources: packages/dsh-ios-skin/src/client.js (v${pkg.version})
              @deepseek-ai/dsh-client-ui-theme v${themeVersion}
              official sheets: ${officialSheets.map((s) => s.name).join(', ')} -->
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh-ios-skin · Deep Fusion 液态玻璃样例</title>
<style>${official}</style>
<style>${handoverCss}</style>
<style>${skin}</style>
<style>${shell}</style>
</head>
<body class="dsh-ios-skin">
${dom}
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`wrote ${path.relative(root, OUT)}`);
console.log(`  official theme       : v${themeVersion} from ${themePath}`);
console.log(`  official token layer : ${official.length} bytes (${officialSheets.length} sheets)`);
console.log(`  token handover      : ${handoverCss.length} bytes, ${tokens} tokens via overrideTokens("${handover.source}")`);
console.log(`  dsh-ios-skin v${pkg.version}  : ${skin.length} bytes, ${rules} rules, ${materialRules} glass rules`);
console.log(`  contract tests       : ${contractTests}`);
console.log(`  total                : ${html.length} bytes`);
