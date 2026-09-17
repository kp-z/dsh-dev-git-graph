/**
 * 领域声明助手：`defineDomain` 与 `domainTable`。
 *
 * **为什么自己带一份**：这两个函数本来在 `@deepseek-ai/dsh-storage-domain` 里，而那个包只存在于
 * **app 的 node_modules**，profile 里没有安装它（profile 里装上的一堆插件没有一个在运行时引用
 * 它）。Node 的解析规则是从本文件所在目录往上找，装进 profile 后这条路径上根本没有它——直接
 * `import` 的结果就是"装上即崩"，而且崩在模块加载期，可能连累整个 profile 启动。
 *
 * 好在这两个助手薄到可以照抄：
 * - `domainTable(schema)` 只是给 schema 套一层 `{ valueSchema: schema }`；
 * - `defineDomain(spec)` 只做字段校验，然后原样返回 spec。
 *
 * 真正的实现——落盘、按序发事件、descriptor 投影、记录逐条的 `valueSchema.parse`——全在宿主
 * 那一侧，本插件只负责把 spec 交出去。
 *
 * **代价与兜底**：这样就放弃了 `defineDomain` 在模块加载时的"响亮失败"。所以
 * `test/domain.test.ts` 会把这里产出的 spec **再喂给真的 `defineDomain`**：形状一旦对不上，
 * 测试立刻红，而不是等到装进 profile 才发现。
 */

/** 域与表名的约束，与宿主一致。 */
const UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/

/** 一张表的声明。 */
export interface TableDeclaration<S> {
  valueSchema: S
}

/** 域声明。 */
export interface DomainSpec {
  name: string
  version: number
  layout?: 'single' | 'per-record'
  compatibleVersions?: number[]
  invalidRecords?: 'backup-and-skip'
  tables: Record<string, TableDeclaration<unknown>>
  global?: { schema: { safeParse(value: unknown): { success: boolean } } }
}

/**
 * 声明一张表。
 * @param schema - 校验该表每条记录的 zod schema。
 * @returns 表声明。
 */
export function domainTable<S>(schema: S): TableDeclaration<S> {
  return { valueSchema: schema }
}

/**
 * 校验一份域声明并原样返回。
 *
 * 迁移自 `@deepseek-ai/dsh-storage-domain`，校验项与报错措辞保持一致，便于与宿主对照。
 * @param spec - 域声明。
 * @returns 同一份 spec。
 */
export function defineDomain<T extends DomainSpec>(spec: T): T {
  if (!UNIT_NAME_RE.test(spec.name)) {
    throw new Error(`domain name '${spec.name}' must match ${UNIT_NAME_RE}`)
  }
  if (!Number.isInteger(spec.version) || spec.version < 0) {
    throw new Error(`domain '${spec.name}' version must be a non-negative integer, got ${spec.version}`)
  }
  for (const compat of spec.compatibleVersions ?? []) {
    if (!Number.isInteger(compat) || compat < 0 || compat >= spec.version) {
      throw new Error(
        `domain '${spec.name}' compatibleVersions entries must be non-negative integers below version ${spec.version}, got ${compat}`,
      )
    }
  }
  if (spec.layout !== undefined && spec.layout !== 'single' && spec.layout !== 'per-record') {
    throw new Error(`domain '${spec.name}' layout must be 'single' or 'per-record', got ${spec.layout}`)
  }
  if (spec.invalidRecords !== undefined && spec.invalidRecords !== 'backup-and-skip') {
    throw new Error(
      `domain '${spec.name}' invalidRecords must be 'backup-and-skip' when present, got ${spec.invalidRecords}`,
    )
  }
  for (const table of Object.keys(spec.tables)) {
    if (!UNIT_NAME_RE.test(table)) {
      throw new Error(`domain '${spec.name}' table name '${table}' must match ${UNIT_NAME_RE}`)
    }
  }
  if (spec.global !== undefined && spec.global.schema.safeParse(null).success) {
    throw new Error(
      `domain '${spec.name}' global schema must not accept null: null is the medium's "never written" sentinel, so a stored null could not round-trip`,
    )
  }
  return spec
}
