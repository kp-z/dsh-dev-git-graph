import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

const execFileAsync = promisify(execFile)

/** 插件配置 schema（会被 dsh 校验；可选暴露到设置页）。 */
export const ExampleToolConfig = z.object({
  /** 是否注册 git_status 工具。 */
  enableGitStatus: z.boolean().default(true),
  /** git 命令执行超时（ms）。 */
  timeoutMs: z.number().default(5000),
})

/** 从 schema 推导的配置类型（schemastery 无 z.infer，用全局命名空间 TypeT）。 */
export type ExampleToolConfig = Schemastery.TypeT<typeof ExampleToolConfig>

/** Loader entry id（kebab-case，全局唯一）。 */
export const name = 'example-tool'

/** 依赖的 service：本插件需要工具注册表。 */
export const inject = ['tools']

/** 插件入口。注意：Loader 传入的 config 是 patch 原始值（可为 undefined），
 * 必须提供默认值兜底——schema 的 default 只影响设置页/校验，不自动填进 config。 */
export function apply(ctx: Context, config: Partial<ExampleToolConfig> = {}) {
  const { enableGitStatus = true, timeoutMs = 5000 } = config

  if (enableGitStatus) {
    ctx.tools.register(defineTool({
      name: 'example_git_status',
      description: '查询指定目录的 git 工作区状态（只读，无副作用）。返回简洁的状态摘要。',
      parameters: {
        path: {
          type: 'string',
          required: true,
          description: '目标仓库的绝对路径',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      timeoutMs,
      async execute(args, exec) {
        const { stdout, stderr } = await execFileAsync('git', ['status', '--short'], {
          cwd: args.path,
          signal: exec.signal,
        })
        if (stderr) return `[git stderr]\n${stderr}`
        const lines = stdout.split('\n').filter((l) => l.trim() !== '')
        if (lines.length === 0) return '(working tree clean)'
        return lines.join('\n')
      },
    }))
  }

  // 示例：注册第二个工具，演示取消与错误路径。
  ctx.tools.register(defineTool({
    name: 'example_echo',
    description: '示例：回显输入文本。用于验证插件安装成功。',
    parameters: {
      text: {
        type: 'string',
        required: true,
        description: '要回显的文本',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `[example-tool] ${args.text}`
    },
  }))
}
