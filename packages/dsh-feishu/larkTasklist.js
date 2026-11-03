/** Portable Task v2 helpers. The injected API owns authentication/transport; no I/O here.
 * Paths and bodies follow feishu_api.py's documented Task v2 requests.
 * Keep one factory per action batch: failed ensures gate subsequent writes, and an
 * uncertain create is never blindly repeated (a complete read can reconcile it).
 */
const ROOT = '/open-apis/task/v2'
const TYPES = new Set(['text', 'datetime', 'single_select', 'multi_select'])
const MAX_PAGES = 1000
const TIMEOUT = 60_000
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const identifier = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 不能为空`)
  return value
}
const select = type => type === 'single_select' || type === 'multi_select'
const namesOf = value => {
  if (value == null) return []
  if (!Array.isArray(value) || value.some(name => typeof name !== 'string')) throw new Error('options 必须是字符串数组')
  return [...new Set(value.filter(name => name.trim()))]
}
// Deterministic fallback, not a random token on every retry. Explicit bridge tokens
// are preferred because they can include the caller's managed-list identity.
function createToken(name) {
  let hash = 2166136261
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 16777619) >>> 0
  return `dsh-tasklist-v1-${hash.toString(16).padStart(8, '0')}-${name.length}`
}
function optionsOf(field) {
  const key = `${field.type}_setting`
  const setting = field[key]
  if (!object(setting) || !Array.isArray(setting.options)) throw new Error('malformed select setting')
  const guids = new Set()
  for (const option of setting.options) {
    if (!object(option) || typeof option.name !== 'string') throw new Error('malformed select option')
    identifier(option.guid, 'option guid')
    if (guids.has(option.guid)) throw new Error('重复选项 GUID')
    if (option.is_hidden != null && typeof option.is_hidden !== 'boolean') throw new Error('malformed hidden option')
    guids.add(option.guid)
  }
  return { key, setting, options: setting.options }
}
function fieldReceipt(field, name, type, guid) {
  if (!object(field) || typeof field.guid !== 'string' || !field.guid.trim() ||
      field.name !== name || field.type !== type || (guid != null && field.guid !== guid)) {
    throw new Error('字段回执缺失/不匹配')
  }
  return field
}
function uniqueOption(options, name) {
  // Hidden + visible names are ambiguous too; never quietly select the visible one.
  const matches = options.filter(option => option.name === name)
  if (matches.length !== 1 || matches[0].is_hidden) throw new Error('选项重名或隐藏，拒绝写入')
  return matches[0]
}
function dateValue(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error('日期字段要 YYYY-MM-DD')
  const year = Number(raw.slice(0, 4))
  const date = new Date(`${raw}T00:00:00.000Z`)
  if (year < 1 || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw) throw new Error('日期字段要有效 YYYY-MM-DD')
  return String(date.getTime())
}

/** @param {Function} api async (method, path, {params, data, timeoutMs}) => {ok,data,error,detail}
 * @returns {Function} async run(action) => Python-compatible structured result
 */
export function createLarkTasklistActions(api) {
  if (typeof api !== 'function') throw new TypeError('api must be a function')
  const uncertainCreates = new Set()
  const failedEnsures = new Map()

  async function request(method, path, options = {}) {
    let res
    try { res = await api(method, path, { ...options, timeoutMs: TIMEOUT }) }
    catch (error) {
      const failure = new Error(error?.message || String(error))
      failure.unknownDelivery = method !== 'GET'
      throw failure
    }
    if (!object(res) || res.ok !== true || !object(res.data)) {
      const failure = new Error(res?.detail || res?.error?.message || (typeof res?.error === 'string' ? res.error : '') || 'malformed API response')
      const code = res?.error?.code
      // Only a structured rejection establishes non-delivery. CLI exit/errors and
      // absent/malformed success bodies are not evidence that a write did not land.
      const rejected = res?.ok === false && (res?.error?.type === 'authorization' || res?.error?.type === 'validation' || (Number.isInteger(code) && ((code >= 400 && code < 500) || (code >= 1470400 && code < 1470500))))
      failure.unknownDelivery = method !== 'GET' && !rejected
      throw failure
    }
    return res.data
  }
  async function all(path, params, kind) {
    const items = []
    const seen = new Set()
    const guids = new Set()
    let cursor
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await request('GET', path, { params: { ...params, ...(cursor ? { page_token: cursor } : {}) } })
      if (!Array.isArray(data.items) || data.items.length > params.page_size || typeof data.has_more !== 'boolean') throw new Error(`malformed ${kind} page`)
      for (const item of data.items) {
        if (!object(item)) throw new Error(`malformed ${kind} item`)
        identifier(item.guid, `${kind} guid`)
        if (guids.has(item.guid)) throw new Error(`duplicate ${kind} GUID`)
        guids.add(item.guid)
        identifier(item.name, `${kind} name`)
        if (kind === 'fields') identifier(item.type, 'field type')
      }
      items.push(...data.items)
      if (!data.has_more) return items
      cursor = data.page_token
      if (typeof cursor !== 'string' || !cursor.trim() || seen.has(cursor)) throw new Error(`malformed ${kind} pagination: missing/repeated cursor`)
      seen.add(cursor)
    }
    throw new Error(`${kind} pagination limit exceeded`)
  }
  const fields = tasklist => all(`${ROOT}/custom_fields`, {
    resource_type: 'tasklist', resource_id: identifier(tasklist, 'tasklist'), page_size: 100,
  }, 'fields')

  async function completeOptions(target, names, result, strict = false) {
    const { key, setting, options } = optionsOf(target)
    for (const name of names) {
      const matches = options.filter(option => option.name === name)
      if (matches.length && (matches.length !== 1 || matches[0].is_hidden)) {
        if (strict) throw new Error('选项重名或隐藏，拒绝写入')
        result.warnings.push(`选项重名或隐藏，写入这些值会被拒绝：${name}`)
      }
    }
    const missing = names.filter(name => !options.some(option => option.name === name))
    if (!missing.length) return { target, added: [] }
    result.unknownDelivery = true
    const data = await request('PATCH', `${ROOT}/custom_fields/${encodeURIComponent(target.guid)}`, {
      data: { custom_field: { [key]: { ...setting, options: [...options.map(option => ({ ...option })), ...missing.map(name => ({ name }))] } }, update_fields: [key] },
    })
    const after = fieldReceipt(data.custom_field, target.name, target.type, target.guid)
    const received = optionsOf(after).options
    for (const before of options) {
      const found = received.find(option => option.guid === before.guid)
      if (!found || found.name !== before.name || Boolean(found.is_hidden) !== Boolean(before.is_hidden)) throw new Error('追加选项回执未保留原 GUID/隐藏项')
    }
    for (const name of missing) uniqueOption(received, name)
    result.unknownDelivery = false
    return { target: after, added: missing }
  }

  return async function run(action = {}) {
    const result = { op: action?.op, ok: false, guid: action?.op === 'ensure_tasklist' ? (action.guid ?? null) : null,
      name: action?.name ?? null, type: action?.op === 'ensure_custom_field' ? (action.type ?? 'single_select') : null,
      warnings: [], error: null, unknownDelivery: false }
    if (result.op === 'ensure_tasklist' || result.op === 'ensure_custom_field') result.created = false
    let pendingCreate
    const ensureKey = JSON.stringify([action?.tasklist, action?.name])
    try {
      if (!object(action)) throw new Error('action must be an object')
      if (action.op === 'list_custom_fields') {
        result.items = await fields(action.tasklist)
        result.ok = true
      } else if (action.op === 'ensure_tasklist') {
        let target
        if (action.guid != null) {
          const guid = identifier(action.guid, 'guid')
          const data = await request('GET', `${ROOT}/tasklists/${encodeURIComponent(guid)}`, { params: { user_id_type: 'open_id' } })
          target = data.tasklist
          if (!object(target) || target.guid !== guid) throw new Error('清单 GET 回执缺失/不匹配')
          identifier(target.name, 'tasklist name')
        } else {
          const name = identifier(action.name, 'name')
          const token = action.create_token != null ? identifier(action.create_token, 'create_token') : createToken(name)
          const key = JSON.stringify(['tasklist', name])
          const items = await all(`${ROOT}/tasklists`, { user_id_type: 'open_id', page_size: 100 }, 'tasklists')
          const matches = items.filter(item => item.name === name)
          if (matches.length > 1) throw new Error('清单重名，拒绝创建')
          if (matches.length) { target = matches[0]; uncertainCreates.delete(key) }
          else {
            if (uncertainCreates.has(key)) { result.unknownDelivery = true; throw new Error('清单创建投递未知，拒绝盲目重试') }
            pendingCreate = key
            result.unknownDelivery = true
            const data = await request('POST', `${ROOT}/tasklists`, { params: { user_id_type: 'open_id' }, data: { name, client_token: token } })
            target = data.tasklist
            if (!object(target) || target.name !== name) throw new Error('清单创建回执缺失/不匹配')
            identifier(target.guid, 'tasklist guid')
            result.created = true
          }
        }
        Object.assign(result, { ok: true, guid: target.guid, name: target.name, unknownDelivery: false })
      } else if (action.op === 'ensure_custom_field') {
        const name = identifier(action.name, 'name')
        const kind = result.type
        if (!TYPES.has(kind)) throw new Error(`不支持字段类型 ${kind}`)
        const accepted = action.accepted_types == null ? [kind] : action.accepted_types
        if (!Array.isArray(accepted) || !accepted.length || accepted.some(type => !TYPES.has(type))) throw new Error('不支持 accepted_types')
        const names = namesOf(action.options)
        const items = await fields(action.tasklist)
        const matches = items.filter(field => field.name === name)
        if (matches.length > 1) throw new Error('字段重名，拒绝创建/写入')
        const key = JSON.stringify(['field', action.tasklist, name])
        if (matches.length) {
          const target = matches[0]
          Object.assign(result, { guid: target.guid, type: target.type })
          if (!TYPES.has(target.type) || (target.type !== kind && !accepted.includes(target.type))) throw new Error(`字段「${name}」已存在但类型是 ${target.type}，不是 ${kind}`)
          uncertainCreates.delete(key)
          result.added = select(target.type) ? (await completeOptions(target, names, result)).added : []
        } else {
          if (uncertainCreates.has(key)) { result.unknownDelivery = true; throw new Error('字段创建投递未知，拒绝盲目重试') }
          const body = { resource_type: 'tasklist', resource_id: action.tasklist, name, type: kind }
          if (select(kind)) body[`${kind}_setting`] = { options: names.map(name => ({ name })) }
          else body[`${kind}_setting`] = kind === 'text' ? {} : { format: 'yyyy-mm-dd' }
          pendingCreate = key
          result.unknownDelivery = true
          const data = await request('POST', `${ROOT}/custom_fields`, { data: body })
          const target = fieldReceipt(data.custom_field, name, kind)
          if (select(kind)) {
            const received = optionsOf(target).options
            for (const name of names) uniqueOption(received, name)
          }
          Object.assign(result, { created: true, guid: target.guid })
        }
        result.ok = true
        result.unknownDelivery = false
        failedEnsures.delete(ensureKey)
      } else if (action.op === 'set_custom_field') {
        const task = identifier(action.task, 'task')
        if (action.expected_type != null && !TYPES.has(action.expected_type)) throw new Error('不支持 expected_type')
        const items = await fields(action.tasklist)
        const byGuid = action.field_guid != null
        const key = identifier(byGuid ? action.field_guid : action.name, byGuid ? 'field_guid' : 'name')
        const matches = items.filter(field => field[byGuid ? 'guid' : 'name'] === key)
        if (matches.length !== 1) throw new Error(matches.length ? '字段重名/重复 GUID，拒绝写入' : '没有匹配的字段')
        let target = matches[0]
        if (byGuid && action.name != null && target.name !== action.name) throw new Error('field_guid 与 name 不匹配')
        Object.assign(result, { guid: target.guid, name: target.name, type: target.type })
        if (!TYPES.has(target.type) || (action.expected_type != null && target.type !== action.expected_type)) throw new Error('字段类型与 expected_type 不匹配')
        const failed = failedEnsures.get(JSON.stringify([action.tasklist, target.name]))
        if (failed) { result.skipped = 'ensure_failed'; throw new Error(`同批 ensure 失败，跳过写入：${failed}`) }
        const kind = target.type
        const raw = action.value
        const value = { guid: target.guid, type: kind }
        if (select(kind)) {
          let names
          if (raw == null || raw === '' || (Array.isArray(raw) && !raw.length)) names = []
          else if (kind === 'multi_select' && Array.isArray(raw)) names = namesOf(raw)
          else if (typeof raw === 'string') names = [raw]
          else throw new Error('select value 必须是字符串（多选可用字符串数组）')
          target = (await completeOptions(target, names, result, true)).target
          const options = optionsOf(target).options
          const selected = names.map(name => uniqueOption(options, name).guid)
          value[`${kind}_value`] = kind === 'single_select' ? (selected[0] ?? '') : selected
        } else if (kind === 'datetime') value.datetime_value = dateValue(raw)
        else {
          if (raw != null && !['string', 'number', 'boolean'].includes(typeof raw)) throw new Error('text value 必须是标量')
          if (typeof raw === 'number' && !Number.isFinite(raw)) throw new Error('text value 必须是有限标量')
          value.text_value = raw == null ? '' : typeof raw === 'boolean' ? (raw ? 'True' : 'False') : String(raw)
        }
        result.unknownDelivery = true
        await request('PATCH', `${ROOT}/tasks/${encodeURIComponent(task)}`, {
          params: { user_id_type: 'open_id' }, data: { task: { custom_fields: [value] }, update_fields: ['custom_fields'] },
        })
        Object.assign(result, { ok: true, unknownDelivery: false })
      } else throw new Error(`不支持操作 ${action.op}`)
    } catch (error) {
      result.error = String(error?.message || error).slice(0, 200)
      if (typeof error?.unknownDelivery === 'boolean') result.unknownDelivery = error.unknownDelivery
      if (pendingCreate && result.unknownDelivery) uncertainCreates.add(pendingCreate)
      if (action?.op === 'ensure_custom_field') failedEnsures.set(ensureKey, result.error)
    }
    return result
  }
}
