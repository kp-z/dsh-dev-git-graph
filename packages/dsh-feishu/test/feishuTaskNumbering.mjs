#!/usr/bin/env node
/** 新建任务的编号必须来自飞书任务号（task_get 里的 task_id），并且：
 *   - 两条任务同时创建时各拿各的号，不会撞；
 *   - 读不到飞书号时**不写假编号**（旧实现会本地发号，造出多个 T1）。
 * Run: node packages/dsh-feishu/test/feishuTaskNumbering.mjs
 */
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createBackendScope } from '../backendScope.js'
import { createCreationLedger } from '../creationLedger.js'
import { feishuTaskNo, formatTaskTitle } from '../index.js'

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const extract = (name) => { const m = source.match(new RegExp('  (?:async )?function ' + name + '\\([^]*?\\n  }')); assert.ok(m, name); return m[0] }

/** 每个 guid 配一个飞书任务号；failing 里的 guid 让 task_get 拿不到号。 */
function harness({ failing = new Set() } = {}) {
  const store = new AsyncLocalStorage()
  let sequence = 0
  const numbers = new Map()
  const titles = []
  const impl = {
    createTask: async () => {
      const guid = `guid-${++sequence}`
      numbers.set(guid, `t${516000 + sequence}`)
      await new Promise((r) => setTimeout(r, 15))
      return { ok: true, guid, tasklistGuid: 'list' }
    },
    updateTask: async (_s, id, patch) => { titles.push({ id, title: patch.summary }); return { ok: true } },
    actions: async (_s, actions) => {
      if (actions[0]?.op === 'task_get') {
        const guid = actions[0].task
        if (failing.has(guid)) return { ok: false, actions: [{ op: 'task_get', ok: false }] }
        return { ok: true, actions: [{ op: 'task_get', ok: true, task: { guid, task_id: numbers.get(guid) } }] }
      }
      return { ok: true, actions: [] }
    },
  }
  const h = {
    settings: { cliBackend: 'feishu-sync', managedTasklist: { enabled: true, guid: 'list' } },
    backendGeneration: 0, lifecycleDisposed: false,
    state: { tasks: [], taskCreationReceipts: {}, relations: [], relationSync: {}, workspaceLinks: {}, workspaceWrites: {} },
    backendContext: { getStore: () => null }, activeCreationKeys: new Set(),
    createHash, asString: (v) => (v == null ? '' : String(v)), nowMs: Date.now,
    service: () => undefined, ctx: {}, ensureManagedTasklist: async () => ({ ok: true, guid: 'list' }),
    defaultsFromState: () => ({ assignee: 'ou_mock', tasklistGuid: 'list' }),
    extractDocLinks: () => [], persistState: async () => {},
    updateRelations: () => ({ ok: true, edges: [] }), linkTask: async () => ({ ok: true }),
    syncTasks: async () => ({ ok: true }), relationView: () => ({ edges: [] }), writeTaskRelations: async () => ({ ok: true }),
    /* 生产实现：编号全部来自飞书任务号。 */
    feishuTaskNo,
    taskNo: (task) => (Number.isInteger(task?.no) && task.no > 0 ? task.no : 0),
    decorateTitle: (title, task, material) => formatTaskTitle(title, task.no, '🧪'),
  }
  h.captureBackendScope = () => createBackendScope({ getSettings: () => h.settings, getGeneration: () => h.backendGeneration, isDisposed: () => h.lifecycleDisposed, resolveBackend: () => impl })
  h.taskCreationLedger = createCreationLedger({ load: async () => structuredClone(h.state.taskCreationReceipts), save: async (rows) => { h.state.taskCreationReceipts = structuredClone(rows) }, now: Date.now })
  vm.createContext(h)
  vm.runInContext([extract('creationPending'), extract('pendingCreationWriteBlocked'), extract('createTaskFromSession')].join('\n'), h)
  return { h, numbers, titles }
}

/* 1. 两条同时创建：各拿各的飞书号，标题里的号互不相同。 */
{
  const { h, titles } = harness()
  const results = await Promise.all([
    h.createTaskFromSession('session-a', { summary: '第一条' }),
    h.createTaskFromSession('session-b', { summary: '第二条' }),
  ])
  assert.equal(results.every((r) => r.ok), true, JSON.stringify(results))
  const rows = h.state.tasks.filter((t) => t.id.startsWith('guid-'))
  assert.equal(rows.length, 2)
  const nos = rows.map((t) => t.no)
  assert.equal(new Set(nos).size, 2, `两条任务拿到不同号，实际 ${nos.join('/')}`)
  assert.deepEqual([...nos].sort((a, b) => a - b), [516001, 516002], '号就是飞书任务号')
  for (const row of rows) assert.equal(row.feishuTaskId, `t${row.no}`, '飞书号文本也落库')
  const written = rows.map((t) => t.title)
  assert.deepEqual([...written].sort(), ['🧪 T516001-第一条', '🧪 T516002-第二条'].sort(), '标题里的号 = 飞书号')
  console.log('✓ concurrent creations each adopt their own Feishu task number (no local counter)')
}

/* 2. 读不到飞书号：不写假编号，标题保持无号（等下一轮同步补）。 */
{
  const failing = new Set()
  const { h, numbers } = harness({ failing })
  failing.add('guid-1')
  const first = await h.createTaskFromSession('session-a', { summary: '拿不到号' })
  assert.equal(first.ok, true, first.error)
  assert.equal(first.title, '🧪 拿不到号', '拿不到飞书号时标题不带编号')
  const row = h.state.tasks.find((t) => t.id === 'guid-1')
  assert.equal(row.no, 0)
  assert.equal(row.feishuTaskId, '')
  console.log('✓ without a Feishu task number the title carries no number (never a made-up one)')
}
