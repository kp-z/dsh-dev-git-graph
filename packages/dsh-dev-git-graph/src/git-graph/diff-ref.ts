/**
 * DSH: git-graph 的 viewDiff 请求 -> dsh-better-sidebar 原生 `SidebarDiffRef` 映射。
 *
 * 目标：点 Git Graph 里的文件时，打开的是**同一个**原生 DiffTab —— 与侧边栏
 * 「文件变动」tab、内置 Git 面板点文件/提交完全一致（同一套 ref、同一套页签 id
 * 语法，因此同名条目会聚焦同一个页签而不是重复开）。
 *
 * 对齐基准（dsh-better-sidebar 0.19.1 源码）：
 * - `worktreeRefOf`：`{kind:'worktree', path, staged, untracked, worktree, repoRoot}`
 *   —— 工作区/索引的一条路径变更，diff 内容 = `git diff [--cached] -- <path>`。
 * - `commitRefOf`：`{kind:'commit', hash, hashFull, subject, worktree, repoRoot}`
 *   —— 一个提交的整份 patch（`git show --format= -m --first-parent <hash>`）。
 * - `diffTabOf`：
 *     `diff:w:${encodeURIComponent(ref.worktree ?? '')}:${staged?'s':'u'}:${ref.path}`
 *     `diff:c:${encodeURIComponent(ref.worktree ?? '')}:${ref.hashFull}`
 *     标题 = `basename(path)` / `${hash} ${subject}`。
 *
 * 已知取舍：
 * 1. 本插件不写 `ref.worktree`。better-sidebar 会拿它做 `resolveWorktree()` 校验，
 *    命中不了 `git worktree list` 就抛 `unknown linked worktree`；而页签 id 的
 *    worktree 段在主工作区场景下就等于仓库根，故这里直接把 `repoRoot` 写进 id，
 *    结果与「文件变动」逐字一致，同时不引入抛错路径。
 * 2. `SidebarDiffRef` 的 commit 形态没有 `path`，better-sidebar 侧也没有
 *    pathspec 版 commit diff —— 所以「提交里的某个文件」只能展示该提交的 patch，
 *    这与「文件变动」点历史提交的行为一致（并非本插件的退化）。
 */

/** 响应里的 `diffHost`：告诉前端这条 diff 该交给哪种宿主打开。 */
export const DIFF_HOST = 'better-sidebar';

/** git-graph 的未提交哨兵（见 vendor/git-graph/gg-shims/utilsShim.ts 的 UNCOMMITTED）。 */
export const UNCOMMITTED = '*';

/** 兼容写法：上游不同版本/不同入口用过这几个字面量表示「工作区」。 */
const UNCOMMITTED_HASHES: ReadonlySet<string> = new Set([UNCOMMITTED, '', 'UNCOMMITTED', 'WORKING_TREE']);

/** `hash` 是否表示「未提交的工作区」（含未跟踪文件）。 */
export function isUncommittedHash(hash: string): boolean {
	return UNCOMMITTED_HASHES.has(hash);
}

export interface SidebarWorktreeDiffRef {
	kind: 'worktree';
	path: string;
	staged: boolean;
	untracked?: boolean;
	worktree?: string;
	repoRoot?: string;
}

export interface SidebarCommitDiffRef {
	kind: 'commit';
	hash: string;
	hashFull: string;
	subject: string;
	worktree?: string;
	repoRoot?: string;
}

export type SidebarDiffRef = SidebarWorktreeDiffRef | SidebarCommitDiffRef;

/** 前端拿到的页签种子：id/title 由宿主算好，父页原样透传给 onOpenDiff。 */
export interface DiffTabSeed {
	id: string;
	title: string;
}

export interface DiffOpen {
	diff: SidebarDiffRef;
	tab: DiffTabSeed;
}

/** 斜杠分隔路径的 basename（git 输出恒为 '/' 分隔，不用 path 模块以免平台差异）。 */
export function baseName(filePath: string): string {
	const index = filePath.lastIndexOf('/');
	return index === -1 ? filePath : filePath.slice(index + 1);
}

/** 与 gg-shims 的 abbrevCommit 一致（8 位）。 */
export function abbrev(hash: string): string {
	return hash.substring(0, 8);
}

function worktreeTabId(repoRoot: string, staged: boolean, filePath: string): string {
	return 'diff:w:' + encodeURIComponent(repoRoot) + ':' + (staged ? 's' : 'u') + ':' + filePath;
}

function commitTabId(repoRoot: string, hashFull: string): string {
	return 'diff:c:' + encodeURIComponent(repoRoot) + ':' + hashFull;
}

/** 工作区文件（含未跟踪）-> 原生 worktree ref + 页签种子。 */
export function buildWorktreeDiffOpen(repoRoot: string, filePath: string, untracked: boolean, staged = false): DiffOpen {
	return {
		diff: {
			kind: 'worktree',
			path: filePath,
			staged,
			untracked,
			repoRoot,
		},
		tab: {
			id: worktreeTabId(repoRoot, staged, filePath),
			title: baseName(filePath),
		},
	};
}

/** 提交（单个提交 / 提交对比 / stash）-> 原生 commit ref + 页签种子。 */
export function buildCommitDiffOpen(repoRoot: string, hashFull: string, subject: string): DiffOpen {
	const hash = abbrev(hashFull);
	const title = subject !== '' ? hash + ' ' + subject : hash;
	return {
		diff: {
			kind: 'commit',
			hash,
			hashFull,
			subject,
			// better-sidebar 用 ref.repoRoot 决定在哪个仓库跑 git（selectedRepoOf）；
			// 漏掉它就会退回会话 cwd 的仓库，图和 diff 可能不是一个库。
			repoRoot,
		},
		tab: {
			id: commitTabId(repoRoot, hashFull),
			title,
		},
	};
}

export interface ViewDiffRequest {
	repoRoot: string;
	fromHash: string;
	toHash: string;
	oldFilePath: string;
	newFilePath: string;
	type: string;
	/** 可选：`toHash` 那个提交的标题（前端已有，省一次 git 调用）。 */
	subject?: string;
}

/**
 * `viewDiff` 的主映射。返回 null 表示请求缺文件路径（调用方回 400）。
 *
 * - `toHash` 是未提交哨兵（`'*'` 等）-> worktree ref（该文件的工作区改动）。
 * - 其余（单提交 / 对比 / stash）-> commit ref（该提交的 patch）。
 */
export function buildViewDiffOpen(req: ViewDiffRequest): DiffOpen | null {
	const filePath = req.newFilePath !== '' ? req.newFilePath : req.oldFilePath;
	const isWorktree = isUncommittedHash(req.toHash);
	if (isWorktree) {
		if (filePath === '') return null;
		// git graph 不区分暂存/未暂存，统一 staged:false；原生 DiffTab 自带
		// 「diff 为空则换另一侧」回退，观感与「文件变动」一致。
		return buildWorktreeDiffOpen(req.repoRoot, filePath, req.type === 'U');
	}
	const subject = typeof req.subject === 'string' ? firstLine(req.subject) : '';
	return buildCommitDiffOpen(req.repoRoot, req.toHash, subject);
}

/** 取首行并去空白（前端可能把整段提交信息给过来）。 */
export function firstLine(text: string): string {
	const index = text.search(/\r?\n/);
	return (index === -1 ? text : text.slice(0, index)).trim();
}