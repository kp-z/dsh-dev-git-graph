# 2D 像素美术资源库（R50）

> 用户决定：渲染改走 **2D 俯视格子**（《环世界》那种）。这一轮**只收集资源**，不写渲染代码。
> 收集日期 **2026-10-16**；工作目录 `packages/dsh-agent-world/src/vendor/pixel/`。
>
> **一句话结论**：11 个包 · 1720 个文件 · **1.41 MiB** · **全部 CC0**（无署名义务）· 主风格 **16×16**。
> 预览图：`/Users/kp/Downloads/aw-r50-pixel-preview.png`

---

## 一、主尺寸：**16×16**（理由，不是偏好）

| 依据 | 实测 |
|---|---|
| **包本身就是 16×16** | 11 个包里 10 个 Kenney 包 + OGA 那套，逐包读过 `Tilesheet.txt` / `spritesheetInfo.txt`：全部 `TILE SIZE: 16 x 16`（边距 1px；UI 包 2px；OGA 是 18px 格 = 16px 画 + 2px 边距） |
| **同屏能看到整座小镇** | 面板约 1200×700 px；16px 格 → 可见 **75×44 格**。我们的镇是 4 个区 × 8×8 世界单位，一格一单位 = 256 格，**一屏装得下**；换 32px 就只剩 37×22 格，得滚屏 |
| **一套就够拼** | 16px 的格与格能直接拼（同一位对齐、同一套边距）；混 32px 会立刻出现"16px 的人站在 32px 的地板上" |
| **像素清晰度** | 16px 在 2×/3× 整数放大（nearest-neighbour）下依然干净；面板想更精细时可以 3× 放大到 48px/格 |
| **后续补充资源最容易找** | 俯视殖民/roguelike 类素材的绝对主流规格就是 16×16 |

**32×32 备选已核实但本轮没进库**：OpenGameArt 的 `underworld-load-comprehensive-top-view-rpg-tileset-32x32-some-16x24-16x16`，许可 **CC-BY 3.0 + OGA-BY 3.0**（页面 License(s) 字段逐字如此），可用；没进库的理由是**尺寸不同 + 幻想地下城主题**，收进来只会制造混搭风险。真要 32×32 时再单独放 `_other-sizes/`（见 §六）。

---

## 二、许可：逐包亲自读过，原文入库

**规则**：只收 CC0（首选）/ CC-BY 3.0-4.0；拒收 CC-BY-SA、GPL、非商业、无许可标记。

**证据形态**：每个包目录下有一份 **`LICENSE.txt`**，内容是
① 上游许可原文（Kenney 包内自带 `License.txt`，逐字未改）＋ ② 我抄录的**来源与证据**：
资源页 URL、下载直链、zip 的 sha256、收录日期、以及**我在页面上逐字读到的原句**。

抽查（`src/vendor/pixel/tiles/kenney-tiny-town/LICENSE.txt`）：

```
	Tiny Town (1.1)
	Created/distributed by Kenney (www.kenney.nl)
	License: (Creative Commons Zero, CC0)
	http://creativecommons.org/publicdomain/zero/1.0/
	This content is free to use in personal, educational and commercial projects.
	Support us by crediting Kenney or www.kenney.nl (this is not mandatory)
── 来源与证据 ──
资源页（读过） : https://kenney.nl/assets/tiny-town
下载直链       : https://kenney.nl/media/pages/assets/tiny-town/a415fbeb49-1735736916/kenney_tiny-town.zip
zip 的 sha256  : 9768692dccff1d706408a5aedd6ca4f6cd1409506cbc84cb2f862919764be977
我在资源页上逐字读到的原句：
  · "Download this package (130 assets) for free, CC0 licensed!"
  · "Creative Commons CC0"
```

**⚠️ 一条必须写下来的更正**：任务书里说"Kenney 页面是 JS 渲染、直接抓不到 zip 链接（试过 404）"。
**实测不是这样**：`https://kenney.nl/assets/<slug>` 返回的是**静态 HTML**，里面直接带
`https://kenney.nl/media/pages/assets/<slug>/<hash>/kenney_<slug>.zip`。我**成功下载了 11 个 zip**
（每个 60 KB ~ 1.2 MB），并且每个包里的 `License.txt` 都在。所以"Kenney 拿不到"这件事是**可以推翻的**——
不是我编的链接，抓取配方见 §八。

---

## 三、总表

