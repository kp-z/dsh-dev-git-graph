// utils shim：移植自 mhutchie/vscode-git-graph（见 ../LICENSE），去除 vscode 依赖。
import * as cp from 'child_process';
import * as fs from 'fs';

const FS_REGEX = /\\/g;

export const UNCOMMITTED = '*';
export const UNABLE_TO_FIND_GIT_MSG = '找不到 git 可执行文件（请确认已安装 git）。';

export interface GitExecutable {
	readonly path: string;
	readonly version: string;
}

export function getPathFromStr(str: string) {
	return str.replace(FS_REGEX, '/');
}

export function getPathFromUri(path: string) {
	return path.replace(FS_REGEX, '/');
}

export function pathWithTrailingSlash(path: string) {
	return path.endsWith('/') ? path : path + '/';
}

export function realpath(path: string, native: boolean = false) {
	return new Promise<string>((resolve) => {
		(native ? fs.realpath.native : fs.realpath)(path, (err, resolvedPath) => resolve(err !== null ? path : resolvedPath.replace(FS_REGEX, '/')));
	});
}

export function abbrevCommit(commitHash: string) {
	return commitHash.substring(0, 8);
}

export function abbrevText(text: string, toChars: number) {
	return text.length <= toChars ? text : text.substring(0, toChars - 1) + '...';
}

export const enum GitVersionRequirement {
	FetchAndPruneTags = '2.17.0',
	GpgInfo = '2.4.0',
	PushStash = '2.13.2',
	TagDetails = '1.7.8'
}

export function doesVersionMeetRequirement(version: string, requiredVersion: GitVersionRequirement) {
	const v1 = parseVersion(version);
	const v2 = parseVersion(requiredVersion);
	if (v1 === null || v2 === null) return true;
	if (v1.major > v2.major) return true;
	if (v1.major < v2.major) return false;
	if (v1.minor > v2.minor) return true;
	if (v1.minor < v2.minor) return false;
	if (v1.patch > v2.patch) return true;
	if (v1.patch < v2.patch) return false;
	return true;
}

function parseVersion(version: string) {
	const match = version.trim().match(/^[0-9]+(\.[0-9]+|)(\.[0-9]+|)/);
	if (match === null) return null;
	const comps = match[0].split('.');
	return {
		major: parseInt(comps[0], 10),
		minor: comps.length > 1 ? parseInt(comps[1], 10) : 0,
		patch: comps.length > 2 ? parseInt(comps[2], 10) : 0
	};
}

export function constructIncompatibleGitVersionMessage(executable: GitExecutable, version: GitVersionRequirement, feature?: string) {
	return '需要更新版本的 Git (>= ' + version + ') 才能执行 ' + (feature ? feature : '该功能') + '。当前 Git 版本为 ' + executable.version + '。';
}

/** DSH 宿主：没有终端可开，记录并返回（交互式 rebase 走降级分支）。 */
export function openGitTerminal(cwd: string, gitPath: string, command: string | null, name: string) {
	console.error('[git-graph] openGitTerminal not supported in DSH (' + name + '): ' + gitPath + ' ' + (command ?? '') + ' @ ' + cwd);
}

export function resolveSpawnOutput(cmd: cp.ChildProcess) {
	return Promise.all([
		new Promise<{ code: number, error: Error | null }>((resolve) => {
			let resolved = false;
			cmd.on('error', (error) => {
				if (resolved) return;
				resolve({ code: -1, error: error });
				resolved = true;
			});
			cmd.on('exit', (code) => {
				if (resolved) return;
				resolve({ code: code === null ? -1 : code, error: null });
				resolved = true;
			});
		}),
		new Promise<Buffer>((resolve) => {
			const buffers: Buffer[] = [];
			if (cmd.stdout) {
				cmd.stdout.on('data', (b: Buffer) => { buffers.push(b); });
				cmd.stdout.on('close', () => resolve(Buffer.concat(buffers)));
			} else {
				resolve(Buffer.alloc(0));
			}
		}),
		new Promise<string>((resolve) => {
			let stderr = '';
			if (cmd.stderr) {
				cmd.stderr.on('data', (d) => { stderr += d; });
				cmd.stderr.on('close', () => resolve(stderr));
			} else {
				resolve('');
			}
		})
	]);
}

export function showErrorMessage(message: string) {
	console.error('[git-graph:error] ' + message);
}

export function findGitExecutable(): Promise<GitExecutable> {
	return new Promise((resolve, reject) => {
		const cmd = cp.spawn('git', ['--version']);
		resolveSpawnOutput(cmd).then(([{ code, error }, stdout]) => {
			if (code === 0) {
				const versionMatch = stdout.toString().match(/([0-9]+(?:\.[0-9]+)*)/);
				resolve({ path: 'git', version: versionMatch !== null ? versionMatch[0] : 'unknown' });
			} else {
				reject(error ?? new Error('git --version failed'));
			}
		});
	});
}
