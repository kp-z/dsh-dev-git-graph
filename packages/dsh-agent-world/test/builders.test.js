/**
 * 几何构建器注册表测试（BACKLOG M4-7）。
 *
 * ## 这条测试是"换模型只改内容"的**验证点**
 *
 * 内容里的 `models` 条目通过 `builder` 名指向一个构建器。只要那个名字在注册表里，
 * **加一个模型条目就完全不用改代码**。所以这里的关键断言是：
 *
 * > 内置内容里声明的**每一个** `builder` 名，注册表都得有。
 *
 * 少一个的表现是"画面上某个站点是个品红方块"——而那时你会去查渲染器代码，
 * 不会想到是内容引用了一个不存在的构建器。这条断言把它变成一个测试失败。
 *
 * ## 为什么能在 node 里测
 *
 * 构建器只需要几何与分组，**不需要 WebGL 上下文**。所以直接 import
 * `lib/vendor/three.module.min.js`（vendored 那份）就能建出真的 `Object3D` 来检查，
 * 而不是靠"看起来对"。注册表也因此接受注入的 `THREE`，不自己 import 裸说明符。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import * as THREE from '../lib/vendor/three/build/three.module.min.js'
import { createBuilderRegistry } from '../web/builders.js'
import { ContentRegistry, builtinPacks } from '../lib/content/index.js'

const registry = createBuilderRegistry(THREE)

/**
 * 内置内容里**声明过**的全部构建器名（去重）。
 *
 * **扫的是各个包自己的条目，不是合并后的注册表**。这一点是 R19 改对的：
 * `pack.kenney-mini` 把 `model.agent.base` 覆盖成了 GLB，于是合并后的注册表里
 * `avatar` 没人引用了——但 `avatar` **并没有变成死代码**：基础包仍声明它，
 * 而且它是"没装表现包 / GLB 加载失败"时唯一的角色形状。
 *
 * 用合并后的注册表来判"有没有人用"，等于让**一次合法的覆盖**把基础包的实现诬告成死代码。
 * 真正该死掉的是"哪个包都不再声明的实现"。
 */
function declaredBuilders() {
  const names = new Set()
  for (const pack of builtinPacks()) {
    for (const entry of pack.entries.models ?? []) {
      if (entry.source.kind === 'procedural') names.add(entry.source.builder)
    }
  }
  return [...names].sort()
}

test('内容里声明的每个构建器都已注册（少一个就是画面上一个品红方块）', () => {
  const declared = declaredBuilders()
  assert.ok(declared.length >= 5, `内置内容应当声明好几个构建器，实际 ${declared.length}`)

  const missing = declared.filter((name) => !registry.has(name))
  assert.deepEqual(
    missing,
    [],
    `内容里的这些 builder 没有实现，对应的模型会画成品红占位块：${missing.join(' / ')}。` +
      `已注册：${registry.names().join(' / ')}。` +
      `要么在 web/builders.js 里实现它，要么把内容改成用一个已有的构建器。`,
  )
})

test('注册表里没有多余的孤儿构建器（有实现在，内容却没人用）', () => {
  const declared = new Set(declaredBuilders())
  const orphans = registry.names().filter((name) => !declared.has(name))
  // 允许存在（第三方内容包可能用），但**必须知道**——内置内容用不到的实现
  // 多半是改内容时忘了同步，而它只会静静地留在那里。
  assert.deepEqual(orphans, [], `这些构建器没有任何内置模型引用：${orphans.join(' / ')}`)
})

test('每个构建器都真的造出东西：返回 Object3D，且包围盒非空', () => {
  for (const name of registry.names()) {
    const node = registry.build(name, { color: '#8899aa' })
    assert.ok(node !== null, `${name} 应当造得出`)
    assert.ok(node.isObject3D === true, `${name} 应当返回 Object3D`)

    const bounds = new THREE.Box3().setFromObject(node)
    const size = bounds.getSize(new THREE.Vector3())
    assert.ok(size.x > 0 && size.y > 0 && size.z > 0, `${name} 的包围盒不能有零边：${JSON.stringify(size)}`)
    // 原点应当**贴地**（y≈0）：构建器约定是"底面在 y=0"，缩放/摆放由调用方做。
    assert.ok(
      Math.abs(bounds.min.y) < 0.2,
      `${name} 的底面应当接近 y=0（构建器约定），实际 ${bounds.min.y.toFixed(3)}`,
    )
  }
})

test('颜色来自参数，不是构建器里写死的（否则"改内容换配色"就失效了）', () => {
  for (const name of registry.names()) {
    const a = registry.build(name, { color: '#ff0000' })
    const b = registry.build(name, { color: '#0000ff' })
    const colors = (node) => {
      const out = []
      node.traverse((child) => {
        if (child.isMesh === true && child.material?.color !== undefined) out.push(child.material.color.getHexString())
      })
      return out
    }
    const ca = colors(a)
    const cb = colors(b)
    assert.ok(ca.length > 0, `${name} 里应当至少有一个带颜色的 mesh`)
    assert.notDeepEqual(ca, cb, `${name} 换了颜色参数却造出一模一样的材质——说明色值写死在构建器里了`)
    assert.ok(ca.every((hex) => hex === 'ff0000'), `${name} 不该把传进来的颜色再改掉：${ca.join(',')}`)
  }
})

test('未知构建器返回 null（**不静默退回方块**）', () => {
  assert.equal(registry.build('没这个构建器', { color: '#fff' }), null)
  assert.equal(registry.has('没这个构建器'), false)
})

test('报错信息里能列出已注册的构建器（"未知构建器"四个字帮不了任何人）', () => {
  assert.ok(registry.names().length > 0)
  for (const name of registry.names()) assert.equal(typeof name, 'string')
  // 名字要稳定排序：报错文案与测试断言都依赖它。
  assert.deepEqual(registry.names(), [...registry.names()].sort())
})

test('同一个构建器可以造出多个独立实例（4 个工位共用 desk，改一个不影响另一个）', () => {
  const a = registry.build('desk', { color: '#111111' })
  const b = registry.build('desk', { color: '#222222' })
  assert.notEqual(a, b)
  a.position.set(9, 9, 9)
  assert.deepEqual([b.position.x, b.position.y, b.position.z], [0, 0, 0], '两个实例的位置必须互不影响')
})
