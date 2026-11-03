/**
 * 官方 lark-cli 后端测试：切换后端 → 同步任务 → 读文档 → 写回（评论/完成/改名）。
 *
 * 不依赖真的 npm / 网络 / 飞书授权：用 DSH_FEISHU_EXTRA_PATH 指到临时目录，
 * 里面放一个 shell 脚本假装 lark-cli，按官方输出契约（{ok,data} 信封）返回数据。
 *
 * 跑法：node test/lark.mjs
 * 状态目录强制隔离：isolatedHome() 自己 mkdtemp，绝不继承宿主注入的 DSH_HOME
 * （2026-11-01 就是因为继承 DSH_HOME 再 rm 把真实 ~/.dsh 删了，见 isolatedHome.mjs）。
 */
import { createServer } from 'node:http'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolatedHome } from './isolatedHome.mjs'

const HOME = await isolatedHome('dsh-feishu-lark-')
const BIN = await mkdtemp(join(tmpdir(), 'dsh-feishu-lark-bin-'))
/* 必须在设置 DSH_HOME 之后再加载插件：index.js 在模块顶层读这个变量。 */
const { apply } = await import('../index.js')

const TASKS = JSON.stringify({
  ok: true,
  identity: 'user',
  data: {
    items: [
      {
        guid: 'task-1',
        summary: '修复登录',
        description: '登录偶发 500',
        completed_at: '0',
        due: { timestamp: '1700000000000', is_all_day: false },
        start: { timestamp: '1699000000000', is_all_day: false },
        members: [{ id: 'ou_1', role: 'assignee' }, { id: 'ou_2', role: 'follower' }],
        tasklists: [{ tasklist_guid: 'list-1' }],
        custom_fields: [
          { guid: 'fld-ws', type: 'text', text_value: '工作区A' },
          { guid: 'fld-doc', type: 'text', text_value: 'https://x.feishu.cn/docx/doc-1' },
        ],
        url: 'https://x.feishu.cn/task/task-1',
        updated_at: '1700000000000',
      },
      {
        guid: 'task-3',
        summary: '关系联调用的未完成任务',
        description: '',
        completed_at: '0',
        members: [{ id: 'ou_1', role: 'assignee' }],
        tasklists: [{ tasklist_guid: 'list-1' }],
        custom_fields: [],
        url: 'https://x.feishu.cn/task/task-3',
        updated_at: '1700000000000',
      },
      {
        guid: 'task-2',
        summary: '写周报',
        description: '',
        completed_at: '1700000000001',
        members: [{ id: 'ou_1', role: 'assignee' }],
        tasklists: [{ tasklist_guid: 'list-1' }],
        custom_fields: [],
        url: 'https://x.feishu.cn/task/task-2',
        updated_at: '1700000000000',
      },
    ],
    has_more: false,
  },
})

