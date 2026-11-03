// Pure durable create-task guard. One instance must own a rows store; adapters must
// atomically persist the supplied key -> receipt object and throw on failure.
// Never start remote IO until BOTH begin() and sending() have returned ok:true.
// Keys are supplied by the caller (e.g. SHA256); pass only non-secret metadata.
const ACTIVE = new Set(['prepared', 'sending', 'created', 'partial', 'unknown'])
const STATES = new Set([...ACTIVE, 'failed', 'done'])
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const nonempty = value => typeof value === 'string' && value.trim().length > 0
const errorText = error => error instanceof Error ? error.message : String(error ?? 'Unknown error')
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * All operations are async and serialized, including initial recovery. load()
 * returns a rows object (null/undefined means a new store); save(rows) persists
 * a deep copy, never a tasks array. A failed load/save permanently poisons this
 * instance: no subsequent operation can authorize IO, even if the adapter heals.
 * Persistence exceptions are failure; adapters returning false/{ok:false} also
 * fail closed. get/list are cloned diagnostic snapshots, but throw if poisoned.
 * This is an in-process guard, not a cross-process transaction/locking service.
 */
export function createCreationLedger({ load, save, now = Date.now } = {}) {
  if (typeof load !== 'function' || typeof save !== 'function' || typeof now !== 'function') {
    throw new TypeError('Creation ledger requires load, save and now functions')
  }
  let rows = Object.create(null)
  let initialized = false
  let poison = null
  let tail = Promise.resolve()

  const blocked = (receipt, error) => ({ ok: false, blocked: true, receipt: copy(receipt) ?? null, error: errorText(error) })
  const serialize = operation => {
    const next = tail.then(operation)
    tail = next.catch(() => {})
    return next
  }
  const persist = async next => {
    try {
      const result = await save(copy(next))
      if (result === false || (object(result) && result.ok === false)) throw new Error('Creation ledger save rejected')
      rows = next
      return true
    } catch (error) {
      poison = new Error(`Creation ledger persistence failed: ${errorText(error)}`)
      return false
    }
  }
  const initialize = async () => {
    if (initialized) return
    initialized = true
    try {
      const loaded = await load()
      if (loaded != null && !object(loaded)) throw new Error('Creation ledger load must return a rows object')
      const next = Object.assign(Object.create(null), copy(loaded ?? {}))
      let recovered = false
      for (const [key, receipt] of Object.entries(next)) {
        if (!object(receipt) || receipt.key !== key || !nonempty(receipt.sessionId) || !STATES.has(receipt.status)) {
          throw new Error('Invalid creation ledger receipt')
        }
        if (['created', 'partial', 'done'].includes(receipt.status) && !nonempty(receipt.taskId)) {
          throw new Error('Creation ledger receipt is missing its task GUID')
        }
        if (receipt.status === 'prepared' || receipt.status === 'sending') {
          const prepared = receipt.status === 'prepared'
          receipt.status = prepared ? 'failed' : 'unknown'
          receipt.error = prepared ? 'Recovered preparation: remote IO had not started' : 'Recovered sending: remote outcome is unknown'
          receipt.updatedAt = now()
          recovered = true
        }
      }
      rows = next
      if (recovered) await persist(next)
    } catch (error) {
      poison = new Error(`Creation ledger recovery failed: ${errorText(error)}`)
    }
  }
  const mutate = operation => serialize(async () => {
    await initialize()
    if (poison) return blocked(null, poison)
    try { return await operation() } catch (error) { return blocked(null, error) }
  })
  const update = async (receipt, patch) => {
    const nextReceipt = { ...receipt, ...copy(patch), updatedAt: now() }
    const next = Object.assign(Object.create(null), rows, { [receipt.key]: nextReceipt })
    if (!await persist(next)) return blocked(nextReceipt, poison)
    return { ok: true, receipt: copy(nextReceipt) }
  }
  const transition = (key, allowed, apply) => mutate(async () => {
    const receipt = rows[key]
    if (!receipt || !allowed.includes(receipt.status)) return blocked(receipt, 'Creation ledger transition is not allowed')
    return apply(receipt)
  })

  return {
    begin(request = {}) {
      return mutate(async () => {
        const { key, sessionId, backend, summary, tasklistGuid, followUp = false } = request
        if (!nonempty(key) || !nonempty(sessionId)) return blocked(null, 'Creation key and sessionId are required')
        const previous = rows[key]
        if (previous && previous.sessionId !== sessionId) return blocked(previous, 'Creation key belongs to a different session')
        if (previous?.status === 'done') return { ok: true, reused: true, receipt: copy(previous) }
        const active = Object.values(rows).find(row => row.sessionId === sessionId && ACTIVE.has(row.status))
        if (active) return blocked(active, 'This session has an unresolved creation receipt')
        const receipt = {
          key, sessionId, backend: backend ?? null, summary: summary ?? '',
          tasklistGuid: tasklistGuid ?? null, followUp: followUp === true,
          status: 'prepared', createdAt: now(), updatedAt: now(),
        }
        const next = Object.assign(Object.create(null), rows, { [key]: copy(receipt) })
        if (!await persist(next)) return blocked(receipt, poison)
        return { ok: true, receipt: copy(receipt) }
      })
    },
    sending(key) {
      return transition(key, ['prepared'], receipt => update(receipt, { status: 'sending' }))
    },
    created(key, data = {}) {
      return transition(key, ['sending'], receipt => {
        if (!nonempty(data.taskId)) return blocked(receipt, 'A real task GUID is required')
        const { taskId, partial, status, ...creation } = data
        return update(receipt, { taskId, creation, status: partial === true || status === 'partial' ? 'partial' : 'created' })
      })
    },
    finish(key, result) {
      return transition(key, ['created', 'partial'], receipt => {
        if (!nonempty(receipt.taskId)) return blocked(receipt, 'A known task GUID is required')
        return update(receipt, { status: 'done', result })
      })
    },
    cancel(key, { provenNotSent } = {}) {
      return transition(key, ['prepared', 'sending'], receipt => {
        if (provenNotSent !== true) return blocked(receipt, 'Cancellation requires provenNotSent:true; unknown POST must use fail')
        return update(receipt, { status: 'failed', error: 'Caller confirmed remote IO never started' })
      })
    },
    fail(key, { definitive = false, error } = {}) {
      return transition(key, ['sending'], receipt => update(receipt, {
        status: definitive === true ? 'failed' : 'unknown', error: errorText(error),
      }))
    },
    markPartial(key, error) {
      return transition(key, ['created'], receipt => update(receipt, { status: 'partial', error: errorText(error) }))
    },
    // Explicit recovery evidence, not a remote lookup tool. Unknown can only be
    // resolved to a known GUID, never to retryable failed or directly to done.
    reconcile(key, { taskId, evidence } = {}) {
      return transition(key, ['unknown', 'created', 'partial'], receipt => {
        if (!nonempty(taskId)) return blocked(receipt, 'Reconciliation requires a real task GUID')
        if (receipt.taskId && receipt.taskId !== taskId) return blocked(receipt, 'Cannot replace a known task GUID')
        if (receipt.status === 'unknown' && !nonempty(evidence)) return blocked(receipt, 'Unknown outcome requires explicit non-empty evidence')
        return update(receipt, { taskId, evidence: evidence ?? receipt.evidence ?? null, status: receipt.status === 'partial' ? 'partial' : 'created' })
      })
    },
    get(key) {
      return serialize(async () => {
        await initialize()
        if (poison) throw poison
        return copy(rows[key]) ?? null
      })
    },
    list({ sessionId, status } = {}) {
      return serialize(async () => {
        await initialize()
        if (poison) throw poison
        return copy(Object.values(rows).filter(row => (sessionId === undefined || row.sessionId === sessionId) && (status === undefined || row.status === status)))
      })
    },
  }
}
