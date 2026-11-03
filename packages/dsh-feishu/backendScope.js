/** One operation keeps one immutable settings/authorization context. No IO here. */
const identity = settings => JSON.stringify([settings.cliBackend, settings.cliPath, settings.larkCliPath, settings.larkAccountMode])
export function createBackendScope({ getSettings, getGeneration, isDisposed, resolveBackend, beforeActions }) {
  const settings = JSON.parse(JSON.stringify(getSettings()))
  const generation = getGeneration(), fingerprint = identity(settings)
  const impl = resolveBackend(settings.cliBackend)
  const sameContext = () => generation === getGeneration() && fingerprint === identity(getSettings())
  const valid = () => !isDisposed() && sameContext()
  const message = '后端或配置已变化，旧操作已停止；请核对已发送的部分，不会跨后端继续写入'
  const stale = (method, args, receipt) => ({
    ok: false, stale: true, partial: Boolean(receipt?.ok), detail: message, error: message,
    ...(receipt ? { receipt } : {}),
    ...(method === 'actions' ? { actions: (receipt?.actions || args[0] || []).map(row => ({ op: row.op, ok: false, stale: true, error: message, unknownDelivery: row.unknownDelivery === true || Boolean(receipt && row.ok && !['task_get','task_comments','task_subtasks','task_attachments','task_dependencies'].includes(row.op)), ...(receipt ? { receipt: row } : {}) })), errors: [message] } : {}),
  })
  async function invoke(method, ...args) {
    if (!valid()) return stale(method, args)
    if (method === 'actions' && beforeActions) {
      const blocked = beforeActions(args[0])
      if (blocked) return blocked
    }
    const result = await impl[method](settings, ...args)
    // Disposal stops NEW IO, but a confirmed request already in flight must be
    // allowed to commit its receipt before the engine's lifecycle drain completes.
    // A settings/backend change is different: its result cannot update the new context.
    return sameContext() ? result : stale(method, args, result)
  }
  const scope = { settings, generation, backend: settings.cliBackend, valid }
  for (const method of ['actions', 'probe', 'check', 'listTasks', 'docInfo', 'docRead', 'createTask', 'updateTask', 'complete', 'comment', 'enrich']) scope[method] = (...args) => invoke(method, ...args)
  return scope
}
