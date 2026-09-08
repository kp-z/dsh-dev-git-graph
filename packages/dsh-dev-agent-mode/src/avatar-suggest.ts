/**
 * dsh-dev-agent-mode —— avatar-suggest host 路由：
 *
 * POST /dsh-dev-agent-mode/api/avatar-suggest
 *   body:   { prompt: string }
 *   200:    { dataUrl: string, promptEcho: string }
 *   400:    { error: 'bad-prompt' }          —— prompt 缺失/过长
 *   503:    { error: 'no-model' }            —— 用户未配置默认模型 / llm 服务不可用
 *   429:    { error: 'rate-limited' }        —— 上游限流（透传）
 *   502:    { error: 'llm-failed' }          —— LLM 调用失败 / 超时
 *   413:    { error: 'too-large' }           —— 生成 SVG 超过大小硬顶
 *   422:    { error: 'no-svg' }              —— 模型输出里提取不到合法 SVG
 *
 * 路线说明：DSH 自带的 DeepSeek 适配器是 text-only（无文生位图模型），故采用
 * 「文生 SVG」：让默认文本模型直接输出 64x64 viewBox 的 SVG 代码，做白名单净化
 * 后转 data:image/svg+xml dataURL。SVG 天然小（一般 <5KB），远低于 200KB 存储上限。
 */
import type http from 'node:http';
import type { Context } from '@deepseek-ai/cordis';

/** dataURL 硬顶：与客户端 avatar-store MAX_IMAGE_DATA_URL 对齐（留净化后富余）。 */
export const MAX_SVG_TEXT_LEN = 150_000;
const MAX_PROMPT_LEN = 400;
const LLM_TIMEOUT_MS = 30_000;
const ROUTE_PATH = '/dsh-dev-agent-mode/api/avatar-suggest';

export interface WebServerLike {
	register(spec: {
		kind: 'exact' | 'prefix';
		path: string;
		handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
	}): () => void;
}

/** 最小化依赖面（便于单测 mock）。 */
export interface AvatarSuggestServices {
	webServer: WebServerLike;
	/** 无 llm 服务时为 null（路由降级 503）。 */
	streamText: ((options: {
		provider: string;
		model: string;
		system: string;
		prompt: string;
		signal: AbortSignal;
	}) => Promise<string>) | null;
	/** 无默认模型配置时为 null。 */
	currentSelection: (() => { provider: string; model: string } | null) | null;
}

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
	res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
	res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage, limit = 16_384): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on('data', (c: Buffer) => {
			size += c.length;
			if (size > limit) {
				reject(new Error('body-too-large'));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on('end', () => {
			try {
				resolve(chunks.length > 0 ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {});
			} catch (e) {
				reject(e);
			}
		});
		req.on('error', reject);
	});
}

/**
 * SVG 白名单净化：只放通图形元素与安全的呈现属性。
 * 拒绝：script/foreignObject/image/use/事件属性/一切 href 与外部 url()/CSS import。
 * 用字符串 tokenizer + 栈式重建，不引入 DOM 依赖（host 环境无 DOM）。
 */
const ALLOWED_TAGS = new Set([
	'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line',
	'defs', 'linearGradient', 'radialGradient', 'stop',
]);
const ALLOWED_ATTRS = new Set([
	// 几何
	'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
	'width', 'height', 'd', 'points', 'transform', 'viewBox',
	// 呈现
	'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
	'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule',
	'offset', 'stop-color', 'stop-opacity',
	'gradientUnits', 'gradientTransform', 'spreadMethod', 'id',
	// svg 根元素必需（data:image/svg+xml 渲染要求）
	'xmlns',
]);

