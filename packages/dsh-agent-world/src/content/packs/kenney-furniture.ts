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
 * 这些模型统一用的缩放（下面 `entries.models` 每条都用它）。
 * 定这个值的理由见文件头"关于 `scale: 1.5`"那一段。
 */
const MODEL_SCALE = 1.5

/**
 * ══ R49 实测尺寸（**这些数是下面每个偏移的依据，不是拍的**）═══════════════════
 *
 * 量法（可复现）：解析 GLB 的 POSITION 顶点 → 乘 `scale: 1.5` → 按包围盒把 x/z 居中、
 * 底面贴到 y=0（就是 `scene3d.js` 里 `recenterOnGround` 做的三行）→ 取盒。
 * 脚本：`/tmp/aw-measure-furniture.mjs`（R49 那次；重跑它就能复现下表）。
 *
 * | 模型 | 高(y) | 宽(x) | 深(z) |
 * |---|---|---|---|
 * | `desk` | **0.5766** | 1.102 | 0.588 |
 * | `deskCorner` | **0.5766** | 1.462 | 1.462 |
 * | `table`（会议桌） | 0.490 | 1.262 | 0.671 |
 * | `computerScreen` | 0.441 | 0.589 | 0.156 |
 * | `computerKeyboard` | 0.041 | 0.423 | 0.177 |
 * | `computerMouse` | 0.035 | 0.075 | 0.128 |
 * | `chairDesk` | 0.911 | 0.502 | 0.471 |
 * | `lampRoundTable` | 0.471 | 0.228 | 0.263 |
 * | `plantSmall1` | 0.210 | 0.142 | 0.142 |
 * | `cardboardBoxClosed` | 0.421 | 0.319 | 0.319 |
 *
 * ## 世界方向（决定 `offset.z` 的**符号**，R48 就是这里反了）
 *
 * 相机在 `applyCamera` 里按 yaw 45° / pitch 35.264° 摆放 → 落在 **+x / +y / +z** 一侧，
 * 所以**世界 +z 是"前方"（朝向观察者）**。而 `buildProps` 把内容里的 `offset.z`
 * 放到了 `world z = -站点z - dz`，于是：
 *
 * **`offset.z` 为负 = 世界 +z = 画面前方。**
 *
 * R48 的偏移把这个符号用反了：椅子（`z: 0.62`）实际落在桌子**背面**（被桌子挡住），
 * 显示器（`z: -0.22`）反而落在**坐人那一侧**。
 *
 * ## 椅子的朝向（实测出来的，不是猜的）
 *
 * 量 `chairDesk` 顶部 25% 的顶点（靠背所在高度）其 z 中心 ≈ **-0.202**，
 * 而整把椅子的 z 只占 ±0.236 —— 所以**靠背在局部 -z 侧，椅面朝局部 +z**。
 * 要让椅子朝向桌子，就把它局部 +z 转向桌子那一侧。
 */

/**
 * 桌面高度（世界单位）= Kenney `desk` 的**原始**盒高 × {@link MODEL_SCALE}。
 *
 * 原始盒高实测 **0.384407550**（GLB 顶点 `max.y − min.y`，量法见上面那张表），
 * 所以桌面 = 0.384407550 × 1.5 = **0.576611325**。
 *
 * **为什么不用 0.577 这个好看的数**：0.576611325 与 0.577 差 0.39mm，
 * 而那 0.39mm 正是"桌面小件浮空"——判据是"**不浮**不穿"，不是"看不出来"。
 * 写成"原始值 × 缩放"而不是直接写 0.576611325，是为了让这个数
 * **跟着缩放一起变**（改 `MODEL_SCALE` 时它自动跟上，不需要有人记得重算）。
 *
 * ## 为什么是**具名常量**，而不是在每个小件里写各自的 `y`
 *
 * M10-15 留给我的那个选择，我选常量。判据是"换一套家具时哪种更容易跟着改"：
 *
 * - 换一张桌子 → **只改这一行**（或什么都不用改，缩放变了它自己跟），
 *   显示器/键盘/鼠标/台灯/盆栽全部自动落到新桌面上；
 * - 若把 `0.5766` 抄进五处 `offset.y`：换桌子要改五处，而且**没有任何机制保证五处一致**
 *   ——漏改一个的症状正是"一件浮在空中、一件陷进桌里"，也就是本轮要修的那个东西。
 *
 * 同时**保留逐件覆盖的能力**（`offset.y` 仍然可写）：椅子、纸箱、衣帽架这些
 * **落地**的件就不写 `y`，缺省 0 即地面——"在桌面上"是一个要显式表达的选择，不是默认。
 */
