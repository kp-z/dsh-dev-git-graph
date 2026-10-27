/*
 * 成员头像：把场景里的**角色贴图**取出来当头像（R157）。
 *
 * 之前侧边栏用的是「名字首字 + 部门色块」的字母头像；用户要求直接用 agent 的贴图。
 * 角色贴图来自 `ScenePlan.models`（内容库声明的图集）：
 *
 *   actor.modelId  →  models[] 里的一条  →  sheet.url / cellW / cellH / animations
 *
 * 这里只做**纯计算**（不碰 DOM、不加载图片），方便 node 单测：
 *   · `resolveMemberSprite(scene, agentId)` —— 找出这个角色该用哪张图、哪一帧；
 *   · `spriteAvatarStyle(sprite, size)` —— 算成 CSS 的 background-image/size/position。
 *
 * ## 为什么用 `idle.down` 的第一帧
 *
 * 图集是 32×64 的四向角色（走/站/坐各有四条）。头像是一个 30×30 的方块，
 * 只能截上半身，所以选**正脸朝下（down）的站立帧**：它是"这个人站在那里"最中性的样子。
 * 找不到 `idle.down` 时依次退回 `idle`、图集里的第一条动画——**不猜一个不存在的名字**。
 *
 * ## 为什么纵向要再裁 24px
 *
 * 图集单元格高 64，角色实际从 y≈14–20 才开始（脚踩格子底部的排法）。
 * 更关键的是**头很大**：头发占 y≈16–33，脸/眼睛在 y≈34–45，身体从 y≈46 开始。
 * 如果从顶部裁 30px（y≈12–42），窗口里 2/3 是头发、脸只露一条边——看起来就是"只有头发"。
 * 所以窗口整体下移到 y≈24–54：头发下沿 + 整张脸 + 一点肩膀，头像才认得出人。
 */

/** 头像显示尺寸（CSS px）。与 `styles/components.css` 的 `.board-member-avatar` 保持一致。 */
export const AVATAR_PX = 30
/** 单元格内从顶部往下让多少像素（见文件头：让到脸+肩那一块）。 */
export const AVATAR_CROP_Y = 24

/** 相对资源根（面板的 `./vendor/`）与绝对 URL 的判定，和 `scene/sheet-loader.js` 同一口径。 */
function assetUrl(url, baseUrl = './vendor/') {
  if (typeof url !== 'string' || url === '') return null
  if (/^(https?:)?\/\//.test(url) || url.startsWith('/') || url.startsWith('.')) return url
  return `${baseUrl}${url}`
}

/**
 * 找出一个成员的贴图信息。
 *
 * @param {object|null} scene - `ScenePlan`（快照里的 `scene`）。
 * @param {string|null} agentId
 * @returns {{url: string, col: number, row: number, cellW: number, cellH: number}|null}
 *   找不到（没有场景 / 没有这个 actor / 没声明图集 / 没有动画）时返回 null，调用方退回字母头像。
 */
export function resolveMemberSprite(scene, agentId, baseUrl = './vendor/', role = null) {
  if (scene === null || scene === undefined || typeof agentId !== 'string' || agentId === '') return null
  const actors = Array.isArray(scene.actors) ? scene.actors : []
  let actor = actors.find((a) => a !== null && a.id === agentId)
  // R382：新建成员可能还没进 scene.actors（快照滞后）；按同职业找一张现有贴图，
  // 避免头像直接掉成字母。只做展示兜底，不改变角色身份。
  if (actor === undefined && typeof role === 'string' && role !== '') {
    actor = actors.find((a) => a !== null && a.role === role)
  }
  if (actor === undefined) return null
  const models = Array.isArray(scene.models) ? scene.models : []
  const model = models.find((m) => m !== null && m.id === actor.modelId)
  if (model === undefined || model.sheet === null || model.sheet === undefined) return null
  const sheet = model.sheet
  if (!Number.isFinite(sheet.cellW) || !Number.isFinite(sheet.cellH) || sheet.cellW <= 0 || sheet.cellH <= 0) return null
  const url = assetUrl(model.url, baseUrl)
  if (url === null) return null
  const animations = sheet.animations ?? {}
  const anim = animations['idle.down'] ?? animations.idle ?? Object.values(animations)[0]
  if (anim === undefined || anim === null || !Number.isFinite(anim.col) || !Number.isFinite(anim.row)) return null
  return { url, col: anim.col, row: anim.row, cellW: sheet.cellW, cellH: sheet.cellH }
}

/**
 * 把贴图信息算成 CSS 背景的三件套。
 *
 * ⚠️ `background-size` 必须是 `auto`（用图集原始像素），不能写 `30px auto`。
 * 这是 R157 真机上抓到的一个坑：`30px` 是**整张图集**的宽度，不是一格的宽度。
 * 1792px 宽的图集被压成 30px 之后，一格只有 0.5px——头像看起来就是**空的**。
 * 头像框 30×30 直接取 32×64 格子里的原始像素（x 方向裁掉 2px），最清楚。
 *
 * `AVATAR_CROP_Y` 是"从格子顶部再往下让 24px"：让到脸与肩膀那一块（见文件头）。
 *
 * @param {{url: string, col: number, row: number, cellW: number, cellH: number}} sprite
 * @returns {{backgroundImage: string, backgroundSize: string, backgroundPosition: string}}
 */
export function spriteAvatarStyle(sprite) {
  const x = -sprite.col * sprite.cellW
  const y = -(sprite.row * sprite.cellH + AVATAR_CROP_Y)
  return {
    backgroundImage: `url(${sprite.url})`,
    backgroundSize: 'auto',
    backgroundPosition: `${round(x)}px ${round(y)}px`,
  }
}

/** 保留两位小数：CSS 里 `-71.25px` 这种值比长浮点好读，也不会累积误差到肉眼可见。 */
function round(value) {
  return Math.round(value * 100) / 100
}