/* 假 lark-cli：按官方契约输出，只覆盖插件用到的命令。 */
const FAKE_LARK = `#!/bin/sh
echo "$*" >> "$(dirname "$0")/args.log"
cmd="$1"
fakeapi() {
  method="$1"
  path="$2"
  case "$method $path" in
    "GET /open-apis/task/v2/tasks") cat <<'JSON'
${TASKS}
JSON
      ;;
    "GET /open-apis/task/v2/tasklists/list-1") echo '{"ok":true,"data":{"tasklist":{"guid":"list-1","name":"清单A"}}}' ;;
    "GET /open-apis/task/v2/tasklists") echo '{"ok":true,"data":{"items":[],"has_more":false}}' ;;
    "POST /open-apis/task/v2/tasklists") echo '{"ok":true,"data":{"tasklist":{"guid":"list-1","name":"DSH 任务清单"}}}' ;;
    "POST /open-apis/task/v2/custom_fields") echo '{"ok":true,"data":{"custom_field":{"guid":"fld-new"}}}' ;;
    "POST /open-apis/task/v2/comments") echo '{"ok":true,"data":{"comment":{"id":"123","resource_type":"task","resource_id":"task-1"}}}' ;;
    "GET /open-apis/task/v2/custom_fields") echo '{"ok":true,"data":{"items":[{"guid":"fld-ws","name":"工作区","type":"text"},{"guid":"fld-doc","name":"文档","type":"text"},{"guid":"fld-prio","name":"优先级","type":"single_select","single_select_setting":{"options":[{"guid":"fld-prio-0","name":"P0"},{"guid":"fld-prio-1","name":"P1"},{"guid":"fld-prio-2","name":"P2"},{"guid":"fld-prio-3","name":"P3"}]}},{"guid":"fld-eta","name":"预期完成","type":"text"},{"guid":"fld-status","name":"处理状态","type":"single_select","single_select_setting":{"options":[{"guid":"fld-status-0","name":"正常"},{"guid":"fld-status-1","name":"挂起"}]}},{"guid":"fld-trigger","name":"触发条件","type":"single_select","single_select_setting":{"options":[{"guid":"fld-trigger-0","name":"人工触发"},{"guid":"fld-trigger-1","name":"自动执行"},{"guid":"fld-trigger-2","name":"按时执行"}]}},{"guid":"fld-auto","name":"自动开工","type":"single_select","single_select_setting":{"options":[{"guid":"fld-auto-0","name":"是"},{"guid":"fld-auto-1","name":"否"}]}},{"guid":"fld-start","name":"开始时间","type":"datetime"},{"guid":"fld-end","name":"结束时间","type":"datetime"},{"guid":"fld-prev","name":"前置任务","type":"text"},{"guid":"fld-next","name":"后置任务","type":"text"},{"guid":"fld-source","name":"来源任务","type":"text"}],"has_more":false}}' ;;
    "POST /open-apis/task/v2/custom_fields") echo '{"ok":true,"data":{"custom_field":{"guid":"fld-new","type":"text"}}}' ;;
    "PATCH /open-apis/task/v2/tasks/task-1") echo '{"ok":true,"data":{}}' ;;
    "POST /open-apis/task/v2/tasks/task-1/add_dependencies") echo '{"ok":true,"data":{"dependencies":[{"task_guid":"task-2","type":"prev"}]}}' ;;
    "POST /open-apis/task/v2/tasks/task-1/remove_dependencies") echo '{"ok":true,"data":{"dependencies":[]}}' ;;
    "GET /open-apis/authen/v1/user_info") echo '{"ok":true,"data":{"open_id":"ou_1","name":"测试用户","en_name":"Tester","avatar_middle":"https://x.feishu.cn/me-240.png","avatar_url":"https://x.feishu.cn/me-72.png"}}' ;;
    "GET /open-apis/contact/v3/users/ou_1") echo '{"ok":false,"identity":"user","error":{"type":"authorization","subtype":"missing_scope","code":99991679,"message":"unauthorized: user authorization does not cover the required scope(s): contact:contact.base:readonly"}}' >&2; exit 1 ;;
    "GET /open-apis/contact/v3/users/ou_2") echo '{"ok":true,"data":{"user":{"name":"李四","avatar":{"avatar_240":"https://x.feishu.cn/li-240.png"}}}}' ;;
    "POST /open-apis/task/v2/tasks") echo '{"ok":true,"data":{"task":{"guid":"task-new"}}}' ;;
    "GET /open-apis/task/v2/tasks/task-1") echo '{"ok":true,"data":{"task":{"guid":"task-1","description":"","completed_at":"0","dependencies":[]}}}' ;;
    "POST /open-apis/task/v2/tasks/task-1/comments") echo '{"ok":true,"data":{"comment":{"id":"123","resource_type":"task","resource_id":"task-1"}}}' ;;
    "GET /open-apis/task/v2/comments") echo '{"ok":true,"data":{"items":[{"id":"123","resource_type":"task","resource_id":"task-1","content":"进展正常","creator":{"id":"ou_1"},"created_at":"1700000000000"}],"has_more":false}}' ;;
    "GET /open-apis/task/v2/tasks/task-1/subtasks") echo '{"ok":true,"data":{"items":[]}}' ;;
    "GET /open-apis/task/v2/attachments") echo '{"ok":true,"data":{"items":[]}}' ;;
    "POST /open-apis/task/v2/tasks/task-1/add_tasklist") echo '{"ok":true,"data":{}}' ;;
    "GET /open-apis/drive/v1/files") echo '{"ok":true,"data":{"files":[],"has_more":false}}' ;;
    "POST /open-apis/drive/v1/files/create_folder") echo '{"ok":true,"data":{"token":"folder-1","url":"https://x.feishu.cn/drive/folder/folder-1"}}' ;;
    "GET /open-apis/wiki/v2/spaces/get_node") echo '{"ok":true,"data":{"node":{"obj_token":"doc-2","obj_type":"docx","title":"Wiki 页面"}}}' ;;
    "POST /open-apis/drive/v1/metas/batch_query") echo '{"ok":true,"data":{"metas":[{"title":"文档A","latest_modify_time":"1700000000"}]}}' ;;
    *) echo '{"ok":true,"data":{}}' ;;
  esac
}
case "$cmd" in
  version|--version) echo "lark-cli 1.0.98" ;;
  auth)
    if [ "$2" = "status" ]; then
      echo '{"ok":true,"identity":"user","data":{"identities":{"user":{"status":"authorized","userName":"测试用户","openId":"ou_1"}}}}'
    elif [ "$2" = "login" ]; then
      echo '{"ok":true,"data":{"verification_url":"https://accounts.feishu.cn/oauth?x=1","device_code":"dev-1"}}'
    else
      echo '{"ok":true,"data":{}}'
    fi
    ;;
  api) fakeapi "$2" "$3" ;;
  docs)
    if [ "$2" = "+fetch" ]; then
      echo '{"ok":true,"data":{"document":{"content":"# 标题\\n\\n正文内容"}}}'
    elif [ "$2" = "+create" ]; then
      echo '{"ok":true,"data":{"document":{"document_id":"doc-created","url":"https://x.feishu.cn/docx/doc-created"}}}'
    else
      echo '{"ok":true,"data":{}}'
    fi
    ;;
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
/* 同步末尾会给工作区补挂会话；宿主里 registry 一直都在，测试给个空实现，免得白等 15 秒。 */
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

await mkdir(join(HOME, 'dsh-feishu'), { recursive: true })
await writeFile(join(HOME, 'dsh-feishu', 'settings.json'), JSON.stringify({ autoSync: false, cliPath: '/nonexistent/test-only-feishu-sync-cli', titlesMigrated: true }))
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

async function waitFor(fn, timeoutMs = 15_000) {
  const started = Date.now()
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() - started > timeoutMs) return null
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

try {
  /* 1. 面板里要有后端选择器。 */
  const panel = await fetch(base + '/panel')
  const html = await panel.text()
  check('面板返回 HTML', panel.status === 200 && /<html/i.test(html))
  check(
    '准备卡第 1 步默认只露官方 lark-cli，内部 CLI 收在「高级」里',
    html.includes('id="setupCliBody"') &&
      html.includes('安装官方 lark-cli') &&
      html.includes('id="setupInternalCli"') &&
      html.includes('高级：内部 CLI') &&
      html.includes('安装内部 feishu-sync-cli'),
  )
  check(
    '后端改由安装按钮承担（不再有下拉选择器）',
    !html.includes('id="cliBackendSelect"') && html.includes('id="setupAuthStep"'),
  )
  check(
    '主推官方 lark-cli，内部 CLI 只留一行短标签',
    html.includes('可选飞书官方 lark-cli') &&
      html.includes('内网/私有包') &&
      html.includes('飞书官方') &&
      !html.includes('插件专用：读任务、文档'),
  )
  check(
    '授权引导按后端分成两套流程',
    html.includes('appendLarkAuthSteps') &&
      html.includes('appendFeishuAuthSteps') &&
      html.includes('绑定应用并登录 CLI') &&
      html.includes('确认权限'),
  )
  check(
    '认证流程给出唯一下一步（登录动作在 2.1 这一步）',
    html.includes('飞书登录') &&
      html.includes('创建应用') &&
      html.includes('function deriveNext') &&
      html.includes('auth-next'),
  )
  check(
    '未完成的步骤显示「待办」而不是直接给按钮',
    html.includes('待办') && html.includes('进行中'),
  )
  check(
    '被拦截时说明原因并可重试',
    html.includes('租户数据安全策略拦截（21001）') && html.includes('重新检查'),
  )
  check(
    '个人账号模式用按钮分步（不再堆长说明）',
    html.includes('用你本人的飞书账号授权。') &&
      html.includes('飞书登录') &&
      html.includes('重新登录'),
  )
  check(
    'lark 授权分企业应用 / 个人账号两种模式',
    html.includes('账号模式') && html.includes('企业应用') && html.includes('个人账号'),
  )
  const appIdCall = html.lastIndexOf('appIdRow(auth)')
  check(
    '当前应用 App ID 显示在 2.1 绑定步骤里',
    html.includes('当前应用：') &&
      appIdCall > html.indexOf('function appendLarkAuthSteps') &&
      appIdCall < html.indexOf('var loginChildren'),
  )
  check(
    '登录改为「先取链接、再内联展示」：桌面端不依赖 window.open 相对路径',
    html.includes('飞书登录') &&
      html.includes('authLinkBox') &&
      html.includes('打开飞书登录页') &&
      html.includes("api('auth/login'") &&
      !html.includes("window.open('/dsh-feishu/api/auth/open"),
  )

  /* 2. 默认官方 lark-cli：公司内部 feishu-sync-cli 是隐藏后端，不再作为默认。 */
  const before = await getJson('/api/state')
  check('默认后端兼容 main', before.data.settings?.cliBackend === 'feishu-sync')
  check(
    '默认后端不自动切换到官方 CLI',
    before.data.state?.cli?.backend === 'feishu-sync',
  )
  check('默认保留原后端选择', before.data.settings?.cliBackend === 'feishu-sync')

  /* 3. 从内部后端切回官方 lark-cli：探活、体检、快照都要翻过来。
     默认已经是 lark-cli，所以先显式切到内部后端，才能验证「切换后端」这条路径。 */
  const toInternal = await post('/api/backend/switch', { cliBackend: 'feishu-sync' })
  check('可以切到内部 feishu-sync 后端', toInternal.status === 200 && toInternal.data?.settings?.cliBackend === 'feishu-sync')
  await post('/api/settings', { autoSync: false });
  const switched = await post('/api/backend/switch', { cliBackend: 'lark-cli' })
  check('切换接口返回成功', switched.status === 200 && switched.data.ok === true)
  check('设置里记下了 lark-cli', switched.data.settings?.cliBackend === 'lark-cli')
  check('切换后探活到 lark-cli', switched.data.state?.cli?.found === true)
  check('cli.backend 标记正确', switched.data.state?.cli?.backend === 'lark-cli')
  check('版本号来自 lark-cli', switched.data.state?.cli?.version === '1.0.98')
  check('切换后授权体检通过', switched.data.state?.auth?.ok === true)
  check('体检完成 main 的全字段受管清单', switched.data.state?.auth?.tasklistReady === true && switched.data.state?.managedTasklist?.fields?.length === 12)
  const larkArgs = await readFile(join(BIN, 'args.log'), 'utf8').catch(() => '')
  check(
    '清单不存在时自动创建（name=DSH 任务）',
    /POST \/open-apis\/task\/v2\/tasklists.*DSH 任务/.test(larkArgs),
  )
  check(
    '已有完整 schema 不重复建字段',
    !/POST \/open-apis\/task\/v2\/custom_fields/.test(larkArgs),
  )

  /* 3.2 面板第 1 步要分别看到两套 CLI 装没装。 */
  const status = await getJson('/api/state')
  check(
    'state 记下当前登录用户（建任务默认负责人用）',
    status.data.state?.larkUser?.openId === 'ou_1' && status.data.state?.larkUser?.name === '测试用户',
  )
  check(
    '本人头像从 authen 接口拿到并落进 state.larkUser',
    status.data.state?.larkUser?.avatar === 'https://x.feishu.cn/me-240.png',
  )
  check(
    'state 带上两套 CLI 的状态',
    status.data.state?.clis?.['lark-cli']?.found === true &&
      typeof status.data.state?.clis?.['feishu-sync']?.found === 'boolean',
  )

  /* 3.3 安装接口可以指定后端：已装的那套走 already，并把设置切过去。 */
  const install = await post('/api/cli/install', { backend: 'lark-cli' })
  check(
    '指定后端安装走 already 分支',
    install.status === 200 && install.data.installed === true && install.data.already === true,
  )
  check('指定后端安装会同步设置', install.data.settings?.cliBackend === 'lark-cli')

  /* 3.5 已授权时再点「开始授权」不该弹新链接。 */
  const login = await post('/api/auth/login')
  check('lark 已授权时授权接口直接返回 already', login.status === 200 && login.data.ok === true && login.data.already === true)

  /* 4. 同步任务：listTasks → enrich → normalizeTask 全走 lark 分支。 */
  /* 启动后 rearm() 会先跑一次自动同步：撞上就稍等再点「立即同步」，别把竞态当成功能坏了。 */
  let sync = await post('/api/sync')
  for (let i = 0; i < 40 && sync.data?.started !== true; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    sync = await post('/api/sync')
  }
  check('同步接口已启动', sync.status === 200 && sync.data.started === true)
  const synced = await waitFor(async () => {
    const state = await getJson('/api/state')
    return state.data.state?.syncing === false && (state.data.state?.tasks?.length ?? 0) > 0 ? state : null
  })
  check('同步完成并拿到任务', !!synced)
  if (!synced) {
    const failed = await getJson('/api/state')
    console.log('  同步细节:', JSON.stringify({
      lastError: failed.data.state?.lastError,
      auth: failed.data.state?.auth,
      cli: failed.data.state?.cli,
      syncing: failed.data.state?.syncing,
    }))
  }
  const tasks = synced?.data.state.tasks ?? []
  check('任务标题来自 OAPI summary', String(tasks[0]?.title || '').includes('修复登录'))
  check('清单名来自 tasklists 接口', tasks[0]?.listName === '清单A')
  check(
    '负责人姓名/头像来自本人身份（联系人接口缺 scope 也不再是 open_id 首字母）',
    tasks[0]?.members?.[0]?.name === '测试用户' && tasks[0]?.members?.[0]?.avatar === 'https://x.feishu.cn/me-240.png',
  )
  check(
    '关注人姓名/头像照旧走联系人接口',
    tasks[0]?.members?.[1]?.name === '李四' && tasks[0]?.members?.[1]?.avatar === 'https://x.feishu.cn/li-240.png',
  )
  check(
    '自定义字段值已映射',
    (tasks[0]?.customFields ?? []).some((item) => item.name === '工作区' && item.value === '工作区A'),
  )
  check('已完成任务被过滤（includeCompleted=false）', tasks.every((task) => task.done !== true))

  /* 5. 文档读取：docs +fetch 的信封要能拆开。 */
  const doc = await post('/api/docs/read', { url: 'https://x.feishu.cn/docx/doc-1' })
  check('文档读取成功', doc.status === 200 && doc.data.ok === true)
  check('文档正文解析正确', String(doc.data.markdown || '').includes('正文内容'))

  /* 6. 文档信息：docx 走 metas/batch_query。 */
  const info = await post('/api/tasks/rename', { taskId: 'task-1', title: '改过的标题' })
  check('改名走 lark PATCH 成功', info.status === 200 && info.data.ok === true)

  /* 6.5 写回链路：优先级 / 预期完成 / 关系 / 挂起都走官方 Open API，不需要 Python 桥。
     这几条此前直接调 runBridge(feishu_api.py)，在只有 lark-cli 的机器上必然失败。 */
  await rm(join(BIN, 'args.log'), { force: true })
  const priority = await post('/api/tasks/priority', { taskId: 'task-1', value: 'P1' })
  check('优先级写回走官方自定义字段接口', priority.status === 200 && priority.data.ok === true)
  const eta = await post('/api/tasks/eta', { taskId: 'task-1', when: '明天 18:00' })
  check('预期完成写回走官方自定义字段接口', eta.status === 200 && eta.data.ok === true && eta.data.sync?.ok === true)
  const relations = await post('/api/tasks/relations', { taskId: 'task-1', action: 'set', predecessorIds: ['task-3'] })
  check(
    '任务关系写回官方原生依赖接口',
    relations.status === 200 &&
      relations.data.ok === true &&
      relations.data.remote?.ok === true &&
      (relations.data.relations?.predecessors ?? []).some((item) => item.id === 'task-3'),
  )
  const suspend = await post('/api/tasks/suspension', { taskId: 'task-1', action: 'suspend', reason: '自测挂起' })
  check('挂起写回「处理状态」字段', suspend.status === 200 && suspend.data.ok === true && suspend.data.suspension?.active === true)
  const resume = await post('/api/tasks/suspension', { taskId: 'task-1', action: 'resume' })
  check('恢复写回「处理状态」字段', resume.status === 200 && resume.data.ok === true && resume.data.suspension?.active === false)
  const writeArgs = await readFile(join(BIN, 'args.log'), 'utf8').catch(() => '')
  check(
    '写回全部走 lark-cli（没有回退到 Python 桥）',
    /GET \/open-apis\/task\/v2\/custom_fields/.test(writeArgs) &&
      /PATCH \/open-apis\/task\/v2\/tasks\/task-1/.test(writeArgs) &&
      /POST \/open-apis\/task\/v2\/tasks\/task-1\/add_dependencies/.test(writeArgs),
  )
  check('关系失败不静默：远端未成功时明确回报', relations.data.remote?.ok === true)

  /* 7. 写回：评论 / 完成都走官方 API。 */
  const reported = await post('/api/tasks/report', { taskId: 'task-1', text: '处理完了' })
  check('写评论成功', reported.status === 200 && reported.data.ok === true)
  const completed = await post('/api/tasks/complete', { id: 'task-1' })
  check('置完成成功', completed.status === 200 && completed.data.ok === true)

  /* 8. 工具也要跟着后端走：feishu_doc_read 走 engine.readDocMarkdown。 */
  const readTool = tools.get('feishu_doc_read')
  check('feishu_doc_read 已注册', !!readTool)
  const toolResult = await readTool.execute(
    { url: 'https://x.feishu.cn/docx/doc-1', maxChars: 8000 },
    { agent: { id: 'session-test' } },
  )
  check('工具读取走 lark 后端', String(toolResult).includes('正文内容'))

  /* 8.1 任务详情（评论/子任务/附件）也必须走 lark 后端。 */
  const detailTool = tools.get('feishu_task_detail')
  check('feishu_task_detail 已注册', !!detailTool)
  const detailResult = await detailTool.execute({ taskId: 'task-1', refresh: true }, { agent: { id: 'session-test' } })
  check('任务详情走 lark 后端（评论可见）', String(detailResult).includes('进展正常'))
  const commentApi = await getJson('/api/tasks/comments?taskId=task-1')
  const firstComment = commentApi.data?.comments?.items?.[0] ?? {}
  check('评论作者用本人真名而不是 open_id', firstComment.author === '测试用户')
  check('评论头像带本人真头像地址', firstComment.authorAvatar === 'https://x.feishu.cn/me-240.png')

  /* 9. 显式切到公司内部后端（隐藏项）：不应残留 lark 状态。 */
  const back = await post('/api/backend/switch', { cliBackend: 'feishu-sync' })
  check('切到内部 feishu-sync 后端', back.data.settings?.cliBackend === 'feishu-sync' && back.data.state?.cli?.backend === 'feishu-sync')
  check('切到内部后端后重新探活', back.data.state?.cli?.backend === 'feishu-sync')

  /* 10. 在 feishu 后端点「安装 lark-cli」：已经装过，直接切过去。 */
  const reinstall = await post('/api/cli/install', { backend: 'lark-cli' })
  check(
    '从别的后端点安装会切过去',
    reinstall.data.installed === true &&
      reinstall.data.already === true &&
      reinstall.data.switched === true &&
      reinstall.data.settings?.cliBackend === 'lark-cli',
  )
  check(
    '切过去后 cli 状态正确',
    reinstall.data.cli?.backend === 'lark-cli' && reinstall.data.cli?.found === true,
  )
  /* 11. 还没配置飞书应用时：体检给出明确指引，授权接口能抓到 config init 的链接且不重复起进程。 */
  const spawnLog = join(HOME, 'lark-config.log')
  const NOT_CONFIGURED = `#!/bin/sh
