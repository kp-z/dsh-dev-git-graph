import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { PLATFORM_LABEL } from './catalog.js'
import type { DailyService } from './service.js'
import { humanAge, statsText } from './render.js'
import { expandHome, localDate } from './store.js'
import type { Item } from './types.js'

/**
 * 模型可见的工具集。设计原则：
 *
 * 1. **每个工具都说明副作用**（是否联网、是否写盘），模型才知道什么时候敢调。
 * 2. **写操作都要能被复述**：调教返回"改了哪几项"、反馈返回"现在是什么状态"，
 *    模型可以直接把这句话转述给用户，不需要自己猜。
 * 3. **只读工具与写工具分开**：`daily_brief` / `daily_digest` / `daily_search` 是只读的，
 *    `daily_refresh` / `daily_tune` / `daily_feedback` 会写盘或联网。
 */

function formatItem(item: Item, index: number, now: Date): string {
	const badges = [PLATFORM_LABEL[item.platform], item.sourceName, item.author, humanAge(item.publishedAt, now)]
		.filter(Boolean)
		.join(' · ')
	const heat = statsText(item)
	const lines = [`${index + 1}. ${item.title}`]
	lines.push(`   ${badges}${heat ? ` · ${heat}` : ''}${item.duration ? ` · ${item.duration}` : ''}`)
	lines.push(`   ${item.url}`)
	if (item.summary) lines.push(`   ${item.summary.slice(0, 140)}`)
	if (item.reasons.length > 0) lines.push(`   推荐理由：${item.reasons.join(' · ')}`)
	lines.push(`   id=${item.id} · 主题=${item.topic} · 分数=${item.score}${item.read ? ' · 已读' : ''}`)
	return lines.join('\n')
}

