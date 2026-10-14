/**
 * 磁盘真相（BACKLOG M3-1）。
 *
 * ## 两个文件，两种语义，**不要混在一起**
 *
 * | 文件 | 语义 | 写法 |
 * |---|---|---|
 * | `world.json` | **整世界的快照**（"现在是怎样"） | 原子覆盖：写临时文件 → fsync → rename |
 * | `events.jsonl` | **只增的事件历史**（"怎么变成这样的"） | 追加 |
 *
 * 为什么快照里**不带 `world.events`**：那是**环形缓冲**（只留最近 500 条），
 * 是活着的客户端的补洞窗口，不是历史。把它写进快照，历史会在第 501 条事件时开始静默丢失——
 * 而"历史丢了一段"这种事，只有在需要它的时候才会发现。
 *
 * ## 原子写为什么不是"直接用 fs.writeFile"
 *
 * 直接覆盖的话，写到一半掉电/被杀，磁盘上就留下一个**半截 JSON**，
 * 而下次启动解析它只会得到一句语法错误——原来那份也被毁了。
 * 所以顺序是：写 `world.json.tmp-*` → `fsync` → `rename`。
 * `rename` 在同一文件系统内是原子的：要么还是旧文件，要么已经是完整的新文件。
 *
 * ## 文件里没有墙上时间
 *
 * 只用 `tick` 记状态，不写 `Date.now()`。于是**同一个世界存两次得到逐字节相同的文件**，
 * 可以直接断言（有测试）。顺带也让"存档能不能复现"这件事变得可验，
 * 而不是只能靠肉眼比对。
 *
 * ## 边界
 *
 * 本模块只认 `protocol` 与 `domain` 的形状，**不认识内容库、不认识 three**。
 * 内容包版本由调用方（`state.ts`）以参数传进来，因为它才知道注册表里装了什么。
 */
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from 'node:fs'
import { appendFileSync, mkdirSync } from 'node:fs'
import { appendFile, mkdir, open, readFile, rename, rm, stat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { World, WorldEvent } from '../domain/types.js'
import type { PackVersion, WorldSnapshot } from '../protocol/index.js'

/** 存档格式版本。**不兼容的改动必须 bump**，否则旧存档会被静默读成错的东西。 */
export const WORLD_FILE_VERSION = 1

/** 存档文件名。 */
export const WORLD_FILE = 'world.json'

/** 事件历史文件名。 */
export const EVENTS_FILE = 'events.jsonl'

/**
 * 存档外壳。
 *
 * `content` 放在**外壳**里而不是塞进 `World`：`World` 是模拟内核的模型，
 * 它不该知道"内容包版本"这种装配层的事实。而存档是装配层的产物，
 * 所以外壳里记着"这一局是用哪些版本的包装出来的"——查出"旧存档表现为什么变了"时要用。
 */
export interface WorldFileEnvelope {
  fileVersion: number
  /** 落盘时世界推进到第几 tick。用它判断存档新旧，不去读文件时间。 */
  savedAtTick: number
  /** 落盘时装载的内容包（含版本）。 */
  content: PackVersion[]
  /** 世界本体（**不含**事件环形缓冲）。 */
  world: WorldSnapshot
}

/**
 * 读档结果。
 *
 * `world` 是**完整的 `World`**（不是快照类型）：磁盘上存的是不带事件环形缓冲的快照，
 * 但读出来必须是一个能直接交给运行时的世界。补一个空环是这层的职责——
 * 让每个调用方各自去补，迟早有人忘了补。
 */
export interface LoadedWorld {
  world: World
  /** 存档当时用的内容包版本。 */
  content: PackVersion[]
  savedAtTick: number
}

/** 读档时的结构问题。**不抛异常**——存档坏了不该让插件起不来，而要让调用方决定怎么办。 */
export interface LoadFailure {
  file: string
  reason: string
}

/** 存档目录里有哪些东西（诊断用）。 */
export interface StoreInfo {
  dir: string
  worldBytes: number | null
  eventLines: number | null
  /** 上一轮落盘留下的临时文件（正常情况下应当是空的——非空说明有写操作没跑完）。 */
  strayTempFiles: string[]
}

/**
 * 造存档外壳。**纯函数**（当且仅当 `world` 与 `content` 相同，结果逐字节相同）——
 * 文件里刻意不写墙上时间，于是"同一个世界存两次得到相同文件"可以被直接断言。
 */
export function buildEnvelope(world: World, content: readonly PackVersion[]): WorldFileEnvelope {
  const { events: _ring, ...snapshot } = world
  return {
    fileVersion: WORLD_FILE_VERSION,
    savedAtTick: world.tick,
    // 排序后再写：注册表的装载顺序可能因配置微调而变，但"这一局用了什么内容"
    // 不该因为顺序不同就算成不同的存档（那会让逐字节相同的断言变成偶然）。
    content: [...content].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    world: snapshot,
  }
}

/** 存档文件内容。 */
function envelopeText(world: World, content: readonly PackVersion[]): string {
  return JSON.stringify(buildEnvelope(world, content), null, 2)
}

/**
 * 事件历史的一批文本。
 *
 * 一行一条、换行结尾。这样子进程被杀死时，最坏情况是**最后一行不完整**，
 * 而前面每一行都还是合法 JSON——逐行解析时能保住绝大部分历史。
 */
function eventsText(events: readonly WorldEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n'
}

/** 世界存档。 */
export interface WorldStore {
  readonly dir: string
  /** 原子写快照。 */
  saveWorld(world: World, content: readonly PackVersion[]): Promise<void>
  /** 同步原子写快照（退出路径用，见实现处的说明）。 */
  saveWorldSync(world: World, content: readonly PackVersion[]): void
  /** 追加一批事件。目录不存在会自动建。 */
  appendEvents(events: readonly WorldEvent[]): Promise<number>
  /** 同步追加事件（退出路径用）。 */
  appendEventsSync(events: readonly WorldEvent[]): number
  /** 读档；没有存档返回 null，存档坏了返回 `{ failure }`。 */
  load(): Promise<{ ok: LoadedWorld } | { failure: LoadFailure } | null>
  /** 目录现状（诊断）。 */
  info(): Promise<StoreInfo>
}

/**
 * 建一个世界存档。
 *
 * @param dir - 存档目录（绝对路径；相对路径由调用方先解析好——本模块不猜基准）。
 */
export function createWorldStore(dir: string): WorldStore {
  const worldPath = join(dir, WORLD_FILE)
  const eventsPath = join(dir, EVENTS_FILE)

  return {
    dir,

    async saveWorld(world: World, content: readonly PackVersion[]): Promise<void> {
      await mkdir(dir, { recursive: true })

      // 临时文件名带 pid：两个进程同时存同一目录时不会互相覆盖对方的临时文件。
      const tmp = `${worldPath}.tmp-${process.pid}`
      const handle = await open(tmp, 'w')
      try {
        await handle.writeFile(envelopeText(world, content), 'utf8')
        // **fsync 不能省**：不 sync 的话 rename 可能先于数据落盘完成，
        // 掉电后就得到"名字对、内容空"的文件——那比没有存档更糟。
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(tmp, worldPath)
    },

    /**
     * 同步落盘。**退出路径专用**。
     *
     * 为什么必须有同步版本：`stop()` 之后进程可能立刻退出，而 `await` 出去的写
     * 根本没有机会跑完——那正是"最后一段历史丢了"的成因。所以在关停路径上宁可用
     * 阻塞式的 fsync，也不要一个优雅但不保证完成的 Promise。
     */
    saveWorldSync(world: World, content: readonly PackVersion[]): void {
      mkdirSync(dir, { recursive: true })
      const tmp = `${worldPath}.tmp-${process.pid}`
      const fd = openSync(tmp, 'w')
      try {
        writeSync(fd, envelopeText(world, content))
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(tmp, worldPath)
    },

    appendEventsSync(events: readonly WorldEvent[]): number {
      if (events.length === 0) return 0
      mkdirSync(dir, { recursive: true })
      appendFileSync(eventsPath, eventsText(events), 'utf8')
      return events.length
    },

    async appendEvents(events: readonly WorldEvent[]): Promise<number> {
      if (events.length === 0) return 0
      await mkdir(dir, { recursive: true })
      // 一行一条，换行结尾。这样子进程被杀死时，最坏情况是**最后一行不完整**，
      // 而前面每一行都还是合法 JSON——逐行解析时能保住绝大部分历史。
      await appendFile(eventsPath, eventsText(events), 'utf8')
      return events.length
    },

    async load() {
      const raw = await readFile(worldPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      return parseEnvelope(raw, worldPath)
    },

    async info(): Promise<StoreInfo> {
      const entries = await readdir(dir).catch(() => [] as string[])
      const worldSize = await stat(worldPath).then((s) => s.size).catch(() => null)
      const eventText = await readFile(eventsPath, 'utf8').catch(() => null)
      return {
        dir,
        worldBytes: worldSize,
        eventLines:
          eventText === null ? null : eventText.split('\n').filter((line) => line.trim() !== '').length,
        // 正常情况下必须是空的。非空说明上次写到一半就没了，值得报出来。
        strayTempFiles: entries.filter((name) => name.includes('.tmp-')),
      }
    },
  }
}

/**
 * 把"读到的文本"变成结果。**纯函数**——异步与同步两条读法共用它，
 * 不然解析与校验会有两份实现，而两份实现一定会漂移（漂移的症状是"用哪个入口读结果不一样"）。
 *
 * @param raw - 文件内容；null 表示文件不存在。
 * @param file - 文件名（只用于报错信息）。
 */
export function parseEnvelope(raw: string | null, file: string): { ok: LoadedWorld } | { failure: LoadFailure } | null {
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      failure: {
        file,
        reason:
          `存档不是合法 JSON（${error instanceof Error ? error.message : String(error)}）。` +
          '文件被截断过？删掉它就能重开一局。',
      },
    }
  }

  const problem = checkEnvelope(parsed, file)
  if (problem !== null) return { failure: problem }

  const envelope = parsed as WorldFileEnvelope
  return {
    ok: {
      // 事件环形缓冲**不从存档恢复**：它是活客户端的补洞窗口，
      // 重开时应当是空的；历史在 events.jsonl 里。
      world: { ...envelope.world, events: [] } as World,
      content: envelope.content,
      savedAtTick: envelope.savedAtTick,
    },
  }
}

/**
 * 同步读档。
 *
 * 存在的理由很具体：`apply()` 是同步的（cordis 插件入口不能是 async），
 * 而"启动时把上次的世界接回来"必须在那之前完成。整个插件只有这一处同步读，
 * 且读的是一个小 JSON——同样的做法内容层已经在用了（`loadContentPacks` 也是同步的）。
 */
export function loadWorldSync(dir: string): { ok: LoadedWorld } | { failure: LoadFailure } | null {
  const file = join(dir, WORLD_FILE)
  let raw: string | null
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  return parseEnvelope(raw, file)
}

/**
 * 检查存档外壳的形状。
 *
 * **要给出能照做的信息**：只写"存档已损坏"帮不了任何人——得说清是哪个文件、
 * 期望什么、以及眼下这一版能不能读。
 */
function checkEnvelope(value: unknown, file: string): LoadFailure | null {
  if (typeof value !== 'object' || value === null) {
    return { file, reason: '存档顶层不是对象。这个文件不是本插件写的？删掉它就能重开一局。' }
  }
  const env = value as Partial<WorldFileEnvelope>

  if (env.fileVersion !== WORLD_FILE_VERSION) {
    return {
      file,
      reason:
        `存档格式版本是 ${String(env.fileVersion)}，本版本只读 ${WORLD_FILE_VERSION}。` +
        `（升级插件后旧存档不能直接读。）删掉它就能重开一局。`,
    }
  }
  if (typeof env.savedAtTick !== 'number') {
    return { file, reason: '存档缺少 savedAtTick（落盘时的 tick）。' }
  }
  if (!Array.isArray(env.content)) {
    return { file, reason: '存档缺少 content（落盘时用的内容包版本）。' }
  }
  const world = env.world
  if (typeof world !== 'object' || world === null) {
    return { file, reason: '存档缺少 world（世界本体）。' }
  }
  for (const field of ['id', 'name', 'tick', 'seq', 'agents', 'tasks', 'stations', 'districts'] as const) {
    if ((world as Record<string, unknown>)[field] === undefined) {
      return {
        file,
        reason:
          `存档的 world 缺少必需字段 "${field}"。` +
          `已有的字段：${Object.keys(world as Record<string, unknown>).sort().join(' / ')}`,
      }
    }
  }
  return null
}

/** 删掉一个目录（测试与"重开一局"用）。 */
export async function removeStore(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}
