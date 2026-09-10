/**
 * dsh-dev-agent-mode —— agent 档案存储（host 端）。
 *
 * 存储位置：~/.dsh/storages/agents.json（仿 DSH 官方 workspace.json 版本化格式）
 *   {
 *     "unit": { "name": "agents", "version": 1 },
 *     "tables": {
 *       "agents": { "<workspaceId>": AgentProfile, ... }
 *     }
 *   }
 * AgentProfile 面向未来扩展：persona / memoryRef 预留字段（当前为 null），
 * 后续可接入人设、记忆空间等更长远的 agent 能力。
 *
 * API：
 *   GET  /dsh-dev-agent-mode/api/agents        → { unit, tables } 全部档案
 *   GET  /dsh-dev-agent-mode/api/agents/:id    → 单个 AgentProfile（404 若不存在）
 *   PUT  /dsh-dev-agent-mode/api/agents/:id    → upsert { name?, avatarSpec? }（部分更新）
 *   DELETE /dsh-dev-agent-mode/api/agents/:id  → 删除（204）
 *
 * Agent 名默认生成：动漫角色风确定性词池（fnv1a(workspaceId) 选词），
 * 同一 workspace 恒定同名；用户可通过 PUT name 覆盖。
 */
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { Context } from '@deepseek-ai/cordis';

export const AGENTS_API_BASE = '/dsh-dev-agent-mode/api/agents';

/** 单个 agent 档案（未来扩展：persona / memoryRef）。 */
export interface AgentProfile {
	/** workspaceId（主键）。 */
	workspaceId: string;
	/** Agent 名（默认动漫词池生成，用户可改）。 */
	name: string;
	/** 头像偏好（复用现有 avatar spec：color/image/emoji）。 */
	avatarSpec: Record<string, unknown> | null;
	/** 预留：人设/角色描述（未来）。 */
	persona: string | null;
	/** 预留：记忆空间引用（未来）。 */
	memoryRef: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface AgentStoreFile {
	unit: { name: 'agents'; version: 1 };
	tables: { agents: Record<string, AgentProfile> };
}

export interface WebServerLike {
	register(spec: {
		kind: 'exact' | 'prefix';
		path: string;
		handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
	}): () => void;
}

export interface AgentsStoreServices {
	webServer: WebServerLike;
	/** 存储文件路径（默认 ~/.dsh/storages/agents.json；测试可注入）。 */
	filePath?: string;
	/** 读底层 JSON（测试可注入）。 */
	readFile?: () => Promise<AgentStoreFile>;
	/** 写底层 JSON（测试可注入）。 */
	writeFile?: (data: AgentStoreFile) => Promise<void>;
}

// ---------- 动漫角色风词池（确定性选词） ----------
const NAME_ADJECTIVES = ['赤焰', '银翼', '翠岚', '霜华', '琥珀', '琉璃', '紫电', '星辉', '墨羽', '沧澜', '曜日', '玄冰', '绯云', '青鸾', '金乌', '皓月'];
const NAME_ROLES = ['剑客', '精灵', '术士', '骑士', '猎手', '贤者', '游侠', '法师', '使者', '行者', '守卫', '学者', '歌者', '画师', '工匠', '武士'];

/** 与 client 端一致的 fnv1a 哈希（保证同一 workspace 名恒定）。 */
export function fnv1a(str: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = (h * 0x01000193) >>> 0;
	}
	return h >>> 0;
}

/** 动漫角色风确定性命名：workspaceId -> 「形容词 + 角色」组合。 */
export function defaultAgentName(workspaceId: string): string {
	const h = fnv1a(String(workspaceId || ''));
	const adj = NAME_ADJECTIVES[h % NAME_ADJECTIVES.length] ?? '星辉';
	const role = NAME_ROLES[Math.floor(h / NAME_ADJECTIVES.length) % NAME_ROLES.length] ?? '游侠';
	return adj + role;
}

// ---------- 存储读写 ----------
/** 与官方 @deepseek-ai/dsh-home-paths 同语义：DSH_HOME 环境变量优先，否则 ~/.dsh。 */
function resolveDshHome(): string {
	const env = typeof process !== 'undefined' ? process.env.DSH_HOME : undefined;
	if (env && env.length > 0) return env;
	return join(homedir(), '.dsh');
}

function defaultFilePath(): string {
	return join(resolveDshHome(), 'storages', 'agents.json');
}

function emptyStore(): AgentStoreFile {
	return { unit: { name: 'agents', version: 1 }, tables: { agents: {} } };
}

function isAgentProfile(v: unknown): v is AgentProfile {
	if (v === null || typeof v !== 'object') return false;
	const o = v as Record<string, unknown>;
	return typeof o.workspaceId === 'string' && typeof o.name === 'string';
}

function normalizeFile(raw: unknown): AgentStoreFile {
	const out = emptyStore();
	if (raw === null || typeof raw !== 'object') return out;
	const obj = raw as Record<string, unknown>;
	const tables = obj.tables as Record<string, unknown> | undefined;
	const agents = tables && typeof tables === 'object' ? (tables as Record<string, unknown>).agents : undefined;
	if (agents && typeof agents === 'object') {
		for (const [id, p] of Object.entries(agents as Record<string, unknown>)) {
			if (!isAgentProfile(p)) continue;
			out.tables.agents[id] = {
				workspaceId: p.workspaceId,
				name: p.name,
				avatarSpec: p.avatarSpec ?? null,
				persona: typeof p.persona === 'string' ? p.persona : null,
				memoryRef: typeof p.memoryRef === 'string' ? p.memoryRef : null,
				createdAt: p.createdAt,
				updatedAt: p.updatedAt,
			};
		}
	}
	return out;
}

