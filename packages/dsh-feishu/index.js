/**
 * dsh-feishu · 宿主半体
 *
 * 一句话：把 feishu-sync-cli 变成一个常驻的「飞书同步器」——
 * 定时把任务和文档捞进本地快照，暴露成模型可调的工具，并在右侧栏给一个人能看的面板。
 *
 * ## 为什么是「包一层 CLI」而不是直接调飞书 Open API
 *
 * 飞书那套授权（OAuth user token / tenant token / 各种 scope）feishu-sync-cli 已经踩完了：
 * 它管 token 刷新、管缓存、管 wiki/base/sheet 的差异。这里再实现一遍 OAuth，
 * 除了多一份会过期的密钥，没有任何收益。所以本插件**不碰 token**，
 * 只认三件事：`task list --json`、`info_page --json`、`read_page_as_markdown`。
 *
 * 代价是要处理 CLI 不在 PATH 上（Finder 启动的 GUI 进程 PATH 很短）、
 * 输出里混着日志、以及 token 过期这几种情况——都在下面兜住了。
 *
 * ## 生命周期约定
 *
 * `apply` 保持同步且整体兜底：插件在加载期抛异常，后果是整条插件条目失败（界面会报错），
 * 不是「少了个功能」。所以初始化里的异步动作全部 fire-and-forget，失败只写进 state.lastError。
 */
import { execFile, spawn } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'feishu'

/** tools 与 webServer 是骨架：缺一个就没意义，直接 fail-loud。 */
export const inject = ['tools', 'webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DATA_DIR = join(HOME, 'dsh-feishu')
/* 设置共用一份（只在你点保存时写）；状态按实例分文件，见 stateFileFor()。 */
const SETTINGS_FILE = join(DATA_DIR, 'settings.json')
const MOUNT = '/dsh-feishu'

/** 面板里「打开」按钮要用的飞书 web 域；只用于绝对路径拼接，不做鉴权。 */
const LOGIN_URL_HINT = /https:\/\/accounts\.feishu\.cn\/open-apis\/authen\/v1\/authorize\?[^\s"'\\]+/

/**
 * 同一台机器可能同时跑多个 profile（desktop 一个、测试 profile 一个）。
 * 它们共用 DSH_HOME，如果都写同一个 state.json，就会互相覆盖对方刚绑好的会话。
 * 所以状态文件按「这个实例在哪个端口服务」分开；设置仍然共用一份。
 */
function stateFileFor(ctx) {
  let key = 'default'
  try {
    const origin = ctx?.webServer?.getOrigin?.()
    if (typeof origin === 'string' && origin) {
      const port = new URL(origin).port
      if (port) key = port
    }
  } catch {
    /* 拿不到 origin 就用参数兜底 */
  }
  if (key === 'default') {
    const index = process.argv.indexOf('--port')
    const fromArgv = index >= 0 ? process.argv[index + 1] : ''
    if (/^\d+$/.test(fromArgv ?? '')) key = fromArgv
  }
  return join(DATA_DIR, `state-${key}.json`)
}

/**
 * 本端口的 state 文件还没有内容时，从同目录继承一份最近的旧状态。
 *
 * 为什么需要它：DSH 每次重启都会挑一个**不同的端口**（不是固定端口），而状态文件按端口分，
 * 于是重启一次就等于换了一个空状态——表现就是「任务卡片全部掉绑定」「自动开工又给同一条任务
 * 开一条新会话」。这里在首次加载时挑一份最新的、带会话绑定的 `state-*.json` 继承下来，
 * 端口分文件的隔离性保留（两个实例仍然各写各的），只是不再因为换端口而丢历史。
 */
export async function adoptPreviousState(currentFile) {
  const dir = dirname(currentFile)
  let names = []
  try {
    names = await readdir(dir)
  } catch {
    return null
  }
  const candidates = []
  for (const name of names) {
    if (!/^state-.+\.json$/.test(name)) continue
    const file = join(dir, name)
    if (file === currentFile) continue
    let data
    try {
      data = await readJson(file, {})
    } catch {
      continue
    }
    const tasks = Array.isArray(data?.tasks) ? data.tasks : []
    const bound = tasks.filter((task) => task?.sessionId).length
    if (!bound) continue
    let mtimeMs = 0
    try {
      mtimeMs = (await stat(file)).mtimeMs
    } catch {
      /* 拿不到时间就按最旧排 */
    }
    candidates.push({ file, mtimeMs, data, bound })
  }
  if (!candidates.length) return null
  /* 先看时间（最近用过的那份最接近当前现实），时间相同再看绑定数量。 */
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.bound - a.bound)
  return candidates[0]
}

const DEFAULT_SETTINGS = {
  autoSync: true,
  syncIntervalMinutes: 30,
  cliPath: 'feishu-sync-cli',
  tasks: { includeCompleted: false, keyword: '', dueWithinDays: 0 },
  docs: { watch: [], excerptChars: 600 },
  /* 清单自定义字段里，哪两个字段算「工作区 / 自动开工」。 */
  taskFields: { workspace: '工作区', trigger: '触发条件', legacyAuto: '自动开工', doc: '文档' },
  /* off=不自动开工；tagged=只开任务里标了 auto 的；all=所有新任务都开 */
  autoStartMode: 'off',
  autoStartPrompt:
    '你有一条来自飞书的任务：\n\n{{task}}\n\n任务说明：\n{{description}}\n\n请先复述你的理解，再开始处理。任务说明里若要求写回评论，再写。',
  maxAutoStartPerRun: 1,
  /* 绑定任务时把「任务档案」注入会话（按需打开，默认关）。 */
  contextInjection: false,
  /* 任务有实质变化时推给绑定会话（默认关：每次推送都会消耗一个 turn）。 */
  pushChanges: false,
  /* 每个 turn 结束把进展写回任务评论（用户要求的「进展同步」）。 */
  autoComment: true,
  /* 同一会话两条进度评论的最小间隔（秒），防止一个 turn 刷一条。 */
  autoCommentMinSeconds: 45,
  /* 生成飞书文档时给模型的写作要求（面板可编辑）。 */
  docPrompt:
    '把给你的任务材料整理成一份给工程师看的正式文档。硬性要求：\n' +
    '1. 除标题外，正文尽量只由「表格」和「Mermaid 图」组成，不要写叙述性段落；确实要说一句就控制在一行内。\n' +
    '2. 结论、指标、改动清单、风险、验证方式全部做成 Markdown 表格（2-5 列，单元格简短）。\n' +
    '3. 流程/时序/状态/依赖关系用 ```mermaid 代码块（graph TD/LR、sequenceDiagram、stateDiagram-v2）。\n' +
    '4. 标题最多三级、12 字以内；不写“本文档旨在/综上/背景介绍”这类废话。\n' +
    '5. 材料里没有的信息写“待补充”，不要编造。\n' +
    '直接输出 Markdown 正文。',
}

/* 历史上两版默认提示词：升级成「任务档案」版时只替换这两份原文，改过的保留。 */
const LEGACY_AUTO_START_PROMPTS = [
  '你有一条来自飞书的任务：\n标题：{{title}}\n开始：{{start}}\n截止：{{end}}\n链接：{{url}}\n\n{{description}}\n\n请先复述你的理解，再开始处理。任务说明里若要求写回评论，再写。',
  '你有一条来自飞书的任务：\n标题：{{title}}\n开始：{{start}}\n截止：{{end}}\n链接：{{url}}\n文档：\n{{docs}}\n\n{{description}}\n\n请先复述你的理解，再开始处理。任务说明里若要求写回评论，再写。',
]

const DEFAULT_STATE = {
  auth: { ok: false, checkedAt: 0, detail: '尚未检查' },
  cli: { found: false, version: null, path: null },
  lastSyncAt: 0,
  lastError: null,
  syncing: false,
  tasks: [],
  docs: [],
  /* url → { title, at }；问过但没标题的记 null，避免每轮同步重复问。 */
  docTitles: {},
}

/* ────────────────────────────── 小工具 ────────────────────────────── */

function log(ctx, level, message) {
  try {
    const out = ctx.logger ? ctx.logger('feishu') : console
    const fn = typeof out[level] === 'function' ? out[level] : out.info
    fn.call(out, message)
  } catch {
    /* 日志不能再抛 */
  }
}

function nowMs() {
  return Date.now()
}

/** Cordis 服务探测：没有 `get` 或查不到都返回 undefined，不抛。 */
function service(ctx, key) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(key) : undefined
  } catch {
    return undefined
  }
}

/**
 * 宿主启动后这些服务不是立刻可用的（sessionController 实测要等十几秒）。
 * 人在头几秒点「开工」不该看到「宿主没有提供会话服务」这种假故障，
 * 所以这里短暂等一下再放弃。
 */
async function awaitService(ctx, key, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = service(ctx, key)
    if (found !== undefined) return found
    if (Date.now() >= deadline) return undefined
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function asString(value) {
  return typeof value === 'string' ? value : ''
}

/** 一条任务在「文档」字段里应有的值：本地文档链接去重后一行一个。 */
export function docFieldValue(task) {
  const seen = new Set()
  const urls = []
  for (const doc of Array.isArray(task?.docs) ? task.docs : []) {
    const url = asString(doc?.url).trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    urls.push(url)
  }
  return urls.join('\n')
}


/**
 * 一轮进展 → 评论正文。
 *
 * 去掉代码围栏（评论里贴大段代码没有意义）与 dsh-ui 组件块，压掉多余空行，
 * 正文最多 600 字；这一轮失败时单独标出来，没文本但有失败原因就写原因。
 */
export function progressCommentBody(text, meta = {}, now = Date.now()) {
  const raw = asString(text)
  const cleaned = raw
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const time = new Date(now).toLocaleTimeString('zh-CN', { hour12: false })
  const head = meta.failed ? `【进度 · 本轮失败】${time}` : `【进度】${time}`
  const limit = 600
  if (cleaned) {
    const body = cleaned.length > limit ? `${cleaned.slice(0, limit)}…（已截断，原文 ${cleaned.length} 字）` : cleaned
    return `${head}\n\n${body}`
  }
  if (!meta.failed) return ''
  return `${head}\n\n这一轮没有产出文本${meta.reason ? `，原因：${asString(meta.reason).slice(0, 200)}` : ''}`
}

/** 状态枚举 → 人话。 */
const STATUS_TEXT = { todo: '待办', done: '已完成', in_progress: '进行中', completed: '已完成' }

/**
 * 把一条任务渲染成「任务档案」：模型一眼看全的结构化摘要。
 *
 * 提示词（开工时）和 feishu_task_detail（按需）共用这一份渲染，
 * 免得两处字段对不上——以前提示词只有标题/截止/链接，工具又只有另一套摘要。
 */
export function describeTask(task, options = {}) {
  const lines = []
  const add = (key, value) => {
    const text = asString(value).trim()
    if (text) lines.push(`- ${key}：${text}`)
  }
  const members = Array.isArray(task?.members) ? task.members : []
  const people = (list) => list.map((item) => item.name || item.id).filter(Boolean).join('、')
  const assignees = members.filter((item) => item.role === 'assignee')
  const followers = members.filter((item) => item.role !== 'assignee')

  add('标题', task?.title)
  add('状态', task?.done ? '已完成' : (STATUS_TEXT[asString(task?.status)] ?? asString(task?.status)))
  add('清单', task?.listName)
  add('负责人', people(assignees))
  add('关注人', people(followers))
  if (task?.creator?.name || task?.creator?.id) add('创建人', task.creator.name || task.creator.id)
  add('开始', task?.start)
  add('截止', task?.end || task?.due)
  if (task?.completedAt) add('完成于', formatDay(task.completedAt))
  if (task?.createdAt) add('创建于', formatDay(task.createdAt))
  for (const field of Array.isArray(task?.customFields) ? task.customFields : []) {
    if (field?.value) add(field.name || '字段', field.value)
  }
  if (task?.subtaskCount) add('子任务', `${task.subtaskCount} 条`)
  if (task?.isMilestone) add('里程碑', '是')
  if (task?.dependencyCount) add('前置任务', `${task.dependencyCount} 条`)
  if (task?.origin?.title) add('来源', task.origin.title)
  if (task?.repeatRule) add('重复', task.repeatRule)
  const docs = options.includeDocs === false ? [] : (Array.isArray(task?.docs) ? task.docs : []).filter((doc) => doc?.url)
  if (docs.length) {
    add('文档', docs.map((doc) => (doc.title && doc.title !== doc.url ? `${doc.title}（${doc.url}）` : doc.url)).join('；'))
  }
  add('任务链接', task?.url)
  if (options.includeDescription && task?.description) {
    const text = asString(task.description)
    const limit = options.descriptionLimit ?? 2000
    lines.push('', '任务说明：', text.length > limit ? `${text.slice(0, limit)}…（已截断，原文 ${text.length} 字）` : text)
  }
  return lines.join('\n')
}

/** 从链接里取 docx 的 document_id；wiki / sheets / docs 这类返回空串。 */
export function docxIdOf(url) {
  const match = /\/docx\/([A-Za-z0-9_-]+)/.exec(asString(url))
  return match ? match[1] : ''
}

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** 深合并：只认普通对象，数组整体替换（监听列表就该是替换语义）。 */
function mergeDeep(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
  const out = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = mergeDeep(base[key], value)
    } else {
      out[key] = value
    }
  }
  return out
}

/** 只留契约里声明的字段，防止面板把任意键写进设置文件。 */
/**
 * 自动开工的开关从布尔升级成三态，旧配置要能读：
 *   autoStart:true  → all（保持旧行为，不然老用户升级后突然不开工）
 *   autoStart:false → off
 * 新字段永远优先。
 */
function normalizeAutoStartMode(next, base) {
  const raw = next?.autoStartMode
  if (raw === 'off' || raw === 'tagged' || raw === 'all') return raw
  if (typeof next?.autoStart === 'boolean') return next.autoStart ? 'all' : 'off'
  return base.autoStartMode ?? 'off'
}

function sanitizeSettings(input, base) {
  const next = mergeDeep(base, input)
  return {
    autoSync: next.autoSync !== false,
    syncIntervalMinutes: clampInt(next.syncIntervalMinutes, 1, 24 * 60, base.syncIntervalMinutes),
    cliPath: asString(next.cliPath) || base.cliPath,
    tasks: {
      includeCompleted: next.tasks?.includeCompleted === true,
      keyword: asString(next.tasks?.keyword).slice(0, 120),
      dueWithinDays: clampInt(next.tasks?.dueWithinDays, 0, 3650, 0),
    },
    taskFields: {
      workspace: asString(next.taskFields?.workspace).slice(0, 20) || base.taskFields.workspace,
      trigger: asString(next.taskFields?.trigger).slice(0, 20) || base.taskFields.trigger,
      legacyAuto: asString(next.taskFields?.legacyAuto).slice(0, 20) || base.taskFields.legacyAuto,
      doc: asString(next.taskFields?.doc).slice(0, 20) || base.taskFields.doc,
    },
    docs: {
      watch: Array.isArray(next.docs?.watch)
        ? [...new Set(next.docs.watch.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u)))].slice(0, 50)
        : [],
      excerptChars: clampInt(next.docs?.excerptChars, 0, 4000, 600),
    },
    autoStartMode: normalizeAutoStartMode(next, base),
    autoStartPrompt: asString(next.autoStartPrompt) || base.autoStartPrompt,
    maxAutoStartPerRun: clampInt(next.maxAutoStartPerRun, 1, 10, 1),
    contextInjection: next.contextInjection === true,
    pushChanges: next.pushChanges === true,
    autoComment: next.autoComment !== false,
    autoCommentMinSeconds: clampInt(next.autoCommentMinSeconds, 10, 3600, 45),
    docPrompt:
      typeof next.docPrompt === 'string' && next.docPrompt.trim().length > 0
        ? next.docPrompt.slice(0, 4000)
        : base.docPrompt,
  }
}

/**
 * 从飞书任务里读「工作区 / 自动开工」配置。
 *
 * 为什么放描述里：飞书任务的自定义字段需要 task:custom_field scope，个人授权里没有；
 * 而描述是人随手就能改、且 task list 一定会带回来的字段。任务清单名作为兜底
 * （清单常常就是一个项目的名字），标题里的 `[ws:名字]` 作为轻量写法。
 *
 * 认这些键（大小写、中英文都行）：
 *   workspace / ws / project / 项目 / 工作区
 *   auto / auto-start / autostart / 自动开工 / 自动
 */
const META_WORKSPACE_KEYS = new Set(['workspace', 'ws', 'project', '项目', '工作区'])
const META_AUTO_KEYS = new Set(['auto', 'auto-start', 'autostart', 'autostartup', '自动开工', '自动'])

const TRUE_WORDS = /^(1|true|yes|y|on|enable|enabled|开|开启|自动|是|好)$/i
const FALSE_WORDS = /^(0|false|no|n|off|disable|disabled|关|关闭|否|不要)$/i

export function parseAutoFlag(value) {
  const text = asString(value).trim()
  if (!text) return undefined
  if (TRUE_WORDS.test(text)) return true
  if (FALSE_WORDS.test(text)) return false
  return undefined
}