cmd="$1"
case "$cmd" in
  version|--version) echo "lark-cli 1.0.98" ;;
  auth)
    echo '{"ok":false,"identity":"user","error":{"type":"config","subtype":"not_configured","message":"not configured","hint":"run config init --new"}}' >&2
    exit 1
    ;;
  config)
    if [ "$2" = "init" ]; then
      echo "$$" >> ${spawnLog}
      echo "打开以下链接配置应用: https://open.feishu.cn/page/cli?user_code=TEST-CODE"
      sleep 3
      exit 0
    fi
    echo '{"ok":false}'
    exit 1
    ;;
  *) echo '{"ok":true,"data":{}}' ;;
esac
`
  await writeFile(join(BIN, 'lark-cli'), NOT_CONFIGURED, 'utf8')
  await chmod(join(BIN, 'lark-cli'), 0o755)

  const checked = await post('/api/auth/check')
  check(
    '没配置应用时体检给出可操作提示',
    checked.data.auth?.ok === false &&
      checked.data.auth?.stage === 'config' &&
      String(checked.data.auth?.detail || '').includes('config init --new'),
  )

  const configLogin = await post('/api/auth/login')
  check(
    '授权接口自动拉起 config init 并给出创建应用链接',
    configLogin.data.ok === true &&
      configLogin.data.stage === 'config' &&
      String(configLogin.data.url || '').includes('open.feishu.cn/page/cli'),
  )
  const firstUrl = configLogin.data.url
  const again = await post('/api/auth/login')
  check('重复点授权复用同一个链接', again.data.url === firstUrl && again.data.stage === 'config')
  const spawns = (await readFile(spawnLog, 'utf8')).trim().split('\n').filter(Boolean)
  check('config init 只起了一个进程', spawns.length === 1)
  /* 等这次 config init 自己退出，清掉缓存的链接，再验失败分支。 */
  await new Promise((resolve) => setTimeout(resolve, 3500))

  /* 12. config init 自己失败时：错误要落到「去终端跑」的指引上，而不是干巴巴的 not configured。 */
  const FAILING = `#!/bin/sh
