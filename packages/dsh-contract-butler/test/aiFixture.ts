/**
 * 假模型的"答卷夹具"：字段名从提示词里读，不手写。
 *
 * 字段级中文是**按种子逐个字段**要求的：种子里有几个字段，答案里就得有几个，少一个整批拒绝。
 * 于是测试里手抄一份字段清单就成了陷阱——扫描那一侧但凡多出一个字段，假答案当场变成"缺字段"
 * 的失败，看着像插件坏了，其实是夹具没跟上合同。
 *
 * 所以假模型照真模型的做法来：**看提示词里给它的字段，逐个回一条中文**。提示词的用户段就是这批
 * 契约的 JSON（`buildPromptParts()` 的 `user`；`buildPrompt()` 是开场白 + 同一段 JSON），解析出来
 * 交给 `seedFieldNames()` 取字段名——规则只有那一处，夹具不另写一套，也就不会跟种子悄悄分叉。
 */
import { seedFieldNames, type AiField, type ContractSeed } from '../src/understand.ts'

/** 提示词的两种给法：整段（`buildPrompt`）或分开的 system / user（`buildPromptParts`）。 */
export type PromptLike = string | { system?: string; user: string }

/**
 * 从提示词里读出这一批的种子。
 *
 * 找 `"contracts"` 再往回找它前面那个大括号，就得到用户段的开头（用户段是带缩进的 JSON，前面
 * 还有开场白，所以不能直接整段 parse）。
 *
 * 解析不出来就返回空表：夹具看不懂提示词时，假模型会答一份空卷，测试里那条断言自然就红了——
 * 而不是在这里抛一个与被测代码无关的异常，让人误以为是插件炸了。
 * @param prompt - 提示词（整段或分段）。
 * @returns 这一批的种子；看不懂就是空表。
 */
export function seedsFromPrompt(prompt: PromptLike): ContractSeed[] {
  const user = typeof prompt === 'string' ? prompt : prompt.user
  try {
    const marker = user.indexOf('"contracts"')
    const brace = marker < 0 ? -1 : user.lastIndexOf('{', marker)
    if (brace < 0) return []
    const payload = JSON.parse(user.slice(brace)) as { contracts?: unknown }
    if (!Array.isArray(payload.contracts)) return []
    return payload.contracts
      .filter((one): one is ContractSeed => one !== null && typeof one === 'object' && typeof (one as ContractSeed).id === 'string')
      .map((one) => ({ ...one, fields: linesOf(one.fields) }))
  } catch {
    return []
  }
}

/** 种子的字段行：只认字符串，别的（提示词被人改坏时）当没有。 */
function linesOf(lines: unknown): string[] {
  return Array.isArray(lines) ? lines.filter((line): line is string => typeof line === 'string') : []
}

/**
 * 这一批每条契约"必须给出中文解释"的字段：契约 id → `{name, zh}`。
 *
 * 名字逐字来自种子（所以假模型永远不会编一个种子里没有的字段），顺序也与种子一致。
 * @param prompt - 提示词（整段或分段）。
 * @returns 契约 id → 这一条要答的字段。
 */
export function fieldsFromPrompt(prompt: PromptLike): Map<string, AiField[]> {
  const out = new Map<string, AiField[]>()
  for (const seed of seedsFromPrompt(prompt)) {
    out.set(seed.id, seedFieldNames(seed).map((name) => ({ name, zh: zhOfField(name) })))
  }
  return out
}

/**
 * 假模型给一个字段写的"中文"。
 *
 * 只为过那三道硬条件（非空、含中文、不超过 120 字）——夹具不装作懂业务，业务判断归被测代码。
 */
function zhOfField(name: string): string {
  return `字段 ${name} 的中文`
}