/**
 * EasyStar.js 的 **ESM 垫片**（vendored，不是上游文件）。
 *
 * ## 为什么需要它
 *
 * 上游 0.4.4 只有 CommonJS 源码（`easystar.js` + `instance.js` + `node.js` + `heap` 依赖），
 * 没有 ESM 构建；`bin/` 那份是 webpack `libraryTarget: "var"`，**挂全局、没有模块导出**（实测 `require` 得到空对象）。
 *
 * 而我们的架构红线不许 `src/sim/` import `node:module`（模拟内核要保持纯净、可移植）——
 * 那条规则是对的，不该为了用库去绕它。所以 `createRequire` 只出现在**这个垫片里**，
 * 它是**第三方代码的适配层**，不属于我们的模拟内核；`src/sim/pathfind.ts` 对它只做**静态 import**。
 *
 * ## 为什么不是"把 CJS 转成 ESM"
 *
 * 我试了。`heap` 是 UMD（`typeof exports === 'object' ? module.exports = factory() : root.Heap = factory()`），
 * 机械转换容易在包装层上出错，而**改第三方源码正文**是我们不想要的（升级时会全部丢失）。
 * 垫片只做一件事：把上游原样的 CommonJS 拿进来，原样导出。
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** 上游原封不动的 CommonJS 入口。 */
const EasyStar = require('./easystar.cjs')

export const js = EasyStar.js
export default EasyStar
