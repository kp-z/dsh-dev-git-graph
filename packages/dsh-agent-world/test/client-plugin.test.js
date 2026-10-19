/**
 * DSH Client half 的**漂移守卫**（R161）。
 *
 * 这一轮把 Agent World 从"Host 吐的独立页面"变成"DSH 侧边栏里的主面板"：
 *   · `package.json` 必须有 `dsh.client` 与 `./client` 导出；
 *   · `src/client.js` 注册 `sidebar.panellist`（id）与 `main`（同 key），
 *     并且**不许出现 iframe**（Host UI 规范：iframe 拿不到主题/语言）；
 *   · 页面本身走 `web/embed.js` 的 `@scope` 容器挂载 + `web/main.js` 的 `mountAgentWorld`；
 *   · Phaser 不能再依赖独立页面的 import map（裸 `from 'phaser'` 在宿主页会解析失败）。
 *
 * 只读源码/清单，不启动浏览器；真机路径由 `dsh --profile awtest` 的页面验收。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

test('package.json：有 dsh.client、./client 导出，构建会产出 lib/client.js', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.dsh?.client?.platform, 'web')
  assert.ok(Array.isArray(pkg.dsh.client.inject) && pkg.dsh.client.inject.includes('slots'))
  assert.equal(pkg.exports?.['./client']?.default, './lib/client.js')
  assert.match(pkg.scripts.build, /cp src\/client\.js lib\/client\.js/)
  assert.ok(existsSync(join(ROOT, 'src/client.js')), 'src/client.js 不存在')
  assert.ok(existsSync(join(ROOT, 'lib/client.js')), 'lib/client.js 不存在（构建没拷？）')
})

test('client.js：注册 sidebar.panellist 的 id 与 main 的 key 是同一个口径', () => {
  const src = read('src/client.js')
  const inPanelList = /ctx\.slots\.inject\(\s*['"]sidebar\.panellist['"]/.test(src)
  const inMain = /ctx\.slots\.inject\(\s*['"]main['"]/.test(src)
  assert.ok(inPanelList, '没有注册 sidebar.panellist')
  assert.ok(inMain, '没有注册 main')
  assert.match(src, /name:\s*['"]sidebar\.panellist['"]\s*,\s*id:\s*PANEL_KEY/, 'panellist 的 id 必须用 PANEL_KEY')
  assert.match(src, /name:\s*['"]main['"]\s*,\s*key:\s*PANEL_KEY/, 'main 的 key 必须用 PANEL_KEY（与侧边栏 id 同口径）')
})

test('不把 Host 页面塞 iframe（会把宿主主题/语言切断）', () => {
  for (const rel of ['src/client.js', 'web/embed.js']) {
    assert.equal(/<iframe|createElement\(\s*['"]iframe['"]/.test(read(rel)), false, `${rel} 里真的创建了 iframe`)
  }
})

test('embed.js 用 @scope 隔离样式，并走 mountAgentWorld 而不是第二份装配', () => {
  const src = read('web/embed.js')
  assert.match(src, /@scope \(#\$\{rootId\}\)/, '样式必须 @scope 在容器内')
  assert.ok(src.includes(':root\\s*\\{'), 'tokens 必须从 :root 改写到容器上（否则变量不继承）')
  assert.match(src, /mountAgentWorld\(\s*\{\s*root:\s*container/, '必须复用 mountAgentWorld')
})

test('main.js：导出 mountAgentWorld，且自动挂载只在独立页面发生', () => {
  const src = read('web/main.js')
  assert.match(src, /export function mountAgentWorld\(/, '没有导出 mountAgentWorld')
  assert.match(src, /__AGENT_WORLD_EMBEDDED__/, '没有嵌入模式开关（会自动跟独立页抢挂载）')
  assert.match(src, /getElementById\(['"]town['"]\)/, '自动挂载应当以 #town 是否存在为判据')
})

test('Phaser 不再用裸说明符（宿主页面没有 import map）', () => {
  const src = read('web/scene/scene-phaser.js')
  assert.equal(/^\s*import[^\n]*from\s+['"]phaser['"]/m.test(src), false, 'scene-phaser 还在 from \'phaser\'')
  assert.match(src, /import\(new URL\(['"]\.\.\/vendor\/phaser\//, 'Phaser 必须用 import.meta.url 拼绝对 URL')
})


test('R162：header 里的世界会话名（端点 + 页面接线）', () => {
  const api = read('src/routes/api.ts')
  assert.match(api, /pattern:\s*['"]\/api\/session['"]/, '缺少 /api/session 端点')
  assert.match(read('src/index.ts'), /worldSession\s*:/, 'Host 没有提供 worldSession')
  assert.match(read('web/index.html'), /id="brand-session"/, 'header 里没有会话名的位置')
  assert.match(read('web/main.js'), /apiUrl\('api\/session'\)/, '页面没有取会话信息')
  assert.match(read('web/main.js'), /brandSession\.textContent = `会话 · \$\{label\}`/, '页面没有把会话名写进 header')
  assert.equal(read('web/embed.js').includes("querySelector('.topbar')?.remove()"), false, '嵌入时不能把 header 去掉')
})