| 类别 | 包 | 来源 | 许可 | 格尺寸 | 资源数 | 文件 | 体积 | zip sha256（前 16） |
|---|---|---|---|---|---|---|---|---|
| characters | `kenney-roguelike-characters` | kenney.nl/assets/roguelike-characters | CC0 1.0 | 16px（1px 边距） | 450 | 5 | 47.1 KB | `05c4c0af7326584c` |
| characters | `oga-16x16-base-sprites` | opengameart.org/content/16x16-base-sprites | CC0 1.0 | 18px 格 = 16px 画 + 2px 边距 | —（5 个下载） | 5 | 14.4 KB | `62ce53be0a21aab5` |
| furniture | `kenney-roguelike-indoors` | kenney.nl/assets/roguelike-indoors | CC0 1.0 | 16px（1px 边距） | 480 | 5 | 62.0 KB | `578cfdb066c4a9de` |
| props | `kenney-roguelike-modern-city` | kenney.nl/assets/roguelike-modern-city | CC0 1.0 | 16px（1px 边距） | 1036 | 1041 | 299.1 KB | `2a3f36b1bc3a3d1c` |
| props | `kenney-tiny-battle` | kenney.nl/assets/tiny-battle | CC0 1.0 | 16px（1px 边距） | 190 | 203 | 81.0 KB | `7751ec7d9a07e57b` |
| tiles | `kenney-roguelike-caves-dungeons` | kenney.nl/assets/roguelike-caves-dungeons | CC0 1.0 | 16px（1px 边距） | 520 | 5 | 161.6 KB | `8ee0f7ce911e7bc0` |
| tiles | `kenney-roguelike-rpg-pack` | kenney.nl/assets/roguelike-rpg-pack | CC0 1.0 | 16px（1px 边距） | 1700 | 8 | 444.8 KB | `8e7d2378f8f79424` |
| tiles | `kenney-tiny-dungeon` | kenney.nl/assets/tiny-dungeon | CC0 1.0 | 16px（1px 边距） | 130 | 137 | 61.2 KB | `c109438ab06f65fd` |
| tiles | `kenney-tiny-factory` | kenney.nl/assets/tiny-factory | CC0 1.0 | 16px（1px 边距） | 130 | 137 | 52.0 KB | `eaec4169aa4bf3ea` |
| tiles | `kenney-tiny-town` | kenney.nl/assets/tiny-town | CC0 1.0 | 16px（1px 边距） | 130 | 137 | 143.5 KB | `9768692dccff1d70` |
| ui | `kenney-pixel-ui-pack` | kenney.nl/assets/pixel-ui-pack | CC0 1.0 | 16px（2px 边距） | 750 | 37 | 79.0 KB | `b76f2f60f2be76eb` |

**合计 11 个包 · 1720 个文件 · 1 480 461 字节（1.41 MiB）** —— 全部 CC0，**无署名义务**。
（`du` 会显示 ~7.8 MB：1720 个小文件在 APFS 上按 4 KB 块分配；进 git 的是 1.41 MiB 实际字节。）

### 交叉引用（一个包能服务多个类别）

| 包 | 主类别 | 还能提供 |
|---|---|---|
| `kenney-roguelike-rpg-pack`（1700 件大图集） | tiles | **家具**（室内家具/桌面）、**道具**（钥匙/食物/金币）、角色 |
| `kenney-tiny-town` | tiles | 道具（栅栏/树/路牌）、角色 |
| `kenney-roguelike-modern-city` | props | 地面（沥青/人行道）、墙体/建筑 |
| `kenney-roguelike-caves-dungeons` | tiles | 墙体、道具（箱子/火把）→ "机房/仓库"可用 |
| `kenney-pixel-ui-pack` | ui | 状态图标、面板 9-slice |

*物理上每个上游包只存一份*（放在主类别下），避免同一份图集在库里出现三份、sha256 对不上账。

---

## 四、覆盖度：我们的需求逐条对照

| 需求（来自小镇本身） | 现状 | 判断 |
|---|---|---|
| **8 个可区分的人** | Kenney `roguelike-characters` 一张图集 **450 个变体**（不同发色/衣服/职业外观），任挑 8 个即可区分 | ✅ 够 |
| **人物行走帧 / 4 方向** | **只有 OGA 那套**：男女各 1 套，**4 方向 × 7 帧**（1 idle + 6 走），裸体基础件（要按配色上色）。Kenney 的人物是**静态单帧**（我裁开图集逐格量过：内容格非透明像素逐格相同，没有多帧位移） | ⚠️ **最大的缺口**，见 §六 |
| **4 个区的地面/墙体可辨** | 草地/土路（tiny-town）、工业地板+黄黑警示（tiny-factory）、石墙石地（caves-dungeons）、室内木地板/地毯（indoors + rpg-pack）、沥青/人行道（modern-city） | ✅ 材质够；但**哪一格是哪块**要接入时标注 |
| **办公家具**（桌/椅/显示器/书架/沙发/服务器机柜/告示板/纸箱/盆栽） | `roguelike-indoors` 480 件（桌、椅、柜台、书架、床、地毯、灯…）+ rpg-pack 室内部分 + modern-city（纸箱/货架/杂物） | 🟡 多数有；**"显示器/键盘/白板/服务器机柜"这类现代办公专有物没有明确对应** |
| **小物件**（键盘/杯子/文件/灯/邮件） | rpg-pack 道具、modern-city 物件、pixel-ui-pack 图标（信封类图标可用） | 🟡 有替代，未逐格确认 |
| **UI：对话气泡/状态图标（工作中/待命/走路/失败）** | `pixel-ui-pack` **750 件**：9-slice 按钮（48px 原件）、面板、图标；16px 图集 | ✅ 够用 |
| **特效**（完成闪光/表情） | 没有专门的包 | ❌ **缺口** |

