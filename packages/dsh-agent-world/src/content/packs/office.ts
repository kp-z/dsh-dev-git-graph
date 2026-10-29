/**
 * **Microverse 原版办公室**（R62）——把我们解出来的那张图变成这一局的场景。
 *
 * ## 这个包和 `pack.pixel` 的关系
 *
 * `pack.pixel` 是"用像素素材拼一个办公室"：它**自己声明** 10 个站点、给每个站点写
 * `props`（桌、椅、显示器…）与 `slots`（人站哪）。那是**我们用素材现搭**的场景。
 *
 * 这个包是"**把原版场景搬过来**"：地图已经把家具画好了（1322 格原版图块），
 * 所以站点**只需要位置与能力，不需要 props**——家具位置不再是我们维护的数据。
 *
 * 两个包**整条覆盖**同名的 districts/stations，所以装了本包就等于换场景。
 * 这也是 D31"表现是内容"真正兑现的地方：换场景 = 换一个包。
 *
 * ## 数据从哪来
 *
 * `office-map.ts`（`scripts/convert-microverse-map.mjs` 从 Godot 场景解出）
 * `office-scene.ts`（`scripts/gen-office-scene.mjs` 把地图转成分区与站点）
 *
 * **两个都是生成物，不要手改**；改转换器再重跑。
 */
import type { ContentPack, DistrictEntry, StationEntry, MapEntry, SceneEntry } from '../kinds.js'
import { OFFICE_BACKGROUND, OFFICE_DISTRICTS, OFFICE_STATIONS } from './office-scene.js'
import { OFFICE_MAP } from './office-map.js'
import { OFFICE_OCCUPANCY, OFFICE_OCCUPANCY_RECTS } from './office-occupancy.js'

/** 美术占位格：并进 walkable（不能站），同时留给 `SceneSpace` 生成整格碰撞体。 */
const OCCUPIED = new Set(OFFICE_OCCUPANCY)

/** 底图（整张办公室，1184×672）。 */
const MAP: MapEntry = {
  id: 'map.office',
  name: 'Microverse 办公室',
  url: OFFICE_BACKGROUND.url,
  width: OFFICE_BACKGROUND.width,
  height: OFFICE_BACKGROUND.height,
  cellPx: OFFICE_BACKGROUND.cellPx,
  unitsPerCell: OFFICE_BACKGROUND.unitsPerCell,
  // 原版图块的物理多边形解出来的可行走网格（248/777 格是墙或家具）。
  // R229：再并上"美术明显是家具、但物理多边形没挡"的 7 格——它们**画面上有东西**，
  // 挡上去不是空气墙，是不让人站在台面上。
  walkable: OFFICE_MAP.walkable.map((value, index) => (value === true && OCCUPIED.has(index) ? false : value)),
  occupancy: OFFICE_OCCUPANCY,
  occupancyRects: OFFICE_OCCUPANCY_RECTS,
}

/**
 * 9 个房间 → 分区。
 *
 * ⚠️ **房间描述（`desc`）原版就有**，而且是我们见过最省事的内容来源：
 * 会议室"大显示屏、两个写字板、一个大会议桌以及四个座位"、
 * 办公室"北半部分财务团队六个工位，南边软件工程师八个工位"——**不用我们编**。
 * 但它们现在**只用于分区**，还没有进对话上下文。那是一条独立的小改动（见 BACKLOG M14-5）。
 */
const DISTRICTS: DistrictEntry[] = OFFICE_DISTRICTS.map((d) => ({
  id: d.id,
  name: d.name,
  // 原版有 9 个房间，我们的 `DistrictKind` 只有 4 个值（它决定强调色）——
  // 映射是有损的，见 `gen-office-scene.mjs` 的 `ROOM_KIND`。这里如实转换。
  kind: d.kind as DistrictEntry['kind'],
  bounds: {
    min: { x: d.bounds.min.x, z: d.bounds.min.z },
    max: { x: d.bounds.max.x, z: d.bounds.max.z },
  },
  // 地面色仍走皮肤库——但**底图会盖住它**，所以在装了底图的这一局里，
  // 这个色只在"底图加载失败"时看得见（那正是我们想保留的回退）。
  ground: 'skin.ground.engineering',
}))

