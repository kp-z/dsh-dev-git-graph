/**
 * `pack.kenney-mini`：用 Kenney 的 CC0 角色替掉程序化的"胶囊人"（BACKLOG M5-5）。
 *
 * ## 这个包是"换资产只改内容"的**验证点**（M5-6）
 *
 * 它做的事只有一件：**显式 `overrides` 掉 `models/model.agent.base`**。
 * 没有任何代码改动——`ScenePlan`、模拟内核、渲染器都不知道自己换了模型：
 * 渲染器只是从计划里读到"这个模型是 GLB，url 是这个"。
 *
 * ## 资产（CC0，无需署名）
 *
 * Kenney "Mini Characters" 1.0 —— 12 个低模角色，**每个内嵌 32 条动画**、2 个蒙皮。
 * 来源、sha256 与整包 zip 的记录在 `src/vendor/README.md`。
 *
 * `scale: 2`：模型的自然高度是 **0.671** 世界单位（脚底在 y=0、无节点缩放，实测自
 * GLB 的 POSITION 访问器 min/max），乘 2 之后约 1.34，与镇上的桌椅（约 0.5 高）成比例。
 *
 * ## 现在**只用一个**角色模型
 *
 * 12 个都入库了，但这个包只挑一个。让 8 个 agent 长得不一样是**另一件事**
 * （需要"一个角色模型列表 + 按序分配"这个概念），故意没混进这一轮：
 * 这一轮的目标是"GLB 能跑起来"，而不是顺手加一个内容概念。
 */
import type { ContentPack } from '../kinds.js'

export const kenneyMiniPack: ContentPack = {
  manifest: {
    id: 'pack.kenney-mini',
    name: 'Kenney Mini Characters（CC0）',
    description: '把程序化角色换成 Kenney 的 CC0 低模角色（每个 GLB 内嵌 32 条动画）。',
    version: '1.0.0',
    schemaVersion: 1,
    requires: ['pack.default'],
    provides: ['models'],
    // 显式声明：没声明就撞 id 是错误，而且原条目不许变。
    overrides: ['models/model.agent.base'],
  },
  entries: {
    models: [
      {
        id: 'model.agent.base',
        name: '角色（Kenney Mini Characters）',
        source: {
          kind: 'glb',
          // **相对本插件资源根**的路径（决策 D32），由路径校验挡住协议/绝对路径/`..`。
          // 渲染器把它拼成 `./vendor/kenney-mini-characters/character-male-a.glb`。
          url: 'kenney-mini-characters/character-male-a.glb',
          // 这个 GLB 就是剪辑的来源（`actions` 库的条目指向它里面的剪辑名，M5-2）。
          clipSource: true,
        },
        scale: 2,
        rotationY: 0,
        anchorY: 0,
      },
    ],
  },
}
