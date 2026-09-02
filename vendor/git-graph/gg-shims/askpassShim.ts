// askpass shim：DSH 场景由宿主代理本地仓库，不需要 VS Code askpass 凭据桥。
export type AskpassEnvironment = { [key: string]: string };

export class AskpassManager {
	public getEnv(): AskpassEnvironment {
		return {};
	}
}
