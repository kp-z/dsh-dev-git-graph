/**
 * 契约登记表的**格式自检**。
 *
 * 只做"能不能被机器检查"的那部分：id 形状、域、owner、稳定性、版本、验收形态。
 * 文案级别的一致性在 `test/contracts.test.js` 里与文档双向比对。
 */
import { CONTRACT_DOMAINS, CONTRACT_STABILITIES } from './types.js'
import type { ContractMeta } from './types.js'

/** 验收入口是否合法。规则只有三种，理由见 {@link ContractMeta.verify}。 */
export function isContractVerify(value: string): boolean {
  if (value.startsWith('__agentWorld')) return true
  if (/^planned:P[0-4]$/.test(value)) return true
  if (!value.startsWith('test/')) return false
  // 目录穿越与绝对路径都不接受：验收入口只能是包内的测试文件。
  if (value.includes('..') || value.startsWith('/')) return false
  return value.endsWith('.test.js')
}

/** 格式自检：id 形状、主人、稳定性、版本、验收。返回人类可读的问题列表（空 = 通过）。 */
export function lintContracts(entries: readonly ContractMeta[]): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.id)) problems.push(`契约 id 重复：${entry.id}`)
    seen.add(entry.id)

    const segments = entry.id.split('.')
    if (segments.length < 2 || segments.length > 3) {
      problems.push(`契约 id 必须是 2–3 段：${entry.id}`)
    }
    if (!/^[a-z][a-z0-9]*$/.test(segments[0] ?? '')) problems.push(`契约 id 的域不合法：${entry.id}`)
    if (!(CONTRACT_DOMAINS as readonly string[]).includes(segments[0] ?? '')) {
      problems.push(`契约 id 的域不在 CONTRACT_DOMAINS：${entry.id}`)
    }
    if (entry.owner !== segments[0]) problems.push(`owner 与 id 的域不一致：${entry.id}`)
    if (!CONTRACT_STABILITIES.includes(entry.stability)) problems.push(`未知稳定性：${entry.id}`)
    if (entry.kind !== 'data' && entry.kind !== 'behavior') problems.push(`未知契约类型：${entry.id}`)
    if (!Number.isInteger(entry.version) || entry.version < 1) problems.push(`版本必须是正整数：${entry.id}`)
    if (entry.summary.trim() === '') problems.push(`缺少承诺：${entry.id}`)
    if (!isContractVerify(entry.verify)) problems.push(`验收入口不合法：${entry.id} → ${entry.verify}`)
  }
  return problems
}
