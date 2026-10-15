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
import type { ContentPack } from '../kinds.js'

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

export const kenneyFurniturePack: ContentPack = {
  manifest: {
    id: 'pack.kenney-furniture',
    name: 'Kenney Furniture Kit（CC0）',
    description: '把站点的程序化几何换成 Kenney 的 CC0 家具模型（30 个办公室件）。',
    version: '1.0.0',
    schemaVersion: 1,
    requires: ['pack.default'],
    provides: ['models'],
    overrides: FURNITURE.map(([id]) => `models/${id}`),
  },
  entries: {
    models: FURNITURE.map(([id, file, name]) => ({
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
  },
}
