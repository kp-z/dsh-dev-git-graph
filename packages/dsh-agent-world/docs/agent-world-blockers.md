# Agent World 阻塞项

## R235：空气墙与画面墙体只重合一部分 / 角色仍能走上墙

### 已确认的数据

- 地图 `office.png`：`1184 × 672`，`37 × 21` 格，源图块 `cellPx = 32`。
- 导航：`unitsPerCell = 2`，`originX = -37`，`originZ = -21`；即 1 个 nav 格 = 2 个世界单位 = 32 个纹理像素。
- 渲染常量 `TILE_PX = 16`（1 世界单位 = 16 纹理像素）。
- `office-colliders.json` 的矩形是**源图像素坐标**，`cellPx = 32`。

### 走过的弯路（已回退）

曾把 collider 的 `cellPx: 32` 直接传给 `buildSceneSpace` 的 `tilePx`，结果 world 单位换算变成
`rx / 32`，精细碰撞体整体缩成一半，`uncoveredCells` 反而升到 225。  
**正确换算是 `rx / TILE_PX(16)`**：源图 32px 对应 2 个世界单位，与 `unitsPerCell = 2` 一致。
该改动已回退，未提交。

### 当前判断

- 物理层已经走 `plan.space.obstacles`（fine + art），不再拿 `nav.blocked` 补整格，避免"看不见的墙"。
- 剩余"只覆盖一半"更可能来自：**角色物理体的脚部尺寸/偏移**、**墙体与角色的深度排序**，而不是 collider 的像素换算。
- 不能用"把 nav.blocked 补成整格"解决——那会重新制造空气墙。

### 下一步（需要真机截图/overlay）

1. 在场景里加一个仅调试可见的 obstacle overlay（红框 = 物理体，绿框 = 角色 body），对照墙美术。
2. 分别验证：角色 body 是否落在脚底、墙 body 是否与墙底边对齐、深度是否按底边排序。
3. 若 body 正确但仍"走上墙"，改深度/脚部 body，不要再改碰撞数据。
