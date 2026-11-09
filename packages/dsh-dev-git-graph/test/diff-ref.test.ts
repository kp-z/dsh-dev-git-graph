/**
 * viewDiff -> dsh-better-sidebar 原生 `SidebarDiffRef` 的映射测试。
 *
 * 存在的理由（一次真实的踩坑）：git-graph 用 `'*'` 表示「未提交的工作区」
 * （vendor/git-graph/gg-shims/utilsShim.ts 的 UNCOMMITTED），而宿主旧代码只认
 * `''`/`'UNCOMMITTED'`/`'WORKING_TREE'`，于是点「未提交的更改」里的文件会被当成
 * 提交，载荷变成 `{kind:'commit', hashFull:'*'}` —— better-sidebar 拿到后执行
 * `git show … '*'`，git 把 `*` 当 pathspec，显示的是 HEAD 的整份 patch。
 *
 * 断言打在「真实现怎么用它」上：
 * 1. 未提交哨兵必须落到 worktree ref，且**永不**产出 hashFull 为 `'*'` 的 commit ref；
 * 2. 页签 id/标题必须与 better-sidebar 自己的 `diffTabOf()` 逐字一致 —— 这里直接从
 *    已安装的 better-sidebar 源码里抽出 `diffTabOf` 来对比（拿不到就跳过该用例），
 *    这样上游改语法时本测试会红。
 *
 * 注：本文件只写 Node 类型擦除能吃的语法（无 `!`/`as`/接口），否则 --test 起不来。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
	DIFF_HOST,
	UNCOMMITTED,
	buildCommitDiffOpen,
	buildViewDiffOpen,
	buildWorktreeDiffOpen,
	firstLine,
	isUncommittedHash,
} from '../lib/src/git-graph/diff-ref.js'

const REPO = '/Users/kp/dev/my repo'   // 故意带空格：验证 id 只对 repo 段做 encode

/** 断言一定拿到了载荷（替换 `!` 非空断言，Node 类型擦除不支持那语法）。 */
function mustBuild(req) {
	const open = buildViewDiffOpen(req)
	if (!open) throw new Error('expected a diff payload, got null')
	return open
}

/* ---------------- better-sidebar 的 diffTabOf（真源码抽取） ---------------- */

const BS_FILE = process.env.DSH_BETTER_SIDEBAR_CLIENT_REGISTRY
	|| join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', 'web', 'node_modules', 'dsh-better-sidebar', 'lib', 'client-registry.js')

/** 抽出 better-sidebar 的 `diffTabOf(ref)` 真实现（找不到返回 null，用例跳过）。 */
function loadBetterSidebarDiffTabOf() {
	if (!existsSync(BS_FILE)) return null
	const source = readFileSync(BS_FILE, 'utf8')
	const start = source.indexOf('function diffTabOf(ref) {')
	if (start === -1) return null
	let depth = 0
	let end = -1
	for (let i = source.indexOf('{', start); i < source.length; i++) {
		if (source[i] === '{') depth++
		else if (source[i] === '}') {
			depth--
			if (depth === 0) { end = i + 1; break }
		}
	}
	if (end === -1) return null
	// 它依赖模块内的 baseName$1（同时处理 / 与 \ 分隔符）
	const baseName = (p) => {
		const at = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
		return at === -1 ? p : p.slice(at + 1)
	}
	const body = source.slice(start, end)
	return new Function('baseName$1', body + '\nreturn diffTabOf;')(baseName)
}

/* ---------------- 哨兵 ---------------- */

test('未提交哨兵识别：* / 空串 / UNCOMMITTED / WORKING_TREE', () => {
	for (const hash of [UNCOMMITTED, '', 'UNCOMMITTED', 'WORKING_TREE']) {
		assert.equal(isUncommittedHash(hash), true, JSON.stringify(hash) + ' 应判为未提交')
	}
	for (const hash of ['a1b2c3d4', 'HEAD', '0'.repeat(40)]) {
		assert.equal(isUncommittedHash(hash), false, hash + ' 不应判为未提交')
	}
})

test('未提交哨兵一律落 worktree ref，绝不产出 hashFull=* 的 commit ref（回归护栏）', () => {
	for (const hash of [UNCOMMITTED, '', 'UNCOMMITTED', 'WORKING_TREE']) {
		const open = mustBuild({
			repoRoot: REPO, fromHash: hash, toHash: hash,
			oldFilePath: 'src/a.ts', newFilePath: 'src/a.ts', type: 'M',
		})
		assert.equal(open.diff.kind, 'worktree')
		assert.equal(open.diff.path, 'src/a.ts')
		assert.equal(open.tab.id, 'diff:w:' + encodeURIComponent(REPO) + ':u:src/a.ts')
		assert.equal(open.tab.title, 'a.ts')
	}
})

/* ---------------- 工作区文件 ---------------- */

test('工作区文件 -> worktree ref（staged:false，未跟踪标记 untracked）', () => {
	const modified = mustBuild({
		repoRoot: REPO, fromHash: UNCOMMITTED, toHash: UNCOMMITTED,
		oldFilePath: 'src/a.ts', newFilePath: 'src/a.ts', type: 'M',
	})
	assert.deepEqual(modified.diff, { kind: 'worktree', path: 'src/a.ts', staged: false, untracked: false, repoRoot: REPO })

	const untracked = mustBuild({
		repoRoot: REPO, fromHash: UNCOMMITTED, toHash: UNCOMMITTED,
		oldFilePath: 'src/new.ts', newFilePath: 'src/new.ts', type: 'U',
	})
	assert.equal(untracked.diff.untracked, true)
})

