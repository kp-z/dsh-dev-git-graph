#!/usr/bin/env node
/**
 * Builds docs/glass-3d-demo.html — a self-contained prototype of the round and
 * square glass solids, with real refraction and rigid-body motion.
 *
 * three.js is vendored under scripts/glass3d/vendor and inlined here, so the
 * page needs no network, no dev server and no import map (file:// blocks module
 * imports, and the preview opens as a local file).
 *
 * The bundled module is also written to scripts/glass3d/.build/app.mjs so it can
 * be syntax-checked without a browser.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const VENDOR_THREE = join(HERE, 'glass3d/vendor/three.module.js');
const MODULES = ['specs.mjs', 'geometry.mjs', 'physics.mjs'].map((name) => join(HERE, 'glass3d', name));
const SCENE = join(HERE, 'glass3d/scene.js');
const OUT_HTML = join(ROOT, 'docs/glass-3d-demo.html');
const OUT_BUNDLE = join(HERE, 'glass3d/.build/app.mjs');

/**
 * three.module.js ends with a single `export { ... };` statement. Inside an
 * inline module script the declarations are already in scope, so the export is
 * dropped — but only after proving there is exactly one.
 */
function stripTrailingExport(source) {
  const marker = '\nexport {';
  const last = source.lastIndexOf(marker);
  if (last < 0) throw new Error('three.module.js: no trailing export block');
  if (source.indexOf(marker) !== last) throw new Error('three.module.js: more than one export block');
  return source.slice(0, last);
}

const three = stripTrailingExport(readFileSync(VENDOR_THREE, 'utf8'));
// Our modules are real ESM; the page wants the same code without the keywords.
const modules = MODULES.map((path) => readFileSync(path, 'utf8').replace(/^export /gm, '')).join('\n');
const scene = readFileSync(SCENE, 'utf8');

const bundle = [
  '/* three.js r169 (MIT) — vendored, trailing export stripped */',
  three,
  /* three declares a lot of top-level names (including `contain`), and the
     physics module does too. An IIFE keeps our declarations out of three's
     scope while still reading its classes from the enclosing module. */
  '/* ── specs + geometry + physics + scene ──────────────────────────────── */',
  '(function () {',
  modules,
  scene,
  '})();',
].join('\n');

mkdirSync(dirname(OUT_BUNDLE), { recursive: true });
writeFileSync(OUT_BUNDLE, bundle);

