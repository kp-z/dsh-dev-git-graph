/**
 * git 归属：把"这个文件现在长这样"钉到某个提交上。
 *
 * 为什么所有时间都取自 git：本地时钟会漂、会被改、会和提交顺序不一致。契约演化的时间轴
 * 必须和提交图同源，否则用户会看到一个"未来改的"或"倒着改的"历史。
 *
 * 所有函数都不抛错——不是 git 仓库、detached HEAD、路径被忽略、git 不存在，一律返回
 * null，由调用方降级处理（无 git 的项目用内容哈希当基线）。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** git 命令超时。 */
const GIT_TIMEOUT_MS = 10_000

/** 一次提交的摘要。 */
export interface CommitInfo {
  sha: string
  /** 提交时间（秒）。 */
  at: number
  subject: string
}

/** 跑一条 git 命令，成功返回 stdout，失败返回 null。 */
async function git(root: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: root,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    })
    return stdout
  } catch {
    return null
  }
}

/** 该目录是不是 git 工作树。 */
export async function isRepo(root: string): Promise<boolean> {
  const out = await git(root, ['rev-parse', '--is-inside-work-tree'])
  return out !== null && out.trim() === 'true'
}

/** 解析 `%H%x00%ct%x00%s` 格式的输出。 */
function parseCommit(stdout: string | null): CommitInfo | null {
  if (stdout === null) return null
  const line = stdout.split('\n')[0]
  if (line === undefined || line === '') return null
  const [sha, seconds, ...rest] = line.split('\u0000')
  if (sha === undefined || sha === '' || seconds === undefined) return null
  const at = Number.parseInt(seconds, 10)
  return {
    sha,
    at: Number.isFinite(at) ? at : 0,
    subject: rest.join('\u0000').trim(),
  }
}

/** 当前 HEAD 的提交；空仓库或非仓库返回 null。 */
export async function headCommit(root: string): Promise<CommitInfo | null> {
  return parseCommit(await git(root, ['log', '-1', '--format=%H%x00%ct%x00%s']))
}

/** 最后改动该文件的那个提交。 */
export async function lastCommitOf(root: string, file: string): Promise<CommitInfo | null> {
  return parseCommit(await git(root, ['log', '-1', '--format=%H%x00%ct%x00%s', '--', file]))
}

/** 一批文件里哪些有未提交改动（含未跟踪）。 */
export async function dirtyFiles(root: string, files: string[]): Promise<Set<string>> {
  if (files.length === 0) return new Set()
  const out = await git(root, ['status', '--porcelain', '--', ...files])
  const dirty = new Set<string>()
  if (out === null) return dirty
  for (const line of out.split('\n')) {
    if (line.length < 4) continue
    // porcelain 格式：XY <path>，重命名是 "R  old -> new"，取箭头右边。
    const path = line.slice(3)
    const arrow = path.indexOf(' -> ')
    dirty.add((arrow === -1 ? path : path.slice(arrow + 4)).replace(/^"|"$/g, ''))
  }
  return dirty
}

/** 该提交是否还存在（rebase / force push 后可能就没了）。 */
export async function commitExists(root: string, sha: string): Promise<boolean> {
  const out = await git(root, ['cat-file', '-e', `${sha}^{commit}`])
  return out !== null
}

/**
 * 取 `from..to` 区间内的提交集合（含 `to`，不含 `from`）。
 *
 * 用 git 自己的可达性判断，而不是比时间戳或数组下标：rebase、merge、cherry-pick 之后，
 * "哪一版在另一版之前"只有提交图知道。`from` 为空时取 `to` 可达的全部提交。
 * @param root - 仓库根。
 * @param from - 左端（不含）；空串表示从最初的提交开始。
 * @param to - 右端（含）。
 * @returns 区间内的 sha 集合；git 不可用时返回 null（调用方退化为"不过滤"）。
 */
export async function commitsBetween(root: string, from: string, to: string): Promise<Set<string> | null> {
  const range = from === '' ? to : `${from}..${to}`
  const out = await git(root, ['rev-list', range])
  if (out === null) return null
  const set = new Set<string>()
  for (const line of out.split('\n')) {
    const sha = line.trim()
    if (sha !== '') set.add(sha)
  }
  return set
}

/** 当前 HEAD 的 sha；拿不到返回空串。 */
export async function headSha(root: string): Promise<string> {
  const out = await git(root, ['rev-parse', 'HEAD'])
  return out === null ? '' : out.trim()
}

/** 工作区里是否有未提交改动。 */
export async function isDirty(root: string): Promise<boolean> {
  const out = await git(root, ['status', '--porcelain'])
  return out !== null && out.trim() !== ''
}
