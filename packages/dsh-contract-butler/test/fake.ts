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
