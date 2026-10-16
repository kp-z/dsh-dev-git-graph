# vendored 资产许可核查（R59）

> **这份文件回答一个问题**：`src/vendor/` 下的每一套资产，我们**有没有权利随插件发布**？
>
> **规矩**（R50 定过，这轮继续守）：**每条结论都要贴出上游的原文那句话**，不许只写 "CC0" 或 "MIT"；
> 拿不到证据就写"拿不到 + 我试了什么"，**不许编 URL、不许凭印象断言**。
>
> **抓取日期**：2026-10-16（所有 curl 都在这一天跑，命令见 §六）。
> **本地凭据 ≠ 上游真相**：`microverse/` 就是活例子——它旁边躺着 MIT，但那份 MIT 覆盖的是**代码**，
> 不是它带的美术。所以下面**每一套都去上游核过**。

---

## 一、总表

| 资产集 | 版本 | 上游 | 许可 | **能再分发吗** | 要署名吗 | 依据（原文在 §二） |
|---|---|---|---|---|---|---|
| `kenney-furniture` | Furniture Kit **2.0** | kenney.nl/assets/furniture-kit | **CC0 1.0** | ✅ 能 | ❌ 不需要 | 资源页："Download this package (140 assets) for free, **CC0 licensed!**" |
| `kenney-mini-characters` | Mini Characters **1.0** | kenney.nl/assets/mini-characters | **CC0 1.0** | ✅ 能 | ❌ 不需要 | 资源页："Download this package (25 assets) for free, **CC0 licensed!**" |
| `pixel/`（11 个子包） | 各包版本见包内 `LICENSE.txt` | kenney.nl ×10 + opengameart.org ×1 | **CC0 1.0** | ✅ 能 | ❌ 不需要 | 抽查 3 个 Kenney 页 + OGA 页："(130/1700/750 assets) for free, **CC0 licensed!**"、"License(s): **CC0**" |
| `three` | **0.167.1** | unpkg.com/three@0.167.1 | **MIT** | ✅ 能（保留声明） | 保留版权与许可 | 与发布产物 **sha256 逐字节相同**（§2.5） |
| `phaser` | **3.90.0** | unpkg.com/phaser@3.90.0 | **MIT** | ✅ 能（保留声明） | 保留版权与许可 | 同上 |
| `pixi` | **8.6.6** | unpkg.com/pixi.js@8.6.6 | **MIT** | ✅ 能（保留声明） | 保留版权与许可 | 同上 |
| `microverse` —— **代码** | —— | github.com/KsanaDock/Microverse | **MIT**（KsanaDock 2025） | ✅ 能 | 保留版权与许可 | LICENSE 原文："MIT License / Copyright (c) 2025 KsanaDock" |
| `microverse` —— **美术** | LimeZu **Modern Office - Revamped** | limezu.itch.io/modernoffice | **LimeZu 自定义条款**（非 CC0、非 MIT） | ❌ **条款明写 "CAN'T … distribute the asset to others"** | ✅ **必需署名**（已补，见 §四.1） | 原文见 §2.3——**这是全套里唯一有问题的** |

**一句话**：**除了 `microverse/` 里那套美术，其余全部可以随包发布**（CC0 无需署名；MIT 保留声明即可）。

---

## 二、逐套的原始证据

### 2.1 `kenney-furniture` —— Furniture Kit 2.0

**本地凭据**：`src/vendor/kenney-furniture/License.txt`（包内自带）原文：

```
	Furniture Kit (2.0)

	Created/distributed by Kenney (www.kenney.nl)
	Creation date: 20-10-2018 16:21
	...
	License: (Creative Commons Zero, CC0)
	http://creativecommons.org/publicdomain/zero/1.0/
```

**上游**：`https://kenney.nl/assets/furniture-kit`（2026-10-16 抓）页面上逐字读到：

> Download this package (140 assets) for free, **CC0 licensed!**

**判断**：CC0 1.0 = 公有领域贡献，**可再分发、无需署名**（CC0 的法律文本见
`https://creativecommons.org/publicdomain/zero/1.0/`）。本地 `License.txt` 是上游包内文件，与页面一致。

### 2.2 `kenney-mini-characters` —— Mini Characters 1.0

