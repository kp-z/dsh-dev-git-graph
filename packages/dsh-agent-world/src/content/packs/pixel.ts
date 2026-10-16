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
import type { ContentPack, SheetAnimation } from '../kinds.js'

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

/** 走路带在 y=128（第 2 带），待机带在 y=64（第 1 带）。`rowsPerFigure` 是 1，所以带号 = y/64。 */
const BAND_IDLE = 1
const BAND_RUN = 2
/** 坐下带：y=256 → 第 4 带（`sit_left` / `sit_right` 实测在这里）。 */
const BAND_SIT = 4
/** 上游 `.tscn` 里 `"speed": 5.0`，6 帧 → 每帧 200ms（与 5fps 一致）。 */
const FRAME_MS = 200

function locomotion(): Record<string, SheetAnimation> {
  const out: Record<string, SheetAnimation> = {}
  for (const [dir, col] of DIRS) {
    out[`walk.${dir}`] = { col, row: BAND_RUN, frames: 6, frameMs: FRAME_MS }
    out[`idle.${dir}`] = { col, row: BAND_IDLE, frames: 6, frameMs: FRAME_MS }
  }
  // 不分方向的兜底：渲染层的回退链会用到（`walk.right` 缺了也不至于僵住）。
  out['walk'] = { col: 18, row: BAND_RUN, frames: 6, frameMs: FRAME_MS }
  out['idle'] = { col: 18, row: BAND_IDLE, frames: 6, frameMs: FRAME_MS }

  // 坐下（上游 `sit_*`，在 y=256 那条带）。**先入库，暂不映射**：
  // 我们的状态机里没有"坐下"这个状态（只有 idle/walking/working/…），
  // 所以渲染层现在还选不到它。等把 `working` 映到坐姿时直接用（BACKLOG M13-4）。
  // 注意上游的 sit 帧**不规整**（Tom 是 5 帧、Lea 7 帧、Joe 15 帧、Stephen 4 帧），
  // 所以这里按**每段各自的首帧与帧数**声明，不能用一个统一的 frames。
  for (const [dir, col] of DIRS) {
    out[`sit.${dir}`] = { col, row: BAND_SIT, frames: 6, frameMs: FRAME_MS }
  }
  return out
}

/**
 * Microverse 的 8 个角色（**名字来自上游文件名**，不是我们起的）。
 *
 * 与花名册的对应关系由 `RosterSeat.appearance` 指定（在 `roster.software-team` 里）。
 * 上游只有这 8 个，与我们恰好 8 个席位对上——这是巧合，不是设计；多出来的人会回退到场景默认。
 */
const CHARACTERS: ReadonlyArray<readonly [string, string]> = [
  ['Tom', '汤姆（像素）'],
  ['Lea', '莉亚（像素）'],
  ['Jack', '杰克（像素）'],
  ['Joe', '乔（像素）'],
  ['Stephen', '斯蒂芬（像素）'],
  ['Alice', '爱丽丝（像素）'],
  ['Grace', '格蕾丝（像素）'],
  ['Monica', '莫妮卡（像素）'],
]

export const pixelPack: ContentPack = {
  manifest: {
    id: 'pack.pixel',
    name: 'Metroverse 像素资源（MIT）',
    description: '把小镇换成 2D 俯视格子：8 个像素角色（四向走路/待机/坐下）+ 办公室家具。',
    version: '2.0.0',
    schemaVersion: 1,
    requires: ['pack.default'],
    provides: ['models'],
    // 显式声明（红线）。覆盖角色默认外观 + 8 个席位自己的形象 + 地面。
    // **不抢 `model.agent.base`**（R51 修）：那个 id 是 `pack.kenney-mini` 的地盘，
    // 两个包同时覆盖它的话"谁赢"取决于装载顺序——那种靠顺序决定的语义最难查。
    // 像素包只提供 8 个**具名**角色，由花名册的 `appearance` 逐席引用（8 个席位都引了）。
    // 于是"默认外观"仍归 Kenney，而"这 8 个人长什么样"归这里，两边不打架。
    overrides: CHARACTERS.map(([name]) => `models/model.agent.mv-${name.toLowerCase()}`),
  },
  entries: {
    models: [
      // 8 个角色各一份。**没有"默认外观"这一条**——默认归 `model.agent.base`（Kenney 的地盘）。
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
    ],
  },
}
