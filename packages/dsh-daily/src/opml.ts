/**
 * OPML 导入 / 导出。
 *
 * 为什么值得做：用户多半已经在别的阅读器里订阅了几十个源。让他一条条把 URL 抄进配置，
 * 是这个插件最可能被放弃的一步。有了 OPML，"换过来"就是选一个文件。
 *
 * 实现取舍：**不引入 XML 库，也不复用 RSS 解析器**。
 * OPML 的形状比 RSS 简单得多（就是嵌套的 `<outline>`），而且几乎全是机器生成的，
 * 不会出现 RSS 里那些"CDATA 里嵌 HTML、命名空间前缀满天飞"的畸形输入。
 * 所以这里用一个直白的标签扫描器，把复杂度压在 200 行以内，并且**全部可测**。
 */

export interface OpmlFeed {
	/** 条目显示名。取 `text` → `title` → host。 */
	name: string
	/** 订阅地址（必需）。 */
	url: string
	/** 来源网页（可选，仅用于展示）。 */
	htmlUrl?: string
	/** 所属分类：最近的一层**不带 xmlUrl 的**祖先 outline 的 text。 */
	category?: string
}

export interface OpmlParseResult {
	/** `<head><title>` 里的标题。 */
	title: string | null
	feeds: OpmlFeed[]
	/** 有 outline 但没有 xmlUrl 的（纯分类节点）数量，用于给用户一个"读到了什么"的交代。 */
	categories: number
	/** 被跳过的（缺 xmlUrl、或 url 明显不合法）。 */
	skipped: number
}

const ENTITY_MAP: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
}

/**
 * 实体解码：命名实体 + 十进制 + 十六进制。
 *
 * 注意**只解一层**：`&amp;lt;` 必须解成 `&lt;` 而不是 `<`。
 * 做法是单趟扫描（边扫边拼），而不是反复 replace —— 后者天然会解多层。
 */
export function decodeEntities(input: string): string {
	if (!input.includes('&')) return input
	let out = ''
	let i = 0
	while (i < input.length) {
		const amp = input.indexOf('&', i)
		if (amp < 0) {
			out += input.slice(i)
			break
		}
		out += input.slice(i, amp)
		const semi = input.indexOf(';', amp + 1)
		// 分号太远就不当成实体（避免把整段文本吞掉）
		if (semi < 0 || semi - amp > 12) {
			out += '&'
			i = amp + 1
			continue
		}
		const body = input.slice(amp + 1, semi)
		let decoded: string | null = null
		if (body.startsWith('#x') || body.startsWith('#X')) {
			const code = Number.parseInt(body.slice(2), 16)
			if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) decoded = String.fromCodePoint(code)
		} else if (body.startsWith('#')) {
			const code = Number.parseInt(body.slice(1), 10)
			if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) decoded = String.fromCodePoint(code)
		} else if (Object.prototype.hasOwnProperty.call(ENTITY_MAP, body)) {
			decoded = ENTITY_MAP[body] ?? null
		}
		if (decoded === null) {
			// 认不出来就原样保留（包括那个 &）
			out += input.slice(amp, semi + 1)
		} else {
			out += decoded
		}
		i = semi + 1
	}
	return out
}

/** XML 文本 / 属性值转义。导出时用。 */
export function escapeXml(input: string): string {
	return input
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

/** 从一段标签文本里取出所有属性。属性顺序、单双引号、无引号值都要能处理。 */
export function parseAttributes(tagBody: string): Record<string, string> {
	const attrs: Record<string, string> = {}
	const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
	let match: RegExpExecArray | null
	while ((match = re.exec(tagBody)) !== null) {
		const name = (match[1] ?? '').toLowerCase()
		const value = match[2] ?? match[3] ?? match[4] ?? ''
		attrs[name] = decodeEntities(value).trim()
	}
	return attrs
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '')
	} catch {
		return url
	}
}

/** 看起来像不像一个可以订阅的地址。故意宽松：http/https 即可，剩下交给抓取时报错。 */
export function isHttpUrl(url: string): boolean {
	return /^https?:\/\/\S+$/i.test((url ?? '').trim())
}

/**
 * 解析 OPML。
 *
 * 嵌套用栈处理：只有**带 xmlUrl 的** outline 才是订阅源；
 * 不带 xmlUrl 的 outline 当作分类，它的 text 会成为其后代订阅源的 category。
 * 这样 `<outline text="技术"><outline xmlUrl="…"/></outline>` 能正确归到"技术"。
 */
