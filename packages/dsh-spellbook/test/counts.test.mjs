/**
 * 「多少条」这个数字，不许各处各说各话。
 *
 * ## 为什么值得单独钉一条
 * 这个库的立论是**只有一个真相**：条数在站点上是算出来的，在 `search-index.json` 里是写着的，
 * 在 README 与 `package.json` 的描述里是**人写死的**。前两处永远不会错，后两处会 ——
 * 而且错得没有任何声音：
 *
 * - `package.json` 的 `description` 是**给用户看的**（npm 页、插件市场的卡片）。
 *   加了几条咒语却忘了改它，它就开始安静地说谎。
 * - README 也一样。
 *
 * 这不是假想的风险：这个仓库已经因为「两处各算各的」栽过几次（列名与 `BM25_WEIGHTS` 对不上、
 * 站点与库的 Top-1 不一致），所以这里照同样的办法处理 —— **让它一错就红**，
 * 并且红的时候直接告诉你该把哪一句改成什么。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 真数：目录里有几份 md，就是几条。别的地方都得跟它对齐。 */
function realCount() {
  return readdirSync(path.join(ROOT, 'content', 'effects')).filter((n) => n.endsWith('.md')).length
}

test('条数：package.json 的描述与 README 散文都得跟目录对得上', () => {
  const actual = realCount()
  assert.ok(actual > 0, '一条都没读到 —— 路径或扫描方式可能变了')

  const wrong = []

  // 一、package.json 描述里那句「（N 条，…）」
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const inPkg = /（(\d+)\s*条/.exec(pkg.description ?? '')
  if (!inPkg) {
    wrong.push('package.json 的描述里找不到「（N 条」这个数字 —— 描述是不是被重写了？')
  } else if (Number(inPkg[1]) !== actual) {
    wrong.push(`package.json 描述写的是 ${inPkg[1]} 条，实际 ${actual} 条`)
  }

  // 二、README 里每一处「N 条咒语」
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8')
  const found = [...readme.matchAll(/(\d+)\s*条咒语/g)]
  assert.ok(found.length > 0, 'README 里一处「N 条咒语」都没有？那条线可能被删了')
  for (const m of found) {
    if (Number(m[1]) !== actual) {
      wrong.push(`README 里有一处写的是 ${m[1]} 条咒语，实际 ${actual} 条`)
    }
  }

  assert.deepEqual(
    wrong,
    [],
    `有 ${wrong.length} 处的条数与实际不符（实际 ${actual} 条）：\n  ${wrong.join('\n  ')}\n` +
      `改法：把那些数字改成 ${actual}。站点与索引是算出来的，不用动。`,
  )
})

test('条数：构建产物里的 count 与 docs.length 也跟目录对得上', () => {
  const index = path.join(ROOT, 'dist', 'search-index.json')
  assert.ok(existsSync(index), 'dist/search-index.json 不存在 —— 先跑 `npm run build`')

  const data = JSON.parse(readFileSync(index, 'utf8'))
  const actual = realCount()

  assert.equal(data.docs.length, actual, `索引里 ${data.docs.length} 条，目录里 ${actual} 条`)
  assert.equal(
    data.count,
    data.docs.length,
    `索引自己的 count 字段（${data.count}）与 docs.length（${data.docs.length}）不一致`,
  )
})