export function registerDailyTools(ctx: Context, service: DailyService): void {
	const now = () => new Date()

	ctx.tools.register(
		defineTool({
			name: 'daily_brief',
			description:
				'取今日日报（只读，不联网）。返回按主题分组的推荐条目，含标题、来源、时间、热度、推荐理由与条目 id。' +
				'用户问「今天有什么值得看的 / 有什么新闻 / 日报里有什么」时用它，不要凭记忆编内容。' +
				'如果返回为空，说明今天还没采集，改用 daily_refresh。',
			parameters: {
				topic: { type: 'string', description: '只看某个主题，例如 AI / 开源 / 学术。留空为全部主题。' },
				limit: { type: 'number', description: '最多返回多少条，默认 15，上限 60。' },
				unreadOnly: { type: 'boolean', description: '只返回未读条目，默认 false。' },
			},
			output: {
				schema: { type: 'string' },
				render: (_args, value) => [{ type: 'text', text: value }],
			},
			async execute(args) {
				const limit = Math.max(1, Math.min(60, args.limit ?? 15))
				const payload = await service.getItems({
					topic: args.topic,
					unread: args.unreadOnly === true,
					limit,
				})
				if (payload.items.length === 0) {
					const day = await service.getDay()
					if (day.items.length === 0) {
						return '今天还没有采集到任何条目。调用 daily_refresh 立刻抓一轮，或者稍等每日定时任务。'
					}
					return `当前筛选下没有条目（今天共 ${payload.total} 条）。`
				}
				const head = `今日日报 ${payload.date}：共 ${payload.total} 条，下面是最值得看的 ${payload.items.length} 条。`
				const body = payload.items.map((item, i) => formatItem(item, i, now())).join('\n\n')
				return `${head}\n\n${body}`
			},
		}),
	)

	ctx.tools.register(
		defineTool({
			name: 'daily_digest',
			description:
				'读取某一天的完整 Markdown 日报（只读）。日报文件落在 ~/.dsh/daily/digest/<date>.md。' +
				'需要把日报整篇引用、导出、或发给别人时用它。指定日期当天没生成时会就地生成一份。',
			parameters: {
				date: { type: 'string', description: 'YYYY-MM-DD，默认今天。' },
			},
			output: {
				schema: { type: 'string' },
				render: (_args, value) => [{ type: 'text', text: value }],
			},
			async execute(args) {
				const date = args.date?.trim() || localDate()
				const existing = await service.store.readDigest(date)
				if (existing) return existing
				const day = await service.getDay(date)
				if (day.items.length === 0) {
					return `${date} 没有数据，也就没有日报。可以 daily_refresh 抓今天的。`
				}
				return await service.rebuildDigest(date)
			},
		}),
	)

	ctx.tools.register(
		defineTool({
			name: 'daily_search',
			description:
				'在最近若干天的日报索引里检索（只读）。按标题、摘要、来源、作者匹配，返回带链接与 id 的条目。' +
				'适合回答「上周有没有关于 xxx 的东西」「我前几天看到的那个 B 站视频」。',
			parameters: {
				query: { type: 'string', required: true, description: '检索词。' },
				days: { type: 'number', description: '往前查几天，默认 7，上限 60。' },
				limit: { type: 'number', description: '最多返回几条，默认 20，上限 60。' },
			},
			output: {
				schema: { type: 'string' },
				render: (_args, value) => [{ type: 'text', text: value }],
			},
			async execute(args) {
				const query = args.query.trim().toLowerCase()
				if (!query) return '检索词为空。'
				const days = Math.max(1, Math.min(60, args.days ?? 7))
				const limit = Math.max(1, Math.min(60, args.limit ?? 20))
				const all = await service.store.listDays()
				const targets = all.slice(-days).reverse()
				const hits: Array<{ date: string; item: Item }> = []
				for (const date of targets) {
					const day = await service.getDay(date)
					for (const item of day.items) {
						const haystack = `${item.title} ${item.summary ?? ''} ${item.sourceName} ${item.author ?? ''}`.toLowerCase()
						if (haystack.includes(query)) hits.push({ date, item })
						if (hits.length >= limit) break
					}
					if (hits.length >= limit) break
				}
				if (hits.length === 0) {
					return `最近 ${targets.length} 天里没有匹配「${args.query}」的条目。`
				}
				const lines = hits.map(
					(hit, i) =>
						`${i + 1}. [${hit.date}] ${hit.item.title}\n   ${hit.item.url}\n   ${PLATFORM_LABEL[hit.item.platform]} · ${hit.item.sourceName}${hit.item.summary ? `\n   ${hit.item.summary.slice(0, 120)}` : ''}`,
				)
				return `在最近 ${targets.length} 天里匹配「${args.query}」的条目（${hits.length} 条）：\n\n${lines.join('\n\n')}`
			},
		}),
	)

	ctx.tools.register(
		defineTool({
			name: 'daily_tune',
			description:
				'用一句自然语言调整日报的推荐偏好（会写盘 ~/.dsh/daily/prefs.json，并立即对当天条目重新排序）。' +
				'例如「以后每天多推 AI Agent 相关的，少推币圈」「屏蔽某某话题」「少推哔哩哔哩」。' +
				'生效范围是这台机器上的日报插件，不是当前会话。' +
				'当你发现用户的意图规则解析器可能读不懂时（很口语、很长），先直接调用本工具把原话记下来，' +
				'再按你的理解追加一次更结构化的调用。',
			parameters: {
				instruction: { type: 'string', required: true, description: '用户的原始调教语句。' },
			},
			output: {
				schema: { type: 'string' },
				render: (_args, value) => [{ type: 'text', text: value }],
			},
			async execute(args) {
				const result = await service.tune(args.instruction)
				const changes = result.applied.map((c) => `- ${c.detail}`).join('\n')
				const prefs = result.prefs
				return [
					result.message,
					changes ? `改动清单：\n${changes}` : '（没有可执行改动）',
					'',
					`当前偏好：主题=${prefs.topics.join('/') || '未设置'} · 关键词=${prefs.keywords.map((k) => `${k.word}(${k.weight})`).join('/') || '无'} · 屏蔽词=${prefs.blocked.join('/') || '无'} · 每日上限=${prefs.dailyQuota}`,
				].join('\n')
			},
		}),
	)

	ctx.tools.register(
		defineTool({
			name: 'daily_sources',
			description:
				'查看日报的采集源清单与最近一轮的运行状态（只读）。' +
				'每个源会显示是否正常、抓到多少条、失败原因。排查「为什么没有 YouTube 条目」时先看它。',
			parameters: {},
			output: {
				schema: { type: 'string' },
				render: (_args, value) => [{ type: 'text', text: value }],
			},
			async execute() {
				const [state, catalog] = [await service.getState(), service.sourceCatalogView()]
				const statusById = new Map(state.sources.map((s) => [s.id, s]))
				const lines = catalog.map((source) => {
					const status = statusById.get(source.id)
					if (!status) return `⏸ ${source.name}（${source.id}）· 本轮未运行`
					const icon = status.ok ? '✅' : '❌'
					return `${icon} ${source.name}（${source.id}）· ${status.ok ? `${status.count} 条` : '失败'}${status.error ? ` · ${status.error}` : ''} · ${status.durationMs}ms`
				})
				const extra = statusById.get('extra')
				if (extra) {
					lines.push(
						`${extra.ok ? '✅' : '❌'} 自定义 RSS 源 · ${extra.ok ? `${extra.count} 条` : '失败'}${extra.error ? ` · ${extra.error}` : ''}`,
					)
				}
				const last = state.lastRefresh
				const head = last
					? `最近一轮：${last.at} · ${last.total} 条 · ${last.okSources}/${state.sources.length} 源正常 · 耗时 ${last.durationMs}ms`
					: '还没有跑过任何一轮采集。'
				return `${head}\n\n${lines.join('\n')}`
			},
		}),
	)

	ctx.tools.register(
		defineTool({
			name: 'daily_feedback',
			description:
				'给某条日报条目打反馈（会写盘，影响后续排序）。' +
				'action=like 表示「有意思」会提权，dislike 表示「少推这类」会降权，read 标记已读，hide 从推荐列表移除。',
			parameters: {
				id: { type: 'string', required: true, description: '条目 id（daily_brief / daily_search 的返回值里有）。' },
				action: {
					type: 'string',
					required: true,
					description: 'read | unread | like | dislike | hide | unhide | clear',
				},
			},
			output: {
				schema: { type: 'string' },
				render: (_args, value) => [{ type: 'text', text: value }],
			},
			async execute(args) {
				const allowed = ['read', 'unread', 'like', 'dislike', 'hide', 'unhide', 'clear']
				if (!allowed.includes(args.action)) {
					throw new Error(`未知的 action：${args.action}（可用：${allowed.join(' | ')}）`)
				}
				await service.setFeedback(args.id, args.action)
				return `已记录：条目 ${args.id} → ${args.action}。排序会在下一次刷新或调教时体现。`
			},
		}),
	)

	ctx.tools.register(
		defineTool({
			name: 'daily_opml',
			description:
				'导入或导出 OPML 订阅列表（import **会写盘**，export 可选写文件）。' +
				'import：从文件路径或直接给的 XML 导入订阅源，按 URL 去重，**下一次刷新即生效**（不需改配置）。' +
				'export：把内置源 + 自定义源导出成 OPML，便于带到别的阅读器。',
			parameters: {
				action: {
					type: 'string',
					required: true,
					description: 'import | export',
				},
				path: {
					type: 'string',
					description: 'import 时读这个文件（支持 ~/）；export 时把结果写到这里（不写则直接返回内容）。',
				},
				xml: { type: 'string', description: 'import 时可直接给 OPML 文本（与 path 二选一，path 优先）。' },
			},
			output: {
				schema: { type: 'string' },
				render: (_args, value) => [{ type: 'text', text: value }],
			},
			async execute(args) {
				const action = (args.action || '').trim()
				if (action === 'import') {
					let xml = args.xml ?? ''
					if (args.path) {
						const { readFile } = await import('node:fs/promises')
						try {
							xml = await readFile(expandHome(args.path.trim()), 'utf8')
						} catch (error) {
							throw new Error(
								`读不到 OPML 文件：${args.path}（${error instanceof Error ? error.message : String(error)}）`,
							)
						}
					}
					if (!xml.trim()) throw new Error('需要 path 或 xml 之一')
					const result = await service.importOpml(xml)
					if (result.parsed === 0) {
						return `没有从这份 OPML 里解析出任何订阅源（分类节点 ${result.categories} 个）。请确认文件是 OPML 而不是收藏夹 HTML。`
					}
					return [
						`OPML 导入完成${result.title ? `（${result.title}）` : ''}：`,
						`- 解析出订阅源 ${result.parsed} 条（分类节点 ${result.categories} 个，跳过 ${result.skipped} 条不合法地址）`,
						`- 新增 ${result.added} 条 · 已存在跳过 ${result.duplicated} 条`,
						`- 当前自定义源合计 ${result.total} 条`,
						result.addedNames.length > 0
							? `- 新增的：${result.addedNames.slice(0, 12).join(' / ')}${result.addedNames.length > 12 ? ` …（共 ${result.addedNames.length} 条）` : ''}`
							: '',
						'下一次 daily_refresh 就会抓这些源。',
					]
						.filter(Boolean)
						.join('\n')
				}
				if (action === 'export') {
					const { xml, count } = await service.exportOpml()
					if (args.path) {
						const { writeFile } = await import('node:fs/promises')
						await writeFile(expandHome(args.path.trim()), xml, 'utf8')
						return `已导出 ${count} 个订阅源到 ${args.path}。`
					}
					return `已导出 ${count} 个订阅源：\n\n${xml}`
				}
				throw new Error(`未知的 action：${args.action}（可用：import | export）`)
			},
		}),
	)

	ctx.tools.register(
		defineTool({
			name: 'daily_weekly',
			description:
				'生成日报周报（**会写盘** ~/.dsh/daily/digest/week-<起>_<止>.md，并返回全文）。' +
				'汇总最近 N 天（默认 7）的索引：跨天最值得看的、主题分布、每天条数与未读、采集源健康。' +
				'适合回答「这周有什么变化」「我这周都在看什么方向」「哪天是不是没抓到」。',
			parameters: {
				end: { type: 'string', description: '截止日期 YYYY-MM-DD，默认今天。' },
				days: { type: 'number', description: '往前汇总几天，默认 7，上限 31。' },
				path: { type: 'string', description: '另存一份到这个路径（支持 ~/）；不填则只落在数据目录。' },
			},
			output: {
				schema: { type: 'string' },
				render: (_args, value) => [{ type: 'text', text: value }],
			},
			async execute(args) {
				const days = typeof args.days === 'number' ? Math.min(31, Math.max(1, args.days)) : 7
				const review = await service.buildWeeklyReview(args.end?.trim() || undefined, days)
				if (review.items === 0) {
					return `${review.start} ~ ${review.end} 这 ${days} 天里没有任何落盘数据，周报是空的。先 daily_refresh 抓一轮。`
				}
				if (args.path) {
					const { writeFile } = await import('node:fs/promises')
					await writeFile(expandHome(args.path.trim()), review.markdown, 'utf8')
				}
				const head = `周报已生成：${review.start} ~ ${review.end} · ${review.days} 天有数据 · 共 ${review.items} 条 · 落盘 digest/${review.name}${
					args.path ? ` · 另存到 ${args.path}` : ''
				}\n\n`
				return head + review.markdown
			},
		}),
	)

	ctx.tools.register(
		defineTool({
			name: 'daily_prune',
			description:
				'查看日报归档的磁盘占用，并（可选）把旧归档压缩成索引。**默认只预览、不写盘**；' +
				'只有显式传 apply=true 才真的动文件。' +
				'超过 archiveCompactAfterDays（默认 60）天的归档会被压成索引（丢摘要/热度，保留标题/链接/主题/分数）；' +
				'若配置了 archiveDeleteAfterDays（默认 0=永不删），更早的整天文件会被删除。',
			parameters: {
				apply: {
					type: 'boolean',
					description: 'true 才真的执行压缩/删除；省略或 false 只返回"会做什么"的预览。',
				},
			},
			output: {
				schema: { type: 'string' },
				render: (_args, value) => [{ type: 'text', text: value }],
			},
			async execute(args) {
				const apply = args.apply === true
				const report = await service.pruneArchive({ apply })
				const s = report.stats
				const lines = [
					`归档现状：${s.days} 天 · ${s.items} 条索引 · 最老 ${s.oldest ?? '—'} · 最新 ${s.newest ?? '—'}`,
					`磁盘占用：${s.totalLabel}（数据 ${Math.round(s.dayBytes / 1024)}KB + 日报/周报 ${s.digests} 份 ${Math.round(s.digestBytes / 1024)}KB）` +
						(s.compactedDays > 0 ? ` · 已有 ${s.compactedDays} 天被压缩过` : ''),
					'',
					apply ? '已执行整理：' : '预览（未写盘）：',
					`- 保留 ${report.keep} 天 · 压缩 ${report.compacted} 天 · 删除 ${report.deleted} 天 · 预计释放 ${Math.round(report.freedBytes / 1024)}KB`,
				]
				if (report.changes.length > 0) {
					const shown = report.changes.slice(0, 8)
					lines.push(
						`- 涉及日期：${shown.map((c) => `${c.date}(${c.action === 'delete' ? '删' : '压'})`).join(' ')}` +
							(report.changes.length > shown.length ? ` …共 ${report.changes.length} 天` : ''),
					)
				}
				if (!apply && (report.compacted > 0 || report.deleted > 0)) {
					lines.push('', '要真的执行，请用 daily_prune({ apply: true })。')
				}
				if (!apply && report.compacted === 0 && report.deleted === 0) {
					lines.push('', '当前没有需要整理的归档。')
				}
				return lines.join('\n')
			},
		}),
	)

	ctx.tools.register(
		defineTool({
			name: 'daily_refresh',
			description:
				'立刻抓一轮所有采集源并重排（**会联网**，通常 5~20 秒，偶发源会失败但不会中断）。' +
				'抓完会同步更新当天的 Markdown 日报。用户说「刷新一下日报」「现在抓一下」时用它。',
			parameters: {},
			output: {
				schema: { type: 'string' },
				render: (_args, value) => [{ type: 'text', text: value }],
			},
			async execute(_args, exec) {
				const summary = await service.refresh(
					exec?.signal ? { signal: exec.signal } : {},
				)
				const state = await service.getState()
				const failed = state.sources.filter((s) => !s.ok)
				return [
					`刷新完成：${summary.total} 条（新增 ${summary.added}）· ${summary.okSources}/${state.sources.length} 源正常 · 耗时 ${summary.durationMs}ms。`,
					failed.length > 0
						? `失败源：\n${failed.map((s) => `- ${s.name}：${s.error ?? '未知'}`).join('\n')}`
						: '所有源都正常。',
					'侧边栏「日报」tab 已经是最新数据。',
				].join('\n')
			},
		}),
	)
}
