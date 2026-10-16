/**
 * `pack.pixel`：把小镇换成 **2D 俯视格子**的表现（D49，R51）。
 *
 * ## 资产来源
 *
 * 用户指定的 **Microverse**（github.com/KsanaDock/Microverse，**MIT**）——它是同一个主题的项目：
 * 现代办公室 + 8 个有名有姓的角色 + 办公家具图集 + 中文像素字体。
 * 许可原文在 `src/vendor/microverse/LICENSE`，收录时逐条核过。
 *
 * ## 切法**不是猜的**——从项目自己的场景文件里读出来的
 *
 * Microverse 是 Godot 工程，每个角色一个 `.tscn`，里面用 `AtlasTexture` 的 `region = Rect2(x, y, w, h)`
 * **逐帧**声明了坐标。所以：
 * - 角色帧是 **32×64**（不是 32×32——横竖都按 32 切会切掉半个人）；
 * - 每段动画的帧沿 x 每 **32** 一帧；
 * - 方向顺序 **右(0) → 上(6) → 左(12) → 下(18)**，实测自 `idle_*` / `run_*` 的首帧列号；
 * - 走路与待机在 y=64（idle）与 y=128（run）两条带上，各 6 帧。
 *
 * 把这套坐标写成常量而不是从 `.tscn` 现场解析：解析器要跟着上游改动维护，而坐标是**一次核对过的事实**。
 * 核对方式写在 `docs/tile-index.md`，可复算。
 *
 * ## 8 个角色各一份模型
 *
 * `RosterSeat.appearance`（R51 新增）让**席位**声明自己长什么样，而不是全场景共用一个 `agentModel`。
 * 于是"某个人换一张脸"是改内容，不是改渲染器。
 */
import type { ContentPack, SheetAnimation, StationPropEntry } from '../kinds.js'
import { DEFAULT_STATIONS } from './stations.js'

/** Microverse 角色帧的实测尺寸（32 宽 × 64 高）。 */
const CELL_W = 32
const CELL_H = 64

/** 方向 → 起始列（实测：右 0 / 上 6 / 左 12 / 下 18，每段 6 帧）。 */
const DIRS: ReadonlyArray<readonly [string, number]> = [
  ['right', 0],
  ['up', 6],
  ['left', 12],
  ['down', 18],
]

/** 走路带 y=128（第 2 带）、待机带 y=64（第 1 带）、坐下带 y=256（第 4 带）。 */
const BAND_IDLE = 1
const BAND_RUN = 2
const BAND_SIT = 4
/** 上游 `.tscn` 里 `"speed": 5.0`，6 帧 → 每帧 200ms。 */
const FRAME_MS = 200

function locomotion(): Record<string, SheetAnimation> {
  const out: Record<string, SheetAnimation> = {}
  for (const [dir, col] of DIRS) {
    out[`walk.${dir}`] = { col, row: BAND_RUN, frames: 6, frameMs: FRAME_MS }
    out[`idle.${dir}`] = { col, row: BAND_IDLE, frames: 6, frameMs: FRAME_MS }
  }
  out['walk'] = { col: 18, row: BAND_RUN, frames: 6, frameMs: FRAME_MS }
  out['idle'] = { col: 18, row: BAND_IDLE, frames: 6, frameMs: FRAME_MS }
  // 坐下（上游 `sit_*`，y=256 那条带）。**先入库、暂不映射**：状态机里没有 sit 状态。
  for (const [dir, col] of DIRS) {
    out[`sit.${dir}`] = { col, row: BAND_SIT, frames: 6, frameMs: FRAME_MS }
  }
  return out
}

/**
 * 家具：`[编号, 裁后宽, 裁后高, 名字]`（R54）。
 *
 * ## 为什么必须用**裁紧**的图（`objects-tight/`）
 *
 * 上游的 `objects/*.png` 画布统一是 64×96（2×3 格），但物件在画布里的位置**不统一**——
 * 实测：底边距底从 0 到 28 不等，水平方向有的只占左半格（`x 0..31`）、有的占满（`x 0..63`）。
 * 直接摆的话每件都要一条手工偏移，而**偏移写错就是"家具飘在别处"**，很难归因。
 *
 * 所以入库时做一次**机械裁紧**（`getbbox()` 去掉四周透明），339 件全部裁好放在
 * `microverse/objects-tight/<编号>.png`。裁完之后的约定是**统一的**：
 * 水平居中、底边贴地（`anchor: 'bottom'`）——**摆放规则因此不需要逐件数据**。
 * 裁紧只去掉透明边，**没有改任何一个像素**。
 *
 * 宽高不是手打的：从 `getbbox()` 的实测结果生成（`docs/tile-index.md` §6）。
 */
