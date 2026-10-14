/**
 * 内容注册表（BACKLOG M1-3）。
 *
 * ## 它解决什么
 *
 * "方便替换升级和切换"落到机制上就是三件事：
 * 1. **稳定 id**：代码永远引用 `action.walk`，不引用 `walk.fbx`。
 * 2. **提供方链（provider chain）**：同一个 id 可以有多个包提供实现，**当前生效的排在最前**。
 *    切换提供方 = 改链序，不改任何一处调用点。
 * 3. **回退**：链上第一个能用就用它，用不了就往后退（`resolve` 拿到整条链，
 *    由调用方决定"能不能用"——比如 GLB 下载失败就算不能用）。
 *
 * ## 覆盖必须显式
 *
 * 一个包想顶掉别人同 id 的条目，必须在清单的 `overrides` 里写明 `kind/id`。
 * 没写就撞 id 视为冲突并报错。理由："悄悄换掉别人的内容"是最难查的一类问题——
 * 世界看起来一切正常，只是某个站点变成了别的东西。
 *
 * ## 依赖顺序
 *
 * 包之间用 `requires` 声明依赖，`loadAll` 按拓扑序装载：被依赖的先装，
 * 于是"覆盖"这种事有确定的先后（后面的包可以顶掉前面的）。
 */
import { LIBRARY_SPECS } from './kinds.js'
import type { ContentPack, EntryOf, LibraryKind } from './kinds.js'
import type { Issue } from './validate.js'
import { validatePack } from './validate.js'

/** 某个 id 的一个提供方。 */
export interface Provider<T> {
  /** 提供它的包 id。 */
  pack: string
  data: T
}

/** 注册表里的一个条目（取当前生效的提供方）。 */
export interface Resolved<T> {
  id: string
  pack: string
  data: T
}

/** 装载一个包的选项。 */
export interface LoadOptions {
  /**
   * 允许覆盖但没有在 `overrides` 里声明的 id。
   *
   * 默认 false。只在"用户明确想用本地内容顶掉内置内容"这种场景下由插件配置打开；
   * 打开它就是放弃了那条"覆盖必须显式"的护栏，所以会有明确的警告。
   */
  allowImplicitOverride?: boolean
}

/** 内容注册表。 */
export class ContentRegistry {
  /** kind → id → 提供方链（index 0 = 当前生效）。 */
  private readonly bag = new Map<LibraryKind, Map<string, Provider<unknown>[]>>()
  private readonly manifests: ContentPack['manifest'][] = []

  /** 已装载的包清单，按装载顺序。 */
  get packs(): readonly ContentPack['manifest'][] {
    return this.manifests
  }

  /** 已装载的包 id，按装载顺序。 */
  get packIds(): string[] {
    return this.manifests.map((m) => m.id)
  }

  /** 包是否已装载。 */
  has(packId: string): boolean {
    return this.manifests.some((m) => m.id === packId)
  }

  /**
   * 按拓扑序装载多个包：被依赖的先装。
   *
   * @param packs - 内容包列表（顺序无所谓，依赖关系说了算）。
   * @param options - 装载选项。
   * @returns 全部校验与装载问题；含 `error` 时调用方应当放弃使用这个注册表。
   */
  loadAll(packs: readonly ContentPack[], options: LoadOptions = {}): Issue[] {
    const issues: Issue[] = []
    const byId = new Map(packs.map((p) => [p.manifest.id, p]))

    // 拓扑排序（DFS + 三色）。顺手把缺失依赖与环报出来。
    const order: ContentPack[] = []
    const state = new Map<string, 'visiting' | 'done'>()
    const visit = (pack: ContentPack, trail: string[]): void => {
      const id = pack.manifest.id
      const s = state.get(id)
      if (s === 'done') return
      if (s === 'visiting') {
        issues.push({
          level: 'error',
          pack: id,
          where: 'pack.manifest.requires',
          message: `包依赖存在环：${[...trail, id].join(' → ')}`,
        })
        return
      }
      state.set(id, 'visiting')
      for (const dep of pack.manifest.requires) {
        const target = byId.get(dep)
        if (!target) {
          issues.push({
            level: 'error',
            pack: id,
            where: 'pack.manifest.requires',
            message: `依赖的包 "${dep}" 没有提供。已提供的包：${[...byId.keys()].join(' / ') || '（无）'}`,
          })
          continue
        }
        visit(target, [...trail, id])
      }
      state.set(id, 'done')
      order.push(pack)
    }
    for (const p of packs) visit(p, [])

    for (const pack of order) {
      if (issues.some((i) => i.pack === pack.manifest.id && i.level === 'error')) continue
      issues.push(...this.load(pack, options))
    }
    return issues
  }

