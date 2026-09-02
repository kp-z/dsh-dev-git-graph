// logger shim：dataSource 只用 info/log/logError，输出到 stderr 即可。
export class Logger {
	public log(message: string) {
		console.error('[git-graph] ' + message);
	}
	public logCmd(cmd: string, args?: string[]) {
		console.error('[git-graph] $ ' + cmd + (args ? ' ' + args.join(' ') : ''));
	}
	public info(message: string) {
		console.error('[git-graph] ' + message);
	}
	public logError(message: string) {
		console.error('[git-graph:error] ' + message);
	}
}