---

## 五、拒收清单（每条都有我读到的依据）

| 来源 | 许可（我读到的） | 拒收理由 |
|---|---|---|
| OGA `topdown-characters` | **CC-BY-SA 4.0** | **许可不许**——传染性 copyleft，本库硬约束排除 |
| OGA `dawnlike-16x16-universal-rogue-like-tileset-v181`（任务书点名的那个） | 页面 License(s) 字段 = **CC-BY 4.0**，且 Attribution Instructions 写 "you must accredit DawnBringer" | **许可可用**（CC-BY 要署名），但**风格不搭**：它是深色高细节 roguelike 风，和 Kenney 的明亮扁平风混在一起会像两个游戏。**没收**，留档备查 |
| OGA `underworld-load-...-32x32-...` | **CC-BY 3.0 + OGA-BY 3.0** | 尺寸 32×32 + 幻想主题 → 本轮不收（§一 已说明） |
| Kenney `1-bit-pack`（1078 件） | CC0 | **风格不搭**：1-bit 单色，与主风格不是一个色板 |
| Kenney `ui-pack`（430 件） | CC0 | **非像素**：32~64px 平滑矢量风，混进去会明显"不是一套" |
| Kenney `pattern-pack`（80 件） | CC0 | **非像素**：256×256 平滑图案 |
| Kenney `input-prompts`（1500 件） | CC0 | **非像素 + 4.84 MB**（单包体积是其它包的 5~80 倍） |
| Kenney `pixel-platformer` / `pixel-line-platformer` / `scribble-platformer` | CC0 | **视角不对**：横版侧视，我们是俯视格子 |
| Kenney `tiny-farm` / `tiny-ski` | CC0 | **主题不符**（农场/滑雪） |
| Kenney `mini-dungeon` / `mini-forest` / `mini-skate` | CC0 | **风格不搭**：`mini-*` 是等距/另一套比例 |
| itch.io 各包 | —— | **拿不到**：`itch.io` 在本机网络下超时（实测 000），且 itch 上大量包"免费但没写许可"，本来就该拒 |
| GitHub 上的 CC0 像素仓库 | —— | **半拿不到**：`github.com` / `raw.githubusercontent.com` 超时（000）；`codeload.github.com` 通（301）但本轮没用到（Kenney+OGA 已覆盖需求） |

---

## 六、缺口（下一轮该补什么）

1. **带行走帧的人物只有 2 套**（OGA 男女各一，4 方向 × 7 帧）。
   两条路：**(a)** 用这一套 + 按 8 种配色重上色（渲染侧的工作，成本低，风格统一）；
   **(b)** 再找 1~2 套 CC0 的 4 方向行走角色（OGA 上还有，但要逐个核许可——`topdown-characters` 那种 CC-BY-SA 必须跳过）。
2. **图集没有逐格名称表**：Kenney 的 roguelike 系列只给一张大图集 + `spritesheetInfo.txt`（只有格尺寸/边距）。
   "哪一格是桌子、哪一格是木地板"**目前没人标注**——所以本轮的拼贴图里那些切片是**按"内容非空"挑的示例格**，不是"这些是桌面"。
   接入渲染时的做法：用各包的 `Sample.png`（作者画的示例场景）人工对照，做一张 `tile-index.md`。
3. **现代办公专有物**缺：显示器、键盘、白板、服务器机柜、咖啡机、工位隔板。
   （`roguelike-indoors` 有桌椅柜，但"电脑显示器"这种现代物件没有明确一格。）
4. **特效/表情**完全没有（完成闪光、感叹号、汗滴）。
5. **32×32 备选**已核实许可但未收录（`_other-sizes/` 目前是空的 —— 这是**决定**，不是遗漏）。
6. **音效**不在本轮范围（`sounds` 库仍未接）。
7. **未做**：把资源切成"我们镇需要的那几格"（渲染接入那一步的事，且不该改像素）。

