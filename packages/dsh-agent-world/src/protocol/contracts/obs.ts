/**
 * obs 域契约（3 条）。
 *
 * 可观测与治理：门面、验收、登记表。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const OBS_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "obs.facade",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "obs",
    summary: "`?debug=1` 下每个域有一个可读门面；门面只读",
    verify: "planned:P1",
  },
  {
    id: "obs.verify",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "obs",
    summary: "验收列只允许三种：**存在的测试文件+用例名 / 存在的门面调用 / `planned:<阶段>`**；登记表测试校验前两种存在（P0 后转 frozen）",
    verify: "test/contracts.test.js",
  },
  {
    id: "obs.registry",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "obs",
    summary: "代码登记表与本文目录一一对应（P0 落地后转 frozen）",
    verify: "test/contracts.test.js",
  },
]