function sanitizeAttrValue(name: string, value: string): string | null {
	// 去掉控制字符与危险协议
	const v = value.replace(/[\u0000-\u001f<>]/g, '');
	if ((name === 'fill' || name === 'stroke') && /url\s*\(\s*['"]?\s*(?!#)/i.test(v)) return null; // 外部 url()
	if (/https?:|data:|javascript:|@import/i.test(v)) return null;
	return v;
}

export function sanitizeSvg(raw: string): string | null {
	// 提取首个 <svg ...>...</svg>
	const start = raw.indexOf('<svg');
	const end = raw.lastIndexOf('</svg>');
	if (start < 0 || end < 0 || end <= start) return null;
	const src = raw.slice(start, end + '</svg>'.length);
	if (src.length > MAX_SVG_TEXT_LEN * 2) return null; // 输入异常大直接拒

	const tokenRe = /<!--[^]*?-->|<\/?([A-Za-z][A-Za-z0-9:_-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+)/g;
	const out: string[] = [];
	const stack: string[] = [];
	let hasViewBox = false;
	let m: RegExpExecArray | null;
	tokenRe.lastIndex = 0;
	while ((m = tokenRe.exec(src)) !== null) {
		const tagName = m[1];
		if (tagName === undefined) continue; // 纯文本节点丢弃（防注入）
		const tag: string = tagName;
		if (!ALLOWED_TAGS.has(tag)) continue; // 非白名单标签整体丢弃（含子树由栈自然消化）
		const isClosing = m[0][1] === '/';
		const selfClosing = /\/\s*>$/.test(m[0]);
		if (isClosing) {
			if (stack.length > 0 && stack[stack.length - 1] === tag) {
				stack.pop();
				out.push(`</${tag}>`);
			}
			continue;
		}
		// 开始标签：过滤属性
		const attrSrc = m[2] ?? '';
		const attrRe = /([A-Za-z][A-Za-z0-9:_-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
		const attrs: string[] = [];
		let am: RegExpExecArray | null;
		while ((am = attrRe.exec(attrSrc)) !== null) {
			const name = am[1];
			if (name === undefined) continue;
			// 事件属性、href 类一律拒
			if (/^on/i.test(name) || name === 'href' || name === 'xlink:href') continue;
			if (!ALLOWED_ATTRS.has(name)) continue;
			const rawVal = am[3] ?? am[4] ?? '';
			const clean = sanitizeAttrValue(name, rawVal);
			if (clean === null) continue;
			attrs.push(`${name}="${clean}"`);
		}
		if (tag === 'svg') {
			if (attrs.some((a) => a.startsWith('viewBox='))) hasViewBox = true;
			if (!hasViewBox) {
				attrs.push('viewBox="0 0 64 64"');
				hasViewBox = true;
			}
			// data:image/svg+xml 渲染要求 xmlns
			if (!attrs.some((a) => a.startsWith('xmlns='))) {
				attrs.push('xmlns="http://www.w3.org/2000/svg"');
			}
		}
		const open = `<${tag}${attrs.length > 0 ? ' ' + attrs.join(' ') : ''}${selfClosing ? '/' : ''}>`;
		out.push(open);
		if (!selfClosing) stack.push(tag);
	}
	// 闭合未闭合标签
	while (stack.length > 0) out.push(`</${stack.pop()}>`);
	const svg = out.join('');
	if (!svg.startsWith('<svg')) return null;
	// 至少要有一个图形元素才算可用
	if (!/<(path|circle|ellipse|rect|polygon|polyline|line)[\s/>]/.test(svg)) return null;
	if (svg.length > MAX_SVG_TEXT_LEN) return null;
	return svg;
}

function svgToDataUrl(svg: string): string {
	// utf8 编码 dataURL（SVG 均为 ASCII/UTF-8 文本）
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildSystemPrompt(): string {
	return [
		'You generate a single avatar image as inline SVG for a 64x64 round avatar.',
		'Rules:',
		'- Output ONLY the SVG markup, one <svg> element, nothing else (no prose, no code fences).',
		'- Root element must be <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">.',
		'- Design reads well at 16-48px: bold simple shapes, flat colors, high contrast.',
		'- Use only these elements: svg, g, path, circle, ellipse, rect, polygon, polyline, line, defs, linearGradient, radialGradient, stop.',
		'- Never use <script>, <foreignObject>, <image>, <text>, external refs, href, event handlers.',
		'- Center the subject; it will be clipped to a circle. Full-bleed background encouraged.',
	].join('\n');
}

export function registerAvatarSuggestRoutes(services: AvatarSuggestServices): Array<() => void> {
	const disposer = services.webServer.register({
		kind: 'exact',
		path: ROUTE_PATH,
		handler: (req, res) => {
			if (req.method !== 'POST') {
				res.writeHead(405, { allow: 'POST' });
				res.end();
				return;
			}
			void handle(services, req, res).catch(() => {
				if (!res.headersSent) sendJson(res, 500, { error: 'internal' });
			});
		},
	});
	return [disposer];
}

async function handle(services: AvatarSuggestServices, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
	let body: Record<string, unknown>;
	try {
		body = await readBody(req);
	} catch {
		sendJson(res, 400, { error: 'bad-prompt' });
		return;
	}
	const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
	if (prompt.length === 0 || prompt.length > MAX_PROMPT_LEN) {
		sendJson(res, 400, { error: 'bad-prompt' });
		return;
	}
	// 服务降级
	if (services.streamText === null || services.currentSelection === null) {
		sendJson(res, 503, { error: 'no-model' });
		return;
	}
	const selection = services.currentSelection();
	if (selection === null || !selection.provider || !selection.model) {
		sendJson(res, 503, { error: 'no-model' });
		return;
	}

	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);
	let raw: string;
	try {
		raw = await services.streamText({
			provider: selection.provider,
			model: selection.model,
			system: buildSystemPrompt(),
			prompt: `Avatar description: ${prompt}`,
			signal: ac.signal,
		});
	} catch (e) {
		const msg = String(e instanceof Error ? e.message : e);
		if (/rate.?limit|quota|429/i.test(msg)) sendJson(res, 429, { error: 'rate-limited' });
		else sendJson(res, 502, { error: 'llm-failed' });
		return;
	} finally {
		clearTimeout(timer);
	}

	const svg = sanitizeSvg(raw);
	if (svg === null) {
		sendJson(res, 422, { error: 'no-svg' });
		return;
	}
	const dataUrl = svgToDataUrl(svg);
	if (dataUrl.length > MAX_SVG_TEXT_LEN) {
		sendJson(res, 413, { error: 'too-large' });
		return;
	}
	sendJson(res, 200, { dataUrl, promptEcho: prompt });
}

/**
 * 从真实 cordis ctx 装配服务。软依赖：缺 llm / agentDefaultModel 时降级为 503 路由，
 * 不阻塞插件加载（预选/上传路径仍可用）。
 */
export function mountAvatarSuggest(ctx: Context): Array<() => void> {
	let webServer: WebServerLike | null = null;
	try {
		webServer = ctx.get('webServer') as unknown as WebServerLike;
	} catch {
		webServer = null;
	}
	if (webServer === null) return [];

	// llm 服务（dsh-llm）：把流聚合成纯文本
	let streamText: AvatarSuggestServices['streamText'] = null;
	try {
		const llm = ctx.get('llm') as unknown as {
			stream(options: unknown): AsyncIterable<{ type: string; text?: string }>;
		};
		streamText = async ({ provider, model, system, prompt, signal }) => {
			const chunks: string[] = [];
			for await (const chunk of llm.stream({
				provider,
				model,
				system,
				messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
			})) {
				if (signal.aborted) {
					throw new Error('aborted');
				}
				if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
					chunks.push(chunk.text);
				}
			}
			if (chunks.length === 0) throw new Error('empty-response');
			return chunks.join('');
		};
	} catch {
		streamText = null;
	}

	// 默认模型（dsh-agent-default-model）
	let currentSelection: AvatarSuggestServices['currentSelection'] = null;
	try {
		const adm = ctx.get('agentDefaultModel') as unknown as {
			currentSelection(): { provider: string; model: string; reasoningEffort?: string };
		};
		currentSelection = () => {
			try {
				const sel = adm.currentSelection();
				if (!sel || !sel.provider || !sel.model) return null;
				return { provider: sel.provider, model: sel.model };
			} catch {
				return null;
			}
		};
	} catch {
		currentSelection = null;
	}

	return registerAvatarSuggestRoutes({ webServer, streamText, currentSelection });
}