---

## 七、与上游的差异（我剔除了什么，为什么）

| 剔除 | 为什么 |
|---|---|
| `Preview.png`（各包营销预览图） | 不是资源；占体积（tiny-town 一个 Preview 就 112 KB，比它的全部瓦片还大） |
| `*.url`（Windows 快捷方式） | 不是资源，在 macOS/Linux 上无用 |
| `Tiled/`（`sampleMap.tmx` + `sampleSheet.tsx`） | Tiled 编辑器工程文件，不是资源。**而且它会真的弄坏构建**：`.tsx` 后缀被 `tsconfig.json` 的 `include: ["src"]` 吃进去，tsc 把 XML 当 JSX 编译 → `pnpm test` 直接红（实测过，见 §九）。瓦片本身在 `Tiles/` 和 `Tilemap/` 里一个不少 |
| 上游 `License.txt` → 统一为 `LICENSE.txt` | **不是洁癖**：macOS 文件系统大小写不敏感，`License.txt` 与 `LICENSE.txt` 是**同一个文件**，我第一版同时写这两个名字，结果证据段被反复追加了 5 次（实测踩到）。现在每个包只有一个 `LICENSE.txt`，内容 = 上游原文逐字 + 证据段 |

**像素文件一律原样**：没有改过任何一张图、没有重新编码、没有裁切。

---

## 八、复现 / 刷新配方（下一轮照这个更新）

```bash
# ① 看有哪些 2D 包 + 拿直链（Kenney 页面是静态 HTML，zip 链接就在里面）
curl -sS https://kenney.nl/assets/roguelike-rpg-pack | grep -o 'https://kenney.nl/media/pages/assets/[^"]*\.zip'
# ② 下载（单包 60 KB ~ 1.2 MB；超过 20 MB 的先问 lead）
curl -sS -O '<上一步的 zip 直链>'
# ③ 解开，读包内 License.txt，确认 CC0 原文
unzip -q kenney_xxx.zip -d kenney_xxx && cat kenney_xxx/License.txt

# ④ OpenGameArt：页面里同时有「许可见证」和下载直链
curl -sS 'https://opengameart.org/content/16x16-base-sprites' \
  | grep -oE 'field-name-field-art-licenses.{0,400}' | head -1     # 许可字段
curl -sS 'https://opengameart.org/content/16x16-base-sprites' \
  | grep -oE 'https://opengameart.org/sites/default/files/[^"]+'    # 文件直链
```

**注意**：`web_search` 工具在本轮是坏的（401 invalid key），所以候选来源是靠
`opengameart.org/art-search-advanced?keys=<词>` 的 HTML 与 Kenney 的 slug 猜测**一个个探测**出来的
（`/tmp/kenney-size.mjs` / `/tmp/oga-page.mjs` 那类小脚本）。下一轮想省事就修好搜索工具。

---

## 九、已知红灯（**不修**，原因写在下面）

`pnpm test` 现在 **1 条红**：

```
✖ 白名单与 src/vendor/ 的目录内容一一对应（漏一个都会在运行期变成 404）
   src/vendor/ 里的这些文件没有开路由，运行期会 404：…（1720 条）
```

**这条红是对的**，不能靠改白名单消灭它：
`src/routes/vendor.ts` 的 `VENDOR_WHITELIST` 是**穷举式**的（`test/vendor.test.js` 双向核对
磁盘 ↔ 白名单），它列出的是"**现在渲染器要用**"的确切文件。本轮**没有接渲染**，所以这 1720 个文件
既不该被服务、也不该进白名单——任务书写明"新文件不进白名单是对的，别为了绿去改白名单"。

**下一步（渲染接入时）该怎么做**——两条路，我推荐第一条：
1. 给白名单加**目录前缀**支持（`pixel/` 前缀 + 同一套 MIME/路径校验），一次到位，不必手抄 1720 条；
2. 或者让渲染器只声明它**实际用到**的那几十个文件，照着现在的穷举式白名单一条条加。

`typecheck` 与其余 559 条测试全绿（做完 §七 的剔除之后）。

---

## 十、预览图

`/Users/kp/Downloads/aw-r50-pixel-preview.png`（1520×1374，R50 生成）：
① 四个包**作者自带**的示例场景（一眼看出风格） ② 人物：Kenney 静态人物（放大 4×）+ OGA 的
4 方向行走帧 ③ 地面/墙体/家具/道具/UI 的图集切片（每格 16px，放大 4×）。
图上明确标了"切片是示例格、逐格含义待接入时标注"——**不假装我知道哪一格是桌子**。