export function parseOpml(xml: string): OpmlParseResult {
	const feeds: OpmlFeed[] = []
	let title: string | null = null
	let categories = 0
	let skipped = 0

	if (!xml || typeof xml !== 'string') return { title, feeds, categories, skipped }

	// head/title：允许 title 出现在任意位置，但只取第一个
	const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(xml)
	if (titleMatch?.[1]) {
		const decoded = decodeEntities(titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim()
		if (decoded) title = decoded
	}

	// 用栈追踪分类上下文。tag 扫描只认 <outline …> / </outline> / <outline … />
	const tagRe = /<\s*(\/?)\s*outline\b([^>]*?)(\/?)\s*>/gi
	const stack: Array<{ text: string; isFeed: boolean }> = []
	let match: RegExpExecArray | null

	while ((match = tagRe.exec(xml)) !== null) {
		const closing = match[1] === '/'
		const selfClosing = match[3] === '/'
		const body = match[2] ?? ''

		if (closing) {
			stack.pop()
			continue
		}

		const attrs = parseAttributes(body)
		const url = (attrs.xmlurl ?? attrs.url ?? '').trim()
		const text = attrs.text || attrs.title || ''

		if (url) {
			if (!isHttpUrl(url)) {
				skipped++
			} else {
				// 分类 = 栈里最近的一个"非订阅"节点
				let category: string | undefined
				for (let i = stack.length - 1; i >= 0; i--) {
					const node = stack[i]
					if (node && !node.isFeed && node.text) {
						category = node.text
						break
					}
				}
				feeds.push({
					name: text || hostOf(url),
					url,
					...(attrs.htmlurl ? { htmlUrl: attrs.htmlurl } : {}),
					...(category ? { category } : {}),
				})
			}
		} else {
			categories++
		}

		if (!selfClosing) stack.push({ text, isFeed: Boolean(url) })
	}

	return { title, feeds, categories, skipped }
}

export interface OpmlExportOptions {
	feeds: readonly OpmlFeed[]
	title?: string
	/** 生成时间（ISO）。测试里可注入。 */
	createdAt?: string
}

/** 生成 OPML 2.0。按 category 分组嵌套 —— 这样导出的文件在别的阅读器里也是可读的。 */
export function serializeOpml(options: OpmlExportOptions): string {
	const title = options.title || 'dsh-daily 订阅源'
	const createdAt = options.createdAt ?? new Date().toISOString()
	const groups = new Map<string, OpmlFeed[]>()
	for (const feed of options.feeds) {
		const key = feed.category?.trim() || ''
		const bucket = groups.get(key)
		if (bucket) bucket.push(feed)
		else groups.set(key, [feed])
	}

	const lines: string[] = []
	lines.push('<?xml version="1.0" encoding="UTF-8"?>')
	lines.push('<opml version="2.0">')
	lines.push('  <head>')
	lines.push(`    <title>${escapeXml(title)}</title>`)
	lines.push(`    <dateCreated>${escapeXml(createdAt)}</dateCreated>`)
	lines.push('  </head>')
	lines.push('  <body>')

	const outline = (feed: OpmlFeed, indent: string): string => {
		const parts = [
			`type="rss"`,
			`text="${escapeXml(feed.name)}"`,
			`title="${escapeXml(feed.name)}"`,
		]
		if (feed.htmlUrl) parts.push(`htmlUrl="${escapeXml(feed.htmlUrl)}"`)
		parts.push(`xmlUrl="${escapeXml(feed.url)}"`)
		return `${indent}<outline ${parts.join(' ')} />`
	}

	// 无分类的排前面
	for (const [category, feeds] of groups) {
		if (!category) {
			for (const feed of feeds) lines.push(outline(feed, '    '))
		}
	}
	for (const [category, feeds] of groups) {
		if (!category) continue
		lines.push(`    <outline text="${escapeXml(category)}" title="${escapeXml(category)}">`)
		for (const feed of feeds) lines.push(outline(feed, '      '))
		lines.push('    </outline>')
	}

	lines.push('  </body>')
	lines.push('</opml>')
	return `${lines.join('\n')}\n`
}

/**
 * 把 OPML 里的源合并进现有列表。
 *
 * 三条语义：
 * 1. **按规范化 URL 去重** —— 同一条订阅导入两次不该出现两行（`?utm_source=` 这类也不该绕过去）。
 * 2. **`reserved` 里的 URL 视为已存在** —— 内置源（少数派 / IT之家 / Solidot / 阮一峰）虽然不在
 *    这个数组里，但它们已经在抓了；用户的 OPML 里若也有，就该跳过，否则同一份内容会被抓两次。
 * 3. **已存在的不覆盖** —— 用户手动改过的名字比 OPML 里的更可信。
 */
export interface MergeResult {
	feeds: string[]
	added: number
	duplicated: number
	/** 新增条目的名字，用于给用户一个可核对的清单。 */
	addedNames: string[]
}

export function mergeFeedSpecs(
	existing: readonly string[],
	incoming: readonly OpmlFeed[],
	normalize: (url: string) => string,
	defaultTopic = '热点',
	reserved: readonly string[] = [],
): MergeResult {
	const seen = new Map<string, string>()
	const remember = (spec: string): void => {
		const url = spec.split('|')[1]
		if (!url) return
		seen.set(normalize(url.trim()), spec)
	}
	for (const spec of existing) remember(spec)
	// 记下但**不输出**：内置源只用来判重
	for (const spec of reserved) remember(spec)

	const out = [...existing]
	let added = 0
	let duplicated = 0
	const addedNames: string[] = []

	for (const feed of incoming) {
		const key = normalize(feed.url)
		if (seen.has(key)) {
			duplicated++
			continue
		}
		const topic = (feed.category || defaultTopic).replace(/\|/g, ' ').trim() || defaultTopic
		const name = (feed.name || feed.url).replace(/\|/g, ' ').trim() || feed.url
		const spec = `${name}|${feed.url.trim()}|${topic}`
		seen.set(key, spec)
		out.push(spec)
		added++
		addedNames.push(name)
	}

	return { feeds: out, added, duplicated, addedNames }
}

/** 把 `名称|URL|主题` 编码还原成 OpmlFeed，供导出用。 */
export function specToFeed(spec: string): OpmlFeed | null {
	const parts = spec.split('|')
	const name = (parts[0] ?? '').trim()
	const url = (parts[1] ?? '').trim()
	if (!isHttpUrl(url)) return null
	const topic = (parts[2] ?? '').trim()
	return {
		name: name || hostOf(url),
		url,
		...(topic ? { category: topic } : {}),
	}
}