if [ "$1" = "version" ] || [ "$1" = "--version" ]; then echo "lark-cli 1.0.98"; exit 0; fi
echo '{"ok":false,"identity":"user","error":{"type":"config","subtype":"not_configured","message":"not configured"}}' >&2
exit 1
`
  await writeFile(join(BIN, 'lark-cli'), FAILING, 'utf8')
  await chmod(join(BIN, 'lark-cli'), 0o755)
  const failedLogin = await post('/api/auth/login')
  check(
    '自动创建应用失败时给出终端指引',
    failedLogin.data.ok === false &&
      failedLogin.data.stage === 'config' &&
      String(failedLogin.data.error || '').includes('config init --new'),
  )
  /* 13. 应用已配置但还没登录：进入 login 阶段，授权接口给 OAuth 链接（不再重复建应用）。 */
  /* 真实 CLI 的 auth status / auth login 输出是「裸对象」，没有 {ok,data} 信封，这里按真实形状喂。 */
  const UNAUTHORIZED = `#!/bin/sh
if [ "$1" = "version" ] || [ "$1" = "--version" ]; then echo "lark-cli 1.0.98"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo '{"appId":"cli_test","brand":"feishu","identity":"none","identities":{"user":{"status":"missing"}}}'
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "qrcode" ]; then
  out=""
  prev=""
  for a in "$@"; do
    if [ "$prev" = "--output" ]; then out="$a"; fi
    prev="$a"
  done
  [ -n "$out" ] || exit 1
  printf '\\211PNG\\r\\n\\032\\n' > "$out"
  echo '{"ok":true,"file_path":"'"$out"'"}'
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "login" ]; then
  case "$*" in
    *--device-code*) echo '{"error":"authorization_pending","error_description":"authorization pending"}'; exit 1 ;;
  esac
