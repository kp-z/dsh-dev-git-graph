/**
 * 「飞书准备卡」后端测试：一键装 CLI + 装完认出来 + 授权体检。
 *
 * 不依赖真的 uv / pip / 网络：用 DSH_FEISHU_EXTRA_PATH 指到一个临时目录，
 * 里面放两个 shell 脚本假装 uv 和 feishu-sync-cli。
 *
 * 跑法：node test/setup.mjs
 * 状态目录强制隔离：isolatedHome() 自己 mkdtemp，绝不继承宿主注入的 DSH_HOME
 * （2026-11-01 就是因为继承 DSH_HOME 再 rm 把真实 ~/.dsh 删了，见 isolatedHome.mjs）。
 */
import { createServer } from 'node:http'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolatedHome } from './isolatedHome.mjs'

await isolatedHome('dsh-feishu-setup-')
const BIN = await mkdtemp(join(tmpdir(), 'dsh-feishu-setup-bin-'))
/* 必须在设置 DSH_HOME 之后再加载插件：index.js 在模块顶层读这个变量。 */
const { apply } = await import('../index.js')

/* 假 CLI：`version` 回版本号，`task list` 回空数组（= 个人令牌可用）。 */
const FAKE_CLI = `#!/bin/sh
case "$1" in
  version) echo "feishu-sync 9.9.9" ;;
  task) echo "[]" ;;
  *) echo "[]" ;;
esac
`

/* 假 uv：记下参数，再把假 CLI 落到同目录，模拟 `uv tool install feishu-sync` 的落点。 */
const FAKE_UV = `#!/bin/sh
dir="$(dirname "$0")"
echo "$@" > "$dir/uv-args.log"
cat > "$dir/feishu-sync-cli" <<'CLI'
${FAKE_CLI}CLI
chmod +x "$dir/feishu-sync-cli"
exit 0
`

/* 临时目录都是本次进程现造的，不需要先删；更不允许对继承来的路径做递归删除。 */
await writeFile(join(BIN, 'uv'), FAKE_UV, 'utf8')
await chmod(join(BIN, 'uv'), 0o755)
process.env.DSH_FEISHU_EXTRA_PATH = BIN

const checks = []
function check(label, ok) {
  checks.push({ label, ok: !!ok })
  console.log(`${ok ? '✓' : '✗'} ${label}`)
}

const tools = new Map()
const routes = []
const ctx = {
  logger: () => ({ info: () => {}, error: () => {} }),
  effect(fn) {
    fn()
    return () => {}
  },
  get: () => undefined,
  tools: { register: (definition) => (tools.set(definition.name, definition), () => {}) },
  webServer: { register: (route) => (routes.push(route), () => {}) },
}

apply(ctx, {})

/* boot 是异步的：等路由挂上来再发请求。 */
const startedAt = Date.now()
while (routes.length === 0) {
  if (Date.now() - startedAt > 10_000) throw new Error('等待路由挂载超时')
  await new Promise((resolve) => setTimeout(resolve, 100))
}