const FURNITURE: ReadonlyArray<readonly [number, number, number, string]> = [
  [20, 32, 32, '箱子/柜体'],
  [98, 32, 56, '盆栽（更小）'],
  [99, 32, 36, '盆栽（中）'],
  [100, 24, 52, '盆栽（小）'],
  [127, 30, 52, '显示器（灰屏）'],
  [129, 30, 30, '显示器（蓝屏）'],
  [135, 26, 42, '显示器（笔记本）'],
  [142, 30, 34, '台灯'],
  [170, 60, 46, '白板（带笔槽）'],
  [172, 60, 46, '白板（带图表）'],
  [173, 28, 60, '饮水机'],
  [179, 24, 42, '文件匣'],
  [200, 62, 48, '文件柜（2 格宽）'],
  [203, 56, 76, '机柜'],
  [227, 64, 46, '工位（整套：桌面+键盘+鼠标+显示器）'],
  [231, 64, 46, '工位（另一配色）'],
  [317, 48, 52, '办公椅'],
  [318, 48, 52, '办公椅（另一款）'],
  [321, 52, 64, '空桌面'],
  [322, 52, 64, '桌面（带仪器）'],
  [324, 52, 54, '长桌柜 A'],
  [325, 52, 54, '长桌柜 B'],
  [326, 52, 54, '长桌柜 C'],
  [337, 24, 30, '沙发'],
  [338, 32, 40, '沙发（另一款）'],
  [339, 62, 50, '盆栽（大）'],
]

/**
 * 角色：Microverse 的 8 个（**名字来自上游文件名**，不是我们起的）。
 */
const CHARACTERS: ReadonlyArray<readonly [string, string]> = [
  ['Tom', '汤姆（像素）'], ['Lea', '莉亚（像素）'], ['Jack', '杰克（像素）'], ['Joe', '乔（像素）'],
  ['Stephen', '斯蒂芬（像素）'], ['Alice', '爱丽丝（像素）'], ['Grace', '格蕾丝（像素）'],
  ['Monica', '莫妮卡（像素）'],
]

/** 家具模型的 id（`model.pixel.f<编号>`）。 */
const f = (n: number): string => `model.pixel.f${n}`

/**
 * **办公室怎么摆**：站点 → 部件（R54，用户要求"搞个办公室就行"）。
 *
 * 偏移单位是**世界单位**（1 单位 = 16 源像素，见 `scene2d.js` 的缩放约定）。
 * 所以一张 32px 宽的桌子 = 2 单位宽，而两个工位相距 2.5 单位——**摆得下，但不宽裕**。
 *
 * `dz` 的正方向是**屏幕下方**（世界的 +z），所以"摆在桌子前面"是正的 `dz`，
 * "贴在墙上"是负的。`dy` 是抬高（显示器摆到桌面上用）。
 */
