import type { Context } from '@deepseek-ai/cordis'
import type { DailyService } from './service.js'

/**
 * systemPrompt 注入 —— 「主动推荐」的机制所在。
 *
 * 需求是"每日主动给我推荐"，而不是"我问了才答"。做法是把当天日报的**紧凑摘要**
 * 注册成 systemPrompt 的一个 section：模型每一轮都能看到"今天有这些值得看的"，
 * 于是它会在合适的时机自己提起，而不是等用户问。
 *
 * 两个必须守住的点：
 * 1. **section 的 text 是同步求值的**（`string | (ctx) => string`），而日报要从磁盘读。
 *    所以这里维护一份内存缓存，由 service 的变更事件驱动刷新 —— 绝不能在 text 里做 I/O。
 * 2. **省 token**：这段文本每一轮模型请求都要重发。默认只带 6 条标题（约 200 token），
 *    完整索引留给侧边栏。宁可少说，也不能让用户为了一个日报付出每轮的上下文成本。
 *
 * 注册失败（比如宿主版本的 systemPrompt 契约不同）只降级、不抛 ——
 * 丢了注入只是少了个提醒，插件本身还能用；抛出去却会让整个 profile 加载失败。
 */

const SECTION_NAME = 'dsh-daily-brief'
/**
 * 排序值刻意取一个偏大的奇数：日报是"补充信息"，应该排在身份/工具/工作区这些
 * 结构性 prompt 之后。取特殊值也是为了尽量不跟其它插件的 section 撞 order
 * （同一层里 order 冲突会抛）。
 */
const SECTION_ORDER = 641

interface SystemPromptLike {
	section(section: {
		name: string
		order: number
		text: string | ((context: unknown) => string)
	}): () => void
}

export interface PromptSectionOptions {
	maxItems: number
	logger?: { warn(message: string): void }
	/**
	 * 每次渲染 section 时被调用，带上**宿主给的装配上下文**。
	 *
	 * 这个回调是项目自动识别的主入口：它每一轮都会响，而上下文里带的是
	 * **当前会话**（含 cwd）—— 比"启动时读一次工作区列表"准确得多。
	 * 实现里必须同步、极轻、且绝不抛（渲染失败会让整段 prompt 出问题）。
	 */
	onRender?: (context: unknown) => void
}

export function installPromptSection(
	ctx: Context,
	service: DailyService,
	options: PromptSectionOptions,
): () => void {
	const state = { text: '' }
	let disposed = false

	const refresh = async (): Promise<void> => {
		if (disposed) return
		try {
			const brief = await service.briefNow(options.maxItems)
			state.text = brief ?? ''
		} catch (error) {
			// 读盘失败不该让 prompt 组装挂掉；清空即可
			state.text = ''
			options.logger?.warn(
				`日报摘要生成失败：${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	void refresh()
	const unsubscribe = service.subscribe(() => {
		void refresh()
	})

	let disposeSection: (() => void) | undefined
	try {
		const systemPrompt = (ctx as unknown as { systemPrompt?: SystemPromptLike }).systemPrompt
		if (systemPrompt && typeof systemPrompt.section === 'function') {
			disposeSection = systemPrompt.section({
				name: SECTION_NAME,
				order: SECTION_ORDER,
				text: (context: unknown) => {
					// 顺手把宿主上下文交给自动识别；**包起来**是因为这里抛异常会污染 prompt 装配
					try {
						options.onRender?.(context)
					} catch {
						/* 识别失败与"日报注入"无关，绝不影响 */
					}
					return state.text
				},
			})
		} else {
			options.logger?.warn('宿主没有提供 systemPrompt.section，日报不会主动注入到对话里。')
		}
	} catch (error) {
		options.logger?.warn(
			`注册日报 prompt section 失败（已跳过注入）：${error instanceof Error ? error.message : String(error)}`,
		)
	}

	return () => {
		disposed = true
		unsubscribe()
		disposeSection?.()
	}
}
