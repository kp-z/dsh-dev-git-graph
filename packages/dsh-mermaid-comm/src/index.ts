import type { Context } from '@deepseek-ai/cordis'
import { MermaidCommConfig, type MermaidCommConfig as MermaidCommConfigType } from './config.ts'
import { registerMermaidPrompt, registerVaultIndexSection } from './prompt.ts'
import { registerValidateTool } from './tool-validate.ts'
import { registerVaultTools } from './tool-vault.ts'
import { registerOutputGate } from './gate.ts'
import { registerInjectSwitch, registerSwitchRoutes } from './switch.ts'

/** Loader entry id（kebab-case，全局唯一）。 */
export const name = 'mermaid-comm'

/** 依赖的 service：工具注册表 + 系统提示组装。渲染交给 dsh-mermaid（MrmoLabs），不再依赖 webServer。 */
export const inject = ['tools', 'systemPrompt']

/**
 * 插件入口。
 *
 * 注意：Loader 传入的 config 是 patch 原始值（可为 undefined），必须提供默认值兜底——
 * schema 的 default 只影响设置页/校验，不自动填进 config。
 *
 * 注入开关（promptLevel）三态：
 * - `toggle`（默认）：只在对话输入框的勾选按钮被勾选时注入。真值住在 host
 *   （见 switch.ts），客户端只是遥控器。
 * - `global`：始终注入（v0.2.0 的老行为），客户端按钮自动隐藏。
 * - `off`：从不注入 prompt（工具仍可用），客户端按钮自动隐藏。
 */
export function apply(ctx: Context, config: Partial<MermaidCommConfigType> = {}) {
  const {
    enabled = true,
    promptLevel = 'toggle',
    defaultInject = false,
    diagramTypes = [],
    validateBeforeRender = true,
    vaultEnabled = true,
    vaultDir = '.dsh/mermaid',
    maxVersions = 20,
    injectIndex = true,
    maxFileBytes = 256 * 1024,
  } = config

  if (!enabled) return

  // 开关状态：无论哪种 promptLevel 都建（客户端要靠它问出 toggle 是否生效，
  // 借此决定是否隐藏按钮），只有 toggle 模式下 isOn 才真的由它决定。
  const sw = registerInjectSwitch(ctx, { defaultInject })
  const isOn = promptLevel === 'global'
    ? () => true
    : promptLevel === 'off'
      ? () => false
      : () => sw.isOn()

  // A. 行为引导：注入「用 Mermaid 交流」prompt 段（L1 禁 Unicode 箭头等危险写法）
  if (promptLevel !== 'off') {
    registerMermaidPrompt(ctx, { diagramTypes, validateBeforeRender, isOn })
  }

  // C. 语法校验工具（L2 真解析器 + 危险字符扫描）
  registerValidateTool(ctx)

  // D. Mermaid Vault：图库持久化 + 版本演进 + 上下文回馈
  if (vaultEnabled) {
    registerVaultTools(ctx, { vaultDir, maxVersions, maxFileBytes })
    if (injectIndex && promptLevel !== 'off') {
      registerVaultIndexSection(ctx, { vaultDir, maxVersions, maxFileBytes, isOn })
    }
  }

  // L3. 输出闸：assistant/message 落盘前自动清洗/摘除坏图
  registerOutputGate(ctx)

  // B. 对话输入框勾选按钮的读写通道（GET/POST /dsh-mermaid-comm/state）
  registerSwitchRoutes(ctx, sw, { toggle: promptLevel === 'toggle' })
}

// 导出配置 schema 供设置页/其他插件使用
export { MermaidCommConfig }