const STATION_PROPS: ReadonlyArray<readonly [string, readonly StationPropEntry[]]> = [
  // 工位：整套工位（#227 一件就画完了桌面+键盘+鼠标+显示器）+ 一把椅子在前方。
  ['station.desk-a', [{ model: f(227) }, { model: f(317), offset: { z: 0.85 } }, { model: f(100), offset: { x: -0.85, z: -0.35 } }]],
  ['station.desk-b', [{ model: f(231) }, { model: f(317), offset: { z: 0.85 } }, { model: f(142), offset: { x: 0.8, z: -0.3 } }]],
  ['station.desk-c', [{ model: f(227) }, { model: f(318), offset: { z: 0.85 } }, { model: f(98), offset: { x: 0.8, z: -0.3 } }]],

  // 评审桌：空桌面 + 两把椅子 + 一摞文件。
  ['station.review-table', [
    { model: f(321) },
    { model: f(317), offset: { x: -0.6, z: 0.85 } },
    { model: f(317), offset: { x: 0.6, z: 0.85 } },
    { model: f(179), offset: { x: 0.75, z: -0.25 } },
  ]],

  // 机柜：机柜本体 + 旁边一台显示器（机房总得有个屏幕）。
  ['station.server-rack', [{ model: f(203) }, { model: f(129), offset: { x: 0.9, z: 0.1 } }]],

  // 实验台：带仪器的桌面 + 椅子 + 显示器 + 盆栽。
  ['station.lab-bench', [
    { model: f(322) },
    { model: f(317), offset: { z: 0.85 } },
    { model: f(127), offset: { x: -0.55, z: -0.35, y: 0.55 } },
    { model: f(99), offset: { x: 0.85, z: -0.25 } },
  ]],

  // 作战室：**没有现成的大会议桌**，所以用两张长桌柜拼一张（用户说"没有长桌就搞个办公室就行"）。
  // 这是刻意的凑法，写在注释里，免得下一个人以为上游有长桌。
  ['station.war-room', [
    { model: f(324), offset: { x: -0.7 } },
    { model: f(325), offset: { x: 0.7 } },
    { model: f(317), offset: { x: -0.7, z: 0.9 } },
    { model: f(317), offset: { x: 0.7, z: 0.9 } },
    { model: f(317), offset: { x: -0.7, z: -0.9 }, rotationY: Math.PI },
    { model: f(317), offset: { x: 0.7, z: -0.9 }, rotationY: Math.PI },
  ]],

  // 告示板：白板 + 旁边一个文件柜。
  ['station.board', [{ model: f(170) }, { model: f(200), offset: { x: -1.0, z: 0.15 } }]],

  // 收发室：文件匣 + 箱子（#179 是核到的最可信的"装东西"的件）。
  ['station.mailroom', [
    { model: f(179), offset: { x: -0.35 } },
    { model: f(20), offset: { x: 0.5, z: 0.15 } },
    { model: f(98), offset: { x: 0.95, z: -0.4 } },
  ]],

  // 休息区：沙发 + 饮水机 + 大盆栽 + 白板（墙上那块图表板）。
  ['station.breakroom', [
    { model: f(337) },
    { model: f(173), offset: { x: -1.1, z: -0.2 } },
    { model: f(339), offset: { x: 1.3, z: -0.1 } },
    { model: f(172), offset: { x: 0.2, z: -1.0 } },
  ]],
]

export const pixelPack: ContentPack = {
  manifest: {
    id: 'pack.pixel',
    name: 'Microverse 像素资源（MIT）',
    description: '把小镇换成 2D 俯视格子的**办公室**：8 个像素角色 + 26 件办公家具。',
    version: '3.0.0',
    schemaVersion: 1,
    requires: ['pack.default'],
    provides: ['models', 'stations'],
    // 显式声明（红线）。家具模型是新 id；站点是**整条覆盖**（注册表是整条替换）。
    overrides: [
      ...CHARACTERS.map(([name]) => `models/model.agent.mv-${name.toLowerCase()}`),
      ...FURNITURE.map(([n]) => `models/${f(n)}`),
      ...STATION_PROPS.map(([id]) => `stations/${id}`),
    ],
  },
  entries: {
    models: [
      // ── 8 个角色 ──
      ...CHARACTERS.map(([file, label]) => ({
        id: `model.agent.mv-${file.toLowerCase()}`,
        name: label,
        source: {
          kind: 'sheet' as const,
          url: `microverse/characters/${file}x32.png`,
          sheet: { cellW: CELL_W, cellH: CELL_H, rowsPerFigure: 1, anchor: 'bottom' as const, animations: locomotion() },
        },
        scale: 1,
        rotationY: 0,
        anchorY: 0,
      })),

      // ── 26 件办公家具 ──
      // 每件是**一张单帧图**（裁紧之后），所以 `cellW/cellH` 就是它的宽高、只有一帧。
      // `rowsPerFigure: 1` + `anchor: 'bottom'` → 水平居中、底边贴地。
      ...FURNITURE.map(([n, w, h, label]) => ({
        id: f(n),
        name: label,
        source: {
          kind: 'sheet' as const,
          url: `microverse/objects-tight/${n}.png`,
          sheet: {
            cellW: w,
            cellH: h,
            rowsPerFigure: 1,
            anchor: 'bottom' as const,
            animations: { still: { col: 0, row: 0, frames: 1, frameMs: FRAME_MS } },
          },
        },
        scale: 1,
        rotationY: 0,
        anchorY: 0,
      })),
    ],

    // 站点：复用默认包的锚点与能力，只把外观换成像素家具（与 `pack.kenney-furniture` 同一手法）。
    stations: DEFAULT_STATIONS.filter((st) => STATION_PROPS.some(([id]) => id === st.id)).map((st) => {
      const parts = STATION_PROPS.find(([id]) => id === st.id)?.[1] ?? []
      const { model: _single, ...rest } = st
      return { ...rest, props: parts }
    }),
  },
}
