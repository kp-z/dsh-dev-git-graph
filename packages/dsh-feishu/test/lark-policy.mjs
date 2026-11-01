/**
 * 官方 lark-cli 后端：应用被租户数据安全策略拦截（21001）时的表现。
 *
 * 真实场景里，整个应用被策略挡住，所有 AI 接口都回 21001，授权页显示
 * 「当前无需开通或授权任何权限」。插件必须：
 *   - 体检时直接报 stage=blocked，而不是继续发一个不可能成功的授权链接；
 *   - 面板给出 21001 的原因和开发者后台入口；
 *   - 点「登录 CLI」不再生成链接。
 *
 * 跑法：node test/lark-policy.mjs
 * 状态目录强制隔离：isolatedHome() 自己 mkdtemp，绝不继承宿主注入的 DSH_HOME
 * （2026-11-01 就是因为继承 DSH_HOME 再 rm 把真实 ~/.dsh 删了，见 isolatedHome.mjs）。
 */
import { createServer } from 'node:http'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolatedHome } from './isolatedHome.mjs'

await isolatedHome('dsh-feishu-lark-policy-')
const BIN = await mkdtemp(join(tmpdir(), 'dsh-feishu-lark-policy-bin-'))
/* 必须在设置 DSH_HOME 之后再加载插件：index.js 在模块顶层读这个变量。 */
const { apply } = await import('../index.js')

const POLICY_ERROR = '{"ok":false,"identity":"bot","error":{"type":"policy","subtype":"access_denied","code":21001,"message":"The requested scope is blocked by data security policy. Please contact your tenant administrator."}}'

/* 假 lark-cli：应用能装、bot 身份 ready、用户没登录；所有 api 调用都被 21001 拦。 */
const FAKE_LARK = `#!/bin/sh
case "$1" in
  version|--version) echo "lark-cli 1.0.98" ;;
  auth)
    if [ "$2" = "status" ]; then
      echo '{"appId":"cli_policy_test","brand":"feishu","identities":{"bot":{"status":"ready","available":true},"user":{"status":"missing","available":false}},"identity":"bot"}'
    else
      echo '${POLICY_ERROR}'
    fi
    ;;
  api) echo '${POLICY_ERROR}' ;;
  docs) echo '${POLICY_ERROR}' ;;
  *) echo '{"ok":true,"data":{}}' ;;
esac
`

/* 临时目录都是本次进程现造的，不需要先删；更不允许对继承来的路径做递归删除。 */
await writeFile(join(BIN, 'lark-cli'), FAKE_LARK, 'utf8')
await chmod(join(BIN, 'lark-cli'), 0o755)
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
  get: (key) => (key === 'workspaceRegistry' ? { resolveByPath: async () => undefined } : undefined),
  tools: { register: (definition) => (tools.set(definition.name, definition), () => {}) },
  webServer: { register: (route) => (routes.push(route), () => {}) },
}

apply(ctx, {})

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
  const state = await getJson('/api/state')
  check('状态接口可用', state.status === 200 && !!state.data?.state?.auth)
  const auth = state.data?.state?.auth ?? {}
  check('默认后端是官方 lark-cli', state.data?.settings?.cliBackend === 'lark-cli')
  check('CLI 探活能找到 lark-cli', state.data?.state?.clis?.['lark-cli']?.found === true)

  /* 默认已是 lark-cli：先切到内部后端，再切回 lark，验证「切到 lark 后端」会重新体检，
     体检应该直接报 blocked，而不是 stage=login。 */
  const toInternal = await post('/api/backend/switch', { cliBackend: 'feishu-sync' })
  check('可以切到内部 feishu-sync 后端', toInternal.data?.settings?.cliBackend === 'feishu-sync')
  const switched = await post('/api/backend/switch', { cliBackend: 'lark-cli' })
  check('可以切到 lark-cli 后端', switched.status === 200 && switched.data?.ok === true)
  const after = switched.data?.state?.auth ?? {}
  check('体检直接报「被策略拦截」', after.stage === 'blocked' && after.policyBlocked === true)
  check('给出 21001 的原因', /21001/.test(String(after.detail || '')))
  check('给出开发者后台入口', /open\.feishu\.cn\/app\/cli_policy_test\/auth/.test(String(after.consoleUrl || '')))

  /* 点「登录 CLI」不能再发一条注定失败的链接。 */
  const login = await post('/api/auth/login', {})
  check('不会生成授权链接', login.status === 200 && login.data?.ok === false && !login.data?.url)
  check('登录接口也返回 blocked 阶段', login.data?.stage === 'blocked')

  const panel = await fetch(base + '/panel')
  const html = await panel.text()
  check('面板展示拦截原因', html.includes('租户数据安全策略拦截（21001）'))
  check('拦截态给「重新检查」而不是「登录 CLI」', html.includes('重新检查'))
} finally {
  server.close()
  const failed = checks.filter((item) => !item.ok)
  console.log(failed.length === 0 ? 'POLICY_OK' : `POLICY_FAIL ${failed.length}`)
  for (const item of failed) console.log('  ✗', item.label)
  process.exit(failed.length === 0 ? 0 : 1)
}
