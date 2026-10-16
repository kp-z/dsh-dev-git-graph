# EasyStar.js（vendored）

- 上游：https://github.com/prettymuchbryce/easystarjs
- 版本：0.4.4 · 许可证：MIT（`LICENSE`，Copyright (c) 2012-2020 Bryce Neal）
- 依赖：`heap` 0.2.7 · MIT（`LICENSE-heap`）——已带进来并把 `require('heap')` 指向本地那份

## 为什么 vendor 源码树而不是 `bin/easystar-0.4.4.js`

上游的 `bin/` 是 webpack **`libraryTarget: "var"`** 构建，它把东西挂到**全局变量** `EasyStar` 上，
**没有模块导出**——`require()` 拿到的是一个空对象（实测）。
源码树是普通 CommonJS，Node 直接能 require，所以用它。

## 用途

`src/sim/pathfind.ts` 用它做**绕障寻路**：角色不能穿墙。
碰撞数据来自原版 Godot 图块的物理多边形（`scripts/convert-microverse-map.mjs`）。
