/**
 * 会话只读兼容：DSH 0.2.2 起 sessionController.inspect() 被移除，
 * 只读入口挪到 sessionQuery.readSession()。「同步当前会话」等功能不能因此报
 * 「宿主暂时没有会话服务」。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const start = source.indexOf('  async function readSessionRecord(')
const end = source.indexOf('\n  /** 会话是否真实存在', start)
assert.ok(start > 0 && end > start, 'readSessionRecord block located')

function load(services) {
  const context = {
    ctx: {},
    asString: (value) => (value == null ? '' : String(value)),
    service: (_ctx, key) => services[key],
    awaitService: async (_ctx, key) => services[key],
  }
  vm.createContext(context)
  vm.runInContext(
    source.slice(start, end)
      + '\nthis.readSessionRecord = readSessionRecord; this.canReadSessions = canReadSessions; this.readSessionTitle = readSessionTitle',
    context,
  )
  return context
}

const record = {
  session: { id: 's1', cwd: '/w' },
  events: [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'hi' }] } } }],
}

/* 新宿主（0.2.2+）：sessionController 没有 inspect，只有 prompt；sessionQuery 提供 readSession */
{
  const calls = []
  const api = load({
    sessionController: { prompt() {} },
    sessionQuery: {
      readSession: async (id) => { calls.push(id); return record },
      readTitle: async () => ({ title: '日志里折叠出的标题' }),
    },
  })
  assert.equal(api.canReadSessions(), true, '新宿主也算能读会话')
  assert.deepEqual(await api.readSessionRecord('s1'), record, '退回 sessionQuery.readSession')
  assert.deepEqual(calls, ['s1'])
  assert.equal(await api.readSessionTitle('s1', record), '日志里折叠出的标题', '标题走 readTitle')
}

/* 老宿主：仍然优先 inspect，不改变既有行为 */
{
  const api = load({
    sessionController: { inspect: async () => ({ ...record, session: { ...record.session, title: 'header 标题' } }) },
    sessionQuery: { readSession: async () => { throw new Error('should not be called') } },
  })
  const got = await api.readSessionRecord('s1')
  assert.equal(got.session.title, 'header 标题', '老宿主照旧用 inspect')
  assert.equal(await api.readSessionTitle('s1', got), 'header 标题', 'header 上有标题就直接用')
}

/* 两边都没有：返回 undefined，调用方据此报「暂时没有会话服务」 */
{
  const api = load({ sessionController: { prompt() {} } })
  assert.equal(api.canReadSessions(), false)
  assert.equal(await api.readSessionRecord('s1'), undefined)
  await assert.rejects(() => api.readSessionRecord('  '), /会话 id 为空/)
}

/* 源码里不能再有直接调用 sessions.inspect 的地方：全部经由兼容层 */
assert.equal((source.match(/sessions\??\.inspect/g) || []).length, 0, '所有会话只读都走 readSessionRecord')

console.log('SESSION_READ_COMPAT_OK: inspect 缺席时退回 sessionQuery.readSession / readTitle')
