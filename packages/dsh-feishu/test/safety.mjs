/**
 * 测试安全闸：不许让「继承 DSH_HOME 再删」的事故重演。
 *
 * 2026-11-01 01:01，三个测试用
 *   const HOME = process.env.DSH_HOME || '/tmp/dsh-feishu-...'
 *   await rm(HOME, { recursive: true, force: true })
 * 做隔离，但宿主会把 DSH_HOME=~/.dsh 注入子进程，`||` 兜底永远不生效，
 * 于是 `node test/xxx.mjs` 直接删掉了真实数据目录（43 个会话 + 插件设置）。
 *
 * 这里有两道闸：
 *   1. 静态扫描 test/*.mjs：
 *      - 禁止从 process.env.DSH_HOME 兜底取路径；
 *      - 禁止写死 /tmp/dsh-feishu- 夹具目录；
 *      - 递归删除的目标必须是本进程用 mkdtemp()/isolatedHome() 现造的目录；
 *      - 需要隔离的测试必须动态 import ../index.js（静态 import 会先跑插件
 *        模块初始化、读到继承来的 DSH_HOME，隔离就晚了）。
 *   2. 动态重放事故现场：造一个哨兵 DSH_HOME，用它把 lark / lark-policy /
 *      setup 三个测试各跑一遍，断言测试通过、且哨兵目录一个字节都没变。
 *
 * 跑法：node test/safety.mjs
 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertTempDir } from './isolatedHome.mjs'

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url))
/* 闸门自己和隔离助手：注释里要原样引用事故代码，所以不参加静态扫描。 */
const SELF_FILES = new Set(['safety.mjs', 'isolatedHome.mjs'])
const DYNAMIC_TESTS = ['lark.mjs', 'lark-policy.mjs', 'setup.mjs']

let failures = 0
function check(label, ok, detail = '') {
  if (ok) {
    console.log(`✓ ${label}`)
  } else {
    failures += 1
    console.log(`✗ ${label}${detail ? `\n    ${detail}` : ''}`)
  }
}

/* ── 1. 静态扫描 ── */
const files = (await readdir(TEST_DIR)).filter((name) => name.endsWith('.mjs') && !SELF_FILES.has(name)).sort()
check('扫到测试文件', files.length > 0, `test dir: ${TEST_DIR}`)

for (const file of files) {
  const source = await readFile(join(TEST_DIR, file), 'utf8')

  check(
    `${file}: 不用外部 DSH_HOME 兜底（那是 2026-11-01 事故根因）`,
    !/(?:process\.env\.DSH_HOME|process\.env\[\s*['"]DSH_HOME['"]\s*\])\s*(?:\|\||\?\?)/.test(source),
    '把 process.env.DSH_HOME 当默认值，宿主注入的 ~/.dsh 会让隔离彻底失效',
  )

  check(
    `${file}: 不写死 /tmp/dsh-feishu- 夹具目录`,
    !/['"`]\/tmp\/dsh-feishu-/.test(source),
    '固定名字的夹具目录会被并发/上一轮残留影响，请用 mkdtemp(join(tmpdir(), ...))',
  )

  const tempVars = new Set()
  for (const match of source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:mkdtemp|isolatedHome)\s*\(/g)) {
    tempVars.add(match[1])
  }
  /* 删除动作只信「本进程 mkdtemp 出来的目录」：裸标识符必须在 tempVars 里，
     表达式（如 rm(join(HOME, ...))）必须至少引用一个 tempVars 里的变量。 */
  const tempVarRe = tempVars.size > 0 ? new RegExp(`\\b(?:${[...tempVars].join('|')})\\b`) : null
  for (const match of source.matchAll(/\b(?:rm|rmSync)\s*\(\s*([\s\S]*?)\s*,\s*\{([^}]*\brecursive\s*:\s*true[^}]*)\}/g)) {
    const target = match[1].replace(/\s+/g, ' ').trim()
    const bareIdent = /^[A-Za-z_$][\w$]*$/.test(target)
    const safe = bareIdent
      ? tempVars.has(target)
      : /\b(?:mkdtemp|isolatedHome)\s*\(/.test(target) || Boolean(tempVarRe && tempVarRe.test(target))
    check(
      `${file}: 递归删除的 ${target} 是本次 mkdtemp 出来的目录`,
      safe,
      `${target} 不是 mkdtemp()/isolatedHome() 造出来的路径，禁止对继承来的路径做递归删除`,
    )
  }

  if (/isolatedHome\s*\(/.test(source)) {
    check(
      `${file}: 先隔离再动态加载插件（不能用静态 import '../index.js'）`,
      !/^\s*import\s[^\n]*from\s*['"]\.\.\/index\.js['"]/m.test(source),
      'index.js 在模块顶层读 DSH_HOME，静态 import 会先执行它，隔离就晚了；改成 await import()',
    )
  }

  /* DSH_HOME 在测试里只允许两种用法：保存旧值用于恢复（previous 前缀变量，如
     previousHome）或主动覆盖（process.env.DSH_HOME = ...）。把它读进普通变量、
     解构/别名、或直接拼路径都禁止——那等于把宿主注入的真实 home 带进测试。 */
  for (const match of source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*process\.env\.DSH_HOME\b/g)) {
    check(
      `${file}: 不把 DSH_HOME 读进普通变量 ${match[1]}`,
      /^(?:previous|prev|before|original)/i.test(match[1]),
      '只有 previous*/prev* 这种「保存旧值供 finally 恢复」的变量可以读 DSH_HOME，其余请用 isolatedHome()',
    )
  }
  check(
    `${file}: 不拿 process.env.DSH_HOME 直接拼路径`,
    !/(?:join|resolve|dirname|basename)\s*\([^)]*process\.env\.DSH_HOME/.test(source),
    '直接拼路径 = 继承宿主真实 home；请用 isolatedHome()',
  )
  const aliased = [...source.matchAll(/\.DSH_HOME\b/g)]
    .some((match) => !/process\.env$/.test(source.slice(0, match.index)))
  check(
    `${file}: 不用解构/别名读取 DSH_HOME`,
    !aliased && !/\{[^}]*\bDSH_HOME\b[^}]*\}\s*=\s*process\.env\b/.test(source),
    'const { DSH_HOME } = process.env / const E = process.env; E.DSH_HOME 同样是继承真实 home',
  )
}

/* ── 2. 动态重放：哨兵 DSH_HOME 必须纹丝不动 ── */
async function snapshot(root) {
  const entries = new Map()
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      const rel = full.slice(root.length + 1)
      if (entry.isDirectory()) {
        entries.set(`${rel}/`, 'dir')
        await walk(full)
      } else {
        const info = await stat(full)
        const digest = createHash('sha256').update(await readFile(full)).digest('hex')
        entries.set(rel, `${info.size}:${digest}`)
      }
    }
  }
  await walk(root)
  return entries
}