export function parseTaskMeta(raw) {
  const meta = { workspace: '', auto: undefined, source: '' }
  const text = `${asString(raw?.summary)}\n${asString(raw?.description)}`

  for (const line of text.split(/\r?\n/)) {
    // `工作区: xxx` / `- auto = true` / `WS：xxx` 都认
    const match = /^\s*[-*·]?\s*([A-Za-z\u4e00-\u9fa5_-]{2,16})\s*[:：=]\s*(.+?)\s*$/.exec(line)
    if (!match) continue
    const key = match[1].trim().toLowerCase()
    const value = match[2].trim().replace(/^["'`]|["'`]$/g, '')
    if (META_WORKSPACE_KEYS.has(key) && !meta.workspace && value) {
      meta.workspace = value
      meta.source = 'description'
    }
    if (META_AUTO_KEYS.has(key) && meta.auto === undefined) meta.auto = parseAutoFlag(value)
  }

  // 标题里的 [ws:名字] 轻量写法
  if (!meta.workspace) {
    const tag = /\[(?:ws|workspace|工作区)[:：]\s*([^\]]+)\]/i.exec(asString(raw?.summary))
    if (tag) {
      meta.workspace = tag[1].trim()
      meta.source = 'title'
    }
  }

  return meta
}

/** 任务清单名 → 工作区名（兜底）。清单结构在 CLI 里可能是对象也可能是字符串。 */
export function tasklistNameOf(raw) {
  const lists = Array.isArray(raw?.tasklists) ? raw.tasklists : []
  for (const item of lists) {
    if (typeof item === 'string' && item.trim()) return item.trim()
    if (item && typeof item === 'object') {
      const name = asString(item.name ?? item.title ?? item.tasklist_name)
      if (name.trim()) return name.trim()
    }
  }
  return ''
}

/** 纯函数：这一轮该自动开工哪些任务。抽出来是为了能在测试里直接喂合成任务。 */
/**
 * 触发条件三态（清单字段「触发条件」）：
 *   人工触发 manual    —— 只有人点开工
 *   自动执行 auto      —— 同步发现就开工
 *   按时执行 scheduled —— 到「开始时间」自动开工（超过结束时间就不再开）
 * 兼容旧的「自动开工」是/否字段与描述里的 auto 键。
 */
export function parseTrigger(value) {
  const text = asString(value).trim().toLowerCase()
  if (!text) return undefined
  if (/人工|手动|manual|never|否|^no$|^false$|^off$/.test(text)) return 'manual'
  if (/按时|定时|scheduled?|schedule|at_time|时间/.test(text)) return 'scheduled'
  if (/自动|auto|yes|^true$|^on$|开|是|好/.test(text)) return 'auto'
  return undefined
}

/** 纯函数：一条任务此刻该不该自动开工。返回原因，便于面板/日志解释。 */
export function evaluateAutoStart(task, settings, now = Date.now()) {
  const mode = settings?.autoStartMode ?? 'off'
  if (mode === 'off') return { start: false, reason: '总开关关闭' }
  if (!task || task.started || task.done || !task.isNew) return { start: false, reason: '已开工/已完成/非新任务' }
  if (task.boundOnly) return { start: false, reason: '只绑定了会话，未开工' }
  const trigger = task.meta?.trigger
  if (trigger === 'manual') return { start: false, reason: '人工触发' }
  if (trigger === 'auto') return { start: true, reason: '自动执行' }
  if (trigger === 'scheduled') {
    const startAt = Number(task.startTs) || 0
    const endAt = Number(task.endTs) || 0
    if (!startAt) return { start: false, reason: '未设置开始时间' }
    if (now < startAt) return { start: false, reason: '未到开始时间', waitMs: startAt - now }
    if (endAt && now > endAt) return { start: false, reason: '已过结束时间' }
    return { start: true, reason: '按时执行' }
  }
  // 没写触发条件
  if (mode === 'all') return { start: true, reason: '未标注，按所有新任务处理' }
  return { start: false, reason: '未标注触发条件' }
}

export function selectAutoStartCandidates(tasks, settings, now = Date.now()) {
  const limit = Math.max(1, Number(settings?.maxAutoStartPerRun) || 1)
  return (Array.isArray(tasks) ? tasks : [])
    .filter((task) => evaluateAutoStart(task, settings, now).start)
    .slice(0, limit)
}

function formatStamp(ts, allDay) {
  if (!ts) return ''
  if (allDay) return formatDay(ts)
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${formatDay(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDay(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/* ─────────────────────────── CLI 调用 ─────────────────────────── */

const CLI_CANDIDATES = [
  join(homedir(), '.local', 'bin', 'feishu-sync-cli'),
  '/opt/homebrew/bin/feishu-sync-cli',
  '/usr/local/bin/feishu-sync-cli',
  '/usr/bin/feishu-sync-cli',
]

/** GUI 进程的 PATH 很短，所以要自己找一遍再 `which`。 */
function resolveCli(configured) {
  const explicit = asString(configured).trim()
  if (explicit && explicit.includes('/') && existsSync(explicit)) return explicit
  for (const candidate of CLI_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  return explicit || 'feishu-sync-cli'
}

function cliEnv() {
  const extra = [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
  return {
    ...process.env,
    FEISHU_SYNC_NO_UPDATE_CHECK: '1',
    PATH: [process.env.PATH, ...extra].filter(Boolean).join(':'),
  }
}

/**
 * 跑一次 CLI。
 *
 * 不抛异常：三种失败（找不到命令、超时、退出码非 0）都折成 `{ok:false, detail}`，
 * 因为调用方几乎都是「读数据失败了，界面该显示一句人话」。
 */
function runCli(command, args, { timeoutMs = 180_000 } = {}) {
  return new Promise((resolve) => {
    try {
      execFile(
        command,
        args,
        { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, env: cliEnv(), encoding: 'utf8' },
        (error, stdout, stderr) => {
          const out = asString(stdout)
          const err = asString(stderr)
          if (!error) {
            resolve({ ok: true, stdout: out, stderr: err })
            return
          }
          const reason =
            error.code === 'ENOENT'
              ? `找不到命令 ${command}（feishu-sync-cli 未安装，或设置里的 cliPath 不对）`
              : error.killed
                ? `命令超时（${Math.round(timeoutMs / 1000)}s）`
                : asString(error.message) || String(error)
          resolve({ ok: false, stdout: out, stderr: err, detail: `${reason}${err ? `\n${err.slice(-800)}` : ''}` })
        },
      )
    } catch (error) {
      resolve({ ok: false, stdout: '', stderr: '', detail: String(error) })
    }
  })
}

function parseJson(text) {
  const raw = asString(text).trim()
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    /* 日志混在 stdout 里时，退一步找第一个 JSON 起点 */
  }
  const starts = [raw.indexOf('['), raw.indexOf('{')].filter((i) => i >= 0)
  if (starts.length === 0) return undefined
  const from = Math.min(...starts)
  try {
    return JSON.parse(raw.slice(from))
  } catch {
    return undefined
  }
}

/* ────────────────────── 补充通道（自定义字段 / 人员 / 清单名） ────────────────────── */

/**
 * feishu-sync-cli 的 shebang 指向它自己的 venv；沿用那个解释器，
 * 才能 import 到 feishu_sync.retoken 拿到同一个（会自动刷新的）token。
 */
function resolvePython(cliPath) {
  const candidates = []
  try {
    const head = readFileSync(cliPath, 'utf8').split('\n')[0] ?? ''
    if (head.startsWith('#!')) {
      const fromShebang = head.slice(2).trim().split(/\s+/)[0]
      if (fromShebang && existsSync(fromShebang)) candidates.push(fromShebang)
    }
  } catch {
    /* CLI 不可读就退回目录探测 */
  }
  try {
    candidates.push(join(dirname(cliPath), 'python3'))
  } catch {
    /* ignore */
  }
  candidates.push('/opt/homebrew/bin/python3', '/usr/bin/python3')
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? 'python3'
}

/** 跑补充通道：stdin 进 JSON，stdout 出 JSON；失败返回 ok:false，不抛。 */
function runBridge(python, payload) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(python, [join(HERE, 'feishu_api.py')], { env: cliEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ ok: false, errors: [String(error)] })
      return
    }
    let out = ''
    let err = ''
    let settled = false
    const finish = (payload) => {
      if (settled) return
      settled = true
      resolve(payload)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      finish({ ok: false, errors: ['补充通道超时'] })
    }, 60_000)
    child.stdout.on('data', (chunk) => {
      out += chunk
    })
    child.stderr.on('data', (chunk) => {
      err += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      finish({ ok: false, errors: [String(error)] })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const parsed = parseJson(out)
      if (parsed && typeof parsed === 'object') finish(parsed)
      else finish({ ok: false, errors: [`补充通道失败（code=${code}）：${(err || out).slice(-300)}`] })
    })
    try {
      child.stdin.end(JSON.stringify(payload ?? {}))
    } catch {
      /* ignore */
    }
  })
}

/**
 * 飞书任务描述会校验 Markdown 链接：`[文字](目标)` 里目标不是 http/https/applink 就 400
 * （典型来源是 agent 输出里的 `[file](/Users/...)`、`[x](#L24)`）。这里把非 http 链接降级成纯文字，
 * 合法链接保留文字 + 地址，避免整条创建失败。
 */
export function sanitizeTaskDescription(text) {
  return asString(text)
    .replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, (whole, label, target) => {
      if (/^(https?:|applink:)/i.test(target)) return `${label} ${target}`.trim()
      return asString(label).trim()
    })
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')
    .trim()
}

