/**
 * `pack.kenney-furniture`：把站点的**程序化几何**换成 Kenney 的 CC0 家具模型（M4-7 的延伸）。
 *
 * ## 它证明了什么
 *
 * `pack.kenney-mini` 换的是**角色**（`model.agent.base`）；这个包换的是**站点**（6 个
 * `model.station.*`）。两个包加起来，3D 场景里的**人与陈设都来自外部 GLB**，
 * 而**模拟内核、场景描述层、协议一个字都没改**——渲染器只是从计划里读
 * "这个模型是 GLB，url 是这个"。
 *
 * 这就是决策 D31/D32 想要的效果：**换资产 = 加一个包 + 显式声明 `overrides`**。
 *
 * ## 关于 `scale: 1.5`
 *
 * 不是我随手定的。Kenney 的模型有**统一的单位约定**，但与我们镇上的尺度不一致：
 * 实测（解析 GLB 的 POSITION 访问器 min/max）`desk` 高 **0.38**、`bookcaseClosedWide` 高 **0.79**、
 * `loungeSofa` 高 **0.46**；而角色 `character-male-a` 自然高 **0.671**（乘 2 之后是 1.34）。
 *
 * 现实里书桌高 0.75m、人高 1.7m，比例 **0.44**。按 1.34 的人算，桌子该是 0.59 高 →
 * 0.59 / 0.38 ≈ **1.55**。取 **1.5**（桌子 0.57 高，是人的 43%）——与真实比例几乎一致。
 *
 * ## 一个**必须由机制处理**的坑：Kenney 家具的原点在角上
 *
 * 实测 `desk` 的包围盒是 `x -0.01..+0.72 / z -0.38..+0.18`——**原点在角/边上，不在中心**。
 * 站点的 `anchor` 是"中心"，直接摆会让家具整体偏出去半间屋子。
 *
 * 修法**不在内容里写 30 个偏移量**，而在渲染器里做一次通用处理
 * （`scene3d.js` 的 `recenterOnGround`）：摆之前按包围盒把模型在 x/z 上居中、底面贴到 y=0。
 * 这是**机制**（"怎么把任意外部模型摆正"），不是内容——所以换一个模型也不用补数据。
 */
import type { ContentPack, StationPropEntry } from '../kinds.js'
import { DEFAULT_STATIONS } from './stations.js'

/** 站点的模型替换表：站点模型 id → Kenney 家具文件名。 */
const FURNITURE: ReadonlyArray<readonly [string, string, string]> = [
  ['model.station.desk', 'desk', '工位（Kenney 书桌）'],
  // `tableCross` 更大（2.03 宽，放大后 3 米）会压到隔壁站点——两个会议站点只隔约 2.5。
  ['model.station.meeting', 'table', '会议桌（Kenney 桌）'],
  ['model.station.server', 'bookcaseClosedWide', '机柜（Kenney 高柜）'],
  ['model.station.mailroom', 'cardboardBoxOpen', '收发室（Kenney 纸箱）'],
  ['model.station.lab', 'deskCorner', '实验台（Kenney 转角桌）'],
  ['model.station.breakroom', 'loungeSofa', '休息区（Kenney 沙发）'],
]

/**
 * **办公小件**（M4-11，R48）：椅子、显示器、键盘、鼠标。
 *
 * 它们不替换任何站点，只被 `STATION_PROPS` 组合到工位上。
 * R47 的 3D 评估指出的正是这个：**库里躺着 25 个没人用的家具，而工位是光秃秃的桌子**。
 */
const PARTS: ReadonlyArray<readonly [string, string, string]> = [
  ['model.part.chair-desk', 'chairDesk', '办公椅（Kenney）'],
  ['model.part.screen', 'computerScreen', '显示器（Kenney）'],
  ['model.part.keyboard', 'computerKeyboard', '键盘（Kenney）'],
  ['model.part.mouse', 'computerMouse', '鼠标（Kenney）'],
  ['model.part.lamp-table', 'lampRoundTable', '台灯（Kenney）'],
  ['model.part.plant', 'plantSmall1', '小盆栽（Kenney）'],
  ['model.part.box', 'cardboardBoxClosed', '纸箱（Kenney）'],
  ['model.part.coat-rack', 'coatRackStanding', '衣帽架（Kenney）'],
]

/**
 * **站点怎么拼**：工作站 = 桌子 + 椅子 + 桌面三件套（M4-11）。
 *
 * 这里每一个偏移都是"显示器摆在桌面哪一侧"这类**内容决策**；
 * "让任意外部模型的包围盒居中、底面贴地"仍然是**机制**（`recenterOnGround`），
 * 所以换一套家具时这些偏移可能要重调，但不需要动渲染器代码。
 *
 * 数值来源：Kenney 家具在 `scale: 1.5` 下的实测尺寸（书桌 1.08 宽 × 0.84 深；
 * 椅座高约 0.30；显示器约 0.4 宽）。椅子摆在桌子**前方**（+z 侧，因为等距视角里
 * 那是"画面前方"），显示器摆在桌面**远侧**（-z）——与真人坐向一致。
 */
