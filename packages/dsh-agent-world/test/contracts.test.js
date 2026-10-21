/**
 * 契约登记表测试（CONTRACTS.md §一 / §八 / §九的强制力）。
 *
 * ## 这个文件在防什么
 *
 * 文档里的"契约"最容易被绕过：加功能的人不看文档、改了语义没人知道。
 * 所以登记表必须是**代码里的数据**，并且被测试钉住两件事：
 *
 * 1. **格式自洽**：id 形状、域、稳定性、版本、验收入口都合法；
 * 2. **文档与代码双向一致**：`docs/CONTRACTS.md` 第四节里有的，这里必须有；
 *    这里有的，文档里必须解释得到（否则代码里多出一条"没人知道为什么存在"的契约）。
 *
 * ## 为什么验收入口要检查文件存在
 *
 * 评审抓到过：验收列写着 `__agentWorldScene3d.benchmark`，而 3D 门面根本不存在，
 * 于是"每条契约都有验收"变成一句空话。规则收紧成三种形态（见 `isContractVerify`）：
 * 存在的测试文件 / 页内门面 / 显式 `planned:Pn`。**欠账可以，但要写在明面上。**
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  CONTRACTS,
  CONTRACT_DOMAINS,
  CONTRACT_STABILITIES,
  contractById,
  contractsByDomain,
  isContractVerify,
  lintContracts,
} from '../lib/protocol/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')
const docPath = join(packageRoot, 'docs', 'CONTRACTS.md')

/** 文档第四节的表格行：| `id` | 承诺 | 等级 | 验收 | */
const DOC_ROW =
  /^\| `([a-z][a-z0-9.]+)` \| ([^|]*) \| (🔒|📘|🧩|🧪) \| (.*) \|$/
const SYMBOL_TO_STABILITY = {
  '🔒': 'frozen',
  '📘': 'standard',
  '🧩': 'extension',
  '🧪': 'experimental',
}

/** 从文档里读出目录（只认四列齐全、且第三列是稳定性符号的行）。 */
function readDocCatalog() {
  const text = readFileSync(docPath, 'utf8')
  const rows = []
  for (const line of text.split('\n')) {
    const match = DOC_ROW.exec(line)
    if (match === null) continue
    const [, id, summary, symbol, verifyCell] = match
    const code = /`([^`]+)`/.exec(verifyCell)
    rows.push({
      id,
      summary: summary.trim(),
      stability: SYMBOL_TO_STABILITY[symbol],
      verify: (code === null ? verifyCell : code[1]).trim(),
    })
  }
  return rows
}

test('登记表：格式自洽（id / 域 / 稳定性 / 版本 / 验收）', () => {
  assert.deepEqual(lintContracts(), [], 'lintContracts 报出了问题，先修登记表再谈别的')
  assert.ok(CONTRACTS.length >= 50, `契约数量不像话：${CONTRACTS.length} 条`)
})

test('登记表：id 唯一，且 owner = id 的第一段', () => {
  const ids = CONTRACTS.map((item) => item.id)
  assert.equal(new Set(ids).size, ids.length, '契约 id 有重复')

  for (const item of CONTRACTS) {
    assert.ok(
      (CONTRACT_DOMAINS).includes(item.owner),
      `${item.id} 的 owner ${item.owner} 不在 CONTRACT_DOMAINS`,
    )
    assert.equal(item.owner, item.id.split('.')[0], `${item.id} 的 owner 与 id 第一段不一致`)
  }
})

test('登记表：稳定性只有四种取值，且每条都有 summary', () => {
  for (const item of CONTRACTS) {
    assert.ok(CONTRACT_STABILITIES.includes(item.stability), `${item.id} 稳定性非法`)
    assert.ok(item.summary.trim() !== '', `${item.id} 没有一句话承诺`)
  }
})

test('文档 ↔ 代码：两边 id 集合完全一致', () => {
  const doc = readDocCatalog()
  const docIds = new Set(doc.map((row) => row.id))
  const codeIds = new Set(CONTRACTS.map((item) => item.id))

  const missingInCode = [...docIds].filter((id) => !codeIds.has(id))
  const missingInDoc = [...codeIds].filter((id) => !docIds.has(id))

  assert.deepEqual(missingInCode, [], `文档里有、登记表里没有：${missingInCode.join('、')}`)
  assert.deepEqual(missingInDoc, [], `登记表里有、文档里没有：${missingInDoc.join('、')}`)
  assert.equal(doc.length, CONTRACTS.length, '两边条数不一致')
})

test('文档 ↔ 代码：同一条契约的稳定性与验收一致', () => {
  const byId = new Map(CONTRACTS.map((item) => [item.id, item]))
  for (const row of readDocCatalog()) {
    const entry = byId.get(row.id)
    assert.ok(entry !== undefined, `登记表缺少 ${row.id}`)
    assert.equal(entry.stability, row.stability, `${row.id} 的稳定性与文档不一致`)
    assert.equal(entry.verify, row.verify, `${row.id} 的验收入口与文档不一致`)
    assert.equal(entry.summary, row.summary, `${row.id} 的承诺与文档不一致`)
  }
})

test('验收：test/ 开头的必须真的有这个文件', () => {
  for (const item of CONTRACTS) {
    if (!item.verify.startsWith('test/')) continue
    const path = join(packageRoot, item.verify)
    assert.ok(existsSync(path), `${item.id} 的验收文件不存在：${item.verify}`)
  }
})

test('验收：合法形态只有三种，其它一律拒绝', () => {
  assert.equal(isContractVerify('test/sim.test.js'), true)
  assert.equal(isContractVerify('__agentWorldStage.history()'), true)
  assert.equal(isContractVerify('planned:P1'), true)
  assert.equal(isContractVerify('planned:P9'), false, '不存在的阶段必须拒绝')
  assert.equal(isContractVerify('看起来像验收'), false)
  assert.equal(isContractVerify('test/../package.json'), false, '目录穿越必须拒绝')
  assert.equal(isContractVerify('/etc/passwd'), false)
})

test('查询：contractById / contractsByDomain 可用', () => {
  assert.equal(contractById('world.tick.order')?.stability, 'frozen')
  assert.equal(contractById('不存在.的契约'), null)
  const worlds = contractsByDomain('world')
  assert.ok(worlds.length > 0)
  assert.ok(worlds.every((item) => item.owner === 'world'))
})