/* 哨兵目录被整个删掉时必须是一次干净的「✗」，不能让闸门自己崩掉。 */
async function snapshotOrMissing(root) {
  try {
    return await snapshot(root)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function diffSnapshots(before, after) {
  return {
    added: [...after.keys()].filter((key) => !before.has(key)),
    removed: [...before.keys()].filter((key) => !after.has(key)),
    changed: [...before.keys()].filter((key) => after.has(key) && after.get(key) !== before.get(key)),
  }
}

function runTest(file, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(TEST_DIR, file)], {
      cwd: TEST_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    const timer = setTimeout(() => child.kill('SIGKILL'), 180_000)
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, output })
    })
  })
}

const sentinel = assertTempDir(await mkdtemp(join(tmpdir(), 'dsh-feishu-sentinel-')))
try {
  /* 复刻事故现场：真实数据目录的样子（有 dsh-feishu/settings.json 和会话文件）。 */
  await mkdir(join(sentinel, 'dsh-feishu'), { recursive: true })
  await writeFile(join(sentinel, 'dsh-feishu', 'settings.json'), JSON.stringify({ sentinel: 'must-survive' }))
  await writeFile(join(sentinel, 'session-keep.jsonl.zstd'), 'keep me')

  const before = await snapshot(sentinel)
  for (const file of DYNAMIC_TESTS) {
    const result = await runTest(file, { ...process.env, DSH_HOME: sentinel })
    const tail = result.output.trim().split('\n').slice(-12).join('\n')
    check(
      `${file}: 在哨兵 DSH_HOME 下运行通过（退出码 ${result.code ?? result.signal}）`,
      result.code === 0,
      tail,
    )
  }
  const after = await snapshotOrMissing(sentinel)
  const drift = after === null ? { removed: ['<整个哨兵目录被删除>'], added: [], changed: [] } : diffSnapshots(before, after)
  check(
    '哨兵 DSH_HOME 未被写入/删除（事故重放零影响）',
    after !== null && drift.added.length === 0 && drift.removed.length === 0 && drift.changed.length === 0,
    JSON.stringify(drift),
  )
} finally {
  /* sentinel 来自 mkdtemp 且已过 assertTempDir 校验，删它自己是安全的。 */
  await rm(sentinel, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} 项失败`)
  process.exit(1)
}
console.log('\nSAFETY_OK')
