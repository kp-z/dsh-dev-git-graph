import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const html = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
new vm.Script(script)
const start = script.indexOf('  function mountTaskMenu(')
const end = script.indexOf('\n  /* 工作区标签下拉', start)
const listeners = { document: new Map(), window: new Map() }
function events(name) { return { addEventListener(type, fn) { listeners[name].set(type, fn) }, removeEventListener(type, fn) { if (listeners[name].get(type) === fn) listeners[name].delete(type) } } }
let focused = false
const anchor = { isConnected: true, contains: n => n === anchor, getBoundingClientRect: () => ({ left: -10, top: 380, bottom: 400 }), focus() { focused = true } }
const child = {}
const menu = { style: {}, isConnected: true, offsetHeight: 320, offsetWidth: 220, contains: n => n === menu || n === child, remove() { this.isConnected = false }, querySelectorAll: () => [] }
const sandbox = { disposeTaskMenu: null, document: { ...events('document'), body: { appendChild() {} } }, window: { ...events('window'), innerHeight: 500, innerWidth: 320 } }
vm.createContext(sandbox)
vm.runInContext(script.slice(start, end), sandbox)
const close = sandbox.mountTaskMenu(menu, anchor)
assert.equal(menu.style.left, '8px')
assert.ok(parseInt(menu.style.top) >= 8)
listeners.document.get('scroll')({ target: child })
assert.equal(menu.isConnected, true, 'menu inner scrolling must not close it')
listeners.document.get('scroll')({ target: {} })
assert.equal(menu.isConnected, true, 'external scroll repositions visible anchor')
listeners.document.get('mousedown')({ target: child })
assert.equal(menu.isConnected, true)
listeners.document.get('keydown')({ key: 'Escape', preventDefault() {} })
assert.equal(menu.isConnected, false)
assert.equal(focused, true)
assert.equal(listeners.document.size, 0)
assert.equal(listeners.window.size, 0)
close(false)
assert.equal(sandbox.disposeTaskMenu, null)
assert.match(html, /\.prio-menu \.prio-item\s*\{\s*flex-shrink:\s*0/)
assert.match(html, /overscroll-behavior:\s*contain/)
assert.match(script, /document\.querySelector\('\.chip-pop'\) \|\| document\.querySelector\('\.prio-menu'\)/)
console.log('TASK_MENU_OK: internal scroll, external reposition, viewport clamp, Escape/focus, listener cleanup and stable menu anchors')