async function readStore(services: AgentsStoreServices): Promise<AgentStoreFile> {
	if (services.readFile) return normalizeFile(await services.readFile());
	const filePath = services.filePath ?? defaultFilePath();
	try {
		const raw = await fs.readFile(filePath, 'utf8');
		return normalizeFile(JSON.parse(raw));
	} catch {
		return emptyStore();
	}
}

async function writeStore(services: AgentsStoreServices, data: AgentStoreFile): Promise<void> {
	if (services.writeFile) {
		await services.writeFile(data);
		return;
	}
	const filePath = services.filePath ?? defaultFilePath();
	await fs.mkdir(dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ---------- 路由 ----------
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

/** 从请求路径提取 ID 后的剩余段（用于区分 GET /agents 与 GET /agents/:id）。 */
function pathSegments(url: string | undefined, prefix: string): string[] {
	if (!url) return [];
	const rest = url.slice(prefix.length);
	return rest.split('/').filter((s) => s.length > 0).map((s) => {
		try { return decodeURIComponent(s); } catch { return s; }
	});
}

export function registerAgentsRoutes(services: AgentsStoreServices): Array<() => void> {
	const disposers: Array<() => void> = [];

	disposers.push(services.webServer.register({
		kind: 'prefix',
		path: AGENTS_API_BASE,
		handler: (req, res) => {
			void handleAgents(services, req, res).catch(() => {
				if (!res.headersSent) sendJson(res, 500, { error: 'internal' });
			});
		},
	}));

	return disposers;
}

async function handleAgents(services: AgentsStoreServices, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
	const segments = pathSegments(req.url, AGENTS_API_BASE);
	const id = segments[0] ?? null;
	const method = req.method ?? 'GET';

	// GET /api/agents —— 全部档案
	if (method === 'GET' && id === null) {
		const store = await readStore(services);
		sendJson(res, 200, store);
		return;
	}

	if (id === null) {
		// 无 id 的其它方法
		if (method === 'POST') {
			// 预留：批量/创建（当前不支持，返回 501）
			sendJson(res, 501, { error: 'unsupported' });
			return;
		}
		sendJson(res, 405, { error: 'method-not-allowed' });
		return;
	}

	// 单个档案路由
	switch (method) {
		case 'GET': {
			const store = await readStore(services);
			const profile = store.tables.agents[id];
			if (!profile) {
				sendJson(res, 404, { error: 'not-found' });
				return;
			}
			sendJson(res, 200, profile);
			return;
		}
		case 'PUT': {
			let body: Record<string, unknown>;
			try {
				body = await readBody(req);
			} catch {
				sendJson(res, 400, { error: 'bad-body' });
				return;
			}
			if (body === null || typeof body !== 'object' || Array.isArray(body)) {
				sendJson(res, 400, { error: 'bad-body' });
				return;
			}
			const store = await readStore(services);
			const now = new Date().toISOString();
			const existing = store.tables.agents[id];
			// name 校验：字符串且 ≤60 字符；avatarSpec：对象或 null
			let name = existing ? existing.name : defaultAgentName(id);
			if (typeof body.name === 'string') {
				const n = body.name.trim();
				if (n.length === 0 || n.length > 60) {
					sendJson(res, 400, { error: 'bad-name' });
					return;
				}
				name = n;
			} else if (body.name !== undefined && body.name !== null) {
				sendJson(res, 400, { error: 'bad-name' });
				return;
			}
			let avatarSpec: Record<string, unknown> | null = existing ? existing.avatarSpec : null;
			if (body.avatarSpec !== undefined) {
				if (body.avatarSpec === null) avatarSpec = null;
				else if (typeof body.avatarSpec === 'object' && !Array.isArray(body.avatarSpec)) avatarSpec = body.avatarSpec as Record<string, unknown>;
				else {
					sendJson(res, 400, { error: 'bad-avatar' });
					return;
				}
			}
			const profile: AgentProfile = {
				workspaceId: id,
				name,
				avatarSpec,
				persona: existing ? existing.persona : null,
				memoryRef: existing ? existing.memoryRef : null,
				createdAt: existing ? existing.createdAt : now,
				updatedAt: now,
			};
			store.tables.agents[id] = profile;
			await writeStore(services, store);
			sendJson(res, 200, profile);
			return;
		}
		case 'DELETE': {
			const store = await readStore(services);
			if (store.tables.agents[id]) {
				delete store.tables.agents[id];
				await writeStore(services, store);
			}
			res.writeHead(204);
			res.end();
			return;
		}
		default:
			sendJson(res, 405, { error: 'method-not-allowed' });
			return;
	}
}

/** 从真实 cordis ctx 装配。软依赖：缺 webServer 时返回空。 */
export function mountAgentsStore(ctx: Context): Array<() => void> {
	let webServer: WebServerLike | null = null;
	try {
		webServer = (ctx.get('webServer') ?? null) as unknown as WebServerLike;
	} catch {
		webServer = null;
	}
	if (webServer === null) return [];
	return registerAgentsRoutes({ webServer });
}
