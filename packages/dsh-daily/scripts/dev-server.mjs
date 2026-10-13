/**
 * 本地联调服务器 —— 不开 DSH，直接跑插件自己的业务层与 HTTP 层。
 *
 *   node scripts/dev-server.mjs              # 用今天已有的数据（没有就先抓一轮）
 *   node scripts/dev-server.mjs --no-refresh # 只用已有数据，绝不联网
 *   node scripts/dev-server.mjs --port 8799
 *
 * 为什么值得单独做这件事：插件最终是一个"host 路由 + 侧边栏 iframe"的组合，
 * 而真实 GUI 里的验证成本很高（要装进 profile、要重启）。这个脚本把**同一个**
 * mountRoutes 挂到一个裸 http server 上，于是页面、接口、数据三者可以在浏览器里
 * 直接联调，改一行 CSS 刷新就能看到。装进 profile 前的所有 UI 迭代都走这条路。
 */
import http from 'node:http'
import { parseArgs, toNumber } from './args.mjs'
import { MOUNT, mountRoutes } from '../lib/api.js'
import { resolveConfig } from '../lib/config.js'
import { DailyService } from '../lib/service.js'
import { localDate } from '../lib/store.js'

const args = process.argv.slice(2)
// 参数解析走 scripts/args.mjs：**两种写法都认**（`--port 8799` 与 `--port=8799`），
// 且**不认识的参数直接报错**。改这个的起因是一个真实事故：
// 我用 `--port=8971` 起服务时它被静默忽略、回落到 8799，而脚本一直轮询 8971 →
// 冒烟必然失败，日志里却明明写着 8799。宁可起不来，也不要"起来了但配置没生效"。
const HAS_FAIL_API = args.some((a) => a.startsWith('--fail-api'))
const parsed = parseArgs(args, {
	flags: ['no-refresh', 'ai-fake', ...(HAS_FAIL_API ? ['fail-api'] : [])],
	values: ['port', 'data-dir', 'seed-history'],
})
const noRefresh = parsed.values['no-refresh'] === true
const aiFakeFlag = parsed.values['ai-fake'] === true
const port = toNumber(parsed.values.port, 'port', parsed.errors, { min: 1, max: 65535 }) ?? 8799
const dataDirValue = typeof parsed.values['data-dir'] === 'string' ? parsed.values['data-dir'] : ''
const seedDaysValue =
	toNumber(parsed.values['seed-history'], 'seed-history', parsed.errors, { min: 0, max: 365 }) ?? 0
if (parsed.errors.length > 0) {
	console.error('参数有问题（不会静默忽略）：')
	for (const message of parsed.errors) console.error(`  - ${message}`)
	console.error('')
	console.error(
		'用法：node scripts/dev-server.mjs [--port 8799 | --port=8799] [--data-dir=DIR] [--seed-history=N] [--ai-fake] [--no-refresh]',
	)
	process.exit(2)
}
/**
 * `--ai-fake`：打开 AI 摘要并注入一个**假 stream**。
 *
 * 为什么需要它：真实模型调用要花 token、还依赖密钥，而 UI 上"✨ 按钮能不能出现、
 * 摘要渲染成什么样、失败提示长什么样"这些是要天天看的。假 stream 让这条链路可以
 * 零成本反复验证，且输出可控（能刻意造出"部分失败"来看提示条）。
 */
const aiFake = aiFakeFlag

/**
 * `--data-dir=<path>`：指向一个临时数据目录。
 * `--seed-history=N`：把今天的落盘数据复制成 N 个过去的日子。
 *
 * 这两个开关是为了**验证跨天 UI（按天翻阅 / 周报）而不用等好几天**，
 * 而且不会污染 `~/.dsh/daily` —— 归档相关的界面状态（日期条、回到今天、
 * 历史态禁用刷新）只有多天数据时才看得到。
 */
const dataDir = dataDirValue
const seedDays = seedDaysValue

const config = resolveConfig({
	dataDir,
	...(aiFake
		? {
				aiSummaryEnabled: true,
				aiSummaryProvider: 'fake',
				aiSummaryModel: 'fake-dev-model',
				aiSummaryMaxItems: 6,
				aiSummaryConcurrency: 2,
			}
		: {}),
})
const log = (level) => (message) => console.log(`[${level}] ${message}`)
const service = new DailyService(config, {
	info: log('info'),
	warn: log('warn'),
	error: log('error'),
})

await service.init()
// 跑一次项目自动识别：真实入口（index.ts 的 bootstrap）会做这件事，而 dev-server 之前不做，
// 于是 `/api/state` 里永远没有 `project.detect` —— 巡检脚本因此报"诊断字段缺失"。
// 让 dev-server 走同一条路径，联调环境才和真实宿主**行为一致**（这也是巡检能发现的问题）。
try {
	const detected = await service.autoDetect()
	console.log(`项目识别：${detected.changed ? `已切到 ${detected.dir}` : detected.reason}`)
} catch (error) {
	console.log(`项目识别失败（不影响联调）：${error instanceof Error ? error.message : String(error)}`)
}

