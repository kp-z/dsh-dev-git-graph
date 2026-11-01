/**
 * 面板「悬停头像显示姓名」回归：
 *   - .avatar-tip 气泡的 CSS、data-tip 渲染点、启动接线都在；
 *   - 悬停/聚焦显示姓名，移出隐藏；没有 data-tip 的头像不弹；
 *   - 事件委托只接一次（重复调用 wireAvatarTips 不叠加监听）。
 *
 * 跑法：node test/avatarTip.mjs
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const html = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')

/* 1. 样式与渲染点：原生 title 让位给 data-tip 气泡。 */
assert.match(html, /\.avatar-tip\s*\{/, '气泡样式存在')
assert.match(html, /\.avatar-tip\[data-show="1"\]/, '气泡显示态样式存在')
assert.match(html, /'data-tip': who \|\| label/, '负责人/关注人头像带 data-tip')
assert.match(html, /'data-tip': label \+ '：' \+ list\.slice\(shown\.length\)/, '+N 头像带完整名单')
assert.match(html, /avatar\.setAttribute\('data-tip', role \? authorName \+ ' · ' \+ role : authorName\)/, '评论头像带作者名+角色')
assert.match(script, /\n  wireAvatarTips\(\);/, '启动时接线气泡')
assert.doesNotMatch(html, /title: label \+ '：' \+ who/, '头像不再用原生 title 造成双重提示')

/* 2. 行为：抽出气泡相关声明，用假 DOM 跑一遍。 */
const start = script.indexOf('  /* ---------------- 头像悬停姓名')
const end = script.indexOf('  function showSaved', start)
assert.ok(start >= 0 && end > start, '找到头像气泡声明区')
const declarations = script.slice(start, end)

function makeNode(tag) {
  return {
    tag,
    children: [],
    attrs: {},
    style: {},
    isConnected: false,
    textContent: '',
    offsetWidth: 0,
    offsetHeight: 0,
    appendChild(child) { this.children.push(child); child.parentNode = this; return child },
    setAttribute(k, v) { this.attrs[k] = String(v) },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null },
    removeAttribute(k) { delete this.attrs[k] },
    contains(child) { return child === this ? true : this.children.some((item) => item.contains?.(child)) },
  }
}

const listeners = new Map()
const body = makeNode('body')
const fakeDocument = {
  body,
  hidden: false,
  createElement: (tag) => makeNode(tag),
  addEventListener(type, fn) {
    if (!listeners.has(type)) listeners.set(type, [])
    listeners.get(type).push(fn)
  },
}
const fakeWindow = {
  innerWidth: 800,
  addEventListener(type, fn) {
    if (!listeners.has(type)) listeners.set(type, [])
    listeners.get(type).push(fn)
  },
}
const el = (tag, attrs = {}) => {
  const node = makeNode(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = String(value)
    else node.setAttribute(key, value)
  }
  return node
}
body.appendChild = function appendChild(child) { this.children.push(child); child.isConnected = true; child.parentNode = this; return child }

const api = new Function(
  'el',
  'document',
  'window',
  `${declarations}\nreturn { showAvatarTip, hideAvatarTip, avatarTipEl, placeAvatarTip, avatarTipTargetOf, wireAvatarTips }`,
)(el, fakeDocument, fakeWindow)

const avatar = makeNode('span')
avatar.setAttribute('data-tip', '张匡浦')
avatar.setAttribute('aria-label', '负责人：张匡浦')
avatar.getBoundingClientRect = () => ({ left: 100, top: 100, right: 116, bottom: 116, width: 16, height: 16 })

api.showAvatarTip(avatar)
const tip = api.avatarTipEl()
assert.equal(tip.textContent, '张匡浦', '提示文本=姓名')
assert.equal(tip.getAttribute('data-show'), '1', '显示态')
assert.equal(tip.getAttribute('aria-hidden'), 'false', '屏幕阅读器可见')
assert.match(tip.style.left, /^\d+px$/, '水平定位')
assert.match(tip.style.top, /^\d+px$/, '垂直定位')

api.hideAvatarTip()
assert.equal(tip.getAttribute('data-show'), null, '移出后隐藏')
assert.equal(tip.getAttribute('aria-hidden'), 'true')

const anonymous = makeNode('span')
api.showAvatarTip(anonymous)
assert.equal(tip.getAttribute('data-show'), null, '没有 data-tip 的头像不弹气泡')

/* 3. 事件委托：只接一次。 */
api.wireAvatarTips()
api.wireAvatarTips()
assert.equal(listeners.get('pointerover')?.length, 1, 'pointerover 只接一次')
assert.equal(listeners.get('pointerout')?.length, 1, 'pointerout 只接一次')
assert.equal(listeners.get('focusin')?.length, 1, 'focusin 只接一次')
assert.equal(listeners.get('scroll')?.length, 1, 'scroll 只接一次')

/* 悬停进子元素（img）也能冒泡到带 data-tip 的头像。 */
const img = makeNode('img')
avatar.appendChild(img)
assert.equal(api.avatarTipTargetOf({ target: img }), avatar, '子元素命中父头像')
assert.equal(api.avatarTipTargetOf({ target: makeNode('div') }), null, '普通元素不命中')

console.log('AVATAR_TIP_OK')