const styles = `
  *{box-sizing:border-box}
  html,body{height:100%;margin:0}
  body{
    background:#04050a;color:#f2f2f7;overflow:hidden;
    font:13px/1.55 -apple-system,"SF Pro Text","Helvetica Neue","PingFang SC",sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  #glass3d{position:fixed;inset:0;display:block;width:100%;height:100%;z-index:0}
  /* The scrim is the honest knob: it buys legibility back by dimming the glass
     instead of pretending bright glass can sit under body text. */
  #scrim{position:fixed;inset:0;background:#04050a;opacity:.34;pointer-events:none;z-index:1;transition:opacity .2s}

  #ui{position:fixed;inset:0;z-index:2;display:grid;grid-template-rows:44px minmax(0,1fr) auto}
  .bar{display:flex;align-items:center;gap:10px;padding:0 16px;background:rgba(18,18,22,.45);
       -webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);
       border-bottom:1px solid rgba(235,235,245,.14)}
  .bar b{font-size:13px;font-weight:600}
  .chip{padding:3px 9px;border-radius:999px;background:rgba(118,118,128,.20);
        border:1px solid rgba(235,235,245,.14);font-size:11px;color:rgba(235,235,245,.72)}
  .spacer{flex:1}

  .col{overflow:auto;padding:22px 20px 8px}
  .inner{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
  .row{display:flex;gap:10px}
  .row.me{justify-content:flex-end}
  .av{width:26px;height:26px;border-radius:50%;flex:0 0 auto;background:rgba(118,118,128,.28);
      border:1px solid rgba(235,235,245,.18)}
  .bubble{padding:9px 13px;border-radius:14px;background:rgba(44,44,46,.55);
          border:1px solid rgba(235,235,245,.14);max-width:78%;
          -webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%)}
  .bubble.me{background:rgba(0,122,255,.88);border-color:rgba(0,122,255,.5);color:#fff}
  .block{border-radius:14px;background:rgba(28,28,30,.62);border:1px solid rgba(235,235,245,.14);
         -webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);
         overflow:hidden}
  .block h3{margin:0;padding:9px 13px;font-size:12px;font-weight:600;
            border-bottom:1px solid rgba(235,235,245,.12)}
  .block p{margin:0;padding:11px 13px}
  pre{margin:0;padding:12px 13px;font:12px/1.5 ui-monospace,"SF Mono",Menlo,monospace;
      color:#e8e8ee;background:rgba(10,10,12,.72);overflow:auto}
  .muted{color:rgba(235,235,245,.62)}
  .composer{padding:12px 20px 20px}
  .composer .box{max-width:720px;margin:0 auto;display:flex;gap:10px;align-items:center;
    padding:10px 12px;border-radius:14px;background:rgba(44,44,46,.55);
    border:1px solid rgba(235,235,245,.16);
    -webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%)}
  .composer .box span{flex:1;color:rgba(235,235,245,.5)}
  .send{width:28px;height:28px;border-radius:50%;background:#0a84ff;border:0;display:grid;place-items:center;color:#fff}

  #controls{position:fixed;right:14px;bottom:14px;z-index:3;width:250px;padding:12px;
    border-radius:14px;background:rgba(20,20,24,.72);border:1px solid rgba(235,235,245,.16);
    -webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);
    font-size:11.5px;color:rgba(235,235,245,.86)}
  #controls h4{margin:0 0 9px;font-size:11px;font-weight:600;letter-spacing:.02em;color:rgba(235,235,245,.6)}
  .ctl{display:grid;grid-template-columns:64px 1fr 34px;align-items:center;gap:8px;margin:7px 0}
  .ctl label{color:rgba(235,235,245,.66)}
  .ctl output{text-align:right;font-variant-numeric:tabular-nums;color:rgba(235,235,245,.9)}
  input[type=range]{width:100%;accent-color:#0a84ff}
  .btns{display:flex;gap:8px;margin-top:10px}
  button.ctl-btn{flex:1;padding:6px 8px;border-radius:9px;font-size:11.5px;cursor:pointer;
    background:rgba(118,118,128,.24);border:1px solid rgba(235,235,245,.18);color:#f2f2f7}
  button.ctl-btn:hover{background:rgba(118,118,128,.34)}
  #note{position:fixed;left:14px;bottom:14px;z-index:3;max-width:430px;padding:10px 12px;
    border-radius:14px;background:rgba(20,20,24,.72);border:1px solid rgba(235,235,245,.16);
    -webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);
    font-size:11.5px;color:rgba(235,235,245,.74)}
  #note b{color:#f2f2f7}
  #diag{position:fixed;left:0;top:0;z-index:9;margin:0;padding:10px 12px;max-width:100%;
    font:15px/1.45 ui-monospace,"SF Mono",Menlo,monospace;color:#5ef08a;background:rgba(0,0,0,.86);
    white-space:pre-wrap;pointer-events:none;display:none}
  /* Milestones stay hidden so they do not spoil a design review: open the page
     with #diag to read them, or they force themselves open on a real failure. */
  #diag.visible{display:block}
  @media (prefers-reduced-motion:reduce){#scrim{transition:none}}
`;

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>圆形与方形玻璃实体 — 原型</title>
<style>${styles}</style>
</head>
<body>
<canvas id="glass3d"></canvas>
<div id="scrim"></div>

<!-- Diagnostics are rendered into the page on purpose: the only way to inspect
     this build here is a headless screenshot, so the page has to say out loud
     what worked and what threw. -->