  /**
   * 装载单个包。不会重复装载同一个包 id。
   *
   * @param pack - 内容包。
   * @param options - 装载选项。
   */
  load(pack: ContentPack, options: LoadOptions = {}): Issue[] {
    if (this.has(pack.manifest.id)) {
      return [
        {
          level: 'warning',
          pack: pack.manifest.id,
          where: 'pack.manifest.id',
          message: `包 "${pack.manifest.id}" 已经装载过，本次忽略（重复装载通常是配置写重了）。`,
        },
      ]
    }

    const issues = validatePack(pack)
    if (issues.some((i) => i.level === 'error')) return issues

    const packId = pack.manifest.id
    const declaredOverrides = new Set(pack.manifest.overrides)

    for (const kind of Object.keys(pack.entries) as LibraryKind[]) {
      const list = pack.entries[kind]
      if (!Array.isArray(list)) continue
      for (const entry of list) {
        const id = (entry as { id: string }).id
        const chain = this.ensureChain(kind, id)
        const existing = chain.length > 0

        if (existing && !declaredOverrides.has(`${kind}/${id}`)) {
          const owners = chain.map((p) => p.pack).join('、')
          if (!options.allowImplicitOverride) {
            issues.push({
              level: 'error',
              pack: packId,
              where: `${kind}/${id}`,
              message:
                `条目 id 与包 ${owners} 冲突。要么改 id，要么在 manifest.overrides 里显式写 "${kind}/${id}" ` +
                '——覆盖别人的内容必须留下痕迹，否则世界会静默地变成另一个样子。',
            })
            continue
          }
          issues.push({
            level: 'warning',
            pack: packId,
            where: `${kind}/${id}`,
            message: `隐式覆盖了包 ${owners} 的同 id 条目（allowImplicitOverride 已打开）。`,
          })
        }

        // 新来的排到链首（= 当前生效）；旧的留在链尾当回退。
        chain.unshift({ pack: packId, data: entry })
      }
    }

    this.manifests.push(pack.manifest)
    return issues
  }

  /** 取当前生效的条目。 */
  get<K extends LibraryKind>(kind: K, id: string): Resolved<EntryOf<K>> | undefined {
    const chain = this.chainOf(kind, id)
    const head = chain[0]
    if (!head) return undefined
    return { id, pack: head.pack, data: head.data as EntryOf<K> }
  }

  /**
   * 取条目，取不到就抛。
   *
   * @param kind - 库种类。
   * @param id - 条目 id。
   * @param why - 调用方补充的上下文（"场景 X 引用的主题"），会进报错文案，
   *   否则用户只看到"找不到 id.y"完全不知道从哪查起。
   */
  require<K extends LibraryKind>(kind: K, id: string, why?: string): EntryOf<K> {
    const found = this.get(kind, id)
    if (!found) {
      const available = this.list(kind).map((e) => e.id)
      throw new Error(
        `内容缺失：${kind} 库里没有 "${id}"${why ? `（${why}）` : ''}。` +
          `可用条目：${available.length > 0 ? available.join(' / ') : '（该库为空）'}`,
      )
    }
    return found.data
  }

