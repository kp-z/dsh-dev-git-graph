/** Bounded, plugin-owned sync receipts. No task bodies, credentials or model text. */
import { randomUUID } from 'node:crypto'

export const SYNC_HISTORY_LIMIT = 100

export function safeSyncDetail(value) {
  return String(value ?? '')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/((?:["']?)(?:access_token|refresh_token|app_secret|client_secret|authorization|token)(?:["']?)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}&]+)/gi, '$1[redacted]')
    .slice(0, 600)
}

export function recoverSyncHistory(value, now = Date.now()) {
  return (Array.isArray(value) ? value : []).filter((row) => row && typeof row === 'object' && typeof row.id === 'string')
    .slice(0, SYNC_HISTORY_LIMIT).map((row) => row.status === 'running' ? {
      ...row, status: 'interrupted', finishedAt: now,
      durationMs: Math.max(0, now - (Number(row.startedAt) || now)),
      errors: [...(Array.isArray(row.errors) ? row.errors : []), '上次同步未完成，进程重启或插件重载后恢复'],
      stages: (Array.isArray(row.stages) ? row.stages : []).filter((stage) => stage && typeof stage === 'object').map((stage) => stage.status === 'running' ? { ...stage, status: 'interrupted' } : stage),
    } : row)
}

export function beginSyncHistory(state, source, now = Date.now()) {
  const row = {
    id: randomUUID(), source: safeSyncDetail(source), startedAt: now, finishedAt: null, durationMs: 0,
    status: 'running', counts: { tasks: 0, docs: 0, autoStarted: 0, commentsProcessed: 0, commentsDispatched: 0, attributions: 0 },
    errors: [], stages: [], ai: { attributionAttempts: 0, autoStarted: 0, commentsDispatched: 0 },
  }
  state.syncHistory = [row, ...(Array.isArray(state.syncHistory) ? state.syncHistory : [])].slice(0, SYNC_HISTORY_LIMIT)
  state.syncing = true
  return row
}

export async function recordSyncStage(row, name, operation, { optional = false } = {}) {
  const startedAt = Date.now()
  const stage = { name, status: 'running', durationMs: 0 }
  row.stages.push(stage)
  try {
    const result = await operation()
    const failures = Array.isArray(result?.failures) ? result.failures : []
    const bad = result?.ok === false || failures.length > 0
    stage.status = bad ? 'failed' : 'success'
    if (bad) {
      stage.detail = safeSyncDetail(result?.detail || result?.error || failures.join('；') || '操作失败')
      row.errors.push(`${name}：${stage.detail}`)
    }
    return result
  } catch (error) {
    stage.status = 'failed'
    stage.detail = safeSyncDetail(error?.message || error)
    row.errors.push(`${name}：${stage.detail}`)
    if (!optional) throw error
    return { ok: false, detail: stage.detail }
  } finally {
    stage.durationMs = Math.max(0, Date.now() - startedAt)
  }
}

export function finishSyncHistory(state, row, { fatal = false, now = Date.now() } = {}) {
  row.finishedAt = now
  row.durationMs = Math.max(0, now - row.startedAt)
  row.status = fatal ? 'failed' : row.errors.length ? 'partial' : 'success'
  row.counts.tasks = state.tasks?.length || 0
  row.counts.docs = state.docs?.length || 0
  state.lastError = row.errors.length ? row.errors.join('；') : null
  state.syncing = false
  return { ok: row.errors.length === 0 && !fatal, errors: [...row.errors] }
}