test('删除/重命名：newFilePath 为空时回退 oldFilePath', () => {
	const deleted = mustBuild({
		repoRoot: REPO, fromHash: UNCOMMITTED, toHash: UNCOMMITTED,
		oldFilePath: 'src/gone.ts', newFilePath: '', type: 'D',
	})
	assert.equal(deleted.diff.path, 'src/gone.ts')
	assert.equal(deleted.tab.title, 'gone.ts')
})

test('工作区请求缺路径 -> null（调用方回 400，而不是抛错）', () => {
	assert.equal(buildViewDiffOpen({
		repoRoot: REPO, fromHash: UNCOMMITTED, toHash: UNCOMMITTED,
		oldFilePath: '', newFilePath: '', type: 'M',
	}), null)
})

/* ---------------- 提交 ---------------- */

test('提交中的文件 -> commit ref（整提交 patch），标题 = 短 hash + 提交标题', () => {
	const hashFull = 'c50e4a501b3d3c1c9a0f2e5d4b7a8c9d0e1f2a3b'
	const open = mustBuild({
		repoRoot: REPO, fromHash: hashFull, toHash: hashFull,
		oldFilePath: 'src/pages/JsonTree.tsx', newFilePath: 'src/pages/JsonTree.tsx',
		type: 'M', subject: 'fix(mvizlite)：JsonTree 行组件透传 ref',
	})
	assert.deepEqual(open.diff, {
		kind: 'commit', hash: 'c50e4a50', hashFull,
		subject: 'fix(mvizlite)：JsonTree 行组件透传 ref', repoRoot: REPO,
	})
	assert.equal(open.tab.id, 'diff:c:' + encodeURIComponent(REPO) + ':' + hashFull)
	assert.equal(open.tab.title, 'c50e4a50 fix(mvizlite)：JsonTree 行组件透传 ref')
})

test('提交对比 / stash：按 toHash 出 commit ref', () => {
	const from = '1'.repeat(40)
	const to = '2'.repeat(40)
	const open = mustBuild({
		repoRoot: REPO, fromHash: from, toHash: to,
		oldFilePath: 'src/a.ts', newFilePath: 'src/a.ts', type: 'M', subject: 'later commit',
	})
	assert.equal(open.diff.kind, 'commit')
	assert.equal(open.diff.hashFull, to)
	assert.equal(open.tab.title, '22222222 later commit')
})

test('提交缺 subject 时标题退化为短 hash；多行 subject 只取首行', () => {
	assert.equal(buildCommitDiffOpen(REPO, 'a'.repeat(40), '').tab.title, 'aaaaaaaa')
	const multi = mustBuild({
		repoRoot: REPO, fromHash: 'a'.repeat(40), toHash: 'a'.repeat(40),
		oldFilePath: 'x', newFilePath: 'x', type: 'M', subject: 'subject line\nbody line\n',
	})
	assert.equal(multi.tab.title, 'aaaaaaaa subject line')
	assert.equal(firstLine('  a\r\nb  '), 'a')
})

/* ---------------- viewDiffWithWorkingFile ---------------- */

test('viewDiffWithWorkingFile -> 该文件的工作区 ref（近似表达，README 已记录）', () => {
	const open = buildWorktreeDiffOpen(REPO, 'src/a.ts', false)
	assert.deepEqual(open.diff, { kind: 'worktree', path: 'src/a.ts', staged: false, untracked: false, repoRoot: REPO })
	assert.equal(open.tab.id, 'diff:w:' + encodeURIComponent(REPO) + ':u:src/a.ts')
})

test('diffHost 标记固定为 better-sidebar', () => {
	assert.equal(DIFF_HOST, 'better-sidebar')
})

/* ---------------- 与 better-sidebar 的页签语法对齐 ---------------- */

test('页签 id/标题与 better-sidebar diffTabOf 逐字一致（主工作区等价 ref）', (t) => {
	const diffTabOf = loadBetterSidebarDiffTabOf()
	if (diffTabOf === null) {
		t.skip('未找到 better-sidebar 源码：' + BS_FILE)
		return
	}
	// 本插件刻意不写 ref.worktree（better-sidebar 会用它做 worktree list 校验并可能抛
	// unknown linked worktree），改为把 repoRoot 写进 id 的 worktree 段；「文件变动」在
	// 主工作区下 ref.worktree 恰等于 repoRoot，因此两者的 id/标题必须完全相同 ——
	// 这也是「同一个文件在两侧聚焦同一个页签」的前提。
	const stage = (ref) => ({ ...ref, worktree: REPO })

	const worktree = buildWorktreeDiffOpen(REPO, 'src/pages/MvizLite/JsonTree.tsx', false)
	const theirsWorktree = diffTabOf(stage(worktree.diff))
	assert.equal(worktree.tab.id, theirsWorktree.id)
	assert.equal(worktree.tab.title, theirsWorktree.title)

	const hashFull = 'c50e4a501b3d3c1c9a0f2e5d4b7a8c9d0e1f2a3b'
	const commit = buildCommitDiffOpen(REPO, hashFull, 'fix(mvizlite)：JsonTree 行组件透传 ref')
	const theirsCommit = diffTabOf(stage(commit.diff))
	assert.equal(commit.tab.id, theirsCommit.id)
	assert.equal(commit.tab.title, theirsCommit.title)

	// 反向确认：若真的漏了 repo 段，id 会退化成 `diff:w::u:<path>`，与「文件变动」不再同名
	assert.notEqual(worktree.tab.id, diffTabOf({ ...worktree.diff, worktree: '' }).id)
})