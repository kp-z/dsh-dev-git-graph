/**
 * 测试用的进程内存储替身。
 *
 * 刻意**不引真实领域包**：真实领域的行为（打开时校验、坏记录移走、写盘排队）不是这个插件
 * 的逻辑，把它拖进单元测试只会让测试依赖外部实现。这里的替身只负责"表和记录在，并且重开
 * 还在"，用来验证管家自己的读写与判重。
 */
import type { DomainLike, StorageDomainFacility, TableLike } from '../lib/store.js'

/** 一张内存表，行为对齐 `dsh-storage-domain` 的 `KvTableImpl`。 */
export class MemoryTable<T> implements TableLike<T> {
  private readonly map = new Map<string, T>()

  get(key: string): T | undefined {
    return this.map.get(key)
  }

  entries(): IterableIterator<[string, T]> {
    return this.map.entries()
  }

  keys(): IterableIterator<string> {
    return this.map.keys()
  }

  get size(): number {
    return this.map.size
  }

  async put(key: string, value: T): Promise<void> {
    this.map.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.map.delete(key)
  }

  async update(key: string, fn: (record: T) => T): Promise<T> {
    const current = this.map.get(key)
    if (current === undefined) throw new Error('missing-key')
    const next = fn(current)
    this.map.set(key, next)
    return next
  }
}

/** 一个内存领域。 */
export class MemoryDomain implements DomainLike {
  readonly tables = new Map<string, MemoryTable<never>>()

  table<T>(name: string): TableLike<T> {
    let table = this.tables.get(name)
    if (table === undefined) {
      table = new MemoryTable<never>()
      this.tables.set(name, table)
    }
    return table as unknown as TableLike<T>
  }

  async close(): Promise<void> {
    // 内存领域没有需要释放的东西；表刻意留着，用来模拟"关掉再打开，数据还在"。
  }
}

/** 造一个存储设施 + 它背后的领域。 */
export function memoryFacility(domain = new MemoryDomain()): {
  facility: StorageDomainFacility
  domain: MemoryDomain
} {
  return {
    facility: { open: async () => domain },
    domain,
  }
}

/**
 * **对齐真宿主的**存储设施：打开领域时把介质里的每条记录过一遍表 schema。
 *
 * 为什么必须有这一份：真宿主 `@deepseek-ai/dsh-storage-domain` 在 `open()` 里对每条记录调
 * `tableSpec.valueSchema.parse(raw)`（见该包 `lib/index.js` 的 `parseRecord`），而 **zod 会静默
 * 剥掉 schema 里没声明的键**——这一点在本插件上真的咬过人：`aiFields`（字段级中文）漏声明，
 * 于是 AI 写回的中文在领域下一次打开时消失，表现成"外层中文有、每个字段的中文全空"，而
 * `memoryFacility()`（纯 Map，不 parse）让所有单测照样全绿。
 *
 * 写回路径刻意**不** parse：真宿主也只有打开那一处 parse（`KvTableImpl.put/update` 原样存），
 * 所以这份替身照抄：open 时 parse、写时不 parse——同一个进程里写进去能读出来，重开就现原形。
 *
 * 用法与 `memoryFacility()` 完全一致（同一个 `domain` 可以反复 open，模拟宿主重启）。
 * @param domain - 背后的领域（不传就新建；传同一个就模拟"重启后数据还在"）。
 * @returns 设施 + 背后的领域。
 */
export function schemaCheckedFacility(domain = new MemoryDomain()): {
  facility: StorageDomainFacility
  domain: MemoryDomain
} {
  const facility: StorageDomainFacility = {
    async open(spec: unknown): Promise<DomainLike> {
      const tables = (spec as { tables?: Record<string, unknown> } | null)?.tables ?? {}
      for (const [name, tableSpec] of Object.entries(tables)) {
        const valueSchema = (tableSpec as { valueSchema?: { parse?: (value: unknown) => unknown } } | null)?.valueSchema
        if (typeof valueSchema?.parse !== 'function') continue
        const table = domain.table<unknown>(name)
        /* 就地重建：parse 的结果才是打开后内存里的那一条（未声明的键在这一步被剥掉）。 */
        for (const [key, raw] of [...table.entries()]) {
          await table.put(key, valueSchema.parse(raw))
        }
      }
      return domain
    },
  }
  return { facility, domain }
}