**本地凭据**：`src/vendor/kenney-mini-characters/License.txt`：

```
	Mini Characters (1.0)

	Created/distributed by Kenney (www.kenney.nl)
	Creation date: 17-07-2024 11:31
	...
	License: (Creative Commons Zero, CC0)
```

**上游**：`https://kenney.nl/assets/mini-characters`（2026-10-16 抓）：

> Download this package (25 assets) for free, **CC0 licensed!**

**判断**：同上，CC0，可再分发。

### 2.3 `microverse` 的美术 —— **本轮的重点**

#### (a) 本地凭据只有一份 MIT，而且它说的是 "the Software"

`src/vendor/microverse/LICENSE`（2026-10-16 从 `https://github.com/KsanaDock/Microverse/raw/main/LICENSE` 重抓，本地与上游一致）：

```
MIT License

Copyright (c) 2025 KsanaDock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
...
THE SOFTWARE IS PROVIDED "AS IS"...
```

**关键**：MIT 通篇只谈 **"the Software"**，**一个字都没提美术/资产**。所以这份 MIT **不能**被援引为"图可以分发"的依据。

#### (b) Microverse 自己说美术是第三方的

`https://github.com/KsanaDock/Microverse/raw/main/README.md` 第 219 行（2026-10-16 抓，逐字）：

