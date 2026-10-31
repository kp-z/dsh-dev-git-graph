import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { beginSyncHistory, finishSyncHistory, recordSyncStage, recoverSyncHistory, safeSyncDetail } from '../syncHistory.js'

const state = { tasks: [{ id: 'one' }], docs: [], syncHistory: [] }
assert.deepEqual(recoverSyncHistory(null), [])
for (let n = 0; n < 105; n++) {
  const row = beginSyncHistory(state, 'timer', n + 1)
  await recordSyncStage(row, '任务', async () => ({ ok: true }))
  const result = finishSyncHistory(state, row, { now: n + 10 })
  assert.equal(result.ok, true)
  assert.equal(row.counts.tasks, 1)
  assert.equal(row.status, 'success')
  assert.equal(state.syncing, false)
}
assert.equal(state.syncHistory.length, 100)
assert.equal(state.syncHistory[0].startedAt, 105)
const row = beginSyncHistory(state, 'panel', 1000)
assert.equal(state.syncing, true)
await recordSyncStage(row, '文档', async () => ({ ok: false, detail: 'permission denied' }))
await recordSyncStage(row, '归因', async () => { throw new Error('Bearer super-secret') }, { optional: true })
assert.equal(row.errors.length, 2)
assert.ok(!JSON.stringify(row).includes('super-secret'))
assert.equal(finishSyncHistory(state, row, { now: 1100 }).ok, false)
assert.equal(row.status, 'partial')
assert.equal(row.durationMs, 100)
await assert.rejects(recordSyncStage(row, '任务', async () => { throw new Error('bad API') }))
finishSyncHistory(state, row, { fatal: true, now: 1200 })
assert.equal(row.status, 'failed')
assert.ok(state.lastError.includes('bad API'))
const interrupted = beginSyncHistory(state, 'tool', 2000)
interrupted.stages.push({ name: '任务', status: 'running', durationMs: 0 })
const saved = JSON.parse(JSON.stringify(state.syncHistory))
const recovered = recoverSyncHistory(saved, 2100)
assert.equal(recovered[0].status, 'interrupted')
assert.equal(recovered[0].stages[0].status, 'interrupted')
assert.equal(recovered[0].durationMs, 100)
assert.equal(saved[0].status, 'running')
assert.doesNotThrow(() => recoverSyncHistory([{ ...saved[0], stages: [null, false, { status: 'running' }] }], 2100))
for (const detail of ['{"access_token":"secret-json","refresh_token":"secret-two"}', "'app_secret': 'secret-app'", 'https://example.test/?access_token=secret-url&next=1']) {
  assert.ok(!safeSyncDetail(detail).includes('secret-'), safeSyncDetail(detail))
}
assert.equal(safeSyncDetail('access_token=secret; refresh_token=another'), 'access_token=[redacted]; refresh_token=[redacted]')
assert.equal(safeSyncDetail('x'.repeat(1000)).length, 600)