fi
echo '{"device_code":"dev-2","verification_url":"https://accounts.feishu.cn/oauth/v1/device/verify?user_code=TEST","expires_in":600}'
`
  await writeFile(join(BIN, 'lark-cli'), UNAUTHORIZED, 'utf8')
  await chmod(join(BIN, 'lark-cli'), 0o755)

  const loginStage = await post('/api/auth/check')
  check(
    '应用已配置、未登录时体检进入 login 阶段',
    loginStage.data.auth?.ok === false && loginStage.data.auth?.stage === 'login',
  )
  const oauth = await post('/api/auth/login')
  check(
    'login 阶段直接给 OAuth 链接（不重新建应用）',
    oauth.data.ok === true &&
      oauth.data.stage === 'login' &&
      String(oauth.data.url || '').includes('accounts.feishu.cn'),
  )
  const forced = await post('/api/auth/login', { force: true })
  check(
    '「重新获取授权链接」强制换新链接（不走复用）',
    forced.data.ok === true && forced.data.stage === 'login' && forced.data.url,
  )
  /* 面板不再直接 window.open 这条相对路由（桌面端 dsh-app:// 下会被宿主拦）。
     但路由本身保留：外部浏览器/脚本仍可打开它走服务端 302。 */
  const openRes = await fetch(base + '/api/auth/open?force=1', { redirect: 'manual' })
  check(
    '服务端 302 直达路由仍可用（外部浏览器/脚本用）',
    openRes.status === 302 &&
      /accounts\.feishu\.cn/.test(String(openRes.headers.get('location') || '')),
  )

  check(
    '面板在已有链接时仍提供「重新登录」',
    html.includes('重新登录'),
  )

  /* 14. 二维码接口：桌面端面板用它做内联兜底（链接可能被宿主拦）。 */
  const qrRes = await fetch(base + '/api/auth/qrcode?stage=login')
  const qrBuf = Buffer.from(await qrRes.arrayBuffer())
  check(
    '二维码接口可用（桌面端面板内联兜底）',
    qrRes.status === 200 &&
      /image\/png/.test(qrRes.headers.get('content-type') || '') &&
      qrBuf.slice(0, 4).toString('hex') === '89504e47' &&
      html.includes('auth/qrcode'),
  )

  check(
    '面板内嵌「应用权限开通」引导（后台链接 + scope 清单 + 发布步骤）',
    /开发者后台 · 权限管理/.test(html) &&
      /scope-chip/.test(html) &&
      /task:task:read/.test(html) &&
      /版本管理与发布/.test(html),
  )

  /* 15. 登录链接要能被后端记住：刷新面板/后端重启后还能接着显示，并带过期时间。 */
  const remembered = await post('/api/auth/check')
  check(
    '登录链接会被记住（刷新后不用重新生成）',
    /accounts\.feishu\.cn/.test(String(remembered.data.auth?.pendingUrl || '')) &&
      Number(remembered.data.auth?.pendingExpiresAt) > Date.now(),
  )
  const stateNow = await getJson('/api/state')
  check('state 暴露面板/宿主版本号（用于旧宿主提示）', Number(stateNow.data?.state?.apiVersion) >= 4)
  check(
    '面板会提示旧宿主需要重启',
    /宿主还是旧代码/.test(html) && /staleHost/.test(html),
  )

  /* 15.1 用户在浏览器点了同意后，「检查授权」必须自己用 device_code 把登录收掉，
     不能依赖后台常驻轮询（弹窗/宿主重启会把它弄丢，链接还会被用成「不合法」）。 */
  const MARKER = join(BIN, 'device-approved.marker')
  const COMPLETE_LOGIN = `#!/bin/sh