/** 纯函数：把会话里最后一段回复变成任务标题 + 描述。 */
export function deriveTaskDraft(text, sessionId = '') {
  /* 去掉代码围栏（尤其是 dsh-ui 的 JSON 块）：它们对任务描述没有意义。 */
  const cleaned = asString(text)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.replace(/^[#>*\-\s]+/, '').replace(/[`*_]/g, '').trim())
    .filter(Boolean)
  let title = (lines[0] ?? '').slice(0, 30).trim()
  if (!title) title = `会话工作整理${sessionId ? `（${asString(sessionId).slice(-6)}）` : ''}`
  return { title, description: sanitizeTaskDescription(cleaned).slice(0, 2000) }
}

/* ─────────────────────────── 同步引擎 ─────────────────────────── */

function createSyncEngine(ctx) {
  const stateFile = stateFileFor(ctx)
  let settings = { ...DEFAULT_SETTINGS }
  let state = { ...DEFAULT_STATE }
  let inFlight = null
  let cli = { found: false, version: null, path: null }

  async function load() {
    const savedSettings = await readJson(SETTINGS_FILE, {})
    settings = sanitizeSettings(savedSettings, DEFAULT_SETTINGS)
    /* 提示词模板升级：只把「原封不动的旧默认」换成新默认，用户自己改过的一律不动。 */
    if (LEGACY_AUTO_START_PROMPTS.includes(settings.autoStartPrompt)) {
      settings.autoStartPrompt = DEFAULT_SETTINGS.autoStartPrompt
      await writeJson(SETTINGS_FILE, settings)
    }
    let savedState = await readJson(stateFile, {})
    /* 换端口重启后这里是空的：继承上一份带绑定的状态，别让卡片集体掉线。 */
    if (!Array.isArray(savedState?.tasks) || savedState.tasks.length === 0) {
      const adopted = await adoptPreviousState(stateFile)
      if (adopted) {
        savedState = adopted.data
        log(ctx, 'info', `[state] 本端口还没有状态，继承 ${basename(adopted.file)}（任务 ${adopted.data.tasks?.length ?? 0} 条）`)
      }
    }
    state = { ...DEFAULT_STATE, ...savedState }
    state.syncing = false
    state.tasks = Array.isArray(savedState.tasks) ? savedState.tasks : []
    state.docs = Array.isArray(savedState.docs) ? savedState.docs : []
    cli = { ...DEFAULT_STATE.cli, ...(savedState.cli ?? {}) }
  }

  async function persistState() {
    await writeJson(stateFile, state)
  }

  const settingsHooks = []
  /** 注册「设置变了」回调：提示词段要不要挂、挂哪一段，靠它跟着开关走。 */
  function onSettingsChange(fn) {
    settingsHooks.push(fn)
  }

  async function saveSettings(patch) {
    settings = sanitizeSettings(patch, settings)
    await writeJson(SETTINGS_FILE, settings)
    for (const fn of settingsHooks) {
      try {
        fn()
      } catch {
        /* 回调失败不影响保存 */
      }
    }
    return settings
  }

  /**
   * 给绑定了会话的任务补上「会话还活着吗」。
   *
   * `agents.get(id)` 只看本进程里活着的 agent：归档/重启后的会话会返回 undefined，
   * 但那条会话本身还在磁盘上、还能从侧栏点开——所以这里只表达「正在运行」，
   * 不表达「不存在」。面板上的措辞按这个语义写。
   */
  function liveSessionIds() {
    const agents = service(ctx, 'agents')
    const live = new Set()
    try {
      for (const agent of agents?.list?.() ?? []) {
        if (agent && typeof agent.id === 'string') live.add(agent.id)
      }
    } catch {
      /* 服务形状变了也不该让面板拿不到数据 */
    }
    return live
  }

  function workspaces() {
    const registry = service(ctx, 'workspaceRegistry')
    try {
      return (registry?.list?.() ?? []).map((w) => ({ id: w.id, title: w.title, path: w.path }))
    } catch {
      return []
    }
  }

  function snapshot() {
    const live = liveSessionIds()
    return {
      settings,
      workspaces: workspaces(),
      state: {
        ...state,
        tasks: state.tasks.map((task) => {
          const enriched = enrichWorkspace(task)
          return enriched.sessionId ? { ...enriched, sessionAlive: live.has(enriched.sessionId) } : enriched
        }),
        syncing: inFlight !== null,
        cli,
      },
    }
  }

  async function probeCli() {
    const path = resolveCli(settings.cliPath)
    const result = await runCli(path, ['version'], { timeoutMs: 20_000 })
    const text = `${result.stdout}\n${result.stderr}`
    const version = /feishu-sync\s+([0-9][^\s]*)/i.exec(text)?.[1] ?? null
    cli = { found: result.ok, version, path: result.ok ? path : null }
    state.cli = cli
    return cli
  }

  /** 授权体检：`task list` 是个人令牌专属接口，bot 模式反而读不了，正好当探针。 */
  async function checkAuth() {
    const path = resolveCli(settings.cliPath)
    const result = await runCli(path, ['task', 'list', '--json', '--completed=False'], { timeoutMs: 60_000 })
    const text = `${result.stdout}\n${result.stderr ?? ''}`
    let auth
    if (result.ok && Array.isArray(parseJson(result.stdout))) {
      auth = { ok: true, checkedAt: nowMs(), detail: '个人令牌可用（任务接口已通）' }
    } else {
      const revoked = /invalid_grant|20064|refresh token has been revoked/i.test(text)
      const missing = /ENOENT|未安装/.test(text)
      auth = {
        ok: false,
        checkedAt: nowMs(),
        detail: missing
          ? '没找到 feishu-sync-cli：先安装，或把设置里的 cliPath 指到可执行文件'
          : revoked
            ? '个人令牌已失效（refresh token 被吊销）：点「开始授权」重新授权'
            : `读取任务失败：${(result.detail ?? text).slice(-400)}`,
      }
    }
    state.auth = auth
    await persistState()
    return auth
  }

  /**
   * 启动一次授权。CLI 会起本地回调服务并把授权链接打到 stderr；
   * 我们是 GUI 进程，等不了交互，所以只把链接捞出来交给面板，进程留着自己跑完。
   */
  async function startLogin() {
    const path = resolveCli(settings.cliPath)
    return new Promise((resolve) => {
      let settled = false
      let buffer = ''
      let child
      const finish = (payload) => {
        if (settled) return
        settled = true
        resolve(payload)
      }
      try {
        child = execFile(path, ['init_token', '--enable_autofill'], {
          env: cliEnv(),
          timeout: 10 * 60_000,
          maxBuffer: 4 * 1024 * 1024,
          encoding: 'utf8',
        })
      } catch (error) {
        finish({ ok: false, url: null, error: String(error) })
        return
      }
      const onChunk = (chunk) => {
        buffer += asString(chunk)
        const match = LOGIN_URL_HINT.exec(buffer)
        if (match) finish({ ok: true, url: match[0] })
      }
      child.stdout?.on('data', onChunk)
      child.stderr?.on('data', onChunk)
      child.on('error', (error) => finish({ ok: false, url: null, error: String(error) }))
      child.on('exit', async (code) => {
        finish({
          ok: code === 0,
          url: LOGIN_URL_HINT.exec(buffer)?.[0] ?? null,
          error: code === 0 ? null : `授权进程退出码 ${code}`,
        })
        if (code === 0) {
          await checkAuth().catch(() => undefined)
        }
      })
      setTimeout(() => finish({ ok: false, url: LOGIN_URL_HINT.exec(buffer)?.[0] ?? null, error: '等待授权链接超时' }), 20_000)
    })
  }

  /**
   * 工作区名 → 目录。只认「已经登记过的工作区」，不替用户凭空创建，
   * 否则一个拼错的名字会在某个奇怪路径下开工。显式绝对路径是唯一的例外。
   */
  function resolveWorkspace(name) {
    const target = asString(name).trim()
    if (!target) return { path: '', title: '' }
    const registry = service(ctx, 'workspaceRegistry')
    let list = []
    try {
      list = registry?.list?.() ?? []
    } catch {
      list = []
    }
    /* 工作区标题常常带方括号和空格（`[DSH] 插件开发`），所以比较前先把这些噪音去掉，
       否则用户写成「DSH 插件开发」就匹配不上——这类失败最难解释。 */
    const normalize = (value) => asString(value).toLowerCase().replace(/[\[\]（）()【】<>《》\s_\-·]+/g, '')
    const wanted = normalize(target)
    const hit =
      list.find((w) => w.title === target || w.path === target) ??
      list.find((w) => normalize(w.title) === wanted) ??
      list.find((w) => normalize(w.title).includes(wanted) && wanted.length >= 2) ??
      list.find((w) => normalize(w.path).endsWith('/' + wanted) && wanted.length >= 2)
    if (hit) return { path: hit.path, title: hit.title, id: hit.id }
    if (target.startsWith('/') && existsSync(target)) return { path: target, title: target }
    return { error: `没找到工作区「${target}」（已登记：${list.map((w) => w.title).slice(0, 6).join('、') || '无'}）` }
  }

  function enrichWorkspace(task) {
    const name = task.meta?.workspace ?? ''
    if (!name) return task
    const resolved = resolveWorkspace(name)
    /* 清单名只是「碰巧同名就当工作区」的兜底：对不上不算错，也不该把任务卡标红。 */
    if (resolved.error && task.meta?.source === 'tasklist') {
      return { ...task, meta: { ...task.meta, workspace: '' }, workspaceName: '', workspaceTitle: '', workspacePath: '', workspaceError: null }
    }
    return {
      ...task,
      workspaceName: name,
      workspaceTitle: resolved.title ?? '',
      workspacePath: resolved.path ?? '',
      workspaceError: resolved.error ?? null,
    }
  }

  /* 清单名 / 字段定义变得很少，缓存 10 分钟；用户头像 24 小时。 */
  const remoteCache = { tasklists: new Map(), fields: new Map(), users: new Map() }
  const REMOTE_TTL = { tasklists: 10 * 60_000, fields: 10 * 60_000, users: 24 * 60 * 60_000 }

  function cached(map, key, ttl) {
    const hit = map.get(key)
    if (hit && nowMs() - hit.at < ttl) return hit.value
    return undefined
  }

  /**
   * 拉「CLI 拿不到但卡片需要」的三样：清单名、字段定义（选项 guid→文字）、人员姓名头像。
   * 任何一样失败都只是少了那部分展示，不影响任务本身。
   */
  async function enrichRemote(rawList) {
    const cliPath = resolveCli(settings.cliPath)
    const python = resolvePython(cliPath)

    const wantLists = new Set()
    const wantFields = new Set()
    const wantUsers = new Set()
    for (const raw of rawList) {
      for (const member of raw?.members ?? []) {
        const id = asString(member?.id)
        if (id && !cached(remoteCache.users, id, REMOTE_TTL.users)) wantUsers.add(id)
      }
      /* 创建人也要姓名头像：不能只查成员，很多任务是别人建的。 */
      const creator = asString(raw?.creator?.id)
      if (creator && !cached(remoteCache.users, creator, REMOTE_TTL.users)) wantUsers.add(creator)
      for (const list of raw?.tasklists ?? []) {
        const guid = asString(list?.tasklist_guid)
        if (!guid) continue
        if (!cached(remoteCache.tasklists, guid, REMOTE_TTL.tasklists)) wantLists.add(guid)
        if ((raw?.custom_fields ?? []).length > 0 && !cached(remoteCache.fields, guid, REMOTE_TTL.fields)) {
          wantFields.add(guid)
        }
      }
    }

    if (wantLists.size === 0 && wantFields.size === 0 && wantUsers.size === 0) {
      return { tasklists: remoteCache.tasklists, fields: remoteCache.fields, users: remoteCache.users }
    }

    const result = await runBridge(python, {
      tasklists: [...wantLists],
      fields: [...wantFields],
      users: [...wantUsers],
    })
    const stamp = nowMs()
    for (const [guid, name] of Object.entries(result?.tasklists ?? {})) {
      remoteCache.tasklists.set(guid, { at: stamp, value: name })
    }
    for (const [guid, defs] of Object.entries(result?.fields ?? {})) {
      remoteCache.fields.set(guid, { at: stamp, value: defs })
    }
    for (const [id, user] of Object.entries(result?.users ?? {})) {
      remoteCache.users.set(id, { at: stamp, value: user })
    }
    if (Array.isArray(result?.errors) && result.errors.length > 0) {
      log(ctx, 'info', `补充通道部分失败：${result.errors.slice(0, 3).join('；')}`)
    }
    return { tasklists: remoteCache.tasklists, fields: remoteCache.fields, users: remoteCache.users }
  }

  /** 把一条自定义字段值翻译成人能看的文字。 */
  function customFieldValue(rawValue, def) {
    if (!rawValue) return ''
    switch (rawValue.type) {
      case 'single_select': {
        const guid = asString(rawValue.single_select_value)
        return def?.options?.[guid] ?? guid
      }
      case 'multi_select': {
        const list = Array.isArray(rawValue.multi_select_value) ? rawValue.multi_select_value : []
        return list.map((guid) => def?.options?.[guid] ?? guid).join('、')
      }
      case 'text':
        return asString(rawValue.text_value)
      case 'number':
        return rawValue.number_value === undefined ? '' : String(rawValue.number_value)
      case 'datetime':
        return rawValue.datetime_value ? formatDay(Number(rawValue.datetime_value)) : ''
      case 'member': {
        const id = asString(rawValue.member_value?.id ?? rawValue.member_value)
        return cached(remoteCache.users, id, REMOTE_TTL.users)?.name ?? id
      }
      default:
        return asString(rawValue.text_value)
    }
  }

  function normalizeTask(raw, previous) {
    const startTs = Number(raw?.start?.timestamp) || 0
    const dueTs = Number(raw?.due?.timestamp) || 0
    const previousTask = previous.get(asString(raw?.guid))
    const listGuid = asString(raw?.tasklists?.[0]?.tasklist_guid)
    const listName = cached(remoteCache.tasklists, listGuid, REMOTE_TTL.tasklists) ?? ''
    const defs = cached(remoteCache.fields, listGuid, REMOTE_TTL.fields) ?? []

    const customFields = (Array.isArray(raw?.custom_fields) ? raw.custom_fields : []).map((field) => {
      const def = defs.find((item) => item.guid === field.guid)
      return {
        guid: asString(field.guid),
        name: asString(field.name) || asString(def?.name),
        type: asString(field.type),
        value: customFieldValue(field, def),
      }
    })

    const members = (Array.isArray(raw?.members) ? raw.members : []).map((member) => {
      const id = asString(member?.id)
      const user = cached(remoteCache.users, id, REMOTE_TTL.users)
      return { id, role: asString(member?.role), name: user?.name ?? '', avatar: user?.avatar ?? '' }
    })

    /* 配置优先读清单字段；字段不存在时才回退到描述里的旧约定。 */
    const fieldConfig = readFieldConfig(customFields)
    let meta
    if (fieldConfig.workspace || fieldConfig.trigger !== undefined) {
      meta = { workspace: fieldConfig.workspace, trigger: fieldConfig.trigger, source: 'field' }
    } else {
      const legacy = parseTaskMeta(raw)
      meta = {
        workspace: legacy.workspace,
        trigger: legacy.auto === undefined ? undefined : legacy.auto ? 'auto' : 'manual',
        source: legacy.source,
      }
    }

    const creatorId = asString(raw?.creator?.id)
    const creatorUser = cached(remoteCache.users, creatorId, REMOTE_TTL.users)
    const origin = raw?.origin ?? {}

    return {
      id: asString(raw?.guid) || asString(raw?.task_id),
      title: asString(raw?.summary) || '（无标题任务）',
      meta,
      listName,
      tasklistGuid: listGuid,
      sectionGuid: asString(raw?.tasklists?.[0]?.section_guid),
      members,
      creator: { id: creatorId, name: creatorUser?.name ?? '' },
      customFields,
      description: asString(raw?.description),
      done: asString(raw?.completed_at) !== '0' && Boolean(raw?.completed_at),
      status: asString(raw?.status),
      createdAt: Number(raw?.created_at) || 0,
      completedAt: Number(raw?.completed_at) || 0,
      subtaskCount: Number(raw?.subtask_count) || 0,
      parentTaskGuid: asString(raw?.parent_task_guid),
      origin: {
        title: asString(origin?.href?.title),
        url: asString(origin?.href?.url),
        platform: asString(origin?.platform_i18n_name?.zh_cn),
      },
      repeatRule: asString(raw?.repeat_rule),
      isMilestone: raw?.is_milestone === true,
      dependencyCount: Array.isArray(raw?.dependencies) ? raw.dependencies.length : 0,
      due: formatDay(dueTs),
      dueTs,
      start: formatStamp(startTs, raw?.start?.is_all_day !== false),
      startTs,
      end: formatStamp(dueTs, raw?.due?.is_all_day !== false),
      endTs: dueTs,
      url: asString(raw?.url),
      seenAt: nowMs(),
      firstSeenAt: previousTask?.firstSeenAt ?? nowMs(),
      /* 编号一旦分配就固定：老任务沿用，新任务取当前最大值 +1。 */
      no:
        Number.isInteger(previousTask?.no) && previousTask.no > 0
          ? previousTask.no
          : (() => {
              let max = 0
              for (const item of state.tasks) {
                if (item.id !== raw?.guid && Number.isInteger(item?.no) && item.no > max) max = item.no
              }
              return max + 1
            })(),
      boundOnly: previousTask?.boundOnly === true && !previousTask.started,
      isNew: previousTask ? previousTask.isNew === true && !previousTask.started : true,
      started: previousTask?.started === true,
      sessionId: previousTask?.sessionId ?? null,
      startedAt: previousTask?.startedAt ?? null,
      linkSource: previousTask?.linkSource ?? null,
      /* 错误是「这一轮」的信息：上次开工失败不该永远挂在卡片上，下一轮同步即清。 */
      docs: (() => {
        /* 本地记下的文档（生成 / 手动绑定）要跨同步保留；清单字段和描述里的链接每轮重算。
           字段名要从归一化过的 customFields 里取：raw.custom_fields 上不一定带 name，
           以前直接用 raw 判断，于是「字段里写了文档、卡片上却看不到」。 */
        const stored = (Array.isArray(previousTask?.docs) ? previousTask.docs : []).filter(
          (doc) => doc?.url && (doc.source === '生成' || doc.source === '手动'),
        )
        const fieldValue =
          customFields.find((field) => field.name === (settings.taskFields.doc || '文档'))?.value || ''
        const fieldDocs = String(fieldValue)
          .split(/[\s,;，；、]+/)
          .filter((url) => /^https?:\/\//.test(url))
          .map((url) => ({ url, title: '', source: '字段' }))
        const parsed = extractDocLinks(raw?.description)
        const seen = new Set()
        const docs = []
        const titles = state.docTitles || {}
        for (const doc of [...stored, ...fieldDocs, ...parsed]) {
          if (!doc?.url || seen.has(doc.url)) continue
          seen.add(doc.url)
          if (!asString(doc.title) && titles[doc.url]?.title) doc.title = titles[doc.url].title
          docs.push(doc)
        }
        return docs.slice(0, 8)
      })(),
      notifiedSignature: previousTask?.notifiedSignature ?? '',
      updatedAt: Number(raw?.updated_at) || 0,
      localUpdatedAt: Number(previousTask?.localUpdatedAt) || 0,
      error: null,
    }
  }

  /**
   * 从清单自定义字段里读配置。字段名在设置里可改（默认「工作区」「自动开工」）。
   * 自动开工是单选（是/否），也兼容文本字段写成 true/yes/开…
   */
  function readFieldConfig(customFields) {
    const wantWorkspace = settings.taskFields.workspace.trim().toLowerCase()
    const wantTrigger = settings.taskFields.trigger.trim().toLowerCase()
    const wantLegacy = settings.taskFields.legacyAuto.trim().toLowerCase()
    let workspace = ''
    let trigger
    for (const field of customFields) {
      const name = field.name.trim().toLowerCase()
      if (wantWorkspace && name === wantWorkspace && field.value) workspace = field.value
      if (wantTrigger && name === wantTrigger && field.value) {
        const parsed = parseTrigger(field.value)
        if (parsed !== undefined) trigger = parsed
      }
      if (trigger === undefined && wantLegacy && name === wantLegacy && field.value) {
        const parsed = parseTrigger(field.value)
        if (parsed !== undefined) trigger = parsed
      }
    }
    return { workspace, trigger }
  }

  function filterTasks(tasks) {
    const keyword = settings.tasks.keyword.trim().toLowerCase()
    const horizon = settings.tasks.dueWithinDays
    const limit = horizon > 0 ? nowMs() + horizon * 86_400_000 : 0
    return tasks.filter((task) => {
      if (!settings.tasks.includeCompleted && task.done) return false
      if (keyword && !`${task.title}\n${task.description}`.toLowerCase().includes(keyword)) return false
      if (limit > 0 && (!task.dueTs || task.dueTs > limit)) return false
      return true
    })
  }

  async function syncTasks() {
    const path = resolveCli(settings.cliPath)
    const args = ['task', 'list', '--json']
    if (!settings.tasks.includeCompleted) args.push('--completed=False')
    const result = await runCli(path, args)
    if (!result.ok) {
      // 任务接口同时是授权探针：失败原因直接写进 auth，面板才知道该让人去授权还是去装 CLI。
      const text = `${result.stdout}\n${result.stderr ?? ''}`
      const revoked = /invalid_grant|20064|refresh token has been revoked/i.test(text)
      const missing = /ENOENT|未安装/.test(text)
      state.auth = {
        ok: false,
        checkedAt: nowMs(),
        detail: missing
          ? '没找到 feishu-sync-cli：先安装，或把设置里的 cliPath 指到可执行文件'
          : revoked
            ? '个人令牌已失效（refresh token 被吊销）：点「开始授权」重新授权'
            : `读取任务失败：${(result.detail ?? text).slice(-400)}`,
      }
      return { ok: false, detail: state.auth.detail }
    }
    const list = parseJson(result.stdout)
    if (!Array.isArray(list)) return { ok: false, detail: '任务接口返回的不是数组（CLI 版本可能变了）' }
    state.auth = { ok: true, checkedAt: nowMs(), detail: '个人令牌可用（任务接口已通）' }
    const previous = new Map(state.tasks.map((task) => [task.id, task]))
    await enrichRemote(list)
    const next = list.map((raw) => normalizeTask(raw, previous)).filter((task) => task.id)
    const marked = new Set(filterTasks(next).map((task) => task.id))
    const kept = next.filter((task) => marked.has(task.id)).map(enrichWorkspace)
    renumberTasks(kept)
    state.tasks = kept
    await backfillDocTitles(kept).catch(() => undefined)
    await pushTaskChanges(previous, kept).catch(() => undefined)

    /* 一次性把历史标题迁到 `T<n>-<标题>`：只做一轮，之后新任务走正常改名路径。 */
    /* 历史遗留的「会话没挂进项目」在每轮同步时补一次（幂等，已挂的会跳过）。 */
    await repairSessionWorkspaces().catch(() => undefined)

    if (settings.titlesMigrated !== true && kept.length > 0) {
      settings.titlesMigrated = true
      await writeJson(SETTINGS_FILE, settings)
      for (const task of kept) {
        const want = withTaskNo(task.title, task)
        if (want !== task.title) {
          await renameTask(task.id, want).catch(() => undefined)
        }
      }
    }
    return { ok: true, count: state.tasks.length }
  }

  async function syncDocs() {
    const path = resolveCli(settings.cliPath)
    const previous = new Map(state.docs.map((doc) => [doc.url, doc]))
    const docs = []
    for (const url of settings.docs.watch) {
      const known = previous.get(url)
      // info_page 默认就吐 JSON，多给 --json 会被当成字段选择器报错。
      const info = await runCli(path, ['info_page', url], { timeoutMs: 90_000 })
      const meta = info.ok ? parseJson(info.stdout) : undefined
      const lastModified = Number(meta?.obj_edit_time) ? Number(meta.obj_edit_time) * 1000 : (known?.lastModified ?? 0)
      const changed = !known || known.lastModified !== lastModified || !known.excerpt
      let excerpt = known?.excerpt ?? ''
      let error = null
      if (!info.ok) {
        error = (info.detail ?? '读取文档信息失败').slice(-300)
      } else if (changed) {
        const body = await runCli(path, ['read_page_as_markdown', url], { timeoutMs: 120_000 })
        if (body.ok) {
          excerpt = body.stdout.replace(/\s+/g, ' ').trim().slice(0, settings.docs.excerptChars)
        } else {
          error = (body.detail ?? '读取正文失败').slice(-300)
        }
      }
      docs.push({
        url,
        title: asString(meta?.title) || known?.title || url,
        lastModified,
        excerpt,
        seenAt: nowMs(),
        error,
      })
    }
    state.docs = docs
    return { ok: true, count: docs.length }
  }

  /** 任务上绑定的文档 → 投给会话的一段文字（标题 + 链接）。 */
  function docLines(task) {
    const docs = (Array.isArray(task?.docs) ? task.docs : []).filter((doc) => doc?.url)
    if (!docs.length) return '（这条任务没有绑定文档）'
    return docs
      .map((doc) => (doc.title && doc.title !== doc.url ? `- ${doc.title}：${doc.url}` : `- ${doc.url}`))
      .join('\n')
  }

  function renderPrompt(task) {
    const template = settings.autoStartPrompt
    const hasArchive = template.includes('{{task}}')
    const hasDocs = template.includes('{{docs}}')
    const filled = template
      .replaceAll('{{title}}', task.title)
      .replaceAll('{{start}}', task.start || '未设置')
      .replaceAll('{{end}}', task.end || '未设置')
      .replaceAll('{{due}}', task.end || task.due || '无截止日期')
      .replaceAll('{{url}}', task.url || '（无链接）')
      .replaceAll('{{description}}', task.description || '（无描述）')
      .replaceAll('{{docs}}', docLines(task))
    if (hasArchive) return filled.replaceAll('{{task}}', describeTask(task))
    /* 老的自定义模板（没写 {{task}}）：整段档案追加到末尾，不改人家原来的措辞；
       模板里已经有 {{docs}} 的不再重复列文档。 */
    return `${filled}\n\n任务档案：\n${describeTask(task, { includeDocs: !hasDocs })}`
  }

  /**
   * 给一条任务开一条会话，把任务描述作为第一条消息投进去。
   *
   * 这是「自动拿过来做」的唯一实现路径：面板的「开工」按钮和定时自动开工共用它，
   * 所以两边的行为不会漂移。宿主没有 agents / sessionController 时明确报出来，
   * 而不是静默标成已开工。
   */
  /**
   * 在当前会话里开工：把任务绑到这条会话，并把任务描述投进去。
   *
   * 与「新建会话」的区别只在会话从哪来：手动点开工时人已经在某个对话里，
   * 没必要再开一条；定时自动开工没有「当前会话」可用，才走新建。
   */
  async function startInSession(task, sessionId) {
    const sessions = await awaitService(ctx, 'sessionController')
    if (!sessions || typeof sessions.prompt !== 'function') {
      return { ok: false, error: '宿主还没把会话服务交出来（刚启动时常见），稍等几秒再点一次' }
    }
    if (!(await sessionExists(sessionId))) {
      return { ok: false, error: `没找到当前会话 ${sessionId}` }
    }
    const owner = state.tasks.find((item) => item.sessionId === sessionId && item.id !== task.id)
    if (owner) {
      return { ok: false, error: `当前会话已经绑在「${owner.title.slice(0, 30)}」上了，先解绑那边` }
    }

    task.sessionId = sessionId
    task.started = true
    task.boundOnly = false
    task.isNew = false
    task.startedAt = nowMs()
    task.linkSource = 'current'
    task.error = null
    await persistState()

    try {
      await sessions.prompt(
        {
          requestId: `feishu:${sessionId}:${nowMs().toString(36)}`,
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: renderPrompt(task) }],
        },
        new AbortController().signal,
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      task.error = `投递失败：${detail}`.slice(0, 300)
      await persistState()
      return { ok: false, error: task.error }
    }
    /* 绑到已有会话时同样对齐名字：任务名 = 会话名。 */
    await renameSession(sessionId, task.title)
    log(ctx, 'info', `[manual] 任务在当前会话开工：${task.title.slice(0, 40)} → ${sessionId}`)
    return { ok: true, sessionId, note: '已在当前会话开工' }
  }

  /** 往一条会话里补一条消息（不加严格任务、不开新会话，只补上下文）。 */
  async function notifySession(sessionId, text) {
    const sessions = await awaitService(ctx, 'sessionController')
    if (!sessions || typeof sessions.prompt !== 'function') return { ok: false, error: '宿主没有会话服务' }
    try {
      await sessions.prompt(
        {
          requestId: `feishu:note:${sessionId}:${nowMs().toString(36)}`,
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text }],
        },
        new AbortController().signal,
      )
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /* 推送频控：同一会话 5 分钟内最多推一条，单轮同步最多推一条。 */
  const lastPushAt = new Map()

  /** 任务「实质变化」的签名：标题/状态/截止/文档集合/描述长度。 */
  function taskSignature(task) {
    const docs = (Array.isArray(task?.docs) ? task.docs : []).map((doc) => doc?.url).filter(Boolean).sort().join('|')
    return [task?.title, task?.status, task?.done ? 1 : 0, task?.end ?? '', docs, asString(task?.description).length].join('\u0001')
  }

  /**
   * 任务有实质变化时推给绑定会话。
   *
   * 默认关：每次推送都会真实消耗一个 turn，不能自作主张打扰正在干活的人。
   * 打开后也只推「标题/状态/新增文档」这类人关心的变化，且一轮最多一条。
   */
  async function pushTaskChanges(previous, tasks) {
    if (settings.pushChanges !== true) return []
    const pushed = []
    for (const task of tasks) {
      if (pushed.length >= 1) break
      if (!task.sessionId || task.started !== true) continue
      const before = previous.get(task.id)
      if (!before) continue
      const signature = taskSignature(task)
      if (task.notifiedSignature === signature) continue
      const changes = []
      if (before.title !== task.title) changes.push(`标题改为「${task.title}」`)
      if (before.status !== task.status) {
        changes.push(`状态 ${STATUS_TEXT[asString(before.status)] ?? before.status} → ${STATUS_TEXT[asString(task.status)] ?? task.status}`)
      }
      const beforeDocs = (before.docs ?? []).map((doc) => doc?.url)
      const added = (task.docs ?? []).filter((doc) => doc?.url && !beforeDocs.includes(doc.url))
      if (added.length) changes.push(`新增文档：${added.map((doc) => doc.title || doc.url).join('、')}`)
      task.notifiedSignature = signature
      if (!changes.length) continue
      const last = lastPushAt.get(task.sessionId) ?? 0
      if (nowMs() - last < 5 * 60_000) continue
      const sent = await notifySession(
        task.sessionId,
        `飞书任务「${task.title}」有变化：\n- ${changes.join('\n- ')}\n\n需要最新全量数据（含评论/子任务/附件）用 feishu_task_detail。`,
      )
      if (sent.ok) {
        lastPushAt.set(task.sessionId, nowMs())
        pushed.push({ taskId: task.id, changes })
      }
    }
    if (pushed.length) await persistState()
    return pushed
  }

  /* 进度评论的节流与失败重试队列（只在下一次 turn 结束时补一次，不做无限重试）。 */
  const lastProgressAt = new Map()
  const pendingProgress = []

  /**
   * 把一轮的进展写回「这条会话绑定的任务」的评论里。
   *
   * 内容取这一轮最后一段助手文本，去掉代码围栏/组件块后截断 600 字；
   * 失败时只记日志并挂进 pendingProgress，下一次 turn 结束补发一次。
   */
  async function commentProgress(sessionId, text, meta = {}) {
    if (settings.autoComment !== true) return { ok: false, skipped: '自动评论关闭' }
    const task = state.tasks.find((item) => item.sessionId === sessionId)
    if (!task) return { ok: false, skipped: '这条会话没有绑定任务' }
    const body = progressCommentBody(text, meta)
    if (!body) return { ok: false, skipped: '这一轮没有可写的进展' }
    const last = lastProgressAt.get(sessionId) ?? 0
    if (nowMs() - last < settings.autoCommentMinSeconds * 1000) return { ok: false, skipped: '间隔不足' }

    const path = resolveCli(settings.cliPath)
    const result = await runCli(path, ['task', 'comment', task.id, body], { timeoutMs: 60_000 })
    if (!result.ok) {
      log(ctx, 'warn', `[comment] 进度写回失败：${(result.detail ?? '').slice(-200)}`)
      if (pendingProgress.length < 5) pendingProgress.push({ taskId: task.id, sessionId, body, at: nowMs() })
      return { ok: false, error: '写评论失败' }
    }
    lastProgressAt.set(sessionId, nowMs())
    task.lastCommentAt = nowMs()
    await persistState()
    return { ok: true, taskId: task.id, body }
  }

  /** 补发上一条失败的进度评论（每次 turn 结束最多补一条）。 */
  async function flushPendingProgress() {
    if (settings.autoComment !== true) return { ok: false }
    const item = pendingProgress.shift()
    if (!item) return { ok: false, skipped: '没有待补发' }
    const path = resolveCli(settings.cliPath)
    const result = await runCli(path, ['task', 'comment', item.taskId, item.body], { timeoutMs: 60_000 })
    if (result.ok) lastProgressAt.set(item.sessionId, nowMs())
    return { ok: result.ok }
  }

  async function startTask(taskId, source, options = {}) {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) return { ok: false, error: '没找到这条任务（可能已被下一次同步移除）' }
    if (task.done) return { ok: false, error: '这条任务在飞书里已经完成了' }
    if (task.started) return { ok: false, error: `已经开过工了（会话 ${task.sessionId}）` }

    /* 已绑过会话（只绑定没开工）：开工就投递到那条会话里。 */
    if (task.boundOnly && task.sessionId) return startInSession(task, task.sessionId)

    /* 人在侧边栏点「开工」时带着当前会话 id —— 就地在这条对话里干。 */
    const currentSession = asString(options.sessionId).trim()
    if (currentSession) return startInSession(task, currentSession)

    const agents = await awaitService(ctx, 'agents')
    const sessions = await awaitService(ctx, 'sessionController')
    if (!agents || typeof agents.create !== 'function' || !sessions || typeof sessions.prompt !== 'function') {
      return { ok: false, error: '宿主没有提供会话服务（agents/sessionController），无法自动开工' }
    }

    const sessionId = `feishu-${task.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)}-${nowMs().toString(36)}`
    /* 任务里写了工作区就按它来；没写才退回默认工作目录。 */
    let cwd
    const wanted = task.meta?.workspace ?? ''
    if (wanted) {
      const resolved = resolveWorkspace(wanted)
      if (resolved.error) {
        task.error = resolved.error
        await persistState()
        return { ok: false, error: resolved.error }
      }
      cwd = resolved.path
    } else {
      const workingDirectory = service(ctx, 'workingDirectory')
      const candidateCwd =
        asString(workingDirectory?.defaultDirectory) ||
        asString(process.env.DSH_WORKSPACE) ||
        process.cwd()
      cwd = candidateCwd.startsWith('/') ? candidateCwd : undefined
    }

    /* 不传模型的话会话能建出来，但第一轮拼系统提示词时 {{model}} 没有值，
       整轮直接 error 收场——实测踩过。所以建会话时就把默认模型带上。 */
    let agentOptions
    try {
      const selection = service(ctx, 'agentDefaultModel')?.currentSelection?.()
      if (selection && selection.provider && selection.model) {
        agentOptions = {
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
        }
      }
    } catch {
      agentOptions = undefined
    }

    try {
      await agents.create({
        sessionId,
        ...(cwd ? { meta: { cwd } } : {}),
        ...(agentOptions ? { agentOptions } : {}),
      })
      /* 建完就挂进项目，否则 UI 里这条会话不属于任何工作区、只能出现在归档。 */
      const attached = await attachSessionToWorkspace(sessionId, cwd)
      if (!attached.ok) log(ctx, 'warn', `[workspace] 会话挂载失败：${attached.reason}`)

      /* 改名要趁会话还活着：turn 结束后 agent 会被摘掉，那时 rename 会报「会话未激活」。 */
      await renameSession(sessionId, task.title)
      await sessions.prompt(
        {
          requestId: `feishu:${sessionId}:1`,
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: renderPrompt(task) }],
        },
        new AbortController().signal,
      )
      task.started = true
      task.boundOnly = false
      task.isNew = false
      task.sessionId = sessionId
      task.startedAt = nowMs()
      task.linkSource = source === 'auto' ? 'auto' : 'open'
      task.error = null
      await persistState()
      /* 任务名 = 会话名：新开的会话直接叫任务名。 */
      const named = await renameSession(sessionId, task.title)
      log(ctx, 'info', `[rename] ${named.ok ? '已改名' : '未改名：' + named.reason}（${sessionId}）`)
      log(ctx, 'info', `[${source}] 任务已开工：${task.title.slice(0, 40)} → ${sessionId}`)
      return { ok: true, sessionId, note: '已开工' }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      /* 热重载/反复 disable-enable 之后，仍在服务请求的那份路由可能挂在已失效的 fiber 上，
         建会话会在它上面创建 effect 而报 inactive context —— 这不是配置问题，重启即可。 */
      const stale = /inactive context/i.test(detail)
      task.error = stale ? '插件实例已失效（多半是热重载残留），重启 DSH 后再试' : detail.slice(0, 300)
      await persistState()
      return {
        ok: false,
        error: stale
          ? '当前插件实例已失效（热重载后残留的旧实例），重启一次 DSH 即可恢复；不需要改配置。'
          : `开工失败：${detail}`,
      }
    }
  }

  /** 会话是否真实存在（活着的 agent，或能被 sessionController 读出来）。 */
  async function sessionExists(sessionId) {
    if (!sessionId) return false
    if (liveSessionIds().has(sessionId)) return true
    const sessions = service(ctx, 'sessionController')
    if (!sessions || typeof sessions.inspect !== 'function') return false
    try {
      await sessions.inspect(sessionId)
      return true
    } catch {
      return false
    }
  }

  /**
   * 把一条任务绑到一条已有会话上。
   *
   * 「开工」是插件替你建会话；这里是把已经存在的会话认领给这条任务——
   * 比如你先在侧栏里开了个会话干这件事，事后才想起来补绑定。
   */
  async function linkTask(taskId, sessionId, source = 'manual') {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) return { ok: false, error: '没找到这条任务（可能已被下一次同步移除）' }
    const id = asString(sessionId).trim()
    if (!id) return { ok: false, error: '需要 sessionId' }
    const owner = state.tasks.find((item) => item.sessionId === id && item.id !== taskId)
    if (owner) return { ok: false, error: `这条会话已经绑在「${owner.title.slice(0, 30)}」上了，先解绑那边` }
    if (!(await sessionExists(id))) return { ok: false, error: `没找到会话 ${id}` }

    /* 「绑定」= 建立关系 + 同步名字，但不投递开工指令。 */
    task.sessionId = id
    task.boundOnly = true
    task.started = false
    task.startedAt = null
    task.linkSource = source
    task.isNew = false
    task.error = null
    task.localUpdatedAt = nowMs()
    await persistState()
    const renamed = await renameSession(id, task.title)
    /* 按需：绑定即把任务档案投进会话，省得人再贴一遍。默认关。 */
    if (settings.contextInjection === true) {
      await notifySession(
        id,
        `已把飞书任务「${task.title}」绑定到本会话：\n\n${describeTask(task)}\n\n需要评论/子任务/附件时调 feishu_task_detail（不传 taskId 就是这条任务）。`,
      ).catch(() => undefined)
    }
    return { ok: true, task, sessionRenamed: renamed.ok }
  }

  async function unlinkTask(taskId) {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) return { ok: false, error: '没找到这条任务' }
    if (!task.sessionId) return { ok: false, error: '这条任务还没有绑定会话' }
    const previous = task.sessionId
    task.sessionId = null
    task.started = false
    task.startedAt = null
    task.linkSource = null
    await persistState()
    return { ok: true, previous, task }
  }

  /**
   * 把会话里的结论回写到飞书任务：写评论，可选置完成。
   *
   * 这是「当前会话 → 飞书」的唯一出口：面板的完成按钮和模型工具都走它，
   * 免得两处各写一套 CLI 调用。
   */
  async function reportTask(taskId, { text = '', complete = false } = {}) {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) return { ok: false, error: '没找到这条任务（可能已被下一次同步移除）' }
    /* 评论同样可能带上 agent 输出里的坏链（[file](/abs/path)），飞书会 400，先清洗。 */
    const body = sanitizeTaskDescription(text)
    if (!body && !complete) return { ok: false, error: '没有要回写的内容' }

    const path = resolveCli(settings.cliPath)
    if (body) {
      const result = await runCli(path, ['task', 'comment', task.id, body], { timeoutMs: 60_000 })
      if (!result.ok) return { ok: false, error: `写评论失败：${(result.detail ?? '').slice(-300)}` }
    }
    if (complete) {
      const result = await runCli(path, ['task', 'complete', task.id], { timeoutMs: 60_000 })
      if (!result.ok) return { ok: false, error: `标记完成失败：${(result.detail ?? '').slice(-300)}` }
      task.done = true
      task.status = 'done'
    }
    await persistState()
    return { ok: true, task, commented: Boolean(body), completed: Boolean(complete) }
  }

  /** 会话记录里最后一条有正文的助手回复；同步就是用这段内容。 */
  function lastAssistantText(inspection) {
    const events = Array.isArray(inspection?.events) ? inspection.events : []
    let last = ''
    for (const event of events) {
      if (event?.type !== 'assistant/message') continue
      const blocks = event.data?.message?.content
      if (!Array.isArray(blocks)) continue
      const text = blocks
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n')
        .trim()
      if (text) last = text
    }
    return last.length > 1500 ? `${last.slice(0, 1500)}…` : last
  }

  /**
   * 把「当前会话」同步到它绑定的飞书任务。
   *
   * 内容取自会话记录里最后一条助手回复——面板拿不到正文，替人编一句只会是噪音；
   * 这里读的是 durable event，不激活 agent。
   */
  async function syncCurrentSession(sessionId, options = {}) {
    const id = asString(sessionId).trim()
    if (!id) return { ok: false, error: '不知道当前是哪个会话：请从右侧栏的「飞书」页签打开面板' }
    const task = state.tasks.find((item) => item.sessionId === id)
    if (!task) return { ok: false, error: '当前会话没有绑定飞书任务：先在任务卡上点「开工（当前会话）」' }

    const sessions = await awaitService(ctx, 'sessionController')
    if (!sessions || typeof sessions.inspect !== 'function') {
      return { ok: false, error: '宿主暂时没有会话服务，稍后再试' }
    }
    let inspection
    try {
      inspection = await sessions.inspect(id)
    } catch (error) {
      return { ok: false, error: `读取会话失败：${error instanceof Error ? error.message : String(error)}` }
    }
    const text = lastAssistantText(inspection)
    if (!text) return { ok: false, error: '这条会话还没有助手回复可同步' }

    const result = await reportTask(task.id, { text, complete: options.complete === true })
    if (!result.ok) return result
    return { ok: true, task: result.task, chars: text.length, completed: result.completed }
  }

  /** 从已同步任务里推断「默认负责人」（同一个人出现最多）与「默认清单」。 */
  function defaultsFromState() {
    const counts = new Map()
    let tasklistGuid = ''
    for (const task of state.tasks) {
      if (!tasklistGuid && task.tasklistGuid) tasklistGuid = task.tasklistGuid
      for (const member of task.members ?? []) {
        if (member.role !== 'assignee' || !member.id) continue
        counts.set(member.id, (counts.get(member.id) ?? 0) + 1)
      }
    }
    let assignee = ''
    let best = 0
    for (const [id, count] of counts) {
      if (count > best) {
        best = count
        assignee = id
      }
    }
    return { assignee, tasklistGuid }
  }

  /**
   * 把当前会话「变成」一条飞书任务：内容由 agent 生成后传进来，这里只负责落库 + 绑定。
   */
  async function createTaskFromSession(sessionId, input = {}) {
    const id = asString(sessionId).trim()
    const summary = asString(input.summary ?? input.title).trim()
    if (!id) return { ok: false, error: '缺少 sessionId' }
    if (!summary) return { ok: false, error: '缺少任务标题（由 agent 生成）' }
    if (state.tasks.some((task) => task.sessionId === id)) {
      return { ok: false, error: '当前会话已经绑定了任务，不需要再建' }
    }

    const path = resolveCli(settings.cliPath)
    const { assignee, tasklistGuid } = defaultsFromState()
    const args = ['task', 'create', summary]
    const description = asString(input.description).trim()
    if (description) args.push(`--description=${description}`)
    if (assignee) args.push(`--assignee=${assignee}`)

    const created = await runCli(path, args, { timeoutMs: 90_000 })
    if (!created.ok) {
      const detail = asString(created.detail)
      /* 飞书这句原始报错会带一整段 JSON，直接怼到 toast 里没人看得懂。 */
      const hint = /url in description is invalid/i.test(detail)
        ? '任务描述里有飞书不接受的链接（非 http/https）'
        : /1470400/.test(detail)
          ? '飞书拒绝了创建参数（1470400）'
          : detail.slice(-300)
      return { ok: false, error: `创建任务失败：${hint}` }
    }
    const parsed = parseJson(created.stdout)
    const guid = asString(parsed?.guid)
    if (!guid) return { ok: false, error: '创建成功但没解析出任务 guid' }

    /* 新建任务也套上 T<n>- 前缀，和面板改名的规则保持一致。 */
    const draftNo = taskNo(undefined)
    let finalTitle = withTaskNo(summary, { no: draftNo })
    if (finalTitle !== summary) {
      const renamed = await runCli(path, ['task', 'update', guid, `--summary=${finalTitle}`], { timeoutMs: 30_000 })
      if (!renamed.ok) finalTitle = summary
    }

    /* CLI 建的任务不带清单：飞书里会「看不见」，所以要补一次 add_tasklist。 */
    if (tasklistGuid) {
      const python = resolvePython(path)
      if (python) {
        const bridged = await runBridge(python, {
          actions: [{ op: 'add_tasklist', task: guid, tasklist: tasklistGuid }],
        })
        const action = (bridged.actions ?? [])[0]
        if (!bridged.ok || !action?.ok) {
          log(ctx, 'warn', `任务已创建，但加入清单失败：${action?.error ?? bridged.errors?.join('; ')}`)
        }
      }
    }

    await sync({ source: 'create' })
    const task = state.tasks.find((item) => item.id === guid)
    if (task) {
      await linkTask(guid, id, 'current')
    } else {
      state.tasks.unshift({
        id: guid,
        title: finalTitle,
        description,
        meta: { workspace: '', trigger: input.trigger, source: 'field' },
        members: [],
        customFields: [],
        listName: '',
        done: false,
        due: '',
        start: '',
        url: '',
        isNew: false,
        started: true,
        sessionId: id,
        startedAt: nowMs(),
        linkSource: 'current',
        docs: (() => {
        const stored = Array.isArray(previousTask?.docs) ? previousTask.docs : []
        const parsed = extractDocLinks(raw?.description)
        const merged = [...stored]
        for (const item of parsed) {
          if (!merged.some((doc) => doc.url === item.url)) merged.push(item)
        }
        return merged.slice(0, 8)
      })(),
      error: null,
      })
      await persistState()
    }
    return { ok: true, taskId: guid, title: finalTitle }
  }

  /**
   * 从会话记录派生任务草稿（脚本路径，不依赖模型）。
   *
   * 标题取第一条有内容的行（去掉 Markdown 记号），描述保留整段（截断）。
   * 这是「一定能落库」的路径；AI 整理作为可选增强，不作为唯一入口。
   */
  async function promoteSessionToTask(sessionId) {
    const id = asString(sessionId).trim()
    if (!id) return { ok: false, error: '不知道当前是哪个会话' }
    if (state.tasks.some((task) => task.sessionId === id)) {
      return { ok: false, error: '当前会话已经绑定任务了' }
    }
    const sessions = await awaitService(ctx, 'sessionController')
    if (!sessions || typeof sessions.inspect !== 'function') {
      return { ok: false, error: '宿主暂时没有会话服务，稍后再试' }
    }
    let inspection
    try {
      inspection = await sessions.inspect(id)
    } catch (error) {
      return { ok: false, error: `读取会话失败：${error instanceof Error ? error.message : String(error)}` }
    }
    const text = lastAssistantText(inspection)
    if (!text) return { ok: false, error: '这条会话还没有助手回复，先聊一轮再同步' }

    /* 任务名 = 会话名：AI 先给一个像任务的名字，失败再用首行启发式兜底。 */
    const draft = deriveTaskDraft(text, id)
    const named = await generateSessionTitle(text, draft.title)
    const result = await createTaskFromSession(id, { title: named.title, description: draft.description })
    if (!result.ok) return result

    const renamed = await renameSession(id, named.title)
    return {
      ok: true,
      taskId: result.taskId,
      title: result.title,
      ai: named.ai,
      renamed: renamed.ok,
      note: named.ai ? '已用 AI 命名并创建任务' : '已从会话记录创建任务',
    }
  }

  /**
   * 用当前默认模型给一段会话内容起个短标题（失败就回退到首行启发式）。
   * 走 llm.stream，purpose 标成 session-title，和 DSH 自己的标题生成同一档。
   */
  async function generateSessionTitle(text, fallback) {
    const asked = await askModelForTitle(
      '你是会话标题助手。把用户给的一段工作记录概括成一个短标题：不超过 18 个汉字，' +
        '动宾结构、书面语，不要标点、不要引号、不要编号、不要解释。只输出标题本身。',
      text,
    )
    const clean = asString(asked.text).split('\n')[0]?.trim().slice(0, 30)
    return clean ? { title: clean, ai: true } : { title: fallback, ai: false, reason: asked.reason || '模型返回空' }
  }

  /**
   * 把会话标题改成给定值。
   *
   * 两条路：
   *   1. 会话活着 → `sessionTitle.rename()`，写一条 user 来源的标题事件，最干净；
   *   2. 会话已归档/未激活 → `sessionController.rename()`（Remote 版），按 id 改持久化会话，
   *      不需要先把 agent 拉起来。
   */
  async function renameSession(sessionId, title) {
    const next = asString(title)
    if (!next) return { ok: false, reason: '标题为空' }
    try {
      const store = ctx.get?.('sessions')
      const session = store?.get?.(sessionId)
      const service = ctx.get?.('sessionTitle')
      if (session && service && typeof service.rename === 'function') {
        service.rename(session, next)
        return { ok: true, mode: 'live' }
      }
    } catch {
      /* 活会话改名失败就走持久化那条 */
    }
    try {
      const controller = await awaitService(ctx, 'sessionController')
      if (controller && typeof controller.rename === 'function') {
        const result = await controller.rename({ sessionId, title: next })
        if (result && result.ok !== false) return { ok: true, mode: 'persisted' }
        return { ok: false, reason: (result && result.error && result.error.message) || '宿主拒绝改名' }
      }
      return { ok: false, reason: '宿主没有可用的改名接口' }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 正式风格的标题提示词：书面语、动宾结构、不带标点与人称。 */
  const TITLE_SYSTEM_PROMPT =
    '你是任务命名助手。根据用户给出的工作记录，生成一条正式、专业的中文任务名：' +
    '12-20 个字，动宾结构，使用书面语，准确概括工作内容与目标。' +
    '专有名词必须原样保留：产品/框架/协议/快捷键/接口/文件名的写法不要改写、不要意译、不要泛化' +
    '（例如 Ctrl+P、Feishu、DSH、Cordis、MCP、LLM 等该用就直接用）。' +
    '不要口语、不要情绪词、不要第一人称、不要引号/编号/标点/解释，也不要加 T1- 这类前缀。只输出标题本身。'

  /**
   * 从 llm.stream 里取纯文本。
   *
   * 只收 `text-delta` 是不够的：推理型模型会把额度先花在 reasoning 上，
   * 最后一个 `block-end` 才带完整 text 块（实测就出现过空结果）。
   */
  async function collectText(stream) {
    let out = ''
    let ended = ''
    for await (const chunk of stream) {
      if (!chunk) continue
      if (chunk.type === 'text-delta' && chunk.text) out += chunk.text
      else if (chunk.type === 'block-end' && chunk.block?.type === 'text' && chunk.block.text) {
        ended += chunk.block.text
      }
    }
    return (out || ended).trim()
  }

  /** 用默认模型按给定 system 生成一段长文本（文档正文用），失败返回空。 */
  async function askModelLong(system, text, budgets = [2500, 4000]) {
    const llm = await awaitService(ctx, 'llm')
    const models = await awaitService(ctx, 'agentDefaultModel')
    const selection = typeof models?.currentSelection === 'function' ? models.currentSelection() : undefined
    if (!llm || typeof llm.stream !== 'function' || !selection?.provider || !selection?.model) {
      return { text: '', reason: '没有可用的模型' }
    }
    const snapshot = asString(text).slice(0, 6000)
    let lastError = ''
    for (const budget of budgets) {
      try {
        const stream = llm.stream({
          provider: selection.provider,
          model: selection.model,
          system: asString(system),
          messages: [{ role: 'user', content: [{ type: 'text', text: snapshot }] }],
          maxTokens: budget,
          temperature: 0.3,
          purpose: 'session-title',
        })
        const out = await collectText(stream)
        if (out) return { text: out }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    }
    return { text: '', reason: lastError || '模型返回空' }
  }

  /** 给定一段文本，用默认模型起一个正式任务名；失败回退启发式。 */
  /**
   * 让默认模型按给定 system 生成一段标题文本。
   *
   * 推理型模型会先把 token 花在 reasoning 上：200 的额度能全被推理吃掉、一个文本都不吐。
   * 所以给足预算，并在空结果时放大一次重试。
   */
  async function askModelForTitle(system, text) {
    const llm = await awaitService(ctx, 'llm')
    const models = await awaitService(ctx, 'agentDefaultModel')
    const selection = typeof models?.currentSelection === 'function' ? models.currentSelection() : undefined
    if (!llm || typeof llm.stream !== 'function' || !selection?.provider || !selection?.model) {
      return { text: '', reason: '没有可用的模型' }
    }
    const snapshot = asString(text).slice(0, 1500)
    let lastError = ''
    for (const budget of [600, 1600]) {
      try {
        const stream = llm.stream({
          provider: selection.provider,
          model: selection.model,
          system,
          messages: [{ role: 'user', content: [{ type: 'text', text: snapshot }] }],
          maxTokens: budget,
          temperature: 0.2,
          purpose: 'session-title',
        })
        const out = await collectText(stream)
        if (out) return { text: out }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    }
    return { text: '', reason: lastError || '模型返回空' }
  }

  async function suggestTitleFrom(text, fallback = '未命名任务') {
    const asked = await askModelForTitle(TITLE_SYSTEM_PROMPT, text)
    const clean = asString(asked.text)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)[0]
      ?.replace(/^["'「『《]+|["'」』》]+$/g, '')
      .replace(/[。．.!！?？:：]+$/, '')
      .slice(0, 40)
      .trim()
    return clean ? { title: clean, ai: true } : { title: fallback, ai: false, reason: asked.reason || '模型返回空' }
  }

  /** 一条任务的「素材」：标题 + 描述 + 绑定会话最后一条回复。 */
  async function taskMaterial(task) {
    const parts = [asString(task.title)]
    if (task.description) parts.push(asString(task.description))
    if (task.sessionId) {
      const sessions = await awaitService(ctx, 'sessionController')
      if (sessions && typeof sessions.inspect === 'function') {
        try {
          const inspection = await sessions.inspect(task.sessionId)
          const text = lastAssistantText(inspection)
          if (text) parts.push(text)
        } catch {
          /* 读不到会话就只用任务本身的内容 */
        }
      }
    }
    return parts.join('\n\n')
  }

  /**
   * 编号去重：老状态里可能都拿到同一个号（按 state 算最大值的坑），这里按列表顺序重新补齐。
   * 已经唯一的号保持不动，尽量避免标题变动。
   */
  function renumberTasks(tasks) {
    const used = new Set()
    let next = 1
    for (const task of tasks) {
      if (Number.isInteger(task.no) && task.no > 0 && !used.has(task.no)) {
        used.add(task.no)
        continue
      }
      while (used.has(next)) next += 1
      task.no = next
      used.add(next)
    }
  }

  /**
   * 任务编号：T1、T2…，按「首次见到」的顺序稳定分配，写进 state 后不再变。
   * 标题格式统一为 `T<n>-<标题>`，用于在飞书、面板、会话名之间对齐同一条任务。
   */
  function taskNo(task) {
    if (Number.isInteger(task?.no) && task.no > 0) return task.no
    let max = 0
    for (const item of state.tasks) {
      if (Number.isInteger(item?.no) && item.no > max) max = item.no
    }
    return max + 1
  }

  /** 去掉标题里已有的 T<n>- 前缀，避免重复叠加。 */
  function stripTaskNo(title) {
    return asString(title)
      .replace(/^\s*Task-[0-9a-z]{6}\s*[-—·]?\s*/i, '')
      .replace(/\s*[·\-—]\s*Task-[0-9a-z]{6}\s*$/i, '')
      .replace(/^\s*T\d+\s*[-.、·：:]\s*/i, '')
      .trim()
  }

  /** 把 `T<n>-` 前缀拼到标题上。 */
  function withTaskNo(title, task) {
    const no = taskNo(task)
    const text = stripTaskNo(title)
    return text ? `T${no}-${text}` : `T${no}-未命名任务`
  }

  async function suggestTaskTitle(taskId) {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) return { ok: false, error: '没找到这条任务' }
    const material = await taskMaterial(task)
    const result = await suggestTitleFrom(material, asString(task.title))
    return {
      ok: true,
      title: withTaskNo(result.title, task),
      raw: stripTaskNo(result.title),
      ai: result.ai,
      reason: result.reason,
      no: taskNo(task),
    }
  }

  async function renameTask(taskId, nextTitle) {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) return { ok: false, error: '没找到这条任务' }
    const title = withTaskNo(nextTitle, task)
    if (!asString(nextTitle).trim()) return { ok: false, error: '标题不能为空' }
    if (title === task.title) return { ok: true, title, unchanged: true }

    const path = resolveCli(settings.cliPath)
    const result = await runCli(path, ['task', 'update', task.id, `--summary=${title}`], { timeoutMs: 60_000 })
    if (!result.ok) return { ok: false, error: `改名失败：${(result.detail ?? '').slice(-300)}` }

    task.title = title
    task.localUpdatedAt = nowMs()
    await persistState()
    /* 任务名 = 会话名：会话还活着就一起改，挂了就只改任务。 */
    const renamedSession = task.sessionId
      ? await renameSession(task.sessionId, title)
      : { ok: false, reason: '没有绑定会话' }
    /* 生成的那篇文档标题也跟任务名走，改完立刻同步到飞书（失败只记日志，不挡改名）。 */
    const docTitles = await syncGeneratedDocTitles(task)
    return {
      ok: true,
      title,
      sessionRenamed: renamedSession.ok,
      sessionReason: renamedSession.reason,
      docTitles,
    }
  }

  /**
   * 把会话挂进工作区登记表。
   *
   * `agents.create({meta:{cwd}})` 只写了会话头里的 cwd，**不会**把 sessionId 记进 workspace 的
   * sessionIds；工作区靠那份登记来列会话，于是插件建的会话在 UI 里根本不属于任何项目，
   * 只能落进「归档」。所以建完会话必须补一次 attach（顺带解归档）。
   */
  async function attachSessionToWorkspace(sessionId, pathHint) {
    const registry = await awaitService(ctx, 'workspaceRegistry')
    if (!registry) return { ok: false, reason: '宿主没有工作区登记表' }
    let workspace
    if (pathHint) {
      try {
        workspace = await registry.resolveByPath(pathHint)
      } catch {
        workspace = undefined
      }
    }
    if (!workspace) return { ok: false, reason: `没找到目录对应的项目：${pathHint || '(无路径)'}` }
    const already = Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(sessionId)
    if (!already) await workspace.attachSession(sessionId)
    try {
      await registry.unarchiveSession(sessionId)
    } catch {
      /* 不在归档集里就无需处理 */
    }
    return { ok: true, attached: !already, workspace: workspace.title }
  }

  /** 修历史遗留：已绑会话但没挂进项目的那批，同步时补挂一次。 */
  async function repairSessionWorkspaces() {
    const registry = await awaitService(ctx, 'workspaceRegistry')
    if (!registry) return
    for (const task of state.tasks) {
      if (!task.sessionId) continue
      const path = task.workspacePath || ''
      if (!path) continue
      try {
        const workspace = await registry.resolveByPath(path)
        if (!workspace) continue
        if (Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(task.sessionId)) continue
        await workspace.attachSession(task.sessionId)
        await registry.unarchiveSession(task.sessionId).catch(() => undefined)
        log(ctx, 'info', `[workspace] 会话补挂到项目：${task.sessionId} → ${workspace.title}`)
      } catch {
        /* 单条失败不影响同步 */
      }
    }
  }

  /**
   * 归档/删除一条会话。
   *
   * DSH 的用户可见「删除」就是归档：会话从侧边栏消失、日志仍在磁盘上（可恢复），
   * 运行中的会话会先停掉它的活（stopActivity）。
   */
  async function archiveSessionForTask(sessionId) {
    const id = asString(sessionId).trim()
    if (!id) return { ok: false, error: '没有会话 id' }
    const registry = await awaitService(ctx, 'workspaceRegistry')
    if (!registry || typeof registry.archiveSession !== 'function') {
      return { ok: false, error: '宿主没有工作区登记表，无法归档会话' }
    }
    try {
      await registry.archiveSession(id, { stopActivity: true })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 「完成」：飞书置完成 + 归档会话。 */
  async function completeTask(taskId) {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) return { ok: false, error: '没找到这条任务' }
    const path = resolveCli(settings.cliPath)
    const done = await runCli(path, ['task', 'complete', task.id], { timeoutMs: 60_000 })
    if (!done.ok) return { ok: false, error: `标记完成失败：${(done.detail ?? '').slice(-300)}` }
    task.done = true
    task.status = 'done'
    let archived = false
    if (task.sessionId) {
      const result = await archiveSessionForTask(task.sessionId)
      archived = result.ok
      if (!result.ok) log(ctx, 'warn', `[session] 归档失败：${result.error}`)
    }
    await persistState()
    return { ok: true, archived, sessionId: task.sessionId }
  }

  /** 「删除」：解绑 + 归档会话（不动飞书任务状态）。 */
  async function deleteSessionForTask(taskId) {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) return { ok: false, error: '没找到这条任务' }
    const sessionId = asString(task.sessionId)
    if (!sessionId) return { ok: false, error: '这条任务没有绑定会话' }
    const archived = await archiveSessionForTask(sessionId)
    task.sessionId = null
    task.started = false
    task.boundOnly = false
    task.startedAt = null
    await persistState()
    return { ok: true, archived: archived.ok, archiveError: archived.ok ? undefined : archived.error }
  }

  /** 从文本里挑出飞书文档链接（docx / docs / wiki / sheets / base）。 */
  function extractDocLinks(text) {
    const found = []
    const re = /https?:\/\/[^\s)"'<>]+\/(?:docx|docs|wiki|sheets|base)\/[A-Za-z0-9_-]+/g
    let match
    while ((match = re.exec(asString(text))) !== null) {
      if (!found.some((item) => item.url === match[0])) found.push({ url: match[0], title: '', source: '描述' })
    }
    return found
  }

  /**
   * 把任务当前的文档链接立刻写回清单的「文档」字段。
   *
   * 绑定 / 解绑文档、生成文档之后都走它：绑定完就同步到飞书，不靠人再点一次同步。
   */
  async function pushDocField(task) {
    const listGuid = task.tasklistGuid || defaultsFromState().tasklistGuid
    if (!listGuid) return { ok: false, error: '不知道任务所属清单，无法写回「文档」字段' }
    const python = resolvePython(resolveCli(settings.cliPath))
    if (!python) return { ok: false, error: '找不到 Python（feishu-sync 安装环境）' }
    const result = await runBridge(python, {
      actions: [
        {
          op: 'set_custom_field',
          task: task.id,
          tasklist: listGuid,
          name: settings.taskFields.doc || '文档',
          value: docFieldValue(task),
        },
      ],
    })
    const item = (result.actions ?? [])[0]
    if (!item?.ok) return { ok: false, error: item?.error || '写回失败' }
    return { ok: true }
  }

  /**
   * 清单「文档」字段里只有链接、没有标题：按 URL 去飞书问一次标题。
   *
   * 只在第一次遇到这篇文档时问（结果进 state.docTitles 缓存，问过没拿到就记 null），
   * 每轮最多补 3 篇——同步是定时跑的，不能为了好看向飞书打几十个 info_page。
   */
  async function backfillDocTitles(tasks) {
    const cache = state.docTitles || (state.docTitles = {})
    const pending = []
    for (const task of tasks) {
      for (const doc of Array.isArray(task.docs) ? task.docs : []) {
        if (!doc?.url) continue
        const hit = cache[doc.url]
        if (!asString(doc.title) && hit?.title) doc.title = hit.title
        if (doc.title || hit === null || pending.some((item) => item.url === doc.url)) continue
        pending.push(doc)
      }
    }
    if (!pending.length) return
    const path = resolveCli(settings.cliPath)
    for (const doc of pending.slice(0, 3)) {
      const info = await runCli(path, ['info_page', doc.url], { timeoutMs: 30_000 })
      const title = info.ok ? asString(parseJson(info.stdout)?.title) : ''
      cache[doc.url] = title ? { title, at: nowMs() } : null
      if (title) doc.title = title
    }
    await persistState()
  }

  /**
   * 把文档标题写回飞书（Drive 里那篇文档真的改名）。
   *
   * 只有 docx 能改：wiki / sheets 的标题在别的接口上，做不到就如实返回原因，
   * 不假装成功——面板会把它显示成「本地已改，飞书未同步」。
   */
  async function pushDocTitle(doc) {
    const id = docxIdOf(doc?.url)
    if (!id) return { ok: false, error: '只有 docx 文档能同步改名' }
    const title = asString(doc.title).trim()
    if (!title) return { ok: false, error: '标题不能为空' }
    const python = resolvePython(resolveCli(settings.cliPath))
    const result = await runBridge(python, {
      actions: [{ op: 'rename_docx', document: id, title }],
    })
    const item = (result.actions ?? [])[0]
    if (!item?.ok) return { ok: false, error: item?.error || '飞书改名失败' }
    return { ok: true }
  }

  /**
   * 任务改名后，把它自己生成的那篇文档标题也同步改掉。
   *
   * 生成文档时标题取的是任务名（去掉 T<n>- 前缀），任务一改名两边就会对不上；
   * 这里在改名成功后补齐，手动绑定的外部文档不动（那是别人的文档，不该跟着任务改）。
   */
  async function syncGeneratedDocTitles(task) {
    const next = stripTaskNo(task.title).slice(0, 120)
    const docs = (Array.isArray(task.docs) ? task.docs : []).filter(
      (doc) => doc?.source === '生成' && docxIdOf(doc.url),
    )
    if (!docs.length) return []
    const results = []
    let changed = false
    for (const doc of docs) {
      if (asString(doc.title) === next) {
        results.push({ url: doc.url, ok: true, unchanged: true })
        continue
      }
      doc.title = next
      changed = true
      const renamed = await pushDocTitle(doc)
      results.push({ url: doc.url, ok: renamed.ok, error: renamed.error })
      if (!renamed.ok) log(ctx, 'warn', `[doc] 文档改名失败：${renamed.error}`)
    }
    if (changed) {
      await persistState()
      const field = await pushDocField(task)
      if (field.ok) task.localUpdatedAt = 0
      await persistState()
    }
    return results
  }

  /**
   * 手动把一篇飞书文档绑到任务上（或解绑）。
   *
   * 面板卡片上的「＋ 文档」直接调它：写本地 + 立刻写回飞书字段，两条链路一次完成。
   * 标题尽力从 CLI 的 info_page 拿；拿不到就用链接占位，不因为标题失败拒绝绑定。
   */
  async function bindTaskDoc(taskId, rawUrl, options = {}) {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) return { ok: false, error: '没找到这条任务' }
    const url = asString(rawUrl).trim()
    if (!url) return { ok: false, error: '需要一篇文档的链接' }
    const remove = options.remove === true
    const current = Array.isArray(task.docs) ? task.docs : []
    if (remove) {
      const next = current.filter((doc) => doc?.url !== url)
      if (next.length === current.length) return { ok: false, error: '这条任务上没有这篇文档' }
      task.docs = next
    } else {
      if (!/^https?:\/\//.test(url)) return { ok: false, error: '文档链接需要以 http(s):// 开头' }
      let title = current.find((doc) => doc?.url === url)?.title || ''
      if (!title) {
        const info = await runCli(resolveCli(settings.cliPath), ['info_page', url], { timeoutMs: 60_000 })
        const meta = info.ok ? parseJson(info.stdout) : undefined
        title = asString(meta?.title)
      }
      const others = current.filter((doc) => doc?.url !== url)
      task.docs = [{ url, title: title || url, source: '手动', createdAt: nowMs() }, ...others].slice(0, 8)
    }
    task.localUpdatedAt = nowMs()
    await persistState()
    const field = await pushDocField(task)
    if (field.ok) task.localUpdatedAt = 0
    await persistState()
    return { ok: true, docs: task.docs, field, docField: settings.taskFields.doc || '文档' }
  }

  /**
   * 把一条任务上已绑定的文档换成另一个链接，并同步到飞书。
   *
   * 卡片上的 `✎` 改的是链接不是标题：粘错文档、或者要把任务挂到另一篇文档时，
   * 直接改链接最直观。换完标题按新链接重新问一次 `info_page`，然后重写「文档」字段
   * （字段里存的就是链接，这一步才是真正让飞书那边跟着换）。
   */
  async function editTaskDoc(taskId, rawUrl, rawNextUrl) {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) return { ok: false, error: '没找到这条任务' }
    const url = asString(rawUrl).trim()
    const nextUrl = asString(rawNextUrl).trim()
    if (!url) return { ok: false, error: '需要文档链接' }
    if (!nextUrl) return { ok: false, error: '链接不能为空' }
    if (!/^https?:\/\//.test(nextUrl)) return { ok: false, error: '文档链接需要以 http(s):// 开头' }
    const docs = Array.isArray(task.docs) ? task.docs : []
    const doc = docs.find((item) => item?.url === url)
    if (!doc) return { ok: false, error: '这条任务上没有这篇文档' }
    if (url === nextUrl) return { ok: true, url, title: asString(doc.title), unchanged: true }

    /* 换成文档上已经有的另一条链接等于重复，直接把旧的那条摘掉。 */
    const duplicate = docs.find((item) => item !== doc && item?.url === nextUrl)
    if (duplicate) task.docs = docs.filter((item) => item !== doc)

    const info = await runCli(resolveCli(settings.cliPath), ['info_page', nextUrl], { timeoutMs: 60_000 })
    const title = info.ok ? asString(parseJson(info.stdout)?.title) : ''
    const previousUrl = url
    doc.url = nextUrl
    /* 换了链接就不再是「自己生成的那篇」了，按手动绑定记。 */
    if (doc.source === '生成') doc.source = '手动'
    doc.title = title || nextUrl
    doc.createdAt = nowMs()
    task.localUpdatedAt = nowMs()
    await persistState()
    const field = await pushDocField(task)
    if (field.ok) task.localUpdatedAt = 0
    await persistState()
    return {
      ok: true,
      url: nextUrl,
      previousUrl,
      title: doc.title,
      field,
      docField: settings.taskFields.doc || '文档',
    }
  }
  /* 任务详情（评论/子任务/附件）带缓存：这三样要额外打三次飞书接口，不必每次工具调用都拉。 */
  const detailCache = new Map()
  const DETAIL_TTL = 120_000

  /**
   * 拉一条任务的「全部数据」：state 里的本体 + 评论 / 子任务 / 附件。
   *
   * 本体走本地快照（同步时一直在更新），这三样走补充通道、带 120s 缓存。
   * 任何一项失败都不影响其它项：失败原因进 errors，面板/工具里显示成「需要权限」。
   */
  async function loadTaskDetail(taskId, options = {}) {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) return { ok: false, error: '没找到这条任务' }
    const hit = detailCache.get(taskId)
    if (options.refresh !== true && hit && nowMs() - hit.at < DETAIL_TTL) {
      return { ok: true, task, detail: hit.value, cached: true }
    }
    const python = resolvePython(resolveCli(settings.cliPath))
    if (!python) return { ok: false, error: '找不到 Python（feishu-sync 安装环境）', task }
    const result = await runBridge(python, {
      actions: [
        { op: 'task_comments', task: taskId },
        { op: 'task_subtasks', task: taskId },
        { op: 'task_attachments', task: taskId },
      ],
    })
    const byOp = (name) => (result.actions ?? []).find((item) => item.op === name)
    const nameOf = (id) => cached(remoteCache.users, asString(id), REMOTE_TTL.users)?.name || asString(id)
    const pick = (name, mapItem) => {
      const item = byOp(name)
      const errors = item?.ok ? [] : [item?.error || '未知错误']
      return { ok: item?.ok === true, items: (item?.items ?? []).map(mapItem), errors }
    }

    const comments = pick('task_comments', (raw) => ({
      id: asString(raw?.id),
      content: asString(raw?.content),
      authorId: asString(raw?.creator?.id ?? raw?.creator_id),
      createdAt: Number(raw?.created_at) || 0,
    }))
    /* 评论人可能不是任务成员（没在 enrich 里露过面）：补查一次姓名，别让输出全是 ou_xxx。 */
    const unknownAuthors = [...new Set(comments.items.map((item) => item.authorId))]
      .filter((id) => id && !cached(remoteCache.users, id, REMOTE_TTL.users))
    if (unknownAuthors.length > 0) {
      try {
        const extra = await runBridge(python, { users: unknownAuthors })
        const stamp = nowMs()
        for (const [id, user] of Object.entries(extra?.users ?? {})) {
          remoteCache.users.set(id, { at: stamp, value: user })
        }
      } catch {
        /* 查不到就退回显示 id */
      }
    }
    for (const item of comments.items) item.author = nameOf(item.authorId)
    const subtasks = pick('task_subtasks', (raw) => ({
      id: asString(raw?.guid ?? raw?.task_guid),
      title: asString(raw?.summary),
      done: Boolean(raw?.completed_at) && asString(raw?.completed_at) !== '0',
      status: asString(raw?.status),
    }))
    const attachments = pick('task_attachments', (raw) => ({
      id: asString(raw?.guid ?? raw?.file_token),
      name: asString(raw?.name ?? raw?.filename),
      size: Number(raw?.size) || 0,
      createdAt: Number(raw?.uploaded_at ?? raw?.created_at) || 0,
    }))
    const value = { comments, subtasks, attachments }
    detailCache.set(taskId, { at: nowMs(), value })
    return { ok: true, task, detail: value }
  }

  /** 详情组装成人读/模型读的文本。 */
  function formatTaskDetail(task, detail) {
    const parts = [describeTask(task, { includeDescription: false })]
    const block = (title, section, render, empty) => {
      if (!section.ok) {
        parts.push(`${title}：（读取失败：${section.errors.join('；').slice(0, 160)}）`)
        return
      }
      if (!section.items.length) {
        parts.push(`${title}：${empty}`)
        return
      }
      parts.push(`${title}（${section.items.length}）`, ...section.items.map(render))
    }
    block('评论', detail.comments, (item) => `- ${item.createdAt ? formatDay(item.createdAt) + ' ' : ''}${item.author}：${item.content.slice(0, 400)}`, '（暂无评论）')
    block('子任务', detail.subtasks, (item) => `- ${item.done ? '✓' : '○'} ${item.title}`, '（无子任务）')
    block('附件', detail.attachments, (item) => `- ${item.name}${item.size ? `（${Math.round(item.size / 1024)} KB）` : ''}`, '（无附件）')
    if (task.description) {
      const text = asString(task.description)
      parts.push('', '任务说明：', text.length > 4000 ? `${text.slice(0, 4000)}…（已截断）` : text)
    }
    return parts.join('\n')
  }

  /**
   * 在统一目录里给一条任务生成飞书文档。
   *
   * 目录结构：`DSH 任务文档 / <T<n>-任务名> / <任务名>.docx`
   * 内容 = 任务描述 + 绑定会话最后一条助手回复；生成后把链接回写进任务描述（飞书里可见）。
   */
  async function createTaskDoc(taskId) {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) return { ok: false, error: '没找到这条任务' }
    const path = resolveCli(settings.cliPath)
    const python = resolvePython(path)
    if (!python) return { ok: false, error: '找不到 Python（feishu-sync 安装环境）' }

    const lines = []
    if (task.description) lines.push(task.description.trim())
    if (task.sessionId) {
      const sessions = await awaitService(ctx, 'sessionController')
      if (sessions?.inspect) {
        try {
          const inspection = await sessions.inspect(task.sessionId)
          const text = lastAssistantText(inspection)
          if (text) lines.push('\n---\n会话结论（' + task.sessionId + '）：\n' + text)
        } catch {
          /* 读不到会话就只写任务内容 */
        }
      }
    }
    const material = lines.join('\n') || task.title
    /* 按面板里可编辑的 docPrompt 让模型重写成「零废话 + 表格 + Mermaid」的正式文档。 */
    const written = await askModelLong(settings.docPrompt, material)
    const body = written.text || material
    if (!written.text) log(ctx, 'warn', `[doc] 模型改写失败，落原始材料：${written.reason}`)

    const root = await runBridge(python, {
      actions: [{ op: 'ensure_folder', name: 'DSH 任务文档', parent: '' }],
    })
    const rootFolder = (root.actions ?? [])[0]
    if (!rootFolder?.ok) return { ok: false, error: `创建文档根目录失败：${rootFolder?.error ?? '未知'}` }

    const subName = `${task.no ? `T${task.no}-` : ''}${stripTaskNo(task.title).slice(0, 20)}`
    const sub = await runBridge(python, {
      actions: [{ op: 'ensure_folder', name: subName, parent: rootFolder.folder }],
    })
    const subFolder = (sub.actions ?? [])[0]
    if (!subFolder?.ok) return { ok: false, error: `创建任务子目录失败：${subFolder?.error ?? '未知'}` }

    /* 已经生成过就原地重写，不再造新文档。 */
    const existing = (Array.isArray(task.docs) ? task.docs : []).find(
      (item) => item.source === '生成' && /\/docx\//.test(item.url || ''),
    )
    const existingId = existing ? String(existing.url).split('/docx/')[1] : ''
    const created = await runBridge(python, {
      actions: [
        existingId
          ? { op: 'update_docx', document: existingId, text: body }
          : { op: 'create_docx', title: stripTaskNo(task.title), folder: subFolder.folder, text: body },
      ],
    })
    let doc = (created.actions ?? [])[0]
    if (existingId && !doc?.ok) {
      /* 记录里的文档可能已经被人删了：退回新建一篇并替换记录。 */
      log(ctx, 'warn', `[doc] 更新失败，改为新建：${doc?.error ?? '未知'}`)
      const recreated = await runBridge(python, {
        actions: [{ op: 'create_docx', title: stripTaskNo(task.title), folder: subFolder.folder, text: body }],
      })
      doc = (recreated.actions ?? [])[0]
    }
    if (!doc?.ok) return { ok: false, error: `创建文档失败：${doc?.error ?? '未知'}` }

    /* 一条任务只保留一个「自己生成」的文档；描述里识别出来的外部链接照旧展示。 */
    const others = (Array.isArray(task.docs) ? task.docs : []).filter((item) => item.source !== '生成')
    task.docs = [{ url: doc.url, title: stripTaskNo(task.title), source: '生成', createdAt: nowMs() }, ...others].slice(0, 8)
    task.localUpdatedAt = nowMs()
    /* 文档链接写进任务的「文档」字段（任务上所有文档一起写回），不再污染描述。 */
    const field = await pushDocField(task)
    if (field.ok) task.localUpdatedAt = 0
    await persistState()
    return {
      ok: true,
      url: doc.url,
      folderUrl: subFolder.url || rootFolder.url,
      updated: Boolean(existingId),
      tables: doc.tables ?? 0,
    }
  }

  /**
   * 按「谁更新」决定同步方向：
   *   本地比飞书新 → 把本地字段写回飞书；
   *   飞书不比本地旧 → 拉取飞书（重新同步一轮），本地跟着变。
   */
  async function syncTaskFields(taskId) {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) return { ok: false, error: '没找到这条任务' }
    const feishuTs = Number(task.updatedAt) || 0
    const localTs = Number(task.localUpdatedAt) || 0
    /* 本地有值、且与飞书现值不同 → 需要写回；否则只拉取。 */
    const fieldValue = (name) =>
      (task.customFields || []).find((item) => item.name === name)?.value || ''

    const path = resolveCli(settings.cliPath)
    const python = resolvePython(path)
    if (!python) return { ok: false, error: '找不到 Python（feishu-sync 安装环境）' }
    const listGuid = task.tasklistGuid || defaultsFromState().tasklistGuid
    if (!listGuid) return { ok: false, error: '不知道任务所属清单，无法写回字段' }

    const actions = []
    const push = (name, value) => {
      if (value) actions.push({ op: 'set_custom_field', task: task.id, tasklist: listGuid, name, value })
    }
    /* 本地没解析出工作区时，从绑定会话的 cwd 反查项目名，避免写空值。 */
    let workspaceLabel = task.workspaceTitle || task.workspaceName || ''
    if (!workspaceLabel && task.sessionId) {
      const sessions = await awaitService(ctx, 'sessionController')
      const registry = await awaitService(ctx, 'workspaceRegistry')
      if (sessions?.inspect && registry?.resolveByPath) {
        try {
          const inspection = await sessions.inspect(task.sessionId)
          const cwd = inspection?.session?.cwd || inspection?.header?.cwd || ''
          if (cwd) {
            const ws = await registry.resolveByPath(cwd)
            if (ws?.title) workspaceLabel = ws.title
          }
        } catch {
          /* 读不到会话就退回字段值 */
        }
      }
    }
    if (workspaceLabel && workspaceLabel !== fieldValue(settings.taskFields.workspace)) {
      push(settings.taskFields.workspace, workspaceLabel)
    }
    /* 写回的是任务上全部文档（生成 + 手动绑定），不是一个；飞书字段一行一个链接。 */
    const docValue = docFieldValue(task)
    if (docValue && docValue !== fieldValue(settings.taskFields.doc)) push(settings.taskFields.doc, docValue)
    const triggerText = { manual: '人工触发', auto: '自动执行', scheduled: '按时执行' }[task.meta?.trigger] || ''
    if (triggerText && triggerText !== fieldValue(settings.taskFields.trigger)) {
      push(settings.taskFields.trigger, triggerText)
    }

    /* 没有差异就不写；有差异时无论时间戳都写回（本地是明确值）。 */
    if (!actions.length) {
      await sync({ source: 'task-sync' })
      return { ok: true, direction: 'pull', note: '飞书与本地一致，已刷新' }
    }
    const result = await runBridge(python, { actions })
    const failed = (result.actions ?? []).filter((item) => !item.ok)
    task.localUpdatedAt = 0
    await persistState()
    await sync({ source: 'task-sync' })
    return {
      ok: true,
      direction: 'push',
      pushed: (result.actions ?? []).length - failed.length,
      failed: failed.map((item) => item.error).filter(Boolean),
    }
  }

  /**
   * 会话改名 → 飞书任务改名。
   *
   * 「任务名 = 会话名」是插件里既定的对应关系（开工 / 绑定时把任务名推给会话），
   * 但反方向一直缺：在侧栏把会话改名后，飞书任务还是旧名字。巡检时补上这一环。
   */
  async function syncSessionTitles() {
    const bound = state.tasks.filter((task) => task.sessionId && !task.done)
    if (bound.length === 0) return { ok: true, renamed: [] }
    const sessions = await awaitService(ctx, 'sessionController', 5000)
    if (!sessions?.inspect) return { ok: false, error: '宿主没有会话服务' }
    const renamed = []
    for (const task of bound) {
      let title = ''
      try {
        const inspection = await sessions.inspect(task.sessionId)
        title = asString(inspection?.session?.title || inspection?.header?.title || inspection?.title).trim()
      } catch {
        continue
      }
      if (!title || title === task.title) continue
      /* 去掉 T<n>- 前缀再比：任务名带编号、会话名通常不带。 */
      if (stripTaskNo(title) === stripTaskNo(task.title)) continue
      const result = await renameTask(task.id, title)
      if (result.ok) renamed.push({ taskId: task.id, title: result.title })
    }
    return { ok: true, renamed }
  }

  async function autoStartNewTasks() {
    const candidates = selectAutoStartCandidates(state.tasks, settings)
    /* 工作区注册表要等 session 历史引导完才可用（启动后十几秒）。这期间带工作区的任务
       不是「配置错了」，只是「还问不到」——跳过这一轮，别把错误写到任务上。 */
    if (candidates.some((task) => (task.meta?.workspace ?? '') !== '') && workspaces().length === 0) {
      return 0
    }
    let started = 0
    for (const task of candidates) {
      const result = await startTask(task.id, 'auto')
      if (result.ok) started += 1
    }
    return started
  }

  async function sync({ source = 'manual' } = {}) {
    if (inFlight) return inFlight
    inFlight = (async () => {
      const started = nowMs()
      const errors = []
      try {
        await probeCli()
        const tasks = await syncTasks()
        if (!tasks.ok) errors.push(`任务：${tasks.detail}`)
        const docs = await syncDocs()
        if (!docs.ok) errors.push(`文档：${docs.detail}`)
        const autoStarted = await autoStartNewTasks()
        state.lastSyncAt = nowMs()
        state.lastError = errors.length > 0 ? errors.join('；') : null
        state.syncing = false
        await persistState()
        log(ctx, 'info', `[${source}] 同步完成：任务 ${state.tasks.length} 条，文档 ${state.docs.length} 篇，自动开工 ${autoStarted}，耗时 ${nowMs() - started}ms`)
        return { ok: errors.length === 0, errors }
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : String(error)
        await persistState()
        return { ok: false, errors: [state.lastError] }
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  return {
    load,
    snapshot,
    saveSettings,
    probeCli,
    checkAuth,
    startLogin,
    startTask,
    linkTask,
    unlinkTask,
    reportTask,
    syncCurrentSession,
    createTaskFromSession,
    promoteSessionToTask,
    renameSession,
    generateSessionTitle,
    suggestTaskTitle,
    renameTask,
    attachSessionToWorkspace,
    completeTask,
    deleteSessionForTask,
    createTaskDoc,
    bindTaskDoc,
    editTaskDoc,
    loadTaskDetail,
    formatTaskDetail,
    syncTaskFields,
    syncSessionTitles,
    archiveSessionForTask,
    sessionExists,
    persistState,
    sync,
    getSettings: () => settings,
    onSettingsChange,
    commentProgress,
    flushPendingProgress,
    getState: () => state,
    /* 定时器用：有没有到点该开工的「按时执行」任务。 */
    dueScheduledNow() {
      return state.tasks.some(
        (task) => task.meta?.trigger === 'scheduled' && evaluateAutoStart(task, settings).start,
      )
    },
    setTaskFlag(taskId, patch) {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task) return undefined
      Object.assign(task, patch)
      return task
    },
  }
}

/* ─────────────────────────── HTTP 接口 ─────────────────────────── */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        resolve({})
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      resolve(parseJson(text) ?? {})
    })
    req.on('error', () => resolve({}))
  })
}

