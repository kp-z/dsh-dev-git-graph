/**
 * 参数 → CSS 值的唯一规则。
 *
 * 构建时（生成图版的默认值）与浏览器里（滑杆改值）都必须用这一份，
 * 否则就会出现「初始渲染没有效果、拖一下滑杆才有」这种最坑的预览。
 *
 * 单位只声明一次：range 参数写 `unit: px`，值在拼装时补上，
 * 所以内容里写的是 `default: 18`，送进 CSS 的是 `18px`。
 */

export function cssValue(param, raw) {
  if (raw === undefined || raw === null) return raw
  if (param?.type === 'range' && param.unit) return `${raw}${param.unit}`
  return String(raw)
}

/**
 * 把一组参数摊成「CSS 变量名 → 值」。
 * @param {Array} params 条目声明里的参数
 * @param {Record<string, unknown>} overrides 覆盖值（滑杆当前值）
 */
export function paramValues(params, overrides = {}) {
  const out = {}
  for (const param of params ?? []) {
    if (!param?.name) continue
    const raw = Object.prototype.hasOwnProperty.call(overrides, param.name)
      ? overrides[param.name]
      : param.default
    out[param.name] = cssValue(param, raw)
  }
  return out
}