if [ "$1" = "version" ] || [ "$1" = "--version" ]; then echo "lark-cli 1.0.98"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  if [ -f "${MARKER}" ]; then
    echo '{"appId":"cli_test","identities":{"user":{"status":"authorized","userName":"测试用户"}}}'
  else
    echo '{"appId":"cli_test","identities":{"user":{"status":"missing"}}}'
  fi
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "login" ]; then
  case "$*" in
    *--device-code*) : > "${MARKER}"; echo '{"ok":true}'; exit 0 ;;
  esac
fi
echo '{"ok":true,"data":{}}'
`
  await writeFile(join(BIN, 'lark-cli'), COMPLETE_LOGIN, 'utf8')
  await chmod(join(BIN, 'lark-cli'), 0o755)
  const completedLogin = await post('/api/auth/check')
  check(
    '浏览器同意后「检查授权」能自己收尾登录',
    completedLogin.data.auth?.ok === true,
  )

  /* 16. 登录成功但应用没开通 scope：体检要带出缺哪些权限 + 开发者后台链接。 */
  const MISSING_SCOPE = `#!/bin/sh
if [ "$1" = "version" ] || [ "$1" = "--version" ]; then echo "lark-cli 1.0.98"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo '{"appId":"cli_test","identities":{"user":{"status":"authorized","userName":"张三"}}}'
  exit 0
