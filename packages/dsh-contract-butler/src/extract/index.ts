/**
 * 文件型抽取器的清单。
 *
 * 顺序即候选顺序，所以是显式数组而不是 Set：扫描结果是给人看的，同样的项目每次扫出来
 * 的排列应当一致，否则"这次怎么看着不一样了"会变成一种廉价的惊吓。
 *
 * 注意这里只有**文件型**抽取器。运行时内省（工具注册表）不在此列——它不遍历文件，由
 * `manage.ts` 在纳管时直接并入候选。
 */
import { jsonSchemaExtractor, openApiExtractor } from './jsonFiles.js'
import { protoExtractor } from './proto.js'
import { tsPatternExtractor } from './tsPattern.js'
import type { Extractor } from './registry.js'

/** 参与文件扫描的全部抽取器。 */
export const FILE_EXTRACTORS: Extractor[] = [
  openApiExtractor,
  jsonSchemaExtractor,
  protoExtractor,
  tsPatternExtractor,
]

export type { Extractor } from './registry.js'
export { candidateId, evidenceAt, linkTwins, makeCandidate } from './registry.js'
