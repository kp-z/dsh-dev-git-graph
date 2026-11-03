/** Bounded full-list reader: partial scans never masquerade as a successful snapshot. */
export async function listLarkPages(api, path, params = {}, validate = () => true, maxPages = 100, itemKey = 'items') {
  const items = [], cursors = new Set()
  let token = ''
  for (let page = 0; page < maxPages; page++) {
    const res = await api('GET', path, { params: { page_size: 100, ...params, ...(token ? { page_token: token } : {}) }, timeoutMs: 120000 })
    if (!res.ok) return { ...res, ok: false, items, incomplete: true }
    const data = res.data
    if (!data || !Array.isArray(data[itemKey]) || typeof data.has_more !== 'boolean' || !data[itemKey].every(validate)) return { ok: false, items, incomplete: true, detail: '列表分页结构无效' }
    items.push(...data[itemKey])
    if (!data.has_more) return { ok: true, items, incomplete: false }
    const next = typeof data.page_token === 'string' ? data.page_token : ''
    if (!next || cursors.has(next)) return { ok: false, items, incomplete: true, detail: '分页游标缺失或循环' }
    cursors.add(next); token = next
  }
  return { ok: false, items, incomplete: true, detail: '超过完整分页保护上限' }
}
