# 第三方资源署名

本插件使用了下列第三方资源。**每一条都给出上游链接与许可依据**——不要凭印象改这份文件，
改动前先读 `docs/ASSET-LICENSES-EVIDENCE.md`（逐套的原始证据）。

## 美术

### LimeZu — Modern Office（**必需署名**）

> 使用位置：`src/vendor/microverse/`（随 `lib/vendor/` 发布）
> 内容：办公家具 339 件、角色 8 个、地图 2 张

**LimeZu 的条款要求署名**（原文）：

> - You **CAN** use the asset in any commercial or non commercial project
> - You **CAN'T** resell or **distribute** the asset to others
> - You **CAN'T** edit and resell the asset to others
> - **Credits required** (this link)

署名对象：**LimeZu** — <https://limezu.itch.io/modernoffice>

⚠️ **这份署名只满足了 "Credits required" 那一条。** 同一份条款里还有
**"You CAN'T resell or distribute the asset to others"**，而我们的 `package.json` 是
`files: ['lib', ...]`、美术在 `lib/vendor/microverse/`——**会随包发布**。
这一条是否被违反，见 `docs/ASSET-LICENSES-EVIDENCE.md` 的结论与 BACKLOG 里待定的处理方式。
**在有结论之前，不要把本插件公开发布。**

### Kenney — Mini Characters 1.0 / Furniture Kit 2.0（CC0）

> 使用位置：`src/vendor/kenney-mini-characters/`、`src/vendor/kenney-furniture/`
> 依据：两套各自的 `License.txt`（上游 <https://kenney.nl/assets>）

### Kenney — 像素包 9 套 + OGA 16×16 裸模（CC0）

> 使用位置：`src/vendor/pixel/`（11 个子包，每包一份 `LICENSE.txt`）
> 依据：`docs/PIXEL-ASSETS.md` 的总表

## 代码库

| 资源 | 版本 | 许可 | 位置 |
|---|---|---|---|
| three.js | 0.167.1 | MIT | `src/vendor/three/` |
| PixiJS | 8.6.6 | MIT | `src/vendor/pixi/` |
| Phaser | 3.90.0 | MIT | `src/vendor/phaser/` |
| Microverse（仅代码） | —— | MIT (KsanaDock) | `src/vendor/microverse/LICENSE` |

## 说明

- **Microverse 的 MIT 覆盖的是它的代码，不是它带的美术。** 美术的许可见上面 LimeZu 那一条——
  这是本文件里唯一需要区分"代码许可"与"美术许可"的地方，也是唯一有争议的一套。
- 新增任何第三方资源时：**先读上游许可页、把原文记进
  `docs/ASSET-LICENSES-EVIDENCE.md`，再入库**；`test/vendor-licenses.test.js` 会守卫
  "有二进制资产的目录必须有许可文件"这条底线，但**它检查不了"本地 LICENSE 是否覆盖美术"**，
  那一层只能靠人读。