// Execute the real orchestration against isolated fake operations, not live APIs.
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const sync = source.match(/  async function sync\(\{ source = 'manual' \} = \{\}\) \{[\s\S]*?\n  \}/)[0]
let release
const gate = new Promise((resolve) => { release = resolve })
let taskCalls = 0
let writes = 0
const fakeState = { tasks: [], docs: [], relationSync: {}, suspensions: {}, syncHistory: [] }
const context = {
  state: fakeState, settings: { comments: { enabled: true } }, inFlight: null,
  beginSyncHistory, finishSyncHistory, recordSyncStage, safeSyncDetail,
  nowMs: Date.now, persistState: async () => { writes++ }, probeCli: async () => { await gate; return { found: true } },
  refreshDshSchedules: async () => {}, retryTaskReopens: async () => {},
  syncTasks: async () => { taskCalls++; fakeState.tasks = [{ id: 'one' }]; return { ok: true } },
  adoptFeishuSchedule: () => false, retryWorkspaceWrites: () => {}, reconcileWorkspaces: async () => {},
  attributeOverdueTasks: async () => ({ ok: true, attributed: 1, modelAttempts: 1 }), retryEtaWrites: async () => {},
  syncDocs: async () => ({ ok: false, failures: ['文档权限不足'] }), autoStartNewTasks: async () => 2,
  comments: { sync: async () => ({ ok: true, delivered: 1, diagnostics: [{ lastScanAt: Date.now(), readCount: 4 }] }) },
  isSuspended: () => false, log: () => {}, ctx: {},
}
vm.createContext(context)
vm.runInContext(sync, context)
const first = context.sync({ source: 'panel' })
const joined = context.sync({ source: 'tool' })
await Promise.resolve()
assert.equal(fakeState.syncHistory.length, 1)
assert.equal(fakeState.syncing, true)
release()
const [a, b] = await Promise.all([first, joined])
assert.deepEqual(a, b)
assert.equal(taskCalls, 1)
assert.equal(writes, 2)
assert.equal(fakeState.syncHistory[0].source, 'panel')
assert.equal(fakeState.syncHistory[0].status, 'partial')
assert.equal(fakeState.syncHistory[0].ai.attributionAttempts, 1)
assert.equal(fakeState.syncHistory[0].ai.commentsDispatched, 1)
assert.equal(fakeState.syncHistory[0].counts.commentsProcessed, 4)
assert.equal(fakeState.syncing, false)
// Return-value adapters must not mark failed CLI/ETA work successful.
context.probeCli = async () => ({ found: false })
fakeState.tasks[0].etaSyncPending = true
fakeState.tasks[0].etaSyncError = 'ETA denied'
context.syncTasks = async () => ({ ok: true })
await context.sync()
assert.equal(fakeState.syncHistory[0].status, 'partial')
assert.ok(fakeState.syncHistory[0].errors.some((text) => text.includes('CLI 不可用')))
assert.ok(fakeState.syncHistory[0].errors.some((text) => text.includes('ETA denied')))
context.refreshDshSchedules = async () => ({ ok: false, detail: 'catalog denied' })
context.autoStartNewTasks = async (failures) => { failures.push('start denied'); return 1 }
fakeState.tasks[0].reopenPending = true
fakeState.tasks[0].reopenError = 'reopen denied'
await context.sync()
assert.equal(fakeState.syncHistory[0].counts.autoStarted, 1)
for (const error of ['catalog denied', 'start denied', 'reopen denied']) assert.ok(fakeState.syncHistory[0].errors.some((text) => text.includes(error)))
context.syncTasks = async () => { throw new Error('task crash') }
assert.equal((await context.sync()).ok, false)
assert.equal(fakeState.syncHistory[0].status, 'failed')
assert.equal(context.inFlight, null)
context.persistState = async () => { throw new Error('disk full') }
assert.equal((await context.sync()).ok, false)
assert.equal(fakeState.syncing, false)
assert.equal(context.inFlight, null)
assert.ok(fakeState.syncHistory[0].errors.some((text) => text.includes('disk full')))
// Real auto-start function must preserve failures while counting successful starts.
const autoStartSource = source.match(/  async function autoStartNewTasks\(failures = \[\]\) \{[\s\S]*?\n  \}/)[0]
const autoContext = {
  state: { tasks: [{ id: 'fail', meta: {} }, { id: 'pass', meta: {} }], schedules: {} }, settings: {},
  nowMs: Date.now, isSuspended: () => false, selectAutoStartCandidates: (tasks) => tasks,
  scheduleViewOf: () => null, scheduleEntryOf: () => null, workspaces: () => [],
  refreshTaskRelations: async () => ({ ok: true }), relationView: () => ({ ready: true }),
  startTask: async (id) => id === 'fail' ? { ok: false, error: 'start failed' } : { ok: true },
}
vm.createContext(autoContext)
vm.runInContext(autoStartSource, autoContext)
const failures = []
assert.equal(await autoContext.autoStartNewTasks(failures), 1)
assert.deepEqual(failures, ['start failed'])
autoContext.refreshTaskRelations = async () => ({ ok: false, error: 'relations failed' })
const relationFailures = []
assert.equal(await autoContext.autoStartNewTasks(relationFailures), 0)
assert.deepEqual(relationFailures, ['relations failed', 'relations failed'])
console.log('SYNC_HISTORY_OK: bounded receipts, recovery, redaction, real singleflight orchestration, failures and AI triggers')