fi
echo '{"ok":false,"error":{"code":99991679,"msg":"insufficient scope","missing_scopes":["task:task:read"],"console_url":"https://open.feishu.cn/app/cli_test/auth"}}'
exit 1
`
  await writeFile(join(BIN, 'lark-cli'), MISSING_SCOPE, 'utf8')
  await chmod(join(BIN, 'lark-cli'), 0o755)
  const needScope = await post('/api/auth/check')
  check(
    '缺 scope 时体检给出缺失权限与开发者后台链接',
    needScope.data.auth?.permission === false &&
      String(needScope.data.auth?.missingScopes || '').includes('task:task:read') &&
      String(needScope.data.auth?.consoleUrl || '').includes('open.feishu.cn/app/cli_test/auth'),
  )

  /* 17. 个人账号模式：登录用 --scope（显式 scope 列表），不申请企业 tenant 身份。 */
  const PERSONAL = `#!/bin/sh
echo "$@" >> "$(dirname "$0")/args.log"
if [ "$1" = "version" ] || [ "$1" = "--version" ]; then echo "lark-cli 1.0.98"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo '{"appId":"cli_test","identities":{"user":{"status":"missing"},"bot":{"status":"ready"}},"identity":"bot"}'
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "login" ]; then
  echo '{"device_code":"dev-personal","verification_url":"https://accounts.feishu.cn/oauth?x=personal","expires_in":600}'
  exit 0
