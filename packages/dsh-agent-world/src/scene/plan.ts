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
import type { SceneActor, SceneGround, ScenePlan, SceneProp } from '../protocol/scene.js'
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
    // 站点的外观由 `models` 库的约定 id 指代——渲染器去模型库里取，
    // **不在代码里写"桌子长什么样"**（决策 D10）。
    modelId: `model.station.${s.kind}`,
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
  }))

  // 纸条配色也从内容来。遍历 domain 里的 MESSAGE_KINDS 而不是在这里手写一份清单：
  // 少一个就会在渲染层退化成兜底色，而"某类纸条颜色不对"很难归因。
  const noteColors: Record<string, string> = {}
  for (const kind of MESSAGE_KINDS) {
    noteColors[kind] = resolveColor(`skin.message.${kind}`, palette)
  }

  return {
    extent: { half: extentOf(world) },
    theme,
    ground,
    props,
    actors,
    noteColors,
  }
}
