// config shim：dataSource 用到的 git 行为开关（默认值与扩展一致）。
export interface DshGitBehaviorConfig {
	dateType: number; // DateType
	useMailmap: boolean;
	showSignatureStatus: boolean;
	showCommitsOnlyReferencedByTags: boolean;
	showUncommittedChanges: boolean;
	showUntrackedFiles: boolean;
	showRemoteHeads: boolean;
	signTags: boolean;
	signCommits: boolean;
	fetchAndPrune: boolean;
	fetchAndPruneTags: boolean;
	fileEncoding: string;
	squashMergeMessageFormat: number; // SquashMessageFormat
	squashPullMessageFormat: number; // SquashMessageFormat
}

const config: DshGitBehaviorConfig = {
	dateType: 0, // DateType.Author
	useMailmap: false,
	showSignatureStatus: false,
	showCommitsOnlyReferencedByTags: true,
	showUncommittedChanges: true,
	showUntrackedFiles: true,
	showRemoteHeads: true,
	signTags: false,
	signCommits: false,
	fetchAndPrune: false,
	fetchAndPruneTags: false,
	fileEncoding: 'utf8',
	squashMergeMessageFormat: 0, // SquashMessageFormat.Default
	squashPullMessageFormat: 0,
};

export function getConfig(_repo?: string): DshGitBehaviorConfig {
	void _repo;
	return config;
}

export function setGitBehaviorConfig(patch: Partial<DshGitBehaviorConfig>): void {
	Object.assign(config, patch);
}
