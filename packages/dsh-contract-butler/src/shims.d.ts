/**
 * 本地开发用的环境补丁，**不随包发布**。
 *
 * 本工作区里 `yaml` 与 `@deepseek-ai/dsh-storage-domain` 解析到的是应用内置的打包副本
 * （只有 `lib/*.js`，没有 `lib/types/*.d.ts`），于是 tsc 在这两个模块上直接报 TS7016/TS2307。
 * 运行期不受影响，缺的只是类型。
 *
 * 因此这里只声明**本插件实际用到的那一点表面**，不重写它们的完整 API：一旦我认错了形状，
 * 编译器会在调用点报错，而不是悄悄放过。tsc 不会把 `.d.ts` 复制进 `outDir`，`package.json`
 * 的 `files` 也只收 `lib`，所以这份补丁不会进产物；正式安装（依赖从 npm 拉取，带完整声明）
 * 时它们自然被真正的类型取代。
 */

declare module 'yaml' {
  /** 解析 YAML 文本；失败抛错。 */
  export function parse(text: string, options?: unknown): unknown
}

declare module '@deepseek-ai/dsh-storage-domain' {
  /** 一张表的声明。`valueSchema` 原样带回传入的 schema，所以类型不丢。 */
  export interface TableDeclaration<S = unknown> {
    valueSchema: S
  }
  /** 声明一张表：所有落进它的记录都要满足这个 schema（**必须是 zod schema**）。 */
  export function domainTable<S>(schema: S): TableDeclaration<S>
  /** 领域规格。 */
  export interface DomainSpec {
    name: string
    version: number
    layout?: 'single' | 'per-record'
    compatibleVersions?: number[]
    invalidRecords?: 'backup-and-skip'
    tables: Record<string, TableDeclaration>
    global?: { schema: { safeParse(value: unknown): { success: boolean } } }
  }
  /** 校验并固定领域规格；配置错误在模块加载时就抛。 */
  export function defineDomain<S extends DomainSpec>(spec: S): S
  /** 投影出交给后端的形式：`tables` 是表名数组（不是对象）。 */
  export function descriptorOf(spec: DomainSpec): {
    name: string
    version: number
    tables: string[]
    hasGlobal: boolean
    layout?: 'single' | 'per-record'
    compatibleVersions?: number[]
  }
  /** 领域操作失败，带稳定错误码。 */
  export class DomainError extends Error {
    code: string
  }
}