function mountRoutes(ctx, engine) {
  const panelFile = join(HERE, 'panel.html')
  return ctx.webServer.register({
    kind: 'prefix',
    path: MOUNT,
    handler: (req, res) => {
      void (async () => {
        const url = new URL(req.url ?? MOUNT, 'http://localhost')
        const route = url.pathname.slice(MOUNT.length) || '/'

        try {
          if (req.method === 'GET' && (route === '/' || route === '/panel')) {
            const html = await readFile(panelFile, 'utf8')
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            res.end(req.method === 'HEAD' ? undefined : html)
            return
          }

          if (route === '/api/state' && req.method === 'GET') {
            const snap = engine.snapshot()
            sendJson(res, 200, {
              ok: true,
              settings: snap.settings,
              state: snap.state,
              workspaces: snap.workspaces,
              now: nowMs(),
            })
            return
          }

          if (route === '/api/settings' && req.method === 'POST') {
            const patch = await readBody(req)
            const settings = await engine.saveSettings(patch)
            sendJson(res, 200, { ok: true, settings })
            return
          }

          if (route === '/api/sync' && req.method === 'POST') {
            const already = engine.snapshot().state.syncing
            if (already) {
              sendJson(res, 200, { ok: true, started: false, reason: 'syncing' })
              return
            }
            void engine.sync({ source: 'panel' })
            sendJson(res, 200, { ok: true, started: true })
            return
          }

          if (route === '/api/auth/check' && req.method === 'POST') {
            const auth = await engine.checkAuth()
            sendJson(res, 200, { ok: true, auth })
            return
          }

          if (route === '/api/auth/login' && req.method === 'POST') {
            const result = await engine.startLogin()
            sendJson(res, 200, { ok: result.ok, url: result.url ?? null, error: result.error ?? null })
            return
          }

          if (route === '/api/tasks/start' && req.method === 'POST') {
            const body = await readBody(req)
            const result = await engine.startTask(asString(body.id), 'panel', {
              sessionId: asString(body.sessionId),
            })
            sendJson(res, result.ok ? 200 : 400, result)
            return
          }

          if (route === '/api/tasks/link' && req.method === 'POST') {
            const body = await readBody(req)
            const result = await engine.linkTask(asString(body.taskId ?? body.id), asString(body.sessionId), 'manual')
            sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, task: result.task } : result)
            return
          }

          if (route === '/api/tasks/sync' && req.method === 'POST') {
            const body = await readBody(req)
            const result = await engine.syncTaskFields(asString(body.taskId ?? body.id))
            sendJson(res, result.ok ? 200 : 400, result)
            return
          }
          /* 手动绑定 / 解绑一篇文档：写本地 + 立刻写回飞书「文档」字段。 */
          if (route === '/api/tasks/bind-doc' && req.method === 'POST') {
            const body = await readBody(req)
            const result = await engine.bindTaskDoc(asString(body.taskId ?? body.id), asString(body.url), {
              remove: body.remove === true,
            })
            sendJson(res, result.ok ? 200 : 400, result)
            return
          }

          if (route === '/api/tasks/create-doc' && req.method === 'POST') {
            const body = await readBody(req)
            const result = await engine.createTaskDoc(asString(body.taskId ?? body.id))
            sendJson(res, result.ok ? 200 : 400, result)
            return
          }

          /* 改卡片上已绑定文档的链接，改完立刻重写飞书「文档」字段。 */
          if (route === '/api/tasks/edit-doc' && req.method === 'POST') {
            const body = await readBody(req)
            const result = await engine.editTaskDoc(
              asString(body.taskId ?? body.id),
              asString(body.url),
              asString(body.nextUrl),
            )
            sendJson(res, result.ok ? 200 : 400, result)
            return
          }

          if (route === '/api/tasks/complete' && req.method === 'POST') {
            const body = await readBody(req)
            const result = await engine.completeTask(asString(body.taskId ?? body.id))
            sendJson(res, result.ok ? 200 : 400, result)
            return
          }

          if (route === '/api/tasks/delete-session' && req.method === 'POST') {
            const body = await readBody(req)
            const result = await engine.deleteSessionForTask(asString(body.taskId ?? body.id))
            sendJson(res, result.ok ? 200 : 400, result)
            return
          }

          if (route === '/api/tasks/unlink' && req.method === 'POST') {
            const body = await readBody(req)
            const result = await engine.unlinkTask(asString(body.taskId ?? body.id))
            sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, previous: result.previous } : result)
            return
          }

          if (route === '/api/sessions' && req.method === 'GET') {
            const agents = service(ctx, 'agents')
            const live = []
            try {
              for (const agent of agents?.list?.() ?? []) {
                if (!agent || typeof agent.id !== 'string') continue
                const title =
                  (typeof agent.session?.title === 'string' && agent.session.title) ||
                  (typeof agent.title === 'string' && agent.title) ||
                  ''
                live.push({ id: agent.id, title })
              }
            } catch {
              /* 拿不到就当空列表 */
            }
            sendJson(res, 200, { ok: true, sessions: live })
            return
          }

          if (route === '/api/tasks/suggest-title' && req.method === 'POST') {
            const body = await readBody(req)
            const result = await engine.suggestTaskTitle(asString(body.taskId ?? body.id))
            sendJson(res, result.ok ? 200 : 400, result)
            return
          }

          if (route === '/api/tasks/rename' && req.method === 'POST') {
            const body = await readBody(req)
            const result = await engine.renameTask(asString(body.taskId ?? body.id), asString(body.title))
            sendJson(res, result.ok ? 200 : 400, result)
            return
          }

          if (route === '/api/sessions/promote' && req.method === 'POST') {
            const body = await readBody(req)
            const result = await engine.promoteSessionToTask(asString(body.sessionId))
            sendJson(res, result.ok ? 200 : 400, result)
            return
          }

          if (route === '/api/sessions/sync' && req.method === 'POST') {
            const body = await readBody(req)
            const result = await engine.syncCurrentSession(asString(body.sessionId), {
              complete: body.complete === true,
            })
            sendJson(
              res,
              result.ok ? 200 : 400,
              result.ok ? { ok: true, task: result.task, chars: result.chars, completed: result.completed } : result,
            )
            return
          }

          if (route === '/api/tasks/report' && req.method === 'POST') {
            const body = await readBody(req)
            const result = await engine.reportTask(asString(body.taskId ?? body.id), {
              text: asString(body.text),
              complete: body.complete === true,
            })
            sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true } : result)
            return
          }

          if (route === '/api/tasks/dismiss' && req.method === 'POST') {
            const body = await readBody(req)
            const task = engine.setTaskFlag(asString(body.id), { isNew: false })
            if (!task) {
              sendJson(res, 404, { ok: false, error: '没有这条任务' })
              return
            }
            await engine.persistState()
            sendJson(res, 200, { ok: true })
            return
          }

          if (route === '/api/docs/read' && req.method === 'POST') {
            const body = await readBody(req)
            const target = asString(body.url)
            if (!/^https?:\/\//.test(target)) {
              sendJson(res, 400, { ok: false, error: '需要一个 http(s) 文档链接' })
              return
            }
            const path = resolveCli(engine.getSettings().cliPath)
            const result = await runCli(path, ['read_page_as_markdown', target], { timeoutMs: 120_000 })
            if (!result.ok) {
              sendJson(res, 502, { ok: false, error: (result.detail ?? '读取失败').slice(-400) })
              return
            }
            sendJson(res, 200, { ok: true, markdown: result.stdout.slice(0, 20_000) })
            return
          }

          if (route === '/api/docs/watch' && req.method === 'POST') {
            const body = await readBody(req)
            const target = asString(body.url).trim()
            const settings = engine.getSettings()
            const watch = new Set(settings.docs.watch)
            if (body.remove === true) {
              watch.delete(target)
            } else if (/^https?:\/\//.test(target)) {
              watch.add(target)
            } else {
              sendJson(res, 400, { ok: false, error: '文档链接需要以 http(s):// 开头' })
              return
            }
            const next = await engine.saveSettings({ docs: { watch: [...watch] } })
            sendJson(res, 200, { ok: true, watch: next.docs.watch })
            return
          }

          sendJson(res, 404, { ok: false, error: `没有这个接口：${req.method} ${route}` })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      })()
    },
  })
}