const DESK_TOP_Y = 0.38440755 * MODEL_SCALE

/**
 * 桌面小件统一用这个 y：**所有"放在桌面上"的件只在这一处表达"我在桌面上"**。
 * 换桌子时上面那个常量一变，这里全体跟着变。
 */
const ON_DESK = { y: DESK_TOP_Y } as const

/**
 * 纸箱高度 = `cardboardBoxClosed` 原始盒高 0.280999988 × `MODEL_SCALE` = 0.421499982。
 * 叠箱子时上层那只的 y 正好等于它（原来写死 0.42，会陷进去 1.5mm）。
 */
const BOX_HEIGHT = 0.280999988 * MODEL_SCALE

/**
 * **站点怎么拼**：工作站 = 桌子 + 椅子 + 桌面三件套（M4-11，R49 调准）。
 *
 * 这里每一个偏移都是"显示器摆在桌面哪一侧"这类**内容决策**；
 * "让任意外部模型的包围盒居中、底面贴地"仍然是**机制**（`recenterOnGround`），
 * 所以换一套家具时这些偏移可能要重调，但不需要动渲染器代码。
 *
 * 下面每个偏移都由上面那张实测表推出来，注释里写出**为什么是这个数**。
 */
const STATION_PROPS: ReadonlyArray<readonly [string, readonly StationPropEntry[]]> = [
  [
    'station.desk-a',
    [
      { model: 'model.station.desk' },
      // 显示器立在桌面**远侧**（世界 -z = 远离观察者那一侧 = 坐的人对面）。
      // 盒 0.589×0.441×0.156：底面贴桌高 0.577，z 占 -0.228..-0.072，全在桌面深 ±0.294 之内。
      { model: 'model.part.screen', offset: { x: 0, z: 0.15, ...ON_DESK } },
      // 键盘在显示器**近侧**平放（盒高只有 0.041），z 占 0.011..0.189，与显示器不重叠。
      { model: 'model.part.keyboard', offset: { x: 0, z: -0.1, ...ON_DESK } },
      // 鼠标在键盘右边同一排：键盘 x 占 ±0.212，鼠标放 0.30 → 占 0.263..0.337，不叠。
      { model: 'model.part.mouse', offset: { x: 0.3, z: -0.1, ...ON_DESK } },
      // 椅子在桌子**前方**（世界 +z，`offset.z` 为负），转 π 让椅面朝桌子、椅背朝外。
      { model: 'model.part.chair-desk', offset: { x: 0, z: -0.55 }, rotationY: Math.PI },
    ],
  ],
  [
    'station.desk-b',
    [
      { model: 'model.station.desk' },
      { model: 'model.part.screen', offset: { x: 0, z: 0.15, ...ON_DESK } },
      { model: 'model.part.keyboard', offset: { x: 0, z: -0.1, ...ON_DESK } },
      // 鼠标换到左手边——同一套桌子两种工位，看着不像复制粘贴。
      { model: 'model.part.mouse', offset: { x: -0.3, z: -0.1, ...ON_DESK } },
      { model: 'model.part.chair-desk', offset: { x: 0, z: -0.55 }, rotationY: Math.PI },
      // 台灯摆在桌面**右后角**：盒 0.228×0.471×0.263 → x 占 0.316..0.544（桌面半宽 0.551）,
      // z 占 -0.292..-0.028；与显示器（x ±0.295）在 x 上完全错开，与键盘/鼠标也不同排。
      { model: 'model.part.lamp-table', offset: { x: 0.43, z: 0.16, ...ON_DESK } },
    ],
  ],
  [
    'station.desk-c',
    [
      { model: 'model.station.desk' },
      { model: 'model.part.screen', offset: { x: 0, z: 0.15, ...ON_DESK } },
      { model: 'model.part.keyboard', offset: { x: 0, z: -0.1, ...ON_DESK } },
      { model: 'model.part.chair-desk', offset: { x: 0, z: -0.55 }, rotationY: Math.PI },
      // 盆栽在桌面**右前角**：盒 0.142×0.210 → x 占 0.359..0.501，与键盘（x ±0.212）不叠。
      { model: 'model.part.plant', offset: { x: 0.43, z: -0.1, ...ON_DESK } },
    ],
  ],
  [
    'station.review-table',
    [
      { model: 'model.station.desk' },
      { model: 'model.part.keyboard', offset: { x: 0, z: 0.12, ...ON_DESK } },
      // 两把椅子都在桌子前方、都朝桌子；右边那把多转 0.6 弧度，像被人随手带歪的。
      // 前方距离取 0.72（不是 0.62）：转过 0.6 弧度之后椅子的**轴对齐盒**会变大
      // （半宽 0.34 / 半深 0.34），0.62 时它的盒角会啃进桌沿 11mm——实测算出来的。
      { model: 'model.part.chair-desk', offset: { x: -0.7, z: -0.72 }, rotationY: Math.PI },
      { model: 'model.part.chair-desk', offset: { x: 0.7, z: -0.72 }, rotationY: Math.PI + 0.6 },
      // 纸箱放在**地面**、桌子左**后**方（世界 z 为负）：与两把椅子（都在 +z 前方）不重叠，
      // x 占 -1.009..-0.691（|x| < 1.25 的半格），不会压到隔壁站点。
      { model: 'model.part.box', offset: { x: -0.85, z: 0.35 } },
    ],
  ],
  [
    'station.war-room',
    [
      { model: 'model.station.meeting' },
      // 三把椅子都**面向桌子**。会议桌盒 1.262×0.671（半宽 0.631、半深 0.336），
      // 每把椅子离桌边都留了 ≥0.2 的空隙（0.85-0.336-0.236 = 0.278）。
      { model: 'model.part.chair-desk', offset: { x: 0, z: -0.85 }, rotationY: Math.PI }, // 世界 +z 近侧 → 转 π 面向桌子
      { model: 'model.part.chair-desk', offset: { x: 0, z: 0.85 } }, // 世界 -z 远侧 → 不转就面向桌子
      { model: 'model.part.chair-desk', offset: { x: 1.1, z: 0 }, rotationY: -Math.PI / 2 }, // 右手边 → 面向 -x
    ],
  ],
  [
    'station.board',
    [
      { model: 'model.station.meeting' },
      // 衣帽架落地（实测高 1.155），摆在桌子右前方：x 占 0.695..1.105，与桌沿（0.631）错开。
      { model: 'model.part.coat-rack', offset: { x: 0.9, z: -0.6 } },
    ],
  ],
  [
    'station.lab-bench',
    [
      { model: 'model.station.lab' },
      // `deskCorner` 也是 0.577 高（L 面覆盖整个 1.462×1.462），所以同样用 ON_DESK。
      { model: 'model.part.screen', offset: { x: -0.3, z: -0.15, ...ON_DESK } },
      // 转角桌太深（半深 0.731）：椅子要推到 1.0 才不与桌沿相交（1.0-0.236 = 0.764 > 0.731）。
      { model: 'model.part.chair-desk', offset: { x: 0, z: -1 }, rotationY: Math.PI },
      // 盆栽收进桌面内：x 0.6 时占 0.529..0.671 < 桌面半宽 0.731（原来 0.7 会探出桌沿 0.04）。
      { model: 'model.part.plant', offset: { x: 0.6, z: 0.2, ...ON_DESK } },
    ],
  ],
  [
    'station.breakroom',
    [
      { model: 'model.station.breakroom' },
      // 盆栽与衣帽架都落地。左边那盆从 -1.5 收到 -1.1：原来它 x 占 3.929..4.071，
      // 与收发室那只纸箱（世界 x 3.641..3.959）**实际相交**——实测才发现的。
      { model: 'model.part.plant', offset: { x: -1.1, z: 0.4 } },
      { model: 'model.part.plant', offset: { x: 1.6, z: -0.3 } },
      // 衣帽架同样从 -2.1 挪到 -2.35：原位置离收发室纸箱只剩 0.036 的空隙。
      { model: 'model.part.coat-rack', offset: { x: -2.35, z: -0.5 } },
    ],
  ],
  [
    'station.mailroom',
    [
      { model: 'model.station.mailroom' },
      { model: 'model.part.box', offset: { x: 0.8, z: 0.5 } },
      // 叠在上面那只：y 就等于实测箱高 0.421（原先写 0.42，会陷进去 1mm）。
      { model: 'model.part.box', offset: { x: 0.8, z: 0.5, y: BOX_HEIGHT } },
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
      scale: MODEL_SCALE,
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
