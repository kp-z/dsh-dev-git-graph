# dsh-agent-world —— 资产、库与美术方向

> 数据核验日期：**2026-10-14**。全部结论来自直接抓取一手来源（npm registry、厂商许可页、
> 以及**真的把资产 zip / GLB 拉下来看过** —— GLB 是解析 JSON chunk 确认 rig 与内嵌动画数的，
> 体积用 HTTP HEAD 量的）。`web_search` 当时不可用（401），所以这份清单没有覆盖 2026-10-14 之后
> 新发布的包。
>
> 本文件是 `docs/ARCHITECTURE.md` §5.4 与 BACKLOG M3-5 / M7-3 的展开。

---

## 0. 三条结论（先看这个）

1. **角色与动画一次解决**：**Kenney "Mini Characters"** —— CC0、无需署名、GLB、**已绑定骨骼且每个
   GLB 内嵌 32 个动画剪辑**（idle / walk / sprint / jump / crouch / sit / pick-up / emote 等），
   12 个低模人类 + 4 个轮椅 + 10 个辅具，**整包 2.29 MB / 26 个 GLB（单角色约 247–273 kB）**。
   已解析 `character-male-a.glb` 确认 `animations:32`、`skins:2`，且 zip 内 `License.txt` 写明 CC0。
   → **一个包同时解决"人"和"走路"两个最难的问题，零法律风险。**
2. **Quaternius 2026 年换许可了，别踩**：站点级许可页现在是 *Quaternius Asset License (QAL) v1.0*
   （2026-08-28 更新），免费商用、无需署名，但 §3(a) **禁止把资产本身（无论是否修改）当作独立资产
   或资产包再分发**。诡异的是**各包页面仍然挂着 "CC0" 徽章**。QAL §7 说以"获取时的版本"为准，
   所以早年下到的 CC0 副本仍是 CC0。→ **不往 MIT 仓库里 vendor Quaternius**，除非把当时的确切
   许可文本 + 下载日期一并记录下来。
3. **Mixamo 不能进仓库**（唯一没查完的一项）：Adobe 的 Mixamo FAQ 给的是"在项目里免费使用"的授权，
   **完全没提再分发动画文件本身**；而真正管事的 Adobe General Terms of Use 从这个网络取不到
   （adobe.com 403 Akamai、AEM content fragment 401）。另外两个现实问题：中国区账号与
   Enterprise/Federated Adobe ID **根本无法使用 Mixamo**，意味着外部贡献者无法复现；且 Mixamo
   没有 per-asset 许可文件可供 sha256。→ **禁止提交 Mixamo 派生的 FBX/GLB**。真要用，只能做成
   可选的本地步骤（用户自己的 Adobe ID + gitignore 的 `assets/private/`），绝不提交二进制。

---

## 1. 选定的资产（按优先级）