/** 24 把椅子 → 站点。**没有 `props`**：地图已经把家具画好了。 */
const CHAIR = 'model.part.chair-desk'

/**
 * R463：原版地图只画了椅子，没有“椅子可坐点”；很多站的 slots 还是 {0,0}，
 * 人就会坐到桌子旁边。这里给 desk 补一把明确椅子 + slot，会议桌补 4 把。
 * 地图里原有的椅子保留（用户要求“多放几把”），新增的是可坐、可碰撞的椅子。
 */
const EXTRA_CHAIRS: Record<string, { x: number; z: number; rotationY: number }> = {
  'station.seat-04': { x: 0, z: 1.5, rotationY: 0 },
  'station.seat-05': { x: 0, z: 1.5, rotationY: 0 },
  'station.seat-15': { x: 0, z: -1.5, rotationY: Math.PI },
  'station.seat-16': { x: 0, z: -1.5, rotationY: Math.PI },
}

const STATIONS: StationEntry[] = OFFICE_STATIONS.map((s) => {
  const base = {
    id: s.id,
    name: s.name,
    kind: s.kind as StationEntry['kind'],
    district: s.district,
    anchor: { x: s.anchor.x, z: s.anchor.z },
    relativeTo: null,
    capacity: s.capacity,
    capabilities: s.capabilities as StationEntry['capabilities'],
  }
  const extra = EXTRA_CHAIRS[s.id]
  if (extra !== undefined && s.kind === 'desk') {
    return {
      ...base,
      // 额外椅子只做装饰/占位，不改官方 seat slot，避免把工位坐点挪进墙里。
      props: [{ model: 'model.part.chair-desk', offset: { x: extra.x, z: extra.z }, rotationY: extra.rotationY }],
      slots: s.slots.map((v) => ({ x: v.x, z: v.z })),
    }
  }
  return { ...base, slots: s.slots.map((v) => ({ x: v.x, z: v.z })) }
})

/**
 * **这一局的装配单**：只引用原版办公室的 9 个分区与 24 个座位。
 *
 * 为什么需要它：`overrides` 只能**按 id 替换**条目，删不掉别人的。而基础包里有
 * 4 个分区（工程区/机房/会议区/公共区）和 10 个手摆的站点——它们会和原版的并存，
 * 于是角色可能被派到"墙外面那个工位"去。
 *
 * `SceneEntry` 就是为这件事存在的：**它按 id 列出这一局用哪些地块与站点**。
 * 所以切换场景 = 换一个 scene 条目，而不是删别人的内容。这也是"包是替换与升级的单位"
 * 那句话真正的用法。
 */
const SCENE: SceneEntry = {
  id: 'scene.office',
  name: 'Microverse 办公室',
  districts: DISTRICTS.map((d) => d.id),
  stations: STATIONS.map((s) => s.id),
  // 入场点：接待处门口（原版前台那一片）。
  spawn: { x: -28, z: 12 },
  // 世界半边长 = 地图宽度的一半（74 / 2）。
  groundSize: 37,
  // 底图：整张烘好的办公室。家具在图里，所以站点不写 props。
  map: 'map.office',
  theme: 'theme.cozy-isometric',
  roster: 'roster.software-team',
  agentModel: 'model.agent.mv-tom',
  // ⚠️ 上面三个 id 我第一版是**猜的**（'roster.default' / 'theme.studio-night'），
  // 结果 76 个测试红在"场景引用了不存在的条目"。内容 id 必须去库里查，不能按命名习惯推。
  residentRules: [],
}

export const officePack: ContentPack = {
  manifest: {
    id: 'pack.office',
    name: 'Microverse 原版办公室',
    description:
      '把 Microverse 游戏自带的办公室场景搬过来：9 个房间（名字与描述是原版的中文）、24 个座位、一张整图底图。',
    version: '1.0.0',
    schemaVersion: 1,
    requires: ['pack.pixel'],
    provides: ['districts', 'stations', 'maps', 'scenes'],
    overrides: [
      ...DISTRICTS.map((d) => `districts/${d.id}`),
      ...STATIONS.map((s) => `stations/${s.id}`),
      'maps/map.office',
      'scenes/scene.office',
    ],
  },
  entries: {
    maps: [MAP],
    scenes: [SCENE],
    districts: DISTRICTS,
    stations: STATIONS,
  },
}
