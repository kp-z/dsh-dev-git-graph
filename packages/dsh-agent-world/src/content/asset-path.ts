/**
 * 资产路径的安全边界（BACKLOG M1.6-7）。
 *
 * ## 它挡的是什么
 *
 * 内容包里的 `models[].source.url`（GLB）与 `sounds[].url` 是**用户可写的字符串**。
 * 在真正去加载它之前，那个字符串可以指向任何地方：`http://evil.example/x.glb`
 * （内容包能把宿主变成任意 URL 的下载器）、`../../../../etc/passwd`
 * （包内相对路径的假象下读到包外）、`data:model/gltf-binary;base64,...`（把大对象塞进 JSON）。
 *
 * 所以规矩是：**只允许包内相对路径**。
 *
 * ## 那个洞是怎么来的（值得记）
 *
 * 载荷字段原来走的是 `checkId()`——而 `checkId` 的语义只是"非空字符串"，
 * 它是为**id**写的最小检查。于是"GLB 地址"这条路径实际上**只被检查了非空**。
 * 教训：`checkId` 这种"最小非空检查"被复用到语义完全不同的字段上时，
 * 名字看起来对（都叫"校验一个字段"），保护却为零。
 *
 * ## 报错要给形状
 *
 * 每条规则给的是**具体哪条不满足 + 允许的形状 + 一个例子**。
 * 只写"地址无效"帮不了任何人——用户不知道是协议不对、还是少了扩展名。
 */

/** 允许的形状示例。报错里要用它，别让用户去猜。 */
export const ASSET_PATH_EXAMPLE = 'assets/characters/robot.glb'

/** URL 协议前缀（`http:` / `https:` / `data:` / `file:` / 以及 Windows 的 `C:`）。 */
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/**
 * 检查一个资产地址是否是合法的**包内相对路径**。
 *
 * @param value - 待检查的值（来自内容 JSON，所以可能是任何东西）。
 * @param what - 这个字段的中文名（拼进报错里，例如 "GLB 地址"）。
 * @returns 问题描述；合法时返回 null。
 */
export function assetPathProblem(value: unknown, what = '资产地址'): string | null {
  const shape = `允许的形状：包内相对路径，例如 "${ASSET_PATH_EXAMPLE}"`

  if (typeof value !== 'string' || value.trim() === '') {
    return `${what} 必须是非空字符串，得到 ${JSON.stringify(value)}。${shape}`
  }
  if (value.includes('\0')) {
    return `${what} 含空字节。${shape}`
  }

  const scheme = SCHEME.exec(value)
  if (scheme !== null) {
    // `C:\...` 也会落进这条：这正是想要的效果——绝对路径与远程地址一并拒绝。
    return (
      `${what} 不允许 URL 协议或盘符（读到 "${scheme[0]}"）。` +
      `内容包只能引用**包内**的资产，不能指向外部地址。${shape}`
    )
  }
  if (value.startsWith('/')) {
    return `${what} 不允许绝对路径（以 "/" 开头）。${shape}`
  }
  if (value.startsWith('~')) {
    return `${what} 不允许 "~"（它依赖运行环境的家目录，换台机器就指向别处）。${shape}`
  }
  if (value.includes('\\')) {
    return (
      `${what} 不允许反斜杠。` +
      `Windows 与 POSIX 对反斜杠的解释不同，同一个包在两个平台上会读到不同的文件。${shape}`
    )
  }

  const segments = value.split('/')
  if (segments.includes('..')) {
    return (
      `${what} 不允许 ".." 上跳——它会读到内容包外面去。` +
      `要引用子目录直接写相对路径即可（例如 "assets/x.glb"）。${shape}`
    )
  }
  if (segments.some((s) => s === '')) {
    return `${what} 含空路径段（"//" 或结尾的 "/"）。${shape}`
  }

  const last = segments[segments.length - 1] ?? ''
  if (!last.includes('.') || last.startsWith('.') || last.endsWith('.')) {
    return `${what} 要以扩展名结尾（例如 ".glb"）。${shape}`
  }

  return null
}
