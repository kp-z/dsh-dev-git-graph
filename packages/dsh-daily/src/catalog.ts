import type { ItemKind, Platform } from './types.js'

/** 一个采集源的静态描述。运行时的成功/失败状态另存在 DayState.sources 里。 */
export interface SourceDef {
	id: string
	name: string
	kind: ItemKind
	/** 该源默认归入的主题。自动分类命中关键词时会覆盖它。 */
	topic: string
	/** 人类可读的来源说明，失败排查时有用。 */
	homepage: string
}

/**
 * 内置源目录。
 *
 * 这份清单是按**本机实测可达性**筛出来的（2026-10-12）：
 * 直连 YouTube / Google News / HuggingFace / GitHub Trending HTML 全部不通，
 * 所以 YouTube 走 RSSHub 镜像池，GitHub 走 Search API，英文社区热度走 HN。
 */
export const SOURCE_CATALOG: SourceDef[] = [
	{
		id: 'hn',
		name: 'Hacker News',
		kind: 'web',
		topic: '技术',
		homepage: 'https://news.ycombinator.com',
	},
	{
		id: 'arxiv',
		name: 'arXiv',
		kind: 'web',
		topic: '学术',
		homepage: 'https://arxiv.org',
	},
	{
		id: 'github',
		name: 'GitHub 新晋热门',
		kind: 'web',
		topic: '开源',
		homepage: 'https://github.com',
	},
	{
		id: 'youtube',
		name: 'YouTube',
		kind: 'video',
		topic: 'AI',
		homepage: 'https://www.youtube.com',
	},
	{
		id: 'bilibili-popular',
		name: '哔哩哔哩·热门',
		kind: 'video',
		topic: '热点',
		homepage: 'https://www.bilibili.com',
	},
	{
		id: 'bilibili-ranking',
		name: '哔哩哔哩·排行榜',
		kind: 'video',
		topic: '热点',
		homepage: 'https://www.bilibili.com',
	},
	{
		id: 'sspai',
		name: '少数派',
		kind: 'web',
		topic: '效率',
		homepage: 'https://sspai.com',
	},
	{
		id: 'ithome',
		name: 'IT之家',
		kind: 'web',
		topic: '技术',
		homepage: 'https://www.ithome.com',
	},
	{
		id: 'solidot',
		name: 'Solidot',
		kind: 'web',
		topic: '技术',
		homepage: 'https://www.solidot.org',
	},
	{
		id: 'ruanyifeng',
		name: '阮一峰的网络日志',
		kind: 'web',
		topic: '技术',
		homepage: 'https://www.ruanyifeng.com/blog/',
	},
]

export const SOURCE_MAP: Map<string, SourceDef> = new Map(
	SOURCE_CATALOG.map((s) => [s.id, s]),
)

/**
 * 主题词典 —— 自动分类的唯一依据。
 *
 * 顺序**有意义**：靠前的主题先匹配，命中即返回。所以把"AI"放在最前面：
 * 一条讲 AI 的文章往往同时命中"技术"和"AI"，我们要的是 AI。
 */
export const TOPIC_KEYWORDS: Array<{ topic: string; words: string[] }> = [
	{
		topic: 'AI',
		words: [
			'ai', '人工智能', '大模型', '大语言模型', 'llm', 'gpt', 'chatgpt', 'claude',
			'gemini', 'copilot', 'agent', '智能体', '机器学习', '深度学习', '神经网络',
			'transformer', 'diffusion', '多模态', 'multimodal', 'openai', 'anthropic',
			'deepseek', 'qwen', 'llama', 'mistral', '推理', 'inference', 'rag',
			'embedding', '微调', 'fine-tune', '强化学习', 'rlhf', 'prompt', 'token',
			'具身智能', '世界模型', 'mcp', 'aigc', '文生图', '文生视频',
		],
	},
	{
		topic: '开源',
		words: [
			'开源', 'open source', 'oss', 'github', '仓库', 'repo', 'star', 'fork',
			'apache', 'mit license', 'maintainer', '贡献者',
		],
	},
	{
		topic: '学术',
		words: [
			'arxiv', '论文', 'paper', 'preprint', '研究', '学术', 'benchmark', '基准',
			'数据集', 'dataset', 'sota', '会议', 'neurips', 'icml', 'cvpr', 'acl',
			'nature', 'science', '引文', '同行评审',
		],
	},
	{
		topic: '硬件',
		words: [
			'芯片', 'chip', 'gpu', '显卡', 'nvidia', '英伟达', 'amd', 'intel', 'arm',
			'处理器', '手机', 'iphone', 'android', '苹果', '华为', '高通', '台积电',
			'内存', 'ssd', '服务器', '数据中心', '算力',
		],
	},
	{
		topic: '商业',
		words: [
			'融资', '收购', '上市', 'ipo', '财报', '营收', '估值', '创业', '独角兽',
			'裁员', '监管', '反垄断', '营收',
		],
	},
	{
		topic: '效率',
		words: [
			'效率', '工具', '工具链', '工作流', 'workflow', '教程', '指南', '技巧',
			'实践', '最佳实践', '自动化', '快捷键', '笔记', '知识管理',
		],
	},
	{
		topic: '技术',
		words: [
			'编程', '代码', '语言', 'rust', 'python', 'typescript', 'javascript', 'go ',
			'java', 'c++', '数据库', 'sql', '架构', '编译', '内核', 'linux', '浏览器',
			'前端', '后端', '分布式', '性能', '调试', '容器', 'kubernetes', 'docker',
			'协议', '网络安全', '漏洞', '加密', '算法', '数据结构', 'api',
		],
	},
]

/** 兜底主题。分类全都落空时的归宿，前端固定把它排最后。 */
export const FALLBACK_TOPIC = '热点'

/** 平台 → 前端徽标语义。 */
export const PLATFORM_LABEL: Record<Platform, string> = {
	web: '网页',
	rss: 'RSS',
	hackernews: 'HN',
	arxiv: 'arXiv',
	github: 'GitHub',
	youtube: 'YouTube',
	bilibili: '哔哩哔哩',
}
