/**
 * 命令行参数解析（给 `scripts/dev-server.mjs` 用）。
 *
 * ## 为什么值得单独一个模块 + 单测
 * 起因是一个真实事故：我用 `--port=8971` 起 dev-server，它**静默忽略**了这个参数、
 * 回落到默认端口 8799 —— 于是我的回归脚本一直轮询 8971，冒烟**必然失败**，
 * 而日志里明明写着 `http://127.0.0.1:8799/dsh-daily/`。
 *
 * 这又是一次"**不报错的失败**"（这个项目里已经撞见六次：未声明的 inject、
 * `Object.entries` 看不见 getter、内存会话为空、`text-delta` 写错、
 * `HOME` 挡不住 `DSH_HOME`、以及这次的 `--port=`）。
 *
 * 所以本模块有两条硬规则：
 * 1. **两种写法都要认**：`--port 8971` 与 `--port=8971` 等价
 * 2. **不认识的参数必须报错**，绝不静默忽略 —— 宁可起不来，也不要"看起来起来了但配置没生效"
 */

/**
 * 解析参数。
 *
 * @param {string[]} argv 不含 node 与脚本名的参数表
 * @param {{ flags?: string[], values?: string[] }} spec
 *   已知的开关（无值）与已知的取值参数（都**不带** `--` 前缀）
 * @returns {{ values: Record<string,string|boolean>, errors: string[] }}
 */
export function parseArgs(argv, spec = {}) {
	const flagNames = new Set(spec.flags ?? [])
	const valueNames = new Set(spec.values ?? [])
	/** @type {Record<string,string|boolean>} */
	const values = {}
	/** @type {string[]} */
	const errors = []

	for (let index = 0; index < argv.length; index += 1) {
		const raw = argv[index]
		if (!raw.startsWith('--')) {
			errors.push(`无法识别的参数：${raw}（位置参数不支持）`)
			continue
		}

		const body = raw.slice(2)
		const eq = body.indexOf('=')
		const name = eq >= 0 ? body.slice(0, eq) : body
		const inline = eq >= 0 ? body.slice(eq + 1) : undefined

		if (flagNames.has(name)) {
			if (inline !== undefined) {
				errors.push(`参数 --${name} 是开关，不接受取值（收到 --${name}=${inline}）`)
				continue
			}
			values[name] = true
			continue
		}

		if (valueNames.has(name)) {
			if (inline !== undefined) {
				if (inline === '') {
					errors.push(`参数 --${name} 缺少取值`)
					continue
				}
				values[name] = inline
				continue
			}
			// 空格写法：取下一个参数当值（下一个不能长得像另一个参数）
			const next = argv[index + 1]
			if (next === undefined || next.startsWith('--')) {
				errors.push(`参数 --${name} 缺少取值（例如 --${name} 123 或 --${name}=123）`)
				continue
			}
			values[name] = next
			index += 1
			continue
		}

		errors.push(`无法识别的参数：--${name}`)
	}

	return { values, errors }
}

/** 把取值参数解析成数字（非法就报错，而不是静默回落）。 */
export function toNumber(value, name, errors, options = {}) {
	if (value === undefined) return undefined
	const num = Number(value)
	if (!Number.isFinite(num)) {
		errors.push(`参数 --${name} 需要是一个数字（收到 ${JSON.stringify(value)}）`)
		return undefined
	}
	if (options.min !== undefined && num < options.min) {
		errors.push(`参数 --${name} 不能小于 ${options.min}（收到 ${num}）`)
		return undefined
	}
	if (options.max !== undefined && num > options.max) {
		errors.push(`参数 --${name} 不能大于 ${options.max}（收到 ${num}）`)
		return undefined
	}
	return num
}