<div id="diag"></div>
<script>
  window.__diag = [];
  window.diag = function (message) {
    window.__diag.push(message);
    var panel = document.getElementById('diag');
    if (panel && location.hash === '#diag') {
      panel.classList.add('visible');
      panel.textContent = window.__diag.join('\\n');
    }
  };
  // A real failure must never be silent, so errors force the panel open.
  window.diagFail = function (message) {
    window.__diag.push(message);
    var panel = document.getElementById('diag');
    if (panel) {
      panel.classList.add('visible');
      panel.textContent = window.__diag.join('\\n');
    }
  };
  window.addEventListener('error', function (e) {
    window.diagFail('ERROR ' + e.message + ' @' + String(e.filename || '').split('/').pop() + ':' + e.lineno);
  });
  window.addEventListener('unhandledrejection', function (e) {
    window.diagFail('REJECT ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
  });
</script>

<div id="ui">
  <div class="bar">
    <b>玻璃实体背景 · 原型</b>
    <span class="chip">6 个刚体</span>
    <span class="chip">transmission 1.0</span>
    <span class="chip">ior 1.5</span>
    <span class="chip">dispersion 3.5</span>
  </div>
  <div class="col">
    <div class="inner">
      <div class="row"><div class="av"></div><div class="bubble">背景里能不能是真正的玻璃几何体，圆形和方形都有，而且要符合物理。</div></div>
      <div class="block">
        <h3>物理性质</h3>
        <p>零重力，六块玻璃作为刚体漂浮、翻滚、碰撞。动量守恒、接触不重叠、能量不增加、被偏心撞到会自旋——这些都有断言守着，不是看上去像而已。</p>
      </div>
      <div class="block">
        <h3>光学性质</h3>
        <p class="muted">折射率 1.5、透射 1.0、厚度 1.7，加上色散，所以背面那块四色底图会被分成彩边。圆形是球体，方形是挤出的圆角板。</p>
        <pre>MeshPhysicalMaterial({
  transmission: 1,
  ior: 1.5,
  thickness: 1.7,
  dispersion: 3.5,
});</pre>
      </div>
      <div class="row me"><div class="bubble me">这段正文就是用来判断可读性的。</div></div>
      <div class="row"><div class="av"></div><div class="bubble">如果文字压不住，就用右下角的遮罩滑杆压暗玻璃，而不是把玻璃做暗——先保住内容，再谈好看。</div></div>
      <div class="block">
        <h3>已知取舍</h3>
        <p>每个像素都要做一次透射采样，所以这比纯 CSS 的合成层贵得多：这是持续 GPU 负载，不只是一个动画。这页放的是 6 个实体和一张底图，真实界面叠上去之后需要实测帧率。</p>
      </div>
    </div>
  </div>
  <div class="composer"><div class="box"><span>给 DeepSeek 发消息</span><button class="send" aria-label="发送">↑</button></div></div>
</div>

<div id="controls">
  <h4>调参</h4>
  <div class="ctl"><label for="speed">速度</label><input id="speed" type="range" min="0.2" max="2.5" step="0.05" value="1"><output id="speed-value">1.00x</output></div>
  <div class="ctl"><label for="exposure">玻璃亮度</label><input id="exposure" type="range" min="0.35" max="1.8" step="0.05" value="1"><output id="exposure-value">1.00</output></div>
  <div class="ctl"><label for="scrim-range">遮罩</label><input id="scrim-range" type="range" min="0" max="0.75" step="0.01" value="0.18"><output id="scrim-value">0.18</output></div>
  <div class="btns"><button class="ctl-btn" id="toggle-pause" aria-pressed="false">暂停</button><button class="ctl-btn" id="toggle-ui" aria-pressed="true">隐藏界面</button></div>
</div>

<div id="note">
  <b>这是原型，不是成品。</b>目的是让你判断三件事：真玻璃实体是否够高级、物理运动是否自然、压上正文之后还能不能读。
  确认方向之后再决定怎么落地——独立插件、是否打包 three、以及帧率实测。
</div>

<script type="module">
${bundle}
</script>
</body>
</html>
`;

writeFileSync(OUT_HTML, html);

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
console.log(`  three.js 内联   : ${kb(Buffer.byteLength(three))}`);
console.log(`  specs+geo+phys+scene: ${kb(Buffer.byteLength(modules + scene))}`);
console.log(`  打包模块        : ${kb(Buffer.byteLength(bundle))}  -> scripts/glass3d/.build/app.mjs`);
console.log(`  生成页面        : ${kb(Buffer.byteLength(html))}  -> docs/glass-3d-demo.html`);