fi
echo '{"ok":true,"data":{}}'
`
  await writeFile(join(BIN, 'lark-cli'), PERSONAL, 'utf8')
  await chmod(join(BIN, 'lark-cli'), 0o755)
  await rm(join(BIN, 'args.log'), { force: true })
  const toPersonal = await post('/api/settings', { larkAccountMode: 'individual' })
  check(
    '设置能存个人账号模式',
    toPersonal.data?.settings?.larkAccountMode === 'individual',
  )
  const personalLogin = await post('/api/auth/login', { force: true })
  const argsLog = await readFile(join(BIN, 'args.log'), 'utf8').catch(() => '')
  check(
    '个人账号模式用 --scope 而不是 --domain',
    personalLogin.data?.ok === true &&
      argsLog.includes('--scope') &&
      argsLog.includes('task:task:read') &&
      !argsLog.includes('--domain'),
  )
  check(
    '个人账号模式不再探测企业 tenant 接口',
    !argsLog.includes('/open-apis/tenant/v2/tenant/query'),
  )
  const personalState = await getJson('/api/state')
  check(
    '状态里保留个人账号模式',
    personalState.data?.settings?.larkAccountMode === 'individual',
  )
  await post('/api/settings', { larkAccountMode: 'enterprise' })

  for (const pid of spawns) {
    try {
      process.kill(Number(pid), 'SIGKILL')
    } catch {
      /* ignore */
    }
  }
} finally {
  server.close()
}

const failed = checks.filter((item) => !item.ok)
if (failed.length > 0) {
  console.error(`\n${failed.length} 项失败：`)
  for (const item of failed) console.error(`  - ${item.label}`)
  process.exit(1)
}
console.log('\nLARK_OK')