| 优先级 | 包 | 作者 | 许可 | 内容 | 格式 | 体积 |
|---|---|---|---|---|---|---|
| **P0** | [Mini Characters](https://kenney.nl/assets/mini-characters) | Kenney | **CC0** | 12 低模人类(6M/6F) + 4 轮椅 + 10 辅具；**每 GLB 内嵌 32 个动画** | GLB | 2.29 MB / 26 GLB |
| **P0** | [Furniture Kit](https://kenney.nl/assets/furniture-kit) | Kenney | **CC0** | 140 个模型（桌/椅/货架，正好当工位与会议室陈设） | GLB+FBX+OBJ | 4.89 MB |
| P1 | [City Kit Commercial](https://kenney.nl/assets/city-kit-commercial) | Kenney | **CC0** | 41 栋建筑 | GLB | 3.91 MB |
| P1 | [Modular Buildings](https://kenney.nl/assets/modular-buildings) | Kenney | **CC0** | 模块化建筑件 | GLB | 1.74 MB |
| P1 | [Nature Kit](https://kenney.nl/assets/nature-kit) | Kenney | **CC0** | 树/石/植被（小镇绿化） | GLB | 10.05 MB |
| P2 | [KayKit Adventurers](https://kaylousberg.com/game-assets/characters-adventurers) + [Character Animations](https://kaylousberg.com/game-assets/character-animations) | Kay Lousberg | **CC0** | 5(+3) 绑定角色 + **133 个人形动画**（同一套 rig） | GLB + glTF | 角色 ~3.5 MB/个 |
| P2 | [Furniture Bits](https://kaylousberg.com/game-assets/furniture-bits) / [City Builder Bits](https://kaylousberg.com/game-assets/city-builder-bits) | Kay Lousberg | **CC0** | 桌椅 / 模块化城市件 | glTF(+OBJ/FBX) | 3.4 / 4.7 MB |
| 环境 | [Poly Haven](https://polyhaven.com/license) | Poly Haven | **CC0** | 997 HDRI + 521 模型（写实扫描，**不是低模**） | HDRI / glTF | 大 |
| 材质 | [ambientCG](https://docs.ambientcg.com/license) | ambientCG | **CC0** | PBR 贴图 / HDRI | PNG 等 | 大 |

**选型取舍**：
- 角色**用 Kenney Mini Characters 而不是 KayKit** —— 单角色 247 kB vs 3.5 MB（KayKit 把 1024 渐变
  图集和所有剪辑都塞进了每个 GLB，5 个角色 17.2 MB）。我们的角色 ≤24 个同屏，体积差 14 倍。
  KayKit 留作"要更好看的角色"时的升级路径。
- 环境**不用 Poly Haven 的模型**（写实扫描，和低模风格打架），只用它的 **HDRI**；
  再加 ambientCG 的 **512 贴图**（转 KTX2）。
- Kenney 的 *Animated Characters* 三包虽然也是 CC0，但**只有 FBX**（GLB 不在里面）→ 不作为首选。
- Poly Pizza 是**逐模型许可**（列表页 CC0 与 CC-BY 3.0 混排）→ 只筛 CC0 用，当零星道具补充。
- **Sketchfab 整站不用**：逐模型 CC-BY / CC-BY-NC / CC-BY-ND / "Standard" 混在一起，NC 与 ND 直接
  出局，是雷区。

---

## 2. 角色动画策略

| 方案 | 结论 | 说明 |
|---|---|---|
| (a) 预烘焙动画 GLB | ✅ **首选** | Kenney Mini Characters：CC0 + 32 剪辑内嵌 + 单角色 247 kB。零署名、零再分发歧义 |
| (b) Mixamo | ❌ **不 vendor** | 见 §0.3。授权只覆盖"在项目里使用"，不覆盖"再分发剪辑文件"，且中国区/企业账号不可用 ⇒ 不可复现 |
| (c) 程序化（胶囊/方块 + 起伏/挤压/倾斜） | ✅ **保底且是必要的补充** | 完全 MIT 干净、零体积、轻松支撑 50+ 角色；也是服务器闪灯、邮件车滚动这类非人形站点的自然选择 |

**采用混合**：(a) 作为主要视觉（`SkeletonUtils.clone` 克隆 2–3 个不同 mesh，每个克隆体一个
`AnimationMixer`，≤20 个角色）+ (c) 做环境动效与道具。
**硬规矩：只有 CC0/public domain 的字节可以进 git。**

---

## 3. 库清单（版本读自 npm registry，2026-10-14）

| 包 | 版本 | 许可 | 体积 | 用途 |
|---|---|---|---|---|
| `three` | 0.186.1 | MIT | 127.7 kB gzip（module 未压缩） | 渲染核心 |
| `three-pathfinding` | 1.3.0 | MIT | 3.7 kB gzip | NavMesh A*（"从工位走到会议室"足够）。注意 2024-05 后没再发版，实质停维护；API 简单稳定 |
| `@recast-navigation/core` (+`/three` `/generators`) | 0.43.1 | MIT | 19.4 kB + 1.9 MB wasm | 运行时从关卡几何生成 navmesh，支持多智能体 crowd。**现代且活跃**的升级路径 |
| `three-mesh-bvh` | 0.9.16 | MIT | 28.8 kB gzip | 拾取/射线加速、可行走面查询 |
| `postprocessing` | 6.39.5 | Zlib | 154 kB gzip | bloom（服务器屏幕发光）。⚠️ peer 上限 `three >=0.168 <0.187`，**每次升 three 都要复查** |
| `yuka` | 0.7.8 | MIT | 82.2 kB gzip | 需要转向行为/感知/FSM 时用；比 three-pathfinding 重 |
| `@react-three/fiber` | 9.8.1 | MIT | ~162 kB gzip | 声明式场景图。**peer: react ≥19 <19.4** |
| `@react-three/drei` | 10.7.9 | MIT | 可 tree-shake（+three-stdlib 25.2 MB 未压缩） | OrbitControls / useGLTF / Environment / Instances |
| `@react-three/rapier` | 2.2.0 | MIT（含 Apache-2.0 的 wasm） | 14.7 kB + 3.08 MB wasm | 角色碰撞/运动学控制。wasm 首帧后懒加载 |

**React 版本红线**：上面所有 pmndrs 的 R3F 系库**只支持 React 19**（fiber 9.x 支持 `>=19 <19.4`；
drei / rapier / postprocessing 要 `^19`）。**如果宿主 shell 是 React 18，就绝不能用 R3F** —— 那会直接
撞 peer 冲突。

> 这正是决策 **D3（面板是宿主路由吐出的独立页面，不塞进宿主 client bundle）** 的价值：
> 独立页面自带自己的 React，**不受宿主 React 版本约束**，也不可能与宿主的 three 版本打架。

---

## 4. 许可红线（逐条）

1. **Quaternius**：包页写 CC0、站点许可页却是 QAL v1.0（2026-08-28）含"禁止再分发资产本身"条款。
   → 只用 Kenney / KayKit 做入库资产；Quaternius 若要留，必须记录确切许可文本 + 下载日期。
2. **CC-BY**（Poly Pizza 混排）：CC-BY 要求署名且**不能被 MIT 再许可**。MIT 仓库里放 CC-BY 需要
   NOTICE + 逐文件署名。→ Poly Pizza 只筛 CC0。
3. **Mixamo**：见 §0.3。不提交。
4. **Sketchfab**：整站不用。
5. **Google Images / Pinterest / 壁纸站 / 训练数据不明的 AI 资产包**：无许可、无溯源、无辩护。
6. **"free" ≠ 开放**：itch.io 上标 "free" 常常等于非商用或禁止再分发；**包页文案可能与 zip 内的
   LICENSE.txt 矛盾**。→ **永远读你实际下到的那个 zip 里的许可文件**（本次已对 Kenney Mini
   Characters 与 KayKit 逐字读过并确认 CC0）。
7. **付费合辑不改许可**：Kenney All-in-1 是可选的便利，单包 CC0 依旧 CC0。
8. **CC0 之上的附加条款**：Poly Pizza 的 TOS 禁止爬取与用于 AI 训练。→ 手工下载，不爬，不喂模型。
9. **字体/音频/HDRI 是独立许可**：`TextGeometry` 要字体文件；Inter（SIL OFL）可以，系统字体不可
   再分发。HDRI 是最大的字节开销 → 只留一张 prefilter 过的小 `.ktx2`。
10. **溯源才是真正的防御**。

---

## 5. VENDOR 台账（M3-5 的交付物模板）

`web/public/assets/VENDOR.md` 必须长这样 —— **一行 = 一个下载下来的压缩包**，不是一行一个站点：

| id | pack | creator | url（实际吐字节的那个） | license | zip 内许可文件 | 下载日期 | sha256 |
|---|---|---|---|---|---|---|---|
| kenney-mini-characters-1.0 | Mini Characters | Kenney | `https://kenney.nl/media/pages/assets/mini-characters/bfc7e272b4-1774770718/kenney_mini-characters.zip` | CC0-1.0 | `License.txt` | 2026-10-14 | `sha256:…` |
| kaykit-adventurers-1.0 | KayKit Adventurers | Kay Lousberg | `https://github.com/KayKit-Game-Assets/...` | CC0-1.0 | `LICENSE.txt` | 2026-10-14 | `sha256:…` |

配套要求：
- 记录**实际提供字节的 URL**（Kenney 走 `/media/pages/assets/…` 的 zip；Quaternius 走 Google Drive
  文件夹，要记 folder id）。
- **zip 与解出的 LICENSE.txt 都要 sha256**。
- 压缩包与许可文件一并入库（许可原文不许只写在 README 里）。
- CI 步骤：重新哈希资产目录并与台账比对，漂移就红。
- 另有 `THIRD_PARTY_NOTICES.md`，列清哪些是 MIT（我们的代码）、哪些是 CC0（美术），
  让 MIT 读者一眼看懂边界。

```bash
shasum -a 256 kenney_mini-characters.zip
find assets -type f -exec shasum -a 256 {} + | sort -k2 > assets/SHA256SUMS
shasum -a 256 -c assets/SHA256SUMS   # CI 里跑
```

---

## 6. 美术方向："舒适等距沙盘园区"

*Cozy isometric diorama campus* —— 一块桌面尺度的办公小镇，平面着色低模，暖色柔光配
柔而长的阴影，轻微深度雾，低饱和粉彩调色板。

**相机**：`OrthographicCamera`，标准等距（yaw 45°，tilt = atan(1/√2) ≈ 35.264°），视锥调到小镇
占满 ~1.0–1.3 倍；允许 ±10° 的 yaw/pitch 微转与两档缩放（总览 / 单站点）。
正交投影是"沙盘感"的来源，也顺带消掉透视穿帮、让 60fps 更容易。
想要一点纵深感就换 `PerspectiveCamera` fov 28–32，保持同样的 yaw/tilt。

**光照配方**：
- `HemisphereLight(sky #CFE6F5, ground #E8C9A0, 0.55)` 作补光
- `DirectionalLight(#FFD9A0, 1.5)` 位于 (12, 18, 8)，`castShadow`，`PCFSoftShadowMap`，
  `shadow.mapSize 2048`，shadow camera 紧贴小镇裁剪
- 极低强度暖色 `AmbientLight(#FFF3E0, 0.2)`
- `FogExp2(#F2E8DC, 0.008–0.012)`，让远处站点化进纸色背景
- 渲染器：`ACESFilmicToneMapping`（曝光 ~1.05）、`outputColorSpace = SRGB`、
  `powerPreference: 'high-performance'`、`pixelRatio` 封顶 1.5–2
- 后处理**只开 bloom**（阈值 ≈0.9、强度 0.3–0.4）做服务器/屏幕发光；**全局 SSAO 关掉**，
  AO 烘进顶点色或每个站点一张柔和接地阴影面（对 60fps 的标签页来说，烘焙 > 实时）

**调色板（hex）**：

| 用途 | 色 |
|---|---|
| 纸色/天空 | `#CFE6F5` |
| 地面 | `#E8D5B7` |
| 墙体/机构 | `#F7EFE3` |
| 木 | `#B98A5E` |
| 赤陶（强调） | `#D97A5A` |
| 苔绿 | `#8FA97C` |
| 青（水/玻璃） | `#4E8C8A` |
| 墨（描边） | `#3B3A38` |
| 薰衣草（强调） | `#8E7CC3` |
| 发光青（服务器/屏幕） | `#7FE3D4` |

**色彩纪律**：饱和度分三层 —— 大面积低饱和表面 / 中间调家具 / **每个功能分区只有一个饱和强调色**。
**所有角色的服装保持在中间调**，这样一群 agent 读起来像"一个团队"而不是"一堆色块"。

> 这一条要落到代码里：`src/domain/constants.ts` 现有的 `DISTRICT_GROUND` / `AGENT_PALETTE` /
> `ROLE_COLOR` 是 R1 凭直觉定的，M3-3 要按上面的配方重排，并保持"每个分区一个强调色"。

**参考作品**：*Monument Valley*（等距粉彩沙盘、平面着色、一区一强调色）、
*Townscaper*（低模舒适村落、柔方向光 + 轻雾、极小调色板）、
*Untitled Goose Game*（平面低模风格化 + 低饱和暖调 + 单一强强调色）。
三者共性：近似正交的取景、最多 2–3 个光源、没有贴图细节、**全靠颜色讲故事**。

**性能/载荷预算**：可见三角面 ≤100k、draw calls ≤60（重复道具走 `InstancedMesh`，静态簇走
`BufferGeometryUtils.mergeGeometries`）、贴图 ≤512²（KayKit 的 1024 图集降到 128–256）、
GLB 上 meshopt/Draco 压缩、**首屏载荷 ≤5 MB**（含 1 张 prefilter `.ktx2` HDRI 与 ≤20 个
`SkeletonUtils` 克隆的蒙皮角色）。

---

## 7. 未决 / 待复核

1. **Mixamo 再分发问题**——唯一没查完的。Adobe 条款文档在本机被 IP 拦。
   谁用正常浏览器打开 `https://www.adobe.com/legal/terms.html` §4 复核一下。
   **在此之前按"不可 vendor"处理。**
2. Quaternius 的实际下载体积、KayKit 在 itch 上的包体积都量不了（itch 子域在本机 DNS 不可达，
   KayKit 用了官方 GitHub 镜像）。M7-3 真下载时补测。
3. `web_search` 当时 401，所以 2026-10-14 之后新发布的包没覆盖。M7-3 前再扫一遍。