const STATION_PROPS: ReadonlyArray<readonly [string, readonly StationPropEntry[]]> = [
  [
    'station.desk-a',
    [
      { model: 'model.station.desk' },
      { model: 'model.part.screen', offset: { x: 0, z: -0.22 } },
      { model: 'model.part.keyboard', offset: { x: 0, z: 0.12 } },
      { model: 'model.part.mouse', offset: { x: 0.26, z: 0.12 } },
      { model: 'model.part.chair-desk', offset: { x: 0, z: 0.62 } },
    ],
  ],
  [
    'station.desk-b',
    [
      { model: 'model.station.desk' },
      { model: 'model.part.screen', offset: { x: 0, z: -0.22 } },
      { model: 'model.part.keyboard', offset: { x: 0, z: 0.12 } },
      { model: 'model.part.mouse', offset: { x: -0.26, z: 0.12 } },
      { model: 'model.part.chair-desk', offset: { x: 0, z: 0.62 } },
      { model: 'model.part.lamp-table', offset: { x: 0.42, z: -0.1 } },
    ],
  ],
  [
    'station.desk-c',
    [
      { model: 'model.station.desk' },
      { model: 'model.part.screen', offset: { x: 0, z: -0.22 } },
      { model: 'model.part.keyboard', offset: { x: 0, z: 0.12 } },
      { model: 'model.part.chair-desk', offset: { x: 0, z: 0.62 } },
      { model: 'model.part.plant', offset: { x: 0.42, z: 0.1 } },
    ],
  ],
  [
    'station.review-table',
    [
      { model: 'model.station.desk' },
      { model: 'model.part.keyboard', offset: { x: 0, z: 0.12 } },
      { model: 'model.part.chair-desk', offset: { x: -0.7, z: 0.62 } },
      { model: 'model.part.chair-desk', offset: { x: 0.7, z: 0.62 }, rotationY: 0.6 },
      { model: 'model.part.box', offset: { x: -0.55, z: -0.2 } },
    ],
  ],
  [
    'station.war-room',
    [
      { model: 'model.station.meeting' },
      { model: 'model.part.chair-desk', offset: { x: 0, z: 0.85 } },
      { model: 'model.part.chair-desk', offset: { x: 0, z: -0.85 }, rotationY: Math.PI },
      { model: 'model.part.chair-desk', offset: { x: 1.1, z: 0 }, rotationY: -Math.PI / 2 },
    ],
  ],
  [
    'station.board',
    [
      { model: 'model.station.meeting' },
      { model: 'model.part.coat-rack', offset: { x: 0.9, z: -0.6 } },
    ],
  ],
  [
    'station.lab-bench',
    [
      { model: 'model.station.lab' },
      { model: 'model.part.screen', offset: { x: -0.3, z: -0.15 } },
      { model: 'model.part.chair-desk', offset: { x: 0, z: 0.7 } },
      { model: 'model.part.plant', offset: { x: 0.7, z: 0.2 } },
    ],
  ],
  [
    'station.breakroom',
    [
      { model: 'model.station.breakroom' },
      { model: 'model.part.plant', offset: { x: -1.5, z: 0.4 } },
      { model: 'model.part.plant', offset: { x: 1.6, z: -0.3 } },
      { model: 'model.part.coat-rack', offset: { x: -2.1, z: -0.5 } },
    ],
  ],
  [
    'station.mailroom',
    [
      { model: 'model.station.mailroom' },
      { model: 'model.part.box', offset: { x: 0.8, z: 0.5 } },
      { model: 'model.part.box', offset: { x: 0.8, z: 0.5, y: 0.42 } },
      { model: 'model.part.plant', offset: { x: -0.9, z: 0.3 } },
    ],
  ],
]

export const kenneyFurniturePack: ContentPack = {
  manifest: {
    id: 'pack.kenney-furniture',
    name: 'Kenney Furniture Kit（CC0）',
    description: '把站点的程序化几何换成 Kenney 的 CC0 家具模型（30 个办公室件）。',
    version: '1.0.0',
    schemaVersion: 1,
    requires: ['pack.default'],
    provides: ['models', 'stations'],
    // 覆盖必须显式（红线）：模型 6+8 条、站点 9 条（加了组合的那几个）。
    overrides: [
      ...FURNITURE.map(([id]) => `models/${id}`),
      ...STATION_PROPS.map(([id]) => `stations/${id}`),
    ],
  },
  entries: {
    models: [...FURNITURE, ...PARTS].map(([id, file, name]) => ({
      id,
      name,
      source: {
        kind: 'glb' as const,
        // **相对本插件资源根**（决策 D32）；渲染器拼成 `./vendor/kenney-furniture/<file>.glb`。
        // 这些 url 由测试逐个核对"文件真的在 src/vendor/ 下"——那是两处没有编译器关系的地方。
        url: `kenney-furniture/${file}.glb`,
        clipSource: false,
      },
      scale: 1.5,
      rotationY: 0,
      anchorY: 0,
    })),

    // 站点：**复用默认包的锚点与能力**，只把外观换成组合件（M4-11）。
    //
    // 只覆盖有组合的那几个（`STATION_PROPS`）；其余站点（机柜、告示板…）继续用默认包的单件，
    // 因为 override 是**整条替换**，没必要为了统一而重写一份坐标。
    stations: DEFAULT_STATIONS.filter((st) => STATION_PROPS.some(([id]) => id === st.id)).map((st) => {
      const parts = STATION_PROPS.find(([id]) => id === st.id)?.[1] ?? []
      // 去掉单件 `model`：`props` 与 `model` 同时给会被校验器判错（二选一）。
      const { model: _single, ...rest } = st
      return { ...rest, props: parts }
    }),
  },
}