if (seedDays > 0) {
	const { writeFile, readFile } = await import('node:fs/promises')
	const { shiftDate } = await import('../lib/rank.js')
	const { localDate: currentDate } = await import('../lib/store.js')
	// 这里不能用文件后面那个 `today`：它在 TDZ 里（这里还在它声明之前）
	const seedToday = currentDate()
	const source = await readFile(service.store.dayFile(seedToday), 'utf8').catch(() => null)
	if (!source) {
		console.log('[warn] --seed-history 需要当天已有落盘数据，先跑一次抓取')
	} else {
		for (let i = 1; i <= seedDays; i++) {
			const date = shiftDate(seedToday, -i)
			if (await service.store.readText(service.store.dayFile(date))) continue
			const day = JSON.parse(source)
			day.date = date
			// 每天留一部分、去掉一部分：让"条数不同"这件事在界面/周报里看得出来
			day.items = day.items.filter((_, index) => index % (i + 1) !== 0)
			day.lastRefresh = null
			await writeFile(service.store.dayFile(date), JSON.stringify(day) + '\n')
		}
		console.log(`[info] 已播种 ${seedDays} 天历史数据（仅用于联调，位于 ${service.store.dir}）`)
	}
}

if (aiFake) {
	let n = 0
	service.setLlm(
		(request) => ({
			async *[Symbol.asyncIterator]() {
				// **按提示词分流**：调研检索词要的是 JSON 数组，摘要要的是一句话。
				// 不分开的话，联调时检索词永远走不到 AI 路径（假 stream 只会返回摘要文本 → 解析失败 → 降级）
				const system = String(request?.system ?? '')
				// 介绍类请求：要求"一句中文介绍" → 回一个 JSON 字符串数组（与检索词请求同形但内容不同）
				const asksForIntros = /中文介绍|结果卡片/.test(system)
				if (asksForIntros) {
					const lines = String(request?.messages?.[0]?.content ?? '')
						.split('\n')
						.filter((line) => /^\d+\. 标题：/.test(line.trim()))
					const payload = lines.map((line, i) => `（假）第 ${i + 1} 条的中文介绍：${line.replace(/^\s*\d+\. 标题：/, '').slice(0, 24)}`)
					yield { type: 'text-delta', text: JSON.stringify(payload) }
					yield { type: 'finish', reason: { kind: 'stop' } }
					return
				}
				const asksForQueries = /检索词/.test(system)
				if (asksForQueries) {
					const payload = [
						'（假）react 19 迁移注意事项',
						'（假）zustand v5 破坏性变更',
						'（假）vite 6 环境变量约定',
					]
					yield { type: 'text-delta', text: JSON.stringify(payload) }
					yield { type: 'finish', reason: { kind: 'stop' } }
					return
				}
				n += 1
				// 第 3 条刻意失败：用来验证"部分失败"的提示条长什么样
				if (n === 3) {
					yield { type: 'finish', reason: { kind: 'max-tokens' } }
					return
				}
				yield { type: 'text-delta', text: `（假摘要 #${n}）一条用于联调的中文一句话摘要。` }
				yield { type: 'finish', reason: { kind: 'stop' } }
			},
		}),
		() => null,
	)
	console.log('[info] AI 摘要：已启用假 stream（--ai-fake），不会调用真实模型')
}

const today = localDate()
let day = await service.getDay()
if (day.items.length === 0 && !noRefresh) {
	console.log('今天还没有数据，先抓一轮（可能要几十秒）……')
	const summary = await service.refresh()
	console.log(`抓取完成：${summary.total} 条 / ${summary.okSources} 源正常 / ${summary.durationMs}ms`)
} else {
	console.log(`今天已有 ${day.items.length} 条数据（${today}）`)
	// 数据在但从没生成过日报时补一份，方便验证 digest 接口
	const digest = await service.store.readDigest(today)
	if (digest === null && day.items.length > 0) await service.rebuildDigest(today)
}

const webServer = {
	routes: [],
	register(spec) {
		this.routes.push(spec)
		return () => {
			const index = this.routes.indexOf(spec)
			if (index >= 0) this.routes.splice(index, 1)
		}
	},
}

mountRoutes(webServer, service)

/**
 * `--fail-api=state,items`：让指定的 API 返回 503。
 *
 * 为什么要有故障注入：页面的**错误态**（红条文案、是否可重试、会不会把页面卡死）
 * 是用户真正会遇到的状态之一，但正常开发流程里几乎无法自然触发 ——
 * 不注入故障就只能靠"看代码觉得没问题"。这是唯一能真的把它验一遍的办法。
 */
const failArg = args.find((a) => a.startsWith('--fail-api='))
const failApis = (failArg ? failArg.slice('--fail-api='.length) : '')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean)

const server = http.createServer((req, res) => {
	for (const route of webServer.routes) {
		const url = new URL(req.url ?? '/', 'http://localhost')
		const matches = route.kind === 'prefix' ? url.pathname.startsWith(route.path) : url.pathname === route.path
		if (matches) {
			const apiName = url.pathname.startsWith(MOUNT + '/api/') ? url.pathname.slice((MOUNT + '/api/').length) : ''
			if (apiName && failApis.includes(apiName)) {
				res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
				res.end(JSON.stringify({ ok: false, error: '注入的故障（--fail-api）' }))
				return
			}
			route.handler(req, res)
			return
		}
	}
	res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
	res.end('404')
})

server.listen(port, '127.0.0.1', () => {
	console.log(`\n日报联调服务器：http://127.0.0.1:${port}/dsh-daily/`)
	console.log(`接口示例：http://127.0.0.1:${port}/dsh-daily/api/state`)
	console.log('Ctrl+C 退出。\n')
})
