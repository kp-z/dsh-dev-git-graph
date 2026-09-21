# 面板第三方资源（vendored）

面板运行期**不走 CDN**：这里的文件随插件包一起发布，由宿主静态路由 `GET /vendor/:file`
从 `<插件>/vendor/` 读出（见 `src/index.ts`）。

## Tabulator 6.5.3

字段表用的高级表格组件（首列固定 / 列宽拖动 / 表头排序 / 横向滚动）。

| 文件 | 用途 | 来源 URL | sha256 |
|---|---|---|---|
| `tabulator.min.js` | UMD 单文件 JS（挂 `window.Tabulator`） | `https://unpkg.com/tabulator-tables@6.5.3/dist/js/tabulator.min.js` | `ffac518cb793c672a2f0522b7fc80bf862234d96bb1e581c8aaf7f48f130eafa` |
| `tabulator.min.css` | 基础样式（默认主题，面板用 `--line`/`--ink3`/`--accent`/`--glass-*` 覆盖） | `https://unpkg.com/tabulator-tables@6.5.3/dist/css/tabulator.min.css` | `405ae24218357d80df2a5f3addf138666d035f970dac4ebdb0265d0b5373efcb` |
| `LICENSE.tabulator` | 上游许可证原文 | `https://unpkg.com/tabulator-tables@6.5.3/LICENSE` | `191a2ee554684e1064c897b432f0e1bc6dfa714ca045d3f6ea2cf692cbd398b7` |

- **版本**：6.5.3（JS 首行 banner：`Tabulator v6.5.3 (c) Oliver Folkerd 2026`）
- **许可**：MIT（`LICENSE.tabulator`，Copyright (c) 2015-2026 Oli Folkerd）
- **语言包**：不引入。中文标签由面板自己传字符串。

### 校验哈希

```sh
shasum -a 256 src/vendor/tabulator.min.js src/vendor/tabulator.min.css src/vendor/LICENSE.tabulator
```

### 升级

换版本时三件事一起做，缺一不可：重下三个文件 → 更新上表版本号与 sha256 → 跑 `npm test`
（面板文本断言会查 `/vendor/tabulator.min.js` 与 `/vendor/tabulator.min.css` 的引用，
`test/vendor.test.ts` 会查路由字节与磁盘一致）。

### 降级

`window.Tabulator` 没加载出来时，面板**不静默失败**：字段表回退到静态渲染，
并在表上方显示「高级表格组件未加载，已退化为静态表」。