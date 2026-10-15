/**
 * 场景描述层（BACKLOG M4-0）。
 *
 * ## 它解决什么问题
 *
 * "用 GitHub 上现成的游戏场景"听起来很省事，但有个硬碰硬的地方：
 * **现成场景都自带一套烘死的布局**，而我们的布局来自内容库
 * （`districts` / `stations` / `scenes`）。直接搬一个村子的场景图过来，要么把内容
 * 硬套到它的节点名字上（脆得可怕），要么只借它的美术风格。
 *
 * 所以这里加一层：**把世界翻译成一份与渲染器无关的"要摆什么"清单**。
 * 于是渲染层只是"把 ScenePlan 画出来"，而：
 * - 换成现成的 three.js 场景 = 让它消费 `ScenePlan`，**不改模拟层、不改内容库**；
 * - 我们自己写程序化场景 = 也消费它；
 * - 将来的 Godot 客户端 = 还是消费它（决策 D2 的"渲染层可整个替换"到这里才真的成立）。
 *
 * ## 类型在哪
 *
 * `ScenePlan` 的形状住在 `protocol/scene.ts`——因为它是快照的一部分、要跨进程。
 * 本文件只有"**怎么算出来**"。分开的理由见那个文件顶部的注释（连我踩的那个坑都写在里面）。
 *
 * ## 三条规矩
 *
 * 1. **颜色在这里就解析完**。上层拿到 `#6F7D5A`，不是 `skin.ground.engineering`。
 * 2. **不含任何渲染器概念**。没有 mesh / material，只有"在哪、多大、什么色、什么模型 id"。
 * 3. **纯函数**。不碰 IO、不碰时间、不碰随机——所以能在 `node --test` 里直接验，
 *    不需要起浏览器。这也是它为什么能在断网时先做完。
 */
import type { World } from '../domain/types.js'
import { MESSAGE_KINDS } from '../domain/types.js'
import { boundsCenter } from '../domain/geometry.js'
import type { SceneActor, SceneGround, ScenePlan, SceneProp , SceneModel} from '../protocol/scene.js'
import { resolveColor } from '../protocol/scene.js'
import type { ThemePlan } from '../protocol/theme.js'

/** 世界半径：取所有地块边界与角色位置的绝对值上界。 */
function extentOf(world: World): number {
  let half = 1
  for (const d of world.districts) {
    half = Math.max(
      half,
      Math.abs(d.bounds.min.x),
      Math.abs(d.bounds.max.x),
      Math.abs(d.bounds.min.z),
      Math.abs(d.bounds.max.z),
    )
  }
  for (const a of world.agents) {
    half = Math.max(half, Math.abs(a.position.x), Math.abs(a.position.z))
  }
  return half
}

/**
 * 把世界翻译成渲染就绪的场景描述。
 *
 * @param world - 世界（只读，**不被修改**）。
 * @param palette - 调色板（token → 色值），由内容层的 `skins` 库合并而来。
 * @param theme - 这一局的主题（已解析好）；缺省为 null。
 */
export function buildScenePlan(
  world: World,
  palette: Readonly<Record<string, string>>,
  theme: ThemePlan | null,
  /**
   * 按 id 取模型的渲染就绪描述。由 host 注入（内容层实现），
   * 这样场景描述层**不用认识内容库**，只认识 `SceneModel` 这个契约。
   */
  resolveModel: (id: string) => SceneModel | null = () => null,
): ScenePlan {
  const ground: SceneGround[] = world.districts.map((d) => {
    const c = boundsCenter(d.bounds)
    return {
      id: d.id,
      name: d.name,
      kind: d.kind,
      x: c.x,
      z: c.z,
      width: Math.abs(d.bounds.max.x - d.bounds.min.x),
      depth: Math.abs(d.bounds.max.z - d.bounds.min.z),
      color: resolveColor(d.ground, palette),
    }
  })

  const occupied = new Set<string>()
  for (const a of world.agents) {
    if (a.station !== null) occupied.add(a.station)
    if (a.targetStation !== null) occupied.add(a.targetStation)
  }

  const props: SceneProp[] = world.stations.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    x: s.anchor.x,
    z: s.anchor.z,
    // 站点的外观由**内容声明**的模型 id 指代（R16 改）。
    //
    // 这里原来是 `` `model.station.${s.kind}` `` ——**代码拼接出来的 id**。
    // 那违反"模型选择是内容"这条红线，且坏得很安静：内容里把某个站点换成别的模型、
    // 或者加了新的 kind 而模型另有其名，代码就会指向一个**不存在的模型**，
    // 而 `models` 库看起来完全正常。
    // `parts` 是**派生量**，而它在存档里可能不存在（R48 真机：旧存档的站点没有这个字段，
    // 计划层直接 `.map` 就 500）。从存档接回的世界不重算站点的外观声明——
    // 所以这里对缺失字段容错，退回单件 `model`（这正是 R47 记的 M10-12 的另一个面孔：
    // "存档该不该存可以被重算的派生量"）。
    parts: (Array.isArray(s.parts) && s.parts.length > 0
      ? s.parts
      : [{ modelId: s.model, dx: 0, dy: 0, dz: 0, rotationY: 0 }]
    ).map((part) => ({ ...part })),
    color: resolveColor(`skin.station.${s.kind}`, palette),
    capacity: s.capacity,
    occupied: occupied.has(s.id),
  }))

  const actors: SceneActor[] = world.agents.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    x: a.position.x,
    z: a.position.z,
    facing: a.facing,
    state: a.state,
    color: resolveColor(a.palette, palette),
    carryingTaskId: a.carrying,
    modelId: world.agentModel,
  }))

  // 纸条配色也从内容来。遍历 domain 里的 MESSAGE_KINDS 而不是在这里手写一份清单：
  // 少一个就会在渲染层退化成兜底色，而"某类纸条颜色不对"很难归因。
  const noteColors: Record<string, string> = {}
  for (const kind of MESSAGE_KINDS) {
    noteColors[kind] = resolveColor(`skin.message.${kind}`, palette)
  }

  // 只把**这一局用到的**模型放进计划：整本 `models` 库搬过去既浪费，
  // 又会让"这局到底用了什么"看不清。顺序按首次引用，稳定且可读。
  const usedIds: string[] = []
  for (const prop of props) {
    for (const part of prop.parts) if (!usedIds.includes(part.modelId)) usedIds.push(part.modelId)
  }
  if (!usedIds.includes(world.agentModel)) usedIds.push(world.agentModel)
  const models: SceneModel[] = []
  for (const id of usedIds) {
    const resolved = resolveModel(id)
    // 解析不出来就**不放进去**，让渲染器按"计划里没有这个 id"报出来。
    // 这里不编一个假的兜底模型——那会把一个内容错误变成一个说不清的画面。
    if (resolved !== null) models.push(resolved)
  }

  return {
    extent: { half: extentOf(world) },
    theme,
    ground,
    props,
    actors,
    models,
    noteColors,
  }
}