  /**
   * 解析 id 的**提供方链**，按 `prefer` 的包顺序优先。
   *
   * 这是"切换"的入口：调用方传 `['my-local-pack', 'kenney-mini']`，
   * 就用本地包优先，本地包没有的条目自然落回 kenney-mini。
   *
   * @param kind - 库种类。
   * @param id - 条目 id。
   * @param prefer - 优先的包 id 列表（前面的优先）。不传 = 用装载顺序的当前生效项。
   */
  resolve<K extends LibraryKind>(kind: K, id: string, prefer?: readonly string[]): Provider<EntryOf<K>>[] {
    const chain = this.chainOf(kind, id)
    if (!prefer || prefer.length === 0) return chain as Provider<EntryOf<K>>[]
    const ranked: Provider<EntryOf<K>>[] = []
    for (const packId of prefer) {
      for (const p of chain) {
        if (p.pack === packId && !ranked.includes(p as Provider<EntryOf<K>>)) {
          ranked.push(p as Provider<EntryOf<K>>)
        }
      }
    }
    // prefer 里没提到的提供方跟在后面，保证"优先"不等于"只能用它"。
    for (const p of chain) {
      if (!ranked.includes(p as Provider<EntryOf<K>>)) ranked.push(p as Provider<EntryOf<K>>)
    }
    return ranked
  }

  /** 某个 id 的全部提供方（含未生效的），用于诊断"到底谁提供了它"。 */
  providersOf(kind: LibraryKind, id: string): string[] {
    return this.chainOf(kind, id).map((p) => p.pack)
  }