const route = routes.find((item) => item.path === '/dsh-feishu') ?? routes[0]
const server = createServer((req, res) => route.handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/dsh-feishu`

async function getJson(path, init) {
  const res = await fetch(base + path, init)
  const text = await res.text()
  try {
    return { status: res.status, data: JSON.parse(text) }
  } catch {
    return { status: res.status, text }
  }
}
const post = (path, body) =>
  getJson(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })

try {
  /* 这个用例测的是公司内部 feishu-sync-cli 的安装流程（隐藏后端，只在「高级」里露出）。
     默认后端现在是官方 lark-cli，先显式切到内部后端，保证测到的是 uv/pip 这条路径。 */
  const toInternal = await post('/api/backend/switch', { cliBackend: 'feishu-sync' })
  check(
    '可以显式切到内部 feishu-sync 后端',
    toInternal.status === 200 && toInternal.data?.settings?.cliBackend === 'feishu-sync',
  )

  /* 1. 面板里要能看到「装 CLI + 授权」两段的静态骨架。 */
  const panel = await fetch(base + '/panel')
  const html = await panel.text()
  check('面板返回 HTML', panel.status === 200 && /<html/i.test(html))
  check('准备卡在面板里', html.includes('id="setupCard"') && html.includes('id="setupCliStep"'))
  check('授权步骤并入准备卡', html.includes('id="setupAuthStep"') && html.includes('id="authBody"'))
  check('内部 CLI 入口在高级设置里', html.includes('id="setupInternalCli"') && html.includes('高级：内部 CLI'))
  check('高级设置里有索引地址与 CLI 路径', html.includes('id="cliIndexUrl"') && html.includes('id="cliPathInput"'))
  check('旧的独立授权卡已移除', !/aria-labelledby="authTitle"/.test(html))
  check('准备卡收放行是单独一行', html.includes('id="setupSummary"') && html.includes('id="setupChips"'))
  check('旧的收起/展开按钮已移除', !html.includes('id="setupToggle"') && !html.includes('id="setupCollapsed"'))
  check('收放行展示 授权 / CLI / 上次同步 / 出错', ['需要授权', 'CLI 未就绪', '上次同步', '上次同步出错'].every((s) => html.includes(s)))
  check('未授权成功时禁止收起', html.includes('if (!st.ready) return') && html.includes('授权成功后才能收起'))

  /* 2. 还没装 CLI：state 要说清楚，并且别把授权写在「可用」上。 */
  const before = await getJson('/api/state')
  check('state 形状正常', before.status === 200 && before.data.ok === true)
  const cliFound = before.data.state?.cli?.found
  check('未装 CLI 时 cli.found=false', cliFound === false)
  const defaultIndex = before.data.settings?.cliIndexUrl
  check('默认索引留空（用公共源）', (defaultIndex ?? '') === '')

  /* 3. 一键安装：走假 uv，装完必须能立刻认出来。 */
  const install = await post('/api/cli/install')
  check('安装接口返回 ok', install.status === 200 && install.data.ok === true)
  check('安装成功（installed=true）', install.data.installed === true && install.data.already !== true)
  check('安装步骤有记录', Array.isArray(install.data.steps) && install.data.steps.length > 0)
  check('步骤标签是 uv 命令', install.data.steps[0]?.label === 'uv tool install feishu-sync')
  const uvArgs = await readFile(join(BIN, 'uv-args.log'), 'utf8')
  check('未配置私有索引时 uv 不加 --index', !uvArgs.includes('--index'))
  check('安装后 cli.found=true', install.data.cli?.found === true)
  check('版本号解析出来了', install.data.cli?.version === '9.9.9')

  const after = await getJson('/api/state')
  check('state 里 CLI 已就绪', after.data.state?.cli?.found === true && after.data.state?.cli?.version === '9.9.9')

  /* 4. 再点一次：应该走「已安装」分支，不再跑安装命令。 */
  const again = await post('/api/cli/install')
  check('重复安装走 already 分支', again.data.installed === true && again.data.already === true && again.data.steps.length === 0)

  /* 5. 授权体检：假 CLI 的 task list 回 []，应判为可用。 */
  const auth = await post('/api/auth/check')
  check('授权体检通过', auth.data.ok === true && auth.data.auth?.ok === true)

  /* 6. 设置：索引地址要能存下来（安装命令、面板回填都靠它）。 */
  const saved = await post('/api/settings', { cliIndexUrl: 'https://mirror.example/simple' })
  check('cliIndexUrl 落进设置', saved.data.settings?.cliIndexUrl === 'https://mirror.example/simple')
  const reload = await getJson('/api/state')
  check('设置能读回来', reload.data.settings?.cliIndexUrl === 'https://mirror.example/simple')

  /* 7. pip 兜底：uv 找不到包 + Homebrew PEP 668。删掉 CLI，让假 uv 报「源里没包」，
     假 python3 第一次被 PEP 668 拦下、带 --break-system-packages 才成功装；
     索引要取自设置里的 cliIndexUrl，而不是写死的值。 */
  await rm(join(BIN, 'feishu-sync-cli'), { force: true })
  const FAKE_UV_BROKEN = `#!/bin/sh
echo "× No solution found when resolving dependencies:" >&2
echo "Because feishu-sync was not found in the package registry and you require feishu-sync, we can conclude that your requirements are unsatisfiable." >&2
exit 1
`
  await writeFile(join(BIN, 'uv'), FAKE_UV_BROKEN, 'utf8')
  await chmod(join(BIN, 'uv'), 0o755)
  const FAKE_PY = `#!/bin/sh
dir="$(dirname "$0")"
echo "$@" >> "$dir/pip-args.log"
case "$*" in
  *--break-system-packages*)
    cat > "$dir/feishu-sync-cli" <<'CLI'
${FAKE_CLI}CLI
    chmod +x "$dir/feishu-sync-cli"
    exit 0
    ;;
  *)
    echo "error: externally-managed-environment" >&2
    echo "× This environment is externally managed" >&2
    exit 1
    ;;
esac
`
  await writeFile(join(BIN, 'python3'), FAKE_PY, 'utf8')
  await chmod(join(BIN, 'python3'), 0o755)

  const pipInstall = await post('/api/cli/install')
  const pipLabels = (pipInstall.data.steps || []).map((item) => item.label)
  const pipArgs = await readFile(join(BIN, 'pip-args.log'), 'utf8')
  check('uv 失败后继续走 pip', pipInstall.data.steps?.[0]?.label === 'uv tool install feishu-sync' && pipInstall.data.steps?.[0]?.ok === false)
  check('PEP 668 后补 --break-system-packages 重试成功', pipInstall.data.installed === true && pipLabels.some((label) => label.includes('--break-system-packages')))
  check('pip 用 --extra-index-url 带上设置里的索引', pipArgs.includes('--extra-index-url https://mirror.example/simple'))
  check('pip 带 --user（不污染系统 Python）', pipArgs.includes('--user'))
} finally {
  server.close()
}

const failed = checks.filter((item) => !item.ok)
if (failed.length > 0) {
  console.error(`\n${failed.length} 项失败：`)
  for (const item of failed) console.error(`  - ${item.label}`)
  process.exit(1)
}
console.log('\nSETUP_OK')
