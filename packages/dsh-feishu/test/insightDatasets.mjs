import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const start = source.indexOf('  function insightChartData() {')
const end = source.indexOf('\n  /** 早会摘要的纯文本版', start)
assert.ok(start > 0 && end > start, 'insightChartData located')
const DAY = 86_400_000
const now = Date.UTC(2026, 10, 1, 4, 0, 0)
const dayStart = (offset = 0) => Date.UTC(2026, 10, 1 + offset, 0, 0, 0)
const tasks = [
  { id: 'a', priority: 'P0', dueTs: now - DAY, started: true },
  { id: 'b', priority: 'P1', dueTs: now + 2 * 3600_000, sessionId: 's', startedAt: now - DAY },
  { id: 'c', priority: 'P2', expectedAt: now + 2 * DAY, started: true },
  { id: 'd', priority: 'P3', dueTs: now + 5 * DAY },
  { id: 'e', priority: 'garbage', dueTs: now + 20 * DAY, started: true },
  { id: 'f', dueTs: 0 },
  { id: 'done', priority: 'P0', done: true, completedAt: now },
]
const context = {
  state: { tasks },
  asString: (value) => (value == null ? '' : String(value)),
  nowMs: () => now,
  dayStart,
  DAY_MS: DAY,
  taskActivityAt: (task) => (task.id === 'c' ? now - 5 * DAY : task.id === 'a' ? now - 3600_000 : now - 10 * DAY),
  insightDataset: () => ({ done_by_day_7: { days: [], values: [] } }),
  insightStats: () => ({
    distribution: [
      { state: 'done', workspace: 'W1', count: 1 },
      { state: 'started', workspace: 'W1', count: 2 },
      { state: 'idle', workspace: 'W2', count: 3 },
      { state: 'started', workspace: 'W2', count: 1 },
    ],
    quality: { early: 2, onTime: 3, late: 4 },
    delayBuckets: [{ bucket: 'a', label: '估时不准', count: 2 }, { bucket: 'b', label: '等依赖', count: 1 }],
    series: Array.from({ length: 14 }, (_, i) => ({ day: '2026-10-' + String(18 + i).padStart(2, '0'), done: i, started: i % 3, wip: i + 2 })),
  }),
}
vm.createContext(context)
vm.runInContext(source.slice(start, end) + '\nthis.insightChartData = insightChartData', context)
const data = structuredClone(context.insightChartData())
assert.deepEqual(data.priority_urgency.rows, ['P0', 'P1', 'P2', 'P3', '未设置'])
assert.deepEqual(data.priority_urgency.cols, ['已逾期', '今天', '2–3 天', '4–7 天', '8 天+', '无截止'])
assert.equal(data.priority_urgency.values.length, 5)
assert.equal(data.priority_urgency.values.flat().reduce((a, b) => a + b, 0), 6, 'Matrix counts every unfinished task exactly once')
assert.equal(data.priority_urgency.values[0][0], 1, 'P0 overdue')
assert.equal(data.priority_urgency.values[1][1], 1, 'P1 today')
assert.equal(data.priority_urgency.values[2][2], 1, 'P2 within 2-3 days')
assert.equal(data.priority_urgency.values[3][3], 1, 'P3 4-7 days')
assert.equal(data.priority_urgency.values[4][4], 1, 'Unset priority 8d+')
assert.equal(data.priority_urgency.values[4][5], 1, 'No due date')
assert.deepEqual(data.stalled_aging.values, [1, 0, 1, 2], 'Aging buckets use last activity')
assert.equal(data.stalled_aging.values.reduce((a, b) => a + b, 0), 4, 'Only engaged unfinished tasks')
assert.deepEqual(data.workspace_load.labels, ['W2', 'W1'], 'Workspaces sorted by total load')
assert.deepEqual(data.workspace_load.series.map((row) => row.label), ['未开始', '在跑', '已完成'])
assert.deepEqual(data.workspace_load.series.map((row) => row.values), [[3, 0], [1, 2], [0, 1]])
assert.deepEqual(data.fulfillment_quality.values, [2, 3, 4])
assert.deepEqual(data.delay_reasons, { labels: ['估时不准', '等依赖'], values: [2, 1] })
assert.equal(data.throughput_14.days.length, 14)
assert.deepEqual(data.throughput_14.done.slice(0, 3), [0, 1, 2])
console.log('INSIGHT_DATASETS_OK: priority/urgency matrix, aging buckets, workspace load, quality, delay reasons, throughput')
