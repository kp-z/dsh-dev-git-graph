/**
 * 资产路径安全边界测试（BACKLOG M1.6-7）。
 *
 * 这个洞的性质值得写在最前面：`models[].source.url` 原来走的是 `checkId()`，
 * 而 `checkId` 的语义只是"非空字符串"——所以**任意字符串都过**，
 * 包括 `http://evil.example/x.glb` 与 `../../../../etc/passwd`。
 *
 * 名字看起来对（都叫"校验一个字段"），保护却是零。所以这里的测试是逐条规则的，
 * 而不只测一个"坏输入被拒"。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ASSET_PATH_EXAMPLE, assetPathProblem } from '../lib/content/asset-path.js'
import { ContentRegistry, builtinPacks } from '../lib/content/index.js'

/** 造一个只提供 models 的最小包。 */
function packWithModel(url) {
  return {
    manifest: {
      id: 'pack.test-models',
      name: '测试模型包',
      version: '1.0.0',
      schemaVersion: 1,
      requires: [],
      provides: ['models'],
      overrides: [],
    },
    entries: {
      models: [
        {
          id: 'model.test.thing',
          name: '测试模型',
          source: { kind: 'glb', url, clipSource: false },
          scale: 1,
          rotationY: 0,
          anchorY: 0,
        },
      ],
    },
  }
}

// ── 逐条规则 ────────────────────────────────────────────────────────────────

test('路径：合法的包内相对路径通过', () => {
  for (const good of [
    'assets/characters/robot.glb',
    'a.glb',
    'assets/models/deep/nested/x.glb',
    'assets/audio/hit.wav',
  ]) {
    assert.equal(assetPathProblem(good), null, `${good} 应当合法`)
  }
})

test('路径：URL 协议一律拒绝（内容包不能把宿主变成下载器）', () => {
  for (const bad of ['http://evil.example/x.glb', 'https://x/y.glb', 'data:application/octet-stream;base64,AAA', 'file:///etc/passwd']) {
    const problem = assetPathProblem(bad)
    assert.ok(problem !== null, `${bad} 必须被拒`)
    assert.match(problem, /URL 协议|盘符/, '要说清是哪一类问题')
  }
})

test('路径：Windows 盘符按"绝对路径"处理（同一条规则覆盖）', () => {
  const problem = assetPathProblem('C:\\Users\\kp\\models\\x.glb')
  assert.ok(problem !== null)
  assert.match(problem, /URL 协议|盘符/)
})

test('路径：绝对路径、~、反斜杠、空字节都被拒', () => {
  assert.match(assetPathProblem('/etc/passwd') ?? '', /绝对路径/)
  assert.match(assetPathProblem('~/models/x.glb') ?? '', /"~"/)
  assert.match(assetPathProblem('assets\\x.glb') ?? '', /反斜杠/)
  assert.match(assetPathProblem('assets/\0x.glb') ?? '', /空字节/)
})

test('路径：".." 上跳被拒——这是"包内相对路径"这个假象下最危险的一种', () => {
  for (const bad of ['../x.glb', 'assets/../../etc/passwd', 'a/b/../../../c.glb']) {
    const problem = assetPathProblem(bad)
    assert.ok(problem !== null, `${bad} 必须被拒`)
    assert.match(problem, /"\.\." 上跳/)
  }
})

test('路径：空值、空路径段、没有扩展名都被拒', () => {
  assert.match(assetPathProblem('') ?? '', /非空字符串/)
  assert.match(assetPathProblem(null) ?? '', /非空字符串/)
  assert.match(assetPathProblem(42) ?? '', /非空字符串/)
  assert.match(assetPathProblem('assets//x.glb') ?? '', /空路径段/)
  assert.match(assetPathProblem('assets/x.glb/') ?? '', /空路径段/)
  assert.match(assetPathProblem('assets/x') ?? '', /扩展名/)
  assert.match(assetPathProblem('assets/.glb') ?? '', /扩展名/)
})

test('路径：报错要给**形状与例子**，不能只说"无效"', () => {
  const problem = assetPathProblem('http://evil/x.glb')
  assert.ok(problem !== null)
  assert.match(problem, /包内相对路径/, '要说清允许什么')
  assert.ok(problem.includes(ASSET_PATH_EXAMPLE), `要给出例子（${ASSET_PATH_EXAMPLE}）`)
})

// ── 走一遍真实校验器 ────────────────────────────────────────────────────────

test('校验器：模型的 GLB 地址不是包内相对路径 → error，且指出是哪个字段', () => {
  const registry = new ContentRegistry()
  const issues = registry.load(packWithModel('http://evil.example/x.glb'))
  const errors = issues.filter((i) => i.level === 'error')

  assert.equal(errors.length, 1, `应当正好一条错误：${JSON.stringify(issues)}`)
  assert.match(errors[0].where, /source\.url$/, '要指到字段上')
  assert.match(errors[0].message, /URL 协议|盘符/)
  assert.match(errors[0].message, /包内相对路径/)
})

test('校验器：合法的相对路径不报错（别把好内容也拦了）', () => {
  const registry = new ContentRegistry()
  const issues = registry.load(packWithModel('assets/characters/robot.glb'))
  assert.deepEqual(issues, [])
  assert.ok(registry.get('models', 'model.test.thing'), '条目应当真的装进去了')
})

test('校验器：音效地址走同一套规则', () => {
  const registry = new ContentRegistry()
  const issues = registry.load({
    manifest: {
      id: 'pack.test-sounds',
      name: '测试音效包',
      version: '1.0.0',
      schemaVersion: 1,
      requires: [],
      provides: ['sounds'],
      overrides: [],
    },
    entries: {
      sounds: [{ id: 'sound.test.hit', name: '打击', event: '', url: '../../secret.wav', volume: 1 }],
    },
  })

  const errors = issues.filter((i) => i.level === 'error')
  assert.equal(errors.length, 1)
  assert.match(errors[0].where, /url$/)
  assert.match(errors[0].message, /"\.\." 上跳/)
})

test('内置内容本身是干净的（这条规矩不该让默认包失败）', () => {
  const registry = new ContentRegistry()
  const issues = registry.loadAll(builtinPacks())
  assert.deepEqual(
    issues.filter((i) => i.where.includes('.url')),
    [],
    '内置包不应当有任何路径问题',
  )
})

test('路径校验不会误伤程序化构建器（procedural 没有 url 字段）', () => {
  const registry = new ContentRegistry()
  const issues = registry.load({
    manifest: {
      id: 'pack.test-proc',
      name: '程序化模型包',
      version: '1.0.0',
      schemaVersion: 1,
      requires: [],
      provides: ['models'],
      overrides: [],
    },
    entries: {
      models: [
        {
          id: 'model.test.proc',
          name: '程序化模型',
          source: { kind: 'procedural', builder: 'box' },
          scale: 1,
          rotationY: 0,
          anchorY: 0,
        },
      ],
    },
  })
  assert.deepEqual(issues, [], 'procedural 走 builder 分支，不该被路径规则碰到')
})