/* ─────────────────────────── 模型工具 ─────────────────────────── */

function textTool(name, description, parameters, run) {
  return {
    name,
    description,
    parameters: { type: 'object', properties: parameters, additionalProperties: false },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      /* exec 里有 { agent, signal }：agent.id 就是当前会话。
         以前这里只传了 args，于是 feishu_task_session / report 全都「拿不到当前会话」。 */
      return run(args ?? {}, exec)
    },
  }
}

function registerTools(ctx, engine) {
  const disposers = []
  const register = (definition) => {
    const dispose = ctx.tools.register(definition)
    if (typeof dispose === 'function') disposers.push(dispose)
  }
  register(
    textTool(
      'feishu_tasks',
      '列出已同步到本地的飞书任务（只读；数据来自插件定时同步的本地快照），含任务已绑定的飞书文档链接。' +
        '用户问「我飞书里有哪些待办 / 这条任务状态」时用它。' +
        '加 refresh=true 会先跑一次同步再返回，可能耗时十几秒。',
      {
        refresh: { type: 'boolean', description: '返回前先同步一次，默认 false。' },
        includeDone: { type: 'boolean', description: '是否包含已完成任务，默认 false。' },
        keyword: { type: 'string', description: '按标题/描述过滤。' },
      },
      async (args) => {
        if (args.refresh === true) await engine.sync({ source: 'tool' })
        const state = engine.getState()
        const keyword = asString(args.keyword).toLowerCase()
        const list = state.tasks.filter((task) => {
          if (args.includeDone !== true && task.done) return false
          return keyword ? `${task.title}\n${task.description}`.toLowerCase().includes(keyword) : true
        })
        const head = `飞书任务 ${list.length} 条${state.lastSyncAt ? `（同步于 ${formatDay(state.lastSyncAt)}）` : '（还没同步过）'}`
        if (list.length === 0) return `${head}\n\n没有符合条件的任务。`
        const lines = list.map((task, index) => {
          const assignees = (Array.isArray(task.members) ? task.members : [])
            .filter((member) => member.role === 'assignee')
            .map((member) => member.name || member.id)
            .filter(Boolean)
            .join('、')
          const status = task.done ? '已完成' : (STATUS_TEXT[asString(task.status)] ?? asString(task.status))
          const meta = [
            status,
            task.due ? `截止 ${task.due}` : '无截止',
            assignees ? `负责人 ${assignees}` : '',
            task.started ? `已开工 ${task.sessionId}` : '',
          ]
            .filter(Boolean)
            .join(' · ')
          const fields = (Array.isArray(task.customFields) ? task.customFields : [])
            .filter((field) => field?.value)
            .slice(0, 4)
            .map((field) => `${field.name} ${field.value}`)
            .join(' · ')
          const docs = (Array.isArray(task.docs) ? task.docs : []).filter((doc) => doc?.url)
          const docPart = docs.length
            ? `\n   文档：${docs.map((doc) => (doc.title && doc.title !== doc.url ? `${doc.title} ${doc.url}` : doc.url)).join('；')}`
            : ''
          return `${index + 1}. ${task.title}${meta ? `\n   ${meta}` : ''}${fields ? `\n   ${fields}` : ''}${task.url ? `\n   ${task.url}` : ''}${docPart}${task.description ? `\n   ${task.description.slice(0, 200)}` : ''}`
        })
        return `${head}\n\n${lines.join('\n')}`
      },
    ),
  )

  register(
    textTool(
      'feishu_task_detail',
      '读一条飞书任务的完整数据（默认取当前会话绑定的那条）：状态、负责人/关注人/创建人、时间、' +
        '清单自定义字段、文档、评论、子任务、附件。用户问「这个任务的详情 / 有哪些评论 / 子任务做到哪了」时用它；' +
        '文档正文另用 feishu_doc_read。',
      {
        taskId: { type: 'string', description: '任务 guid；不传则用当前会话绑定的任务。' },
        refresh: { type: 'boolean', description: '跳过 120 秒缓存，强制重新拉评论/子任务/附件。' },
      },
      async (args, exec) => {
        const state = engine.getState()
        const current = asString(exec?.agent?.id)
        const bound = current ? state.tasks.find((task) => task.sessionId === current) : undefined
        const taskId = asString(args.taskId) || asString(bound?.id)
        if (!taskId) return '需要 taskId：当前会话没有绑定飞书任务（可以先用 feishu_tasks 查到 guid 再传进来）。'
        const result = await engine.loadTaskDetail(taskId, { refresh: args.refresh === true })
        if (!result.ok) return `读取失败：${result.error}`
        return engine.formatTaskDetail(result.task, result.detail)
      },
    ),
  )

  register(
    textTool(
      'feishu_sync',
      '立即同步一次飞书任务与监听中的文档（会写本地快照、可能拉起「自动开工」会话）。' +
        '用户说「同步一下飞书 / 刷新任务」时用它；返回同步摘要。',
      {},
      async () => {
        const result = await engine.sync({ source: 'tool' })
        const state = engine.getState()
        return result.ok
          ? `同步完成：任务 ${state.tasks.length} 条，文档 ${state.docs.length} 篇。`
          : `同步部分失败：${(result.errors ?? [state.lastError]).filter(Boolean).join('；')}`
      },
    ),
  )

  register(
    textTool(
      'feishu_doc_read',
      '读取一篇飞书文档/wiki 页面的正文（Markdown）。只读、联网，一次一篇。' +
        '用户给了飞书链接并问「这篇讲了什么」时用它，不要凭记忆编。',
      {
        url: { type: 'string', description: '飞书文档链接，https://momenta.feishu.cn/wiki/... 或 /docx/...' },
        maxChars: { type: 'number', description: '最多返回多少字符，默认 8000，上限 20000。' },
      },
      async (args) => {
        const url = asString(args.url).trim()
        if (!/^https?:\/\//.test(url)) return '需要一个 http(s) 飞书文档链接。'
        const limit = clampInt(args.maxChars, 500, 20_000, 8_000)
        const path = resolveCli(engine.getSettings().cliPath)
        const result = await runCli(path, ['read_page_as_markdown', url], { timeoutMs: 180_000 })
        if (!result.ok) return `读取失败：${(result.detail ?? '').slice(-500)}`
        const text = result.stdout.trim()
        return text.length > limit ? `${text.slice(0, limit)}\n\n…（已截断，原文 ${text.length} 字）` : text
      },
    ),
  )

  register(
    textTool(
      'feishu_task_session',
      '管理「飞书任务 ↔ DSH 会话」的对应关系：查某条任务绑了哪条会话、把当前会话绑到某条任务、解绑。' +
        '（开工时插件会自动绑定；这个工具用于事后补绑或核对。）',
      {
        action: { type: 'string', description: 'get / bind / unbind / list，默认 get。' },
        taskId: { type: 'string', description: '任务 guid（bind/unbind 必填）。' },
        sessionId: { type: 'string', description: '会话 id；bind 不填则用当前会话。' },
      },
      async (args, exec) => {
        const action = asString(args.action) || 'get'
        const current = asString(exec?.agent?.id)
        const state = engine.getState()

        if (action === 'list') {
          const agents = service(ctx, 'agents')
          const ids = []
          try {
            for (const agent of agents?.list?.() ?? []) if (agent?.id) ids.push(agent.id)
          } catch {
            /* 空列表 */
          }
          const bound = state.tasks.filter((task) => task.sessionId)
          const lines = [
            `运行中的会话 ${ids.length} 条：${ids.slice(0, 20).join(', ') || '（无）'}`,
            `已绑定的任务 ${bound.length} 条：`,
            ...bound.map((task) => `- ${task.title.slice(0, 30)} → ${task.sessionId}${ids.includes(task.sessionId) ? '（运行中）' : '（未运行）'}`),
          ]
          return lines.join('\n')
        }

        if (action === 'bind') {
          const taskId = asString(args.taskId)
          const sessionId = asString(args.sessionId) || current
          if (!taskId) return 'bind 需要 taskId（先用 feishu_tasks 查）。'
          if (!sessionId) return '拿不到当前会话 id，请显式传 sessionId。'
          const result = await engine.linkTask(taskId, sessionId, current && sessionId === current ? 'current' : 'manual')
          return result.ok
            ? `已绑定：${result.task.title.slice(0, 40)} ↔ ${sessionId}`
            : `绑定失败：${result.error}`
        }

        if (action === 'unbind') {
          const result = await engine.unlinkTask(asString(args.taskId))
          return result.ok ? `已解绑（原会话 ${result.previous}）` : `解绑失败：${result.error}`
        }

        const taskId = asString(args.taskId)
        if (taskId) {
          const task = state.tasks.find((item) => item.id === taskId)
          if (!task) return `本地快照里没有任务 ${taskId}。`
          return task.sessionId
            ? `${task.title.slice(0, 40)}\n会话：${task.sessionId}（${task.linkSource ?? 'unknown'}，${task.startedAt ? new Date(task.startedAt).toLocaleString() : '未知时间'}）`
            : `${task.title.slice(0, 40)}\n还没有绑定会话。`
        }
        const bound = state.tasks.filter((task) => task.sessionId)
        if (bound.length === 0) return '目前没有任务绑定会话。'
        return ['任务 ↔ 会话：', ...bound.map((task) => `- ${task.title.slice(0, 30)} → ${task.sessionId}`)].join('\n')
      },
    ),
  )

  register(
    textTool(
      'feishu_task_comment',
      '给一条飞书任务写评论（**写操作**，会真的发到飞书里，同事能看到）。' +
        '「开工」处理完一条任务后，用这个把结论写回去。id 必须是 feishu_tasks 返回过的任务 id。',
      {
        id: { type: 'string', description: '飞书任务 guid（feishu_tasks 的输出里有）。' },
        text: { type: 'string', description: '评论正文，纯文本。' },
      },
      async (args) => {
        const id = asString(args.id).trim()
        const text = asString(args.text).trim()
        if (!id || !text) return '需要 id 和 text 两个参数。'
        if (!engine.getState().tasks.some((task) => task.id === id)) {
          return `本地快照里没有这条任务（${id}）：先 feishu_sync 同步一次，或确认 id 抄对了。`
        }
        const path = resolveCli(engine.getSettings().cliPath)
        const result = await runCli(path, ['task', 'comment', id, text], { timeoutMs: 60_000 })
        return result.ok ? `已写入评论：${text.slice(0, 80)}` : `写评论失败：${(result.detail ?? '').slice(-400)}`
      },
    ),
  )

  register(
    textTool(
      'feishu_task_create',
      '把当前会话的工作整理成一条飞书任务（**写操作**）：标题/描述由你生成，创建后自动绑定到当前会话。' +
        '用户在面板上点「同步为飞书任务」时，你会收到整理指令，然后调用本工具。',
      {
        summary: { type: 'string', description: '任务标题，一句中文，不超过 30 字。' },
        description: { type: 'string', description: '任务描述：背景 / 本次改动 / 验证方式，纯文本。' },
      },
      async (args, exec) => {
        const current = asString(exec?.agent?.id)
        if (!current) return '只能从会话里调用（拿不到当前会话 id）。'
        const result = await engine.createTaskFromSession(current, {
          summary: asString(args.summary),
          description: asString(args.description),
        })
        if (!result.ok) return `创建失败：${result.error}`
        return `已创建并绑定：${result.title}（${result.taskId}）`
      },
    ),
  )

  register(
    textTool(
      'feishu_task_report',
      '把当前会话的结论回写到飞书任务：默认写在这条会话已绑定的任务上（评论），可选同时置完成。' +
        '用户说「把结果同步到飞书任务 / 这条做完了 / 写回飞书」时用它。不传 taskId 时用当前会话绑定的任务。',
      {
        summary: { type: 'string', description: '要写进评论的结论/进展（纯文本，建议 1-3 句）。' },
        complete: { type: 'boolean', description: '是否同时把飞书任务置为已完成，默认 false。' },
        taskId: { type: 'string', description: '指定任务 guid；默认取当前会话绑定的任务。' },
      },
      async (args, exec) => {
        const current = asString(exec?.agent?.id)
        let taskId = asString(args.taskId)
        if (!taskId && current) {
          const bound = engine.getState().tasks.find((task) => task.sessionId === current)
          if (bound) taskId = bound.id
        }
        if (!taskId) {
          return '当前会话没有绑定飞书任务：先把任务「开工（当前会话）」，或显式传 taskId。'
        }
        const result = await engine.reportTask(taskId, {
          text: asString(args.summary),
          complete: args.complete === true,
        })
        if (!result.ok) return `回写失败：${result.error}`
        return `已回写：${result.task.title.slice(0, 40)}${result.commented ? '（评论已写）' : ''}${
          result.completed ? '（已置完成）' : ''
        }`
      },
    ),
  )

  register(
    textTool(
      'feishu_task_doc',
      '把飞书文档绑定到一条任务（**写操作**，会写回飞书的「文档」字段）。' +
        '用户贴来一篇飞书文档说「把这个文档绑定到任务」时用它；action=unbind 解绑。',
      {
        taskId: { type: 'string', description: '任务 guid（先用 feishu_tasks 查）。' },
        url: { type: 'string', description: '飞书文档链接（docx / wiki / docs / sheets）。' },
        action: { type: 'string', description: 'bind（默认）或 unbind。' },
      },
      async (args) => {
        const taskId = asString(args.taskId)
        const url = asString(args.url)
        if (!taskId) return '需要 taskId：先用 feishu_tasks 查一遍任务，再传 guid。'
        const result = await engine.bindTaskDoc(taskId, url, { remove: asString(args.action) === 'unbind' })
        if (!result.ok) return `绑定失败：${result.error}`
        const docs = (result.docs || []).map((doc) => `- ${doc.title || doc.url}`).join('\n')
        return result.field.ok
          ? `已绑定并写回飞书「${result.docField}」字段：\n${docs || '（已清空）'}`
          : `已绑定本地，写回飞书失败（${result.field.error}）。文档列表：\n${docs}`
      },
    ),
  )


  return disposers
}

/* ─────────────────────────── 定时 ─────────────────────────── */

function installSchedule(ctx, engine) {
  let timer = null
  let disposed = false

  const tick = () => {
    if (disposed) return
    const settings = engine.getSettings()
    if (!settings.autoSync) return
    void engine.sync({ source: 'schedule' })
  }

  const arm = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    const settings = engine.getSettings()
    if (!settings.autoSync || disposed) return
    timer = setInterval(tick, settings.syncIntervalMinutes * 60_000)
    if (typeof timer.unref === 'function') timer.unref()
  }

  /* 「按时执行」要尽量准点：每 30 秒看一眼有没有到点的任务，有就立刻跑一次同步。
     比等 30 分钟一轮靠谱得多，也不需要给未来任务预建空会话。 */
  let lastTimerSync = 0
  let lastTitleSync = 0
  const dueTicker = setInterval(() => {
    if (disposed) return
    /* 会话改名 → 飞书任务改名：每 2 分钟扫一遍已绑定任务（和到点巡检共用这支定时器）。 */
    const settings = engine.getSettings()
    if (settings.autoSync && engine.getState().lastSyncAt && Date.now() - lastTitleSync > 120_000) {
      lastTitleSync = Date.now()
      void engine.syncSessionTitles().catch(() => undefined)
    }
    if (Date.now() - lastTimerSync < 45_000) return
    try {
      if (engine.dueScheduledNow()) {
        lastTimerSync = Date.now()
        void engine.sync({ source: 'timer' })
      }
    } catch {
      /* 巡检失败不影响主同步 */
    }
  }, 30_000)
  if (typeof dueTicker.unref === 'function') dueTicker.unref()

  // 首次同步由 rearm() 里的 tick() 触发（boot 完成后再调），此后按设置间隔。
  arm()

  return {
    rearm: () => {
      arm()
      const settings = engine.getSettings()
      if (settings.autoSync) tick()
    },
    dispose: () => {
      disposed = true
      clearInterval(dueTicker)
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}

/* ─────────────────────────── 入口 ─────────────────────────── */

export function apply(ctx, config = {}) {
  try {
    const engine = createSyncEngine(ctx)
    const schedule = installSchedule(ctx, engine)

    /* 「按需打开」的任务上下文提示：默认不挂，面板里打开开关才注入。
       只写一段很短的引导（几行），全量数据靠 feishu_task_detail 按需取。 */
    let disposeSection
    const syncTaskSection = () => {
      if (typeof disposeSection === 'function') {
        try {
          disposeSection()
        } catch {
          /* 卸载失败忽略 */
        }
        disposeSection = undefined
      }
      if (engine.getSettings?.()?.contextInjection !== true) return
      try {
        disposeSection = ctx.systemPrompt?.section?.({
          name: 'feishu:task-context',
          order: 160,
          text:
            '## 飞书任务上下文\n' +
            '本会话可能绑定了飞书任务。要拿任务的全部数据（状态、负责人、清单自定义字段、文档、评论、子任务、附件）时，' +
            '调用 `feishu_task_detail`（不传 taskId 就是当前会话绑定的那条）；不要凭记忆猜任务细节。\n',
        })
      } catch {
        /* 宿主没有 systemPrompt 服务就跳过 */
      }
    }
    engine.onSettingsChange?.(syncTaskSection)

    /* 插件卸载/热重载时要注销自己注册的东西：路由和工具都会返回 disposer，
       以前这里丢掉了它们，于是旧实例的 HTTP 路由一直挂在已失效的 fiber 上对外服务。 */
    const owned = []

    /**
     * 每个 turn 结束把进展写回任务评论（「会话有任何进展都同步到飞书」）。
     *
     * 宿主把会话事件统一从 `session/event` 发出来：`turn/start` → `assistant/message`
     * → `turn/end`。这里只缓存本轮的助手文本，到 `turn/end` 才写一条评论——
     * 一个 turn 里模型可能吐好几段，评论只该有一条。
     */
    const progressText = new Map()
    let warnedSessionShape = false
    const sessionIdOf = (session, event) =>
      asString(session?.id ?? session?.sessionId ?? session?.header?.id ?? event?.data?.sessionId)
    try {
      const disposeEvents = ctx.on('session/event', (session, event) => {
        try {
          const type = event?.type
          const sessionId = sessionIdOf(session, event)
          if (!sessionId) {
            if (!warnedSessionShape) {
              warnedSessionShape = true
              log(
                ctx,
                'warn',
                `[comment] 事件里没有会话 id，进度评论跳过（session keys=${session ? Object.keys(session).slice(0, 12).join(',') : 'null'}）`,
              )
            }
            return
          }
          if (type === 'turn/start') {
            progressText.delete(sessionId)
            return
          }
          if (type === 'assistant/message') {
            const blocks = event?.data?.message?.content ?? event?.data?.content ?? []
            const text = (Array.isArray(blocks) ? blocks : [])
              .filter((block) => block?.type === 'text' && typeof block.text === 'string')
              .map((block) => block.text)
              .join('\n')
              .trim()
            if (text) progressText.set(sessionId, text)
            return
          }
          if (type === 'turn/end') {
            const text = progressText.get(sessionId) ?? ''
            progressText.delete(sessionId)
            void engine
              .flushPendingProgress()
              .catch(() => undefined)
              .then(() =>
                engine.commentProgress(sessionId, text, {
                  failed: Boolean(event?.data?.reason),
                  reason: asString(event?.data?.reason),
                }),
              )
              .catch(() => undefined)
          }
        } catch {
          /* 事件处理不能往外抛 */
        }
      })
      if (typeof disposeEvents === 'function') owned.push(disposeEvents)
    } catch {
      /* 宿主不提供事件总线就当没有这个功能 */
    }



    const boot = async () => {
      await engine.load()
      if (config && Object.keys(config).length > 0) {
        await engine.saveSettings(config)
      }
      await engine.probeCli().catch(() => undefined)
      syncTaskSection()
      // 启动时顺手体检一次授权：面板一打开就该知道「能用」还是「该去授权」。
      void engine.checkAuth().catch(() => undefined)
      const disposeRoutes = mountRoutes(ctx, engine)
      if (typeof disposeRoutes === 'function') owned.push(disposeRoutes)
      for (const disposeTool of registerTools(ctx, engine)) owned.push(disposeTool)
      schedule.rearm()
    }

    ctx.effect(() => {
      void boot().catch((error) => {
        log(ctx, 'error', `初始化失败（已忽略）：${error instanceof Error ? error.stack ?? error.message : String(error)}`)
      })
      return () => {
        while (owned.length > 0) {
          const dispose = owned.pop()
          try {
            dispose?.()
          } catch {
            /* 注销失败不该阻塞卸载 */
          }
        }
        schedule.dispose()
        if (typeof disposeSection === 'function') {
          try {
            disposeSection()
          } catch {
            /* 忽略 */
          }
        }
      }
    })
  } catch (error) {
    // 加载期失败只降级，不炸宿主。
    try {
      ctx.logger('feishu').error(`插件初始化失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    } catch {
      // eslint-disable-next-line no-console
      console.error('[dsh-feishu] 初始化失败：', error)
    }
  }
}
