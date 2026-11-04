/**
 * 测试用的强制隔离 HOME —— 血的教训，别再绕过它。
 *
 * 2026-11-01 的事故写法（三个测试都这么干过）：
 *
 *   const HOME = process.env.DSH_HOME || '/tmp/dsh-feishu-xxx'
 *   await rm(HOME, { recursive: true, force: true })
 *
 * 本意是「没设 DSH_HOME 时用 /tmp 兜底」。但 DSH 会把自己的
 * DSH_HOME=~/.dsh 注入 shell 子进程，`||` 兜底永远不生效；于是
 * 不经过 npm script、直接 `node test/xxx.mjs` 就等于 `rm -rf ~/.dsh`，
 * 真实会话和插件设置被整体删除。
 *
 * 规矩只有一条：**测试永远不信任、也不继承 DSH_HOME**。
 * 要隔离就自己 mkdtemp 造临时目录；要删东西先过 assertTempDir()。
 *
 * 另外，因为 ../index.js 在模块初始化时就读 DSH_HOME，必须先调用
 * isolatedHome()、再 `await import('../index.js')`，不能用静态 import。
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

/**
 * 校验 dir 严格位于系统临时目录之内，返回规范化后的绝对路径，否则抛错。
 * 这是所有删除动作前的最后一道闸：宁可测试崩，也不删到临时目录外面。
 */
export function assertTempDir(dir) {
  const root = resolve(tmpdir())
  const target = resolve(dir)
  const rel = relative(root, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`refusing to touch non-temp path: ${target} (tmpdir=${root})`)
  }
  return target
}

/**
 * 新建一个临时 HOME 并设为 process.env.DSH_HOME。
 * 外部已设置 DSH_HOME（例如宿主注入的 ~/.dsh）时一律忽略，只打一行日志说明。
 */
export async function isolatedHome(prefix = 'dsh-feishu-test-') {
  const inherited = process.env.DSH_HOME
  const home = assertTempDir(await mkdtemp(join(tmpdir(), prefix)))
  process.env.DSH_HOME = home
  if (inherited && resolve(inherited) !== home) {
    console.log(`# DSH_HOME=${home}（已忽略外部注入的 ${inherited}）`)
  }
  return home
}
