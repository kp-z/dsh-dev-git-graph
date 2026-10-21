/**
 * knowledge 域契约（4 条）。
 *
 * 知识库：条目、写入、检索、遗忘。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const KNOWLEDGE_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "knowledge.entry",
    version: 1,
    stability: "experimental",
    kind: "data",
    owner: "knowledge",
    summary: "条目形状 + scope（私有/团队/世界只读）+ 来源",
    verify: "planned:P3",
  },
  {
    id: "knowledge.write",
    version: 1,
    stability: "experimental",
    kind: "behavior",
    owner: "knowledge",
    summary: "只写结论；幂等键；去重；冲突**保留两版**不静默覆盖",
    verify: "planned:P3",
  },
  {
    id: "knowledge.retrieve",
    version: 1,
    stability: "experimental",
    kind: "behavior",
    owner: "knowledge",
    summary: "带预算（条数/字节）的 top-k；空结果合法；超时降级为不注入",
    verify: "planned:P3",
  },
  {
    id: "knowledge.forget",
    version: 1,
    stability: "experimental",
    kind: "behavior",
    owner: "knowledge",
    summary: "TTL + 容量淘汰 + tombstone；删除可审计",
    verify: "planned:P3",
  },
]