> - 美术素材来源: [LimeZu](https://limezu.itch.io/) - 感谢这位优秀艺术家提供的精美游戏素材

`README_EN.md` 第 249 行（同一仓库，英文版）：

> - Art Assets: [LimeZu](https://limezu.itch.io/) - Special thanks to this talented artist for providing beautiful game assets

放在 `## 🙏 Acknowledgments`（致谢）一节里——**署名，而不是授权**。

#### (c) LimeZu 的条款原文（`https://limezu.itch.io/modernoffice`，2026-10-16 抓）

页面标题逐字：

> **Modern Office - Revamped - RPG Tileset [16x16]**

页面 `License:` 一节逐字（去标签后原样）：

```
License:
- You  CAN  use the asset in any commercial or non commercial project
- You  CAN'T  resell or distribute the asset to others
- You  CAN'T  edit and resell the asset to others
- Credits required ( this link )
```

其中 **(this link)** 的 href 实测是 `https://limezu.itch.io/`（即"署名要带上这个链接"）。

#### (d) 我们这套图**就是** LimeZu 那一套（不是"看起来像"）

三份独立证据：

1. **Microverse 自己署名**（上一段 a/b）：美术来自 LimeZu。
2. **LimeZu 页面对自己包里内容的描述**（2026-10-16 抓，逐字片段）：
   > - Available sizes (16x, 32x, 48x) - **Sprites also supplied singularly (more than 300 total)** - RPG Maker MV ready-to-use files - Compatible with Modern Interiors
   —— "**32x**" + "**sprites supplied singularly**（散件）+ **more than 300 total**"，
   与我们 vendored 的 **339 个** `Modern_Office_Singles_32x32_<N>.png`（**32×32 散件**）逐条对得上。
3. **文件名**：我们的 `maps/Modern_Office_32x32.png` 与上游包名 **Modern Office** 同名。

> ⚠️ 我没做到的一步：**没有把像素逐块对拍**（LimeZu 的包要么付费、要么下载要过 itch 的交互流程，
> 我没法非交互地取到原始图集来和我们的 32×32 做逐格比对）。所以"同一套"这个结论是
> **由 Microverse 的署名 + LimeZu 页面自述的"32x 散件 300+ 件" + 同名** 三条证据推出来的，
> 不是像素级证明。如果这一点被质疑，**需要一份 LimeZu 包内的 `License.txt`/README**（拿到实物才能逐格比）。

### 2.4 `pixel/`（11 个子包）—— 抽查 3 个 Kenney 页 + 1 个 OGA 页

| 子包 | 上游页（2026-10-16 抓） | 页面上逐字读到的 |
|---|---|---|
| `tiles/kenney-tiny-town` | kenney.nl/assets/tiny-town | "Download this package (130 assets) for free, **CC0 licensed!**" |
| `tiles/kenney-roguelike-rpg-pack` | kenney.nl/assets/roguelike-rpg-pack | "Download this package (1700 assets) for free, **CC0 licensed!**" |
| `ui/kenney-pixel-ui-pack` | kenney.nl/assets/pixel-ui-pack | "Download this package (750 assets) for free, **CC0 licensed!**" |
| `characters/oga-16x16-base-sprites` | opengameart.org/content/16x16-base-sprites | "Author: **Unnamed** … Tags: 16x16 32x16 Pixel Art base sprite male female walk cycle **License(s): CC0**" |

**其余 7 个子包**的页面上游证据写在各自目录的 `LICENSE.txt`（R50 采集时逐包抓的，含资源页 URL、
zip 直链、zip 的 sha256、以及我在页面上逐字读到的句子），本轮未逐页重抓（见 §五）。

**判断**：11 个子包全部 CC0 1.0 → **可再分发、无需署名**。

### 2.5 `three` / `phaser` / `pixi` —— 版本与许可都核到"逐字节"

这轮用的不是"看 LICENSE 像不像"，而是**拿官方发布产物算 sha256 对拍**（2026-10-16）：

| 包 | 本地文件 | 上游发布产物 | sha256（实测） | 结论 |
|---|---|---|---|---|
| three | `build/three.module.min.js`（684,042 B） | `https://unpkg.com/three@0.167.1/build/three.module.min.js` | `54a7a52ddce0ad06fbd1d021fd03b1e1812d946114a2111e1260bcd490c6b840` | **逐字节相同** |
| phaser | `phaser.esm.min.js`（1,197,130 B） | `https://unpkg.com/phaser@3.90.0/dist/phaser.esm.min.js` | `9327deb5e2f7d382cd054842f641fd504b9a784a730a2bdb94ea63516790ead1` | **逐字节相同** |
| pixi | `pixi.min.mjs`（666,372 B） | `https://unpkg.com/pixi.js@8.6.6/dist/pixi.min.mjs` | `77549c6fb22228d0aa69194b33d5f6162881d9d883815a779438cacdbd435afb` | **逐字节相同** |

（本地文件自身的版本串也对得上：phaser 文件里 `VERSION:"3.90.0"`；pixi 文件头 banner
`/*! * PixiJS - v8.6.6 * Compiled Wed, 18 Dec 2024 …`；three 的 LICENSE 与上游 `r167` 标签的
LICENSE **归一化后相同**。）

三份 `LICENSE` 的上游对拍（同样是逐字节/归一化相同的比对）：

| 包 | 本地 LICENSE 首行 | 上游对拍对象 | 结果 |
|---|---|---|---|
| three | `The MIT License` | `raw.githubusercontent.com/mrdoob/three.js/r167/LICENSE`（1081 B） | 归一化后**相同** |
| phaser | `The MIT License (MIT)` | `.../phaserjs/phaser/v3.90.0/LICENSE.md`（1100 B） | 归一化后**相同** |
| pixi | `The MIT License` | `.../pixijs/pixijs/v8.6.6/LICENSE`（1092 B） | 归一化后**相同** |

各包 LICENSE 内的版权行（逐字）：three = `Copyright © 2010-2024 three.js authors`；
phaser = `Copyright (c) 2024 Richard Davey, Phaser Studio Inc.`；pixi = `Copyright (c) 2013-2023 Mathew Groves, Chad Engler`。

**判断**：MIT → **可再分发**，条件是**保留版权声明与许可文本**（我们已把 `LICENSE` 一起 vendored ✅）。

---

## 三、明确回答：`src/vendor/microverse/` 那套美术，我们能打包发布吗？

### 结论：**不能**（按现有证据）

**卡在哪**：卡在 **LimeZu 的条款原文**和**我们拿不到的任何"再分发授权"**上。

依据链（每一步都有上面的原文支撑）：

1. **那套图不是 KsanaDock 的**：Microverse 的 README 在"致谢"里写明美术来自 LimeZu（§2.3b）。
2. **KsanaDock 的 MIT 只覆盖代码**：MIT 原文通篇只授权 "the Software"（§2.3a）。
   所以**我们不能从 Microverse 那里继承到图片的分发权**——他们自己也没有这个权利可以给。
3. **LimeZu 明确禁止分发**："You **CAN'T** resell or **distribute** the asset to others"（§2.3c）。
   连"改一改再卖"也禁止（"CAN'T edit and resell"）。
4. **我们确实在分发**：`package.json` 的 `files: ['lib', 'cordis.patch.yml', 'README.md', 'docs', 'CREDITS.md']`
   含 `lib`，而美术在 `lib/vendor/microverse/`（实测 **698 个文件 / 1.65 MiB**；
   `du` 显示 5 MB 是 4 KB 块分配的虚高，**1.65 MiB 才是真实字节**）→ **随包发布**。
   另外源码树 `src/vendor/microverse/` 也在仓库里，**同样构成分发**（仓库一公开就是分发）。
5. **署名只解决条款 4 条里的 1 条**：`CREDITS.md` 已补上署名（§四.1），
   但 "Credits required" 与 "CAN'T distribute" 是**两条**要求，满足前者不等于满足后者。

### "不确定"的支点在哪（唯一的翻盘可能）

**如果 KsanaDock 私下取得了 LimeZu 的书面许可**（例如向作者申请过、或买了含再分发权的授权），
那么结论会变成"可以"。**这份文件不在 Microverse 仓库里**——我把能看的地方都看了：

- `LICENSE`：只有 MIT（代码）✔ 已读全文
- `README.md` / `README_EN.md`：只有"致谢"里的一行署名，**没有任何"已获授权/可分发"的字样** ✔ 已读
- 仓库根目录文件清单：只有 `.gitignore` / `CONTRIBUTING.md` / `IMPORT_FILES_SOLUTION.md` /
  `LICENSE` / `README.md` / `README_EN.md` / `project.godot` / `panel_container_theme.tres` / `icon.svg` /
  `asset/` / `scene/` / `script/` —— **没有第二份许可文件** ✔
- LimeZu 的 itch 页面：我抓到的就只有那 4 条 License 文本，**没有提供"再分发授权"这一档** ✔

**所以我给的判断是"不可以"，不确定性只落在一处：是否存在一份我们看不到的私下授权。**

### 能怎么解（按代价从低到高，供 lead 拍板）

| 方案 | 代价 | 效果 |
|---|---|---|
| **① 先不公开发布**（`private: true` 或不上 npm） | 最低 | 风险消失（当前 `package.json` **没有** `private`，默认是可发布的） |
| **② 把美术从 `files` 里排除**（或改成运行时由用户自备/下载） | 低 | 发布的是代码；但仓库里仍有图，仓库公开仍需注意 |
| **③ 向 LimeZu 取得书面许可** | 中（要沟通/可能付费） | 正解；拿到后把许可原文放进 `src/vendor/microverse/` |
| **④ 换掉这套美术**（回退到 `pixel/` 的 CC0 像素包） | 中高（要重做美术接入） | 一劳永逸——R50 收的 11 个包**全是 CC0**，现成可用 |

---

## 四、本轮新发现（lead 没提到的）

1. **署名已经补上了，但只有署名**：仓库根有 `CREDITS.md`（2026-10-16 20:48 创建，已在 `files` 里），
   里面已按 LimeZu 要求署名并引了那 4 条原文，还写着"在有结论之前，不要把本插件公开发布"。
   **本轮核实：署名的对象和链接对得上**（LimeZu + `https://limezu.itch.io/modernoffice`；
   LimeZu 要求的那条 "this link" 指向 `https://limezu.itch.io/`，两者都指向作者主页，OK）。
   ⚠️ 但 **`CREDITS.md` 在署名层面成立 ≠ 分发许可成立**（§三）。
2. **体积不是 4.0 MB**：`src/vendor/microverse/` 实测 **698 文件 / 1.65 MiB 真实字节**；
   `du -sm` 报 5 MB 是 1720 个小文件按 4 KB 块分配的虚高（同理 R50 的 pixel/ 报 8 MB、实际 1.41 MiB）。
   **汇报时用 1.65 MiB 更准**。
3. **受影响的不止家具**：`microverse/` 下还有 `characters/`（8 个 + portraits 8 张，**1.09 MiB，占比最大**）、
   `maps/`（2 张 0.23 MiB）、`floors/`、`objects-tight/`（339 件）。**LimeZu 的条款覆盖这一整套**，
   不是只有 `objects/`。换资源时要一起换。
4. **`lib/vendor/microverse/` 已经存在同份拷贝**（构建产物里也是 698 文件）→ 连 `lib/` 都已落盘，
   不只是源码树。
5. **三个引擎这条完全干净**：用发布产物 sha256 对拍，`three@0.167.1` / `phaser@3.90.0` / `pixi.js@8.6.6`
   **逐字节相同**——版本没被调包，MIT 声明也都在。这是全套里最扎实的一块。
6. **lead 的线索可以独立复现**：`https://officetown.vercel.app/` 的 bundle
   `/assets/index-Clz6fu3e.js` 里确实出现 `limezu.itch.io/modernoffice` 与 `LimeZu`
   （该页还加载 `/assets/phaser-DR1EZjxY.js`）。✅ 复现成功。

---

## 五、我没核到 / 拿不到的部分（不含糊）

| 事项 | 状态 |
|---|---|
| `pixel/` 其余 7 个子包的上游页面 | **本轮没逐页重抓**（只抽查了 3 个 Kenney + 1 个 OGA）。它们的上游证据写在各自 `LICENSE.txt`（R50 采集时抓的，含 URL/直链/sha256/页面原句） |
| LimeZu 包内的实物 `License.txt`/README | **拿不到**：包要么付费、要么下载需过 itch 的交互流程，非交互 curl 取不到 |
| 我们这套图与 LimeZu 原图的**像素级**比对 | **没做**（同上，取不到原始图集）。"同一套"是靠署名 + 页面自述 + 同名三条推的 |
| KsanaDock 是否私下取得 LimeZu 许可 | **看不到**：仓库里没有第二份许可文件（§三 列了查过的地方） |
| LimeZu 是否提供"再分发授权"这一档商品 | **没找到**：Modern Office 页面上只有那 4 条 License 文本 |
| `kenney-furniture` / `mini-characters` 的 zip 直链与 sha256 | 本轮只核了**资源页 + 包内 License.txt**；R50 那轮是把 zip 下下来算过 sha256 的（那批是 pixel/ 的包，不是这两个 3D 包） |

---

## 六、复现命令（照这个再核一遍）

```bash
# ── LimeZu 的条款原文（这几行就是 §三 的依据）
curl -sSL https://limezu.itch.io/modernoffice -o /tmp/lz.html
python3 - <<'PY'
import re, html
s = open('/tmp/lz.html', encoding='utf-8', errors='replace').read()
i = s.find('License:')
print(re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s[i:i+700]))))
PY

# ── Microverse 的 MIT + 它对美术的署名
curl -sSL https://github.com/KsanaDock/Microverse/raw/main/LICENSE | head -5
curl -sSL https://github.com/KsanaDock/Microverse/raw/main/README.md | grep -n "LimeZu"
curl -sSL https://github.com/KsanaDock/Microverse/raw/main/README_EN.md | grep -n -i "art assets"

# ── Kenney 的 CC0 那句
for slug in furniture-kit mini-characters tiny-town roguelike-rpg-pack pixel-ui-pack; do
  printf '%-22s ' "$slug"
  curl -sS "https://kenney.nl/assets/$slug" | grep -oE 'Download this package[^"'"'"'<]*' | head -1
done

# ── OpenGameArt 的许可字段
curl -sS https://opengameart.org/content/16x16-base-sprites \
  | grep -oE 'License\(s\):[^<]*' | head -1

# ── 三个引擎：拿官方发布产物算 sha256 对拍（逐字节）
for pair in "three:0.167.1:build/three.module.min.js" "phaser:3.90.0:dist/phaser.esm.min.js" "pixi.js:8.6.6:dist/pixi.min.mjs"; do
  pkg=${pair%%:*}; rest=${pair#*:}; ver=${rest%%:*}; path=${rest#*:}
  curl -sSL "https://unpkg.com/$pkg@$ver/$path" -o /tmp/pub-check
  shasum -a 256 /tmp/pub-check | cut -c1-16
done
```
