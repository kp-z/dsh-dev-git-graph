/**
 * 图版的演示文档。
 *
 * 每个条目生成一份独立的 demo.html，由页面里的
 * <iframe sandbox="allow-scripts"> 加载。iframe 没有 allow-same-origin，
 * 所以演示脚本身处不透明源，拿不到宿主 DOM。
 *
 * 舞台（stage）是必填的：玻璃、模糊、混合模式在白底上看不出效果，
 * 没有舞台就会出现「预览与描述不符」的条目 —— 不是代码错了，是舞台错了。
 */

import { escapeHtml, escapeScriptContent, escapeTemplateContent } from './text.mjs'
import { paramValues } from '../../shared/param.mjs'
import { langLabel } from '../../shared/prompt.mjs'

export const STAGES = {
  plain: { label: '无背景', note: '对照用：给不需要背景的条目' },
  photo: { label: '彩色背景', note: '让模糊、饱和、混合模式显形' },
  grid: { label: '细网格', note: '看对齐、位移、跟随' },
  dark: { label: '暗场', note: '看发光、阴影、半透明' },
}

const STAGE_CSS = `
[data-stage="plain"] .demo-backdrop {
  background: linear-gradient(160deg, #efe9dd 0%, #ddd4c3 100%);
}
[data-stage="photo"] .demo-backdrop {
  background:
    radial-gradient(55% 70% at 18% 22%, #ff9a5a 0%, transparent 62%),
    radial-gradient(45% 55% at 78% 26%, #7c5cff 0%, transparent 60%),
    radial-gradient(65% 65% at 62% 88%, #14b8a6 0%, transparent 66%),
    linear-gradient(140deg, #f43f5e 0%, #6366f1 100%);
}
[data-stage="grid"] .demo-backdrop {
  background-color: #ece5d8;
  background-image:
    linear-gradient(to right, rgb(60 48 30 / 0.1) 1px, transparent 1px),
    linear-gradient(to bottom, rgb(60 48 30 / 0.1) 1px, transparent 1px);
  background-size: 28px 28px;
  background-position: center;
}
[data-stage="dark"] .demo-backdrop {
  background: radial-gradient(60% 60% at 50% 38%, #2a2438 0%, #0a0810 72%);
}
`

const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #fff;
}
.demo-backdrop { position: fixed; inset: 0; z-index: 0; }
.demo-stage {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  padding: 32px;
  max-width: 100%;
}
[data-stage="plain"] body, [data-stage="grid"] body { color: #1b1710; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
`

const RUNTIME = `
(function () {
  var root = document.documentElement;
  var stage = document.getElementById('stage');
  var markup = document.getElementById('spellbook-markup');
  var script = document.getElementById('spellbook-script');
  var userScript = script ? script.textContent : '';

  function applyParams(values) {
    if (!values) return;
    Object.keys(values).forEach(function (key) {
      root.style.setProperty('--' + key, String(values[key]));
    });
  }

  function mount() {
    stage.replaceChildren(markup.content.cloneNode(true));
    if (userScript.trim()) {
      try {
        new Function('stage', userScript)(stage);
      } catch (error) {
        var note = document.createElement('pre');
        note.style.cssText = 'position:fixed;left:12px;bottom:12px;margin:0;padding:8px 10px;' +
          'font:12px/1.4 ui-monospace,monospace;background:rgb(0 0 0/.7);color:#ffb4b4;border-radius:6px;max-width:80vw;white-space:pre-wrap;z-index:9';
        note.textContent = '演示脚本出错：' + error.message;
        document.body.appendChild(note);
      }
    }
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'spellbook:params') applyParams(data.values);
    if (data.type === 'spellbook:replay') {
      stage.replaceChildren();
      requestAnimationFrame(mount);
    }
  });

  applyParams(window.__SPELLBOOK_DEFAULTS__ || {});
  mount();
})();
`

/**
 * 图版渲染不了的那一条：直说，不装作渲染了。
 *
 * 预览是沙箱 iframe，只跑得了网页三件套（HTML/CSS/JS）。一条咒语的示例若换了语言
 * —— React 组件、Vue 指令、SwiftUI、shader —— 这里就什么都拼不出来。
 *
 * 旧写法在这种条目上会**悄悄**给出一张空白图版：缩略图、放大预览全空，
 * 而构建、测试、站点一个都不报错。这个库的立论是「一条咒语 = 描述 + 示例代码」，
 * 预览渲染不了并不是错误，但装作渲染了是。
 *
 * 所以：给出这张说明卡，把语言名列清楚。真正的代码仍在正文里，抄咒语也照抄不误。
 */
function notWebDocument(entry, title, stage, langs) {
  const list = langs.map((lang) => escapeHtml(langLabel(lang))).join('、')
  return `<!doctype html>
<html lang="zh-CN" data-stage="${escapeHtml(stage)}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} · 图版</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 8px;
    padding: 18px;
    box-sizing: border-box;
    background: #17110f;
    font: 400 13px/1.6 system-ui, sans-serif;
    color: #cbbfae;
    text-align: center;
  }
  b { color: #d9a441; font-weight: 600; }
  small { color: #8a7f70; }
</style>
</head>
<body>
<b>这一条不是网页语言写的</b>
<span>示例用的是 ${list}，站内预览渲染不了。</span>
<small>代码在正文里，抄咒语照常。</small>
</body>
</html>
`
}

/**
 * @param {object} entry 已解析的条目
 * @param {string} title 无障碍标题
 * @returns {string} 完整的 demo.html
 */
export function buildDemoDocument(entry, title = entry.meta.title) {
  const stage = entry.meta.stage ?? 'plain'
  const html = entry.code.find((block) => block.lang === 'html')
  const css = entry.code.find((block) => block.lang === 'css')
  const js = entry.code.find((block) => block.lang === 'js')

  // 预览只跑得了网页三件套。没有这三样就说清楚，别给一张空白图版。
  if (!html && !css && !js) {
    return notWebDocument(entry, title, stage, entry.code.map((block) => block.lang))
  }

  // 默认值也要过一遍单位规则：range 参数补上 unit，否则 blur(18) 是无效 CSS
  const defaults = paramValues(entry.meta.params)

  const userMarkup = (html?.lines ?? []).join('\n')
  const userCss = (css?.lines ?? []).join('\n')
  const userJs = (js?.lines ?? []).join('\n')

  return `<!doctype html>
<html lang="zh-CN" data-stage="${escapeHtml(stage)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · 图版</title>
<style>${BASE_CSS}${STAGE_CSS}</style>
</head>
<body data-stage="${escapeHtml(stage)}">
<div class="demo-backdrop" aria-hidden="true"></div>
<div class="demo-stage" id="stage"></div>
<template id="spellbook-markup">${escapeTemplateContent(userMarkup)}</template>
<script type="text/plain" id="spellbook-script">${escapeScriptContent(userJs)}</script>
<style>${userCss}</style>
<script>window.__SPELLBOOK_DEFAULTS__ = ${JSON.stringify(defaults)};</script>
<script>${RUNTIME}</script>
</body>
</html>
`
}