  /** 列出某个库当前生效的全部条目。 */
  list<K extends LibraryKind>(kind: K): Resolved<EntryOf<K>>[] {
    const map = this.bag.get(kind)
    if (!map) return []
    const out: Resolved<EntryOf<K>>[] = []
    for (const [id, chain] of map) {
      const head = chain[0]
      if (head) out.push({ id, pack: head.pack, data: head.data as EntryOf<K> })
    }
    // 按 id 排序：让输出稳定（否则 Map 的迭代顺序会让测试与 diff 飘）。
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  /** 库里有没有条目。 */
  size(kind: LibraryKind): number {
    return this.bag.get(kind)?.size ?? 0
  }

  /**
   * 跨包引用完整性校验（合并之后才查得到）。
   *
   * 这一层专门抓 tsc 抓不到、运行时又难定位的错误：站点引用了不存在的地块、
   * 场景引用了不存在的主题、某个 `AgentState` 没有任何动作（角色走到那个状态就没有动画）。
   */
  validate(): Issue[] {
    const issues: Issue[] = []
    const missing = (where: string, kind: LibraryKind, id: string, who: string): void => {
      issues.push({
        level: 'error',
        pack: this.providersOf(kind, id)[0] ?? null,
        where,
        message: `${who} 引用了不存在的 ${kind} 条目 "${id}"。${
          this.size(kind) > 0 ? `可用：${this.list(kind).map((e) => e.id).join(' / ')}` : `（${kind} 库是空的——是不是有内容包没装载？）`
        }`,
      })
    }

    for (const st of this.list('stations')) {
      if (!this.get('districts', st.data.district)) {
        missing(`stations/${st.id}.district`, 'districts', st.data.district, `站点 ${st.id}`)
      }
      if (st.data.relativeTo && !this.get('districts', st.data.relativeTo)) {
        missing(`stations/${st.id}.relativeTo`, 'districts', st.data.relativeTo, `站点 ${st.id} 的 relativeTo`)
      }
    }

    for (const sc of this.list('scenes')) {
      for (const d of sc.data.districts) {
        if (!this.get('districts', d)) missing(`scenes/${sc.id}.districts`, 'districts', d, `场景 ${sc.id}`)
      }
      for (const s of sc.data.stations) {
        if (!this.get('stations', s)) missing(`scenes/${sc.id}.stations`, 'stations', s, `场景 ${sc.id}`)
      }
      if (!this.get('rosters', sc.data.roster)) {
        missing(`scenes/${sc.id}.roster`, 'rosters', sc.data.roster, `场景 ${sc.id}`)
      }
      // theme 属于表现库：host 侧可能没装任何表现库，那就不该报错。
      if (this.size('themes') > 0 && !this.get('themes', sc.data.theme)) {
        missing(`scenes/${sc.id}.theme`, 'themes', sc.data.theme, `场景 ${sc.id}`)
      }
    }

    // 皮肤 token 引用：只在确实装了皮肤库时才查（同理，host 侧可能没有表现库）。
    if (this.size('skins') > 0) {
      const tokens = new Set<string>()
      for (const skin of this.list('skins')) for (const t of Object.keys(skin.data.colors)) tokens.add(t)
      const checkToken = (where: string, value: string, who: string): void => {
        if (!value.startsWith('skin.')) return // 不是 token，当字面色值用
        const bare = value.slice('skin.'.length)
        if (!tokens.has(bare) && !tokens.has(value)) {
          issues.push({
            level: 'error',
            pack: null,
            where,
            message: `${who} 引用了不存在的皮肤 token "${value}"。可用 token：${[...tokens].sort().join(' / ')}`,
          })
        }
      }
      for (const d of this.list('districts')) checkToken(`districts/${d.id}.ground`, d.data.ground, `地块 ${d.id}`)
      for (const r of this.list('rosters')) {
        r.data.seats.forEach((seat, i) =>
          checkToken(`rosters/${r.id}.seats[${i}].palette`, seat.palette, `花名册 ${r.id} 的第 ${i + 1} 个席位`),
        )
      }
    }

    // 动作覆盖度：每个 AgentState 至少该有一个动作。
    // 注意这是**表现库**的检查，所以要表里非空才有意义。
    if (this.size('actions') > 0) {
      const covered = new Set(this.list('actions').map((a) => a.data.state))
      const need: readonly string[] = ['idle', 'walking', 'working', 'talking', 'blocked', 'celebrating', 'sleeping']
      const absent = need.filter((s) => !covered.has(s as never))
      // `sleeping` 缺了只是没动画，先不当错误；其余缺了角色会僵在上一帧。
      const hard = absent.filter((s) => s !== 'sleeping')
      for (const s of hard) {
        issues.push({
          level: 'error',
          pack: null,
          where: 'actions',
          message: `没有任何动作服务于状态 "${s}"，角色进入这个状态时会僵在上一帧。请补一条 action 条目（clip 可以是 null 表示程序化动画）。`,
        })
      }
      if (absent.includes('sleeping')) {
        issues.push({
          level: 'warning',
          pack: null,
          where: 'actions',
          message: '状态 "sleeping" 没有对应动作，角色休息时会保持站立。',
        })
      }
    }

    return issues
  }

  /** 一句话摘要，给诊断输出与工具用。 */
  describe(): string {
    const parts = LIBRARY_SPECS.map((s) => `${s.title} ${this.size(s.kind)}`).filter((p) => !p.endsWith(' 0'))
    return `内容包 ${this.packIds.length} 个（${this.packIds.join('、') || '无'}）· ${parts.join(' · ') || '无条目'}`
  }

  private chainOf(kind: LibraryKind, id: string): Provider<unknown>[] {
    return this.bag.get(kind)?.get(id) ?? []
  }

  /**
   * 写入用的链获取——**只有 `load` 能调它**。
   *
   * 读路径（get/resolve/list/size）一律走只读的 `chainOf`：如果读也建空链，
   * `size()` 与 `list()` 就会把"查过一次但不存在"的 id 算成有条目。
   */
  private ensureChain(kind: LibraryKind, id: string): Provider<unknown>[] {
    let map = this.bag.get(kind)
    if (!map) {
      map = new Map()
      this.bag.set(kind, map)
    }
    let chain = map.get(id)
    if (!chain) {
      chain = []
      map.set(id, chain)
    }
    return chain
  }
}
