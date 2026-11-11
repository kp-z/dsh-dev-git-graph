/**
 * 生成 `src/client/buildInfo.js`：把「这次构建对应哪个提交、什么时候」写进客户端。
 *
 * 为什么要它：这个插件反复出现「改了 → 重建了 → 用户刷新了 → 看起来没变」。
 * 光靠肉眼分不清「样式没生效」还是「跑的还是旧包」。所以在界面上放一个**可直接读的构建号**，
 * 一眼就能判断当前页面跑的是哪一次构建。
 */
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

let sha = 'dev'
let at = new Date().toISOString().slice(0, 16).replace('T', ' ')
try {
  sha = execSync('git rev-parse --short HEAD', { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim()
} catch { /* 不是 git 仓库就用 dev */ }
try {
  const dirty = execSync('git status --porcelain --untracked-files=no', { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim()
  if (dirty) sha = `${sha}+dirty`
} catch { /* 忽略 */ }

const file = `/**
 * 构建号（自动生成，别手改）：scripts/stamp-build.mjs 在 build:client 前写入。
 * 界面上会显示它，用来判断「页面跑的是不是最新包」。
 */
export const BUILD_SHA = ${JSON.stringify(sha)}
export const BUILD_AT = ${JSON.stringify(at)}
export const BUILD_LABEL = ${JSON.stringify(`${sha} · ${at}`)}
`
writeFileSync(new URL('../src/client/buildInfo.js', import.meta.url), file)
console.log(`build stamp: ${sha} @ ${at}`)
