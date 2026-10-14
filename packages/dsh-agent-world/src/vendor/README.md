# 面板第三方资源（vendored）

按仓库根 `docs/DIRECTORY.md` 的约定：源在 `src/vendor/`（**入库**），构建同步到
`lib/vendor/`（运行期读那一份，随 `files` 发布）。面板运行期**不走 CDN**。

## three.js 0.167.1（MIT）

3D 视图的渲染核心，以及它的 `OrbitControls` 附加组件。

| 文件 | 用途 | 来源 | sha256 |
|---|---|---|---|
| `three.module.min.js` | ESM 构建（`three@0.167.1/build/three.module.min.js`） | 本机 `~/DEV/msim-front-react-workspace-2/node_modules/three` | `54a7a52ddce0ad06fbd1d021fd03b1e1812d946114a2111e1260bcd490c6b840` |
| `three.OrbitControls.js` | 轨道控制（`examples/jsm/controls/OrbitControls.js`），裸导入 `three`，靠 import map 解析 | 同上 | `f260591ef315aa04888152e7f121865214e33fb54727145cf4e4445058db1297` |
| `LICENSE.three` | 上游许可证原文 | 同上 | `4c40a1ef62450b857c3b2aaf294936304cd552d965fbcd9d32d4c5bcf4ba4454` |

### 为什么是 0.167.1（而 `docs/ASSETS.md` 写的是 0.186.1）

**因为这台机器上没有别的副本，而当前没有外网**（R9–R15 连续九次确认：`api.github.com`、
`registry.npmjs.org`、`example.com` 全返回 `000`）。磁盘上唯一的 three 就是 0.167.1。

**唯一代价**：`postprocessing` 的 peer 范围是 `three >=0.168 <0.187`，0.167.1 差一个 minor
进不去 —— 所以**暂时做不了 bloom**。主题里的 `post.bloom.enabled` 已经预留（内容侧），
等联网换成 0.186 之后**只要换这三个文件、不用改场景代码**，开关立刻可用。

### 换版本要做什么

1. 覆盖这三个文件并**更新上面的 sha256**；
2. 跑 `pnpm test`（其中一条测试会逐个核对本目录的文件都在宿主白名单里）；
3. 手动过一遍 3D 视图——three 的 breaking change 从来不看语义版本。

### 一处**有理由的偏离**：为什么不占根 `/vendor`

仓库约定里宿主静态路由是 `GET /vendor/:file`。但 `webServer.register` 对**重复的
(kind, path) 会直接抛错**，而 `packages/dsh-contract-butler` 已经注册了 `/vendor/:file`
（`src/index.ts`）——我再注册一次会让**那个插件起不来**。

所以本插件的白名单路由挂在**自己的前缀**下：`GET /agent-world/vendor/:file`。
客户端侧完全无感（import map 里写相对路径）。这是一条**为共存让路**的偏离，
不是随手改约定——如果将来宿主支持多所有者或加前缀，应当回来对齐。
