/**
 * **美术占位格**（R229）—— 生成物，不要手改。
 *
 * ## 它解决什么
 *
 * 原版地图的 `walkable` 来自 Godot 图块物理多边形，`*-colliders.json` 来自图块 alpha；
 * 但有一批家具（例如右侧办公位的白色台面）**两者都没挡**：nav 说能走、精细几何也没有
 * 对应矩形。真机表现就是"角色站在桌子上"。
 *
 * 判定：对 `office-layer1..4`（家具层，不含地板/墙贴图）逐格统计**下半 60%** 的
 * alpha 覆盖率，≥ 30% 判为"画面上有家具、不能站"。office 场景共 7 格。
 *
 * ## 怎么重新生成
 *
 * `scripts/derive-occupancy.py`（需要 Python 3，无第三方依赖）：
 * 解码 `src/vendor/microverse/scene/office-layer{1..4}.png`，按上面的判据输出本文件。
 * **阈值改动必须连同图一起提交**，否则下次生成会漂移。
 *
 * `index = row * 37 + col`（地图 37×21）。
 */
export const OFFICE_OCCUPANCY: readonly number[] = [75, 112, 180, 181, 392, 395, 479]

/**
 * 上述占位格里，**小而独立**的美术连通块的整块外接矩形（地图像素 x/y/w/h）。
 *
 * 为什么需要它：一个柜台/矮墙常常跨 2–3 格画，而占位格只标了其中一格。只按格补
 * 就只盖住"半截墙"（用户 R231 截图）。这里把整个连通块的外接矩形交给 `SceneSpace`，
 * 绿框才会包住整件物体。
 *
 * 只收 ≤ 3×3 格的小块：大块（整排工位/墙带）外接矩形会吞掉走道，宁可按格。
 * 由 `scripts/derive-occupancy.py` 生成，和 `OFFICE_OCCUPANCY` 同源。
 */
export const OFFICE_OCCUPANCY_RECTS: readonly (readonly [number, number, number, number])[] = [
  [1030, 116, 52, 54],
  [1120, 372, 32, 44],
]
