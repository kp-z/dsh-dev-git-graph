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
import { mountRoutes } from '../lib/api.js'
import { resolveConfig } from '../lib/config.js'
import { DailyService } from '../lib/service.js'
import { localDate } from '../lib/store.js'

const args = process.argv.slice(2)
const noRefresh = args.includes('--no-refresh')
const portArg = args.indexOf('--port')
const port = portArg >= 0 ? Number(args[portArg + 1]) : 8799
/**
 * `--ai-fake`：打开 AI 摘要并注入一个**假 stream**。
 *
 * 为什么需要它：真实模型调用要花 token、还依赖密钥，而 UI 上"✨ 按钮能不能出现、
 * 摘要渲染成什么样、失败提示长什么样"这些是要天天看的。假 stream 让这条链路可以
 * 零成本反复验证，且输出可控（能刻意造出"部分失败"来看提示条）。
 */
const aiFake = args.includes('--ai-fake')

const config = resolveConfig({
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

if (aiFake) {
	let n = 0
	service.setLlm(
		() => ({
			async *[Symbol.asyncIterator]() {
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

const server = http.createServer((req, res) => {
	for (const route of webServer.routes) {
		const url = new URL(req.url ?? '/', 'http://localhost')
		const matches = route.kind === 'prefix' ? url.pathname.startsWith(route.path) : url.pathname === route.path
		if (matches) {
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
