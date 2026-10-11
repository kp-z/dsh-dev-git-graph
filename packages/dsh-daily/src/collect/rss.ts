/**
 * 零依赖 RSS 2.0 / Atom 1.0 / RSS 1.0 (RDF) 解析器。
 *
 * 设计取舍（刻意为之）：
 * - **不是完整 XML 解析器**：只是一个「标签扫描器 + 轻量树」。用 `indexOf('<')`
 *   逐段推进，配一个识别引号的找 `>` 助手；全程没有回溯正则，输入线性扫一遍。
 * - **永不抛异常**：任何畸形 / 非 XML 输入都降级返回「已经解析出来的部分」，
 *   完全认不出来就返回 `{ items: [] }`。
 * - **命名空间前缀无关**：匹配时同时比较完整标签名与「最后一个冒号之后的部分」，
 *   因此 `media:content` / `content`、`dc:date` / `date`、`itunes:author` / `author`
 *   都能命中。
 * - **实体恰好解码一次**：CDATA 在扫描阶段就被「取出」（其内容不参与标签识别），
 *   之后与普通文本一视同仁地解码一次；取值时绝不二次解码，所以 `&amp;lt;`
 *   得到 `&lt;` 而不是 `<`。summary 走 `cleanText`（先解码、再剥标签）。
 * - **绝不空转**：每一处字符扫描循环都有「保证推进」的判断，畸形输入也不会死循环。
 *
 * 无外部依赖，只用 ECMAScript 内置能力，可在任何 Node.js / 浏览器运行时跑。
 */

/* ------------------------------------------------------------------ *
 * 公开类型
 * ------------------------------------------------------------------ */

export interface RssItem {
  title: string
  link: string
  summary?: string
  publishedAt?: string // ISO 8601 字符串；解析不出来就 undefined
  author?: string
  guid?: string
  image?: string // 封面/缩略图 URL
  duration?: string // 如 "12:34"，来自 itunes:duration 或 media:content duration
}

export interface RssFeed {
  title?: string
  link?: string
  description?: string
  items: RssItem[]
}

/* ------------------------------------------------------------------ *
 * HTML 实体
 * ------------------------------------------------------------------ */

/** 常见命名实体（小写、区分大小写；未收录的按字面量保留）。 */
const NAMED_ENTITIES = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', '\u00a0'],
  ['ensp', '\u2002'],
  ['emsp', '\u2003'],
  ['thinsp', '\u2009'],
  ['shy', '\u00ad'],
  ['hellip', '\u2026'],
  ['mdash', '\u2014'],
  ['ndash', '\u2013'],
  ['middot', '\u00b7'],
  ['bull', '\u2022'],
  ['lsquo', '\u2018'],
  ['rsquo', '\u2019'],
  ['ldquo', '\u201c'],
  ['rdquo', '\u201d'],
  ['laquo', '\u00ab'],
  ['raquo', '\u00bb'],
  ['copy', '\u00a9'],
  ['reg', '\u00ae'],
  ['trade', '\u2122'],
  ['times', '\u00d7'],
  ['divide', '\u00f7'],
  ['deg', '\u00b0'],
  ['plusmn', '\u00b1'],
  ['sect', '\u00a7'],
  ['para', '\u00b6'],
  ['micro', '\u00b5'],
  ['euro', '\u20ac'],
  ['pound', '\u00a3'],
  ['yen', '\u00a5'],
  ['cent', '\u00a2'],
  ['permil', '\u2030'],
  ['prime', '\u2032'],
  ['ne', '\u2260'],
  ['le', '\u2264'],
  ['ge', '\u2265'],
])

const DECIMAL_ENTITY = /^[0-9]+$/
const HEX_ENTITY = /^[0-9a-fA-F]+$/

/** 数字实体 → 字符；非法码点返回 undefined。 */
function decodeEntityBody(body: string): string | undefined {
  if (body.length === 0) return undefined
  if (body.charCodeAt(0) === 35 /* # */) {
    const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X'
    const digits = body.slice(hex ? 2 : 1)
    if (digits.length === 0 || digits.length > 8) return undefined
    if (!(hex ? HEX_ENTITY : DECIMAL_ENTITY).test(digits)) return undefined
    const code = Number.parseInt(digits, hex ? 16 : 10)
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return undefined
    if (code >= 0xd800 && code <= 0xdfff) return undefined // 孤立代理区：丢弃
    return String.fromCodePoint(code)
  }
  return NAMED_ENTITIES.get(body)
}

/** 实体名长度上限（`&#x10FFFF;` 共 10 个字符，留点余量）。 */
const MAX_ENTITY_LEN = 32

/**
 * 把实体解码成纯文本，**只解码一层**。
 * `&amp;lt;` → `&lt;`；无法识别的实体（例如 `&foo;`）原样保留。
 * 找 `;` 时只往后看 MAX_ENTITY_LEN 个字符：输入里塞满裸 `&` 时也仍然是 O(n)。
 */
function decodeEntities(input: string): string {
  if (input.indexOf('&') < 0) return input
  let out = ''
  let i = 0
  while (i < input.length) {
    const amp = input.indexOf('&', i)
    if (amp < 0) {
      out += input.slice(i)
      break
    }
    out += input.slice(i, amp)
    let semi = -1
    const scanEnd = Math.min(input.length, amp + 1 + MAX_ENTITY_LEN)
    for (let k = amp + 1; k < scanEnd; k++) {
      if (input.charCodeAt(k) === 59 /* ; */) {
        semi = k
        break
      }
    }
    if (semi < 0) {
      out += '&'
      i = amp + 1
      continue
    }
    const decoded = decodeEntityBody(input.slice(amp + 1, semi))
    if (decoded === undefined) {
      out += '&'
      i = amp + 1
      continue
    }
    out += decoded
    i = semi + 1
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 字符分类小工具（用码点比较，不写正则）
 * ------------------------------------------------------------------ */

function isSpaceCode(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 11 || code === 12 || code === 13
}

/** 标签名首字符：A-Z a-z _ : */
function isNameStartCode(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 58
}

/** 会「产生一个空格」的块级标签：让 `a</p><p>b` 变成 `a b` 而不是 `ab`。 */
const BLOCK_LOCALS = new Set<string>([
  'br', 'p', 'div', 'li', 'ul', 'ol', 'tr', 'td', 'th', 'hr', 'dd', 'dt',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'section',
  'article', 'aside', 'figure', 'figcaption', 'header', 'footer', 'nav', 'table',
])

/** HTML 空元素：即便没有 `/` 也当作自闭合（只为容忍「HTML 当 XML 喂进来」）。 */
const VOID_LOCALS = new Set<string>([
  'br', 'img', 'hr', 'meta', 'input', 'area', 'base', 'col', 'embed',
  'source', 'track', 'wbr', 'param',
])

/** 解析树的最大嵌套深度：防止恶意/畸形输入把递归打爆。 */
const MAX_DEPTH = 256

function localName(name: string): string {
  const i = name.lastIndexOf(':')
  return i < 0 ? name : name.slice(i + 1)
}

/** 大小写不敏感、且不受 Unicode 大小写长度变化影响的 indexOf。 */
function indexOfCI(haystack: string, needle: string, from: number): number {
  const limit = haystack.length - needle.length
  for (let i = Math.max(0, from); i <= limit; i++) {
    let hit = true
    for (let k = 0; k < needle.length; k++) {
      if (haystack.charAt(i + k).toLowerCase() !== needle.charAt(k)) {
        hit = false
        break
      }
    }
    if (hit) return i
  }
  return -1
}

/* ------------------------------------------------------------------ *
 * 标签扫描器
 * ------------------------------------------------------------------ */

interface XmlNode {
  /** 小写完整标签名，如 `media:content` */
  name: string
  /** 小写局部名（最后一个冒号之后），如 `content` */
  local: string
  attrs: Map<string, string>
  children: XmlNode[]
  /** 本层的文本片段（CDATA 已展开成普通片段，取值时**每个片段解码恰好一次**） */
  segs: string[]
}

/** 从 `<` 之后找标签结束的 `>`，跳过引号内的内容。 */
function findTagEnd(src: string, from: number): number {
  let quote = ''
  for (let i = from; i < src.length; i++) {
    const c = src.charAt(i)
    if (quote !== '') {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '>') {
      return i
    }
  }
  return -1
}

/** 解析 `<name attr="v" ...>` 的标签体（不含尖括号，已去掉尾部 `/`）。 */
function parseStartTag(body: string): XmlNode | undefined {
  const n = body.length
  let i = 0
  while (i < n && isSpaceCode(body.charCodeAt(i))) i++
  const nameStart = i
  while (i < n) {
    const code = body.charCodeAt(i)
    if (isSpaceCode(code) || code === 47 /* / */ || code === 61 /* = */) break
    i++
  }
  const name = body.slice(nameStart, i).toLowerCase()
  if (name.length === 0) return undefined

  const attrs = new Map<string, string>()
  while (i < n) {
    while (i < n && isSpaceCode(body.charCodeAt(i))) i++
    if (i >= n) break
    const attrStart = i
    while (i < n) {
      const code = body.charCodeAt(i)
      if (isSpaceCode(code) || code === 61 /* = */ || code === 47 /* / */) break
      i++
    }
    const attrName = body.slice(attrStart, i).toLowerCase()
    if (attrName.length === 0) {
      // 畸形输入（孤立 '/' '=' 等）：跳过这个字符，保证循环一定推进，绝不空转
      i = attrStart + 1
      continue
    }
    while (i < n && isSpaceCode(body.charCodeAt(i))) i++
    let attrValue = ''
    if (body.charCodeAt(i) === 61 /* = */) {
      i++
      while (i < n && isSpaceCode(body.charCodeAt(i))) i++
      const quote = body.charAt(i)
      if (quote === '"' || quote === "'") {
        const end = body.indexOf(quote, i + 1)
        attrValue = end < 0 ? body.slice(i + 1) : body.slice(i + 1, end)
        i = end < 0 ? n : end + 1
      } else {
        const valueStart = i
        while (i < n && !isSpaceCode(body.charCodeAt(i))) i++
        attrValue = body.slice(valueStart, i)
      }
    }
    // 属性值一定不在 CDATA 里，所以在这里解码一次是安全且唯一的
    if (!attrs.has(attrName)) attrs.set(attrName, decodeEntities(attrValue))
  }
  return { name, local: localName(name), attrs, children: [], segs: [] }
}

function pushText(stack: XmlNode[], value: string): void {
  if (value.length === 0) return
  const top = stack[stack.length - 1]
  if (top) top.segs.push(value)
}

function closeNode(stack: XmlNode[], name: string): void {
  if (name.length === 0) return
  for (let i = stack.length - 1; i >= 1; i--) {
    const node = stack[i]
    if (node && (node.name === name || node.local === name)) {
      stack.length = i
      return
    }
  }
  // 找不到匹配的开标签：忽略（畸形输入不做补救）
}

/** 扫描整篇文档，返回根元素（无元素则 undefined）。绝不抛异常。 */
function parseDocument(src: string): XmlNode | undefined {
  const root: XmlNode = { name: '#root', local: '#root', attrs: new Map(), children: [], segs: [] }
  const stack: XmlNode[] = [root]
  const n = src.length
  let i = 0
  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) {
      pushText(stack, src.slice(i))
      break
    }
    if (lt > i) pushText(stack, src.slice(i, lt))

    const j = lt + 1
    const c1 = src.charAt(j)

    if (c1 === '!') {
      if (src.startsWith('!--', j)) {
        const end = src.indexOf('-->', j + 3)
        i = end < 0 ? n : end + 3
        continue
      }
      if (src.startsWith('![CDATA[', j)) {
        const end = src.indexOf(']]>', j + 8)
        pushText(stack, end < 0 ? src.slice(j + 8) : src.slice(j + 8, end))
        i = end < 0 ? n : end + 3
        continue
      }
      // DOCTYPE 等声明：跳到配对的 '>'（内部子集有 '[' ']' 需要计数）
      let k = j + 1
      let depth = 0
      while (k < n) {
        const ch = src.charAt(k)
        if (ch === '[') depth++
        else if (ch === ']') {
          if (depth > 0) depth--
        } else if (ch === '>' && depth === 0) break
        k++
      }
      i = k >= n ? n : k + 1
      continue
    }

    if (c1 === '?') {
      const end = src.indexOf('?>', j + 1)
      i = end < 0 ? n : end + 2
      continue
    }

    if (c1 === '/') {
      const end = src.indexOf('>', j + 1)
      const name = (end < 0 ? src.slice(j + 1) : src.slice(j + 1, end)).trim().toLowerCase()
      closeNode(stack, name)
      i = end < 0 ? n : end + 1
      continue
    }

    if (!isNameStartCode(c1.charCodeAt(0))) {
      // 不是标签（例如正文里的 "a < b"）：'<' 当字面量
      pushText(stack, '<')
      i = lt + 1
      continue
    }

    const end = findTagEnd(src, lt + 1)
    if (end < 0) {
      // 未闭合的开始标签：剩余内容当文本，收工
      pushText(stack, src.slice(lt))
      break
    }
    let body = src.slice(lt + 1, end)
    let selfClose = false
    if (body.length > 0 && body.charAt(body.length - 1) === '/') {
      selfClose = true
      body = body.slice(0, -1)
    }
    const node = parseStartTag(body)
    if (node) {
      const top = stack[stack.length - 1]
      if (top) top.children.push(node)
      if (!selfClose && !VOID_LOCALS.has(node.local) && stack.length < MAX_DEPTH) stack.push(node)
    } else {
      pushText(stack, '<')
    }
    i = end + 1
  }
  return root.children[0]
}

/* ------------------------------------------------------------------ *
 * 取文本 / 取属性
 * ------------------------------------------------------------------ */

/** 原始文本（不解码），用于交给 `cleanText` 做「先解码一次、再剥标签」的整体清洗。 */
function rawText(node: XmlNode | undefined): string {
  if (!node) return ''
  let out = ''
  for (const seg of node.segs) out += seg
  for (const child of node.children) out += rawText(child)
  return out
}

/**
 * 纯文本：每个文本片段解码**恰好一次**，再压缩空白。
 * CDATA 内容在扫描阶段就已经「取出」（不参与标签识别），这里和其它文本一视同仁，
 * 所以 `&amp;lt;`（无论在 CDATA 内外）都得到 `&lt;`，不会被解成 `<`。
 */
function plainText(node: XmlNode | undefined): string {
  if (!node) return ''
  let out = ''
  for (const seg of node.segs) out += decodeEntities(seg)
  for (const child of node.children) out += plainText(child)
  return collapseWhitespace(out)
}

/** 压缩空白（含 nbsp / 全角空格 / BOM / 零宽字符）并去掉首尾空白。 */
function collapseWhitespace(input: string): string {
  let out = ''
  let pending = false
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    if (
      code === 32 || code === 9 || code === 10 || code === 11 || code === 12 || code === 13 ||
      code === 0xa0 || code === 0x200b || code === 0xfeff || code === 0x3000
    ) {
      pending = true
      continue
    }
    if (pending && out.length > 0) out += ' '
    pending = false
    out += input.charAt(i)
  }
  return out
}

function matchesName(node: XmlNode, want: string): boolean {
  return node.name === want || node.local === want
}

/** 按 `names` 的优先级找第一个直接子元素。 */
function findChild(node: XmlNode, names: readonly string[]): XmlNode | undefined {
  for (const want of names) {
    for (const child of node.children) {
      if (matchesName(child, want)) return child
    }
  }
  return undefined
}

/** 取属性：按 `names` 优先级匹配属性名，同时比较完整名与局部名（`rdf:about` ↔ `about`）。 */
function attr(node: XmlNode, names: readonly string[]): string | undefined {
  for (const want of names) {
    for (const [key, value] of node.attrs) {
      if (key === want || localName(key) === want) return value
    }
  }
  return undefined
}

/* ------------------------------------------------------------------ *
 * 文本清洗
 * ------------------------------------------------------------------ */

/** 丢掉 `<script>…</script>` / `<style>…</style>`（含内容）。 */
function stripRawElement(input: string, tag: string): string {
  const open = '<' + tag
  let out = ''
  let i = 0
  while (i < input.length) {
    const start = indexOfCI(input, open, i)
    if (start < 0) {
      out += input.slice(i)
      break
    }
    const after = input.charAt(start + open.length)
    if (after !== '' && after !== '>' && after !== '/' && !isSpaceCode(after.charCodeAt(0))) {
      out += input.slice(i, start + open.length)
      i = start + open.length
      continue
    }
    out += input.slice(i, start)
    const close = indexOfCI(input, '</' + tag, start)
    if (close < 0) break // 未闭合：剩下的都当脚本内容丢掉
    const gt = input.indexOf('>', close)
    i = gt < 0 ? input.length : gt + 1
    out += ' '
  }
  return out
}

/** 去掉标签；块级标签留下一个空格。 */
function stripTags(input: string): string {
  const n = input.length
  let out = ''
  let i = 0
  while (i < n) {
    const lt = input.indexOf('<', i)
    if (lt < 0) {
      out += input.slice(i)
      break
    }
    out += input.slice(i, lt)
    const c1 = input.charAt(lt + 1)
    if (c1 === '!') {
      if (input.startsWith('!--', lt + 1)) {
        const end = input.indexOf('-->', lt + 4)
        i = end < 0 ? n : end + 3
        continue
      }
      // 直接把 CDATA 原文塞进 cleanText 的调用方：按「取出内容」处理，别把正文吃掉
      if (input.startsWith('![CDATA[', lt + 1)) {
        const end = input.indexOf(']]>', lt + 9)
        out += end < 0 ? input.slice(lt + 9) : input.slice(lt + 9, end)
        i = end < 0 ? n : end + 3
        continue
      }
      const end = input.indexOf('>', lt + 2)
      i = end < 0 ? n : end + 1
      continue
    }
    if (c1 === '?') {
      const end = input.indexOf('?>', lt + 2)
      i = end < 0 ? n : end + 2
      continue
    }
    // 开始标签 <name …> 与结束标签 </name> 都要吃掉；其它 '<' 当字面量
    const nameCode = c1 === '/' ? input.charCodeAt(lt + 2) : c1.charCodeAt(0)
    if (!isNameStartCode(nameCode)) {
      out += '<'
      i = lt + 1
      continue
    }
    const end = findTagEnd(input, lt + 2)
    if (end < 0) {
      out += input.slice(lt + 1)
      break
    }
    const body = input.slice(lt + 1, end)
    let k = 0
    if (body.charAt(0) === '/') k = 1
    const nameStart = k
    while (k < body.length) {
      const code = body.charCodeAt(k)
      if (isSpaceCode(code) || code === 47 || code === 62) break
      k++
    }
    const name = localName(body.slice(nameStart, k).toLowerCase())
    if (BLOCK_LOCALS.has(name)) out += ' '
    i = end + 1
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 链接
 * ------------------------------------------------------------------ */

/**
 * 相对链接 → 绝对链接；无法解析时原样返回。
 * 已经是绝对 URL（含 mailto: / data: 等）时保持不变，不做归一化改写。
 */
export function absoluteUrl(link: string, baseUrl?: string): string {
  if (typeof link !== 'string') return ''
  const value = link.trim()
  if (value.length === 0) return ''
  try {
    // 已经绝对：原样返回（避免 new URL 改写掉尾斜杠/编码）
    const asIs = new URL(value)
    if (asIs.protocol.length > 0) return value
  } catch {
    /* 落到下面按相对链接处理 */
  }
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) return value
  try {
    return new URL(value, baseUrl).toString()
  } catch {
    return value
  }
}

/**
 * 从容器里挑正文链接。
 * - RSS/RDF：`<link>https://…</link>` 的文本
 * - Atom：`<link rel="alternate" href>` 或**没有 rel** 的 `href`；
 *   绝不取 `rel="self"` / `rel="replies"`
 */
function pickLink(node: XmlNode, baseUrl?: string): string | undefined {
  const links = node.children.filter((child) => matchesName(child, 'link'))
  // 1) 文本形式（RSS 2.0 / RDF）
  for (const link of links) {
    const text = plainText(link)
    if (text.length > 0) return absoluteUrl(text, baseUrl)
  }
  // 2) Atom：rel 缺省或 alternate
  for (const link of links) {
    const rel = attr(link, ['rel'])
    if (rel === undefined || rel.toLowerCase() === 'alternate') {
      const href = attr(link, ['href'])
      if (href !== undefined && href.length > 0) return absoluteUrl(href, baseUrl)
    }
  }
  // 3) 兜底：任何非 self / replies 的 href
  for (const link of links) {
    const rel = (attr(link, ['rel']) ?? '').toLowerCase()
    if (rel === 'self' || rel === 'replies') continue
    const href = attr(link, ['href'])
    if (href !== undefined && href.length > 0) return absoluteUrl(href, baseUrl)
  }
  return undefined
}

/* ------------------------------------------------------------------ *
 * cleanText
 * ------------------------------------------------------------------ */

/** 把可能含实体的文本解码成纯文本，并去掉 HTML 标签、压缩空白。 */
export function cleanText(input: string | undefined): string {
  if (typeof input !== 'string' || input.length === 0) return ''
  // 先解码、后剥标签：RSS 里大量摘要把 HTML 写成 `&lt;p&gt;…&lt;/p&gt;`，
  // 不先解码就剥不掉标签。整个流程只解码这一次，所以 `&amp;lt;` → `&lt;`（不会变成 `<`）。
  let text = decodeEntities(input)
  text = stripRawElement(text, 'script')
  text = stripRawElement(text, 'style')
  text = stripTags(text)
  return collapseWhitespace(text)
}

/* ------------------------------------------------------------------ *
 * 字段抽取
 * ------------------------------------------------------------------ */

/** summary 的字段优先级：description / summary / content:encoded / content */
const SUMMARY_FIELDS = ['description', 'summary', 'encoded', 'content'] as const
/** publishedAt 的字段优先级：pubDate / published / updated / dc:date / date */
const DATE_FIELDS = ['pubdate', 'published', 'updated', 'date'] as const
/** author 的字段优先级：author / dc:creator / itunes:author（后者的局部名也是 author） */
const AUTHOR_FIELDS = ['author', 'creator'] as const
/** guid 的字段优先级：guid / id / rdf:about */
const GUID_FIELDS = ['guid', 'id'] as const

/** 按优先级取第一个非空清洗结果。 */
function pickSummary(item: XmlNode): string | undefined {
  for (const want of SUMMARY_FIELDS) {
    for (const child of item.children) {
      if (!matchesName(child, want)) continue
      const text = cleanText(rawText(child))
      if (text.length > 0) return text
    }
  }
  return undefined
}

/** 按优先级取第一个能解析成合法日期的字段，转成 ISO 8601。 */
function pickDate(item: XmlNode): string | undefined {
  for (const want of DATE_FIELDS) {
    for (const child of item.children) {
      if (!matchesName(child, want)) continue
      const text = plainText(child)
      if (text.length === 0) continue
      const date = new Date(text)
      if (!Number.isNaN(date.getTime())) return date.toISOString()
    }
  }
  return undefined
}

function pickAuthor(item: XmlNode): string | undefined {
  for (const want of AUTHOR_FIELDS) {
    for (const child of item.children) {
      if (!matchesName(child, want)) continue
      // Atom <author><name>…</name><uri>…</uri></author>
      const nameNode = findChild(child, ['name'])
      const value = nameNode ? plainText(nameNode) : plainText(child)
      if (value.length > 0) return value
    }
  }
  return undefined
}

function pickGuid(item: XmlNode): string | undefined {
  const node = findChild(item, GUID_FIELDS)
  if (node) {
    const value = plainText(node)
    if (value.length > 0) return value
  }
  // rdf:about（RSS 1.0 的稳定标识）
  const about = attr(item, ['about'])
  if (about !== undefined && about.length > 0) return about
  return undefined
}

/** 正文候选节点（用于兜底找封面图）。 */
function bodyNodes(item: XmlNode): XmlNode[] {
  const out: XmlNode[] = []
  for (const want of SUMMARY_FIELDS) {
    for (const child of item.children) {
      if (matchesName(child, want)) out.push(child)
    }
  }
  return out
}

/** 正文里第一个 `<img src=…>`（传入的应是已解码一整轮后的正文）。 */
function firstImgSrc(decodedBody: string, baseUrl?: string): string | undefined {
  let i = 0
  while (i < decodedBody.length) {
    const start = indexOfCI(decodedBody, '<img', i)
    if (start < 0) return undefined
    const after = decodedBody.charAt(start + 4)
    if (after !== '' && after !== '>' && after !== '/' && !isSpaceCode(after.charCodeAt(0))) {
      i = start + 4
      continue
    }
    const end = findTagEnd(decodedBody, start + 4)
    if (end < 0) return undefined
    // 从 `<` 之后开始切，让 `img` 本身作为标签名被解析
    const parsed = parseStartTag(decodedBody.slice(start + 1, end))
    if (parsed) {
      const src = attr(parsed, ['src'])
      if (src !== undefined && src.trim().length > 0) return absoluteUrl(src, baseUrl)
    }
    i = end + 1
  }
  return undefined
}

/** 按优先级挑封面：enclosure(image/*) → media:content → media:thumbnail → itunes:image → 正文 <img>。 */
function pickImage(item: XmlNode, baseUrl?: string): string | undefined {
  // 1) <enclosure type="image/*" url>
  for (const child of item.children) {
    if (!matchesName(child, 'enclosure')) continue
    const url = attr(child, ['url'])
    if (url === undefined || url.length === 0) continue
    const type = attr(child, ['type'])
    // 没写 type 的宽容接受；写了就必须是图片，否则 text/html 的 enclosure 会被误当封面
    if (type !== undefined && type.length > 0 && !type.toLowerCase().startsWith('image/')) continue
    return absoluteUrl(url, baseUrl)
  }
  // 2) <media:content url>（局部名也是 content，但 Atom 的 <content> 没有 url 属性）
  for (const child of item.children) {
    if (!matchesName(child, 'content')) continue
    const url = attr(child, ['url'])
    if (url !== undefined && url.length > 0) return absoluteUrl(url, baseUrl)
  }
  // 3) <media:thumbnail url>
  for (const child of item.children) {
    if (!matchesName(child, 'thumbnail')) continue
    const url = attr(child, ['url'])
    if (url !== undefined && url.length > 0) return absoluteUrl(url, baseUrl)
  }
  // 4) <itunes:image href>
  for (const child of item.children) {
    if (!matchesName(child, 'image')) continue
    const href = attr(child, ['href'])
    if (href !== undefined && href.length > 0) return absoluteUrl(href, baseUrl)
  }
  // 5) 正文里第一个 <img src>
  //    正文可能被实体转义（`&lt;img …&gt;`），所以先整体解码一次再扫
  for (const node of bodyNodes(item)) {
    const raw = rawText(node)
    if (raw.length === 0) continue
    const img = firstImgSrc(decodeEntities(raw), baseUrl)
    if (img !== undefined) return img
  }
  return undefined
}

/** itunes:duration 文本，或 media:content 的 duration 属性。原样返回，不做格式归一化。 */
function pickDuration(item: XmlNode): string | undefined {
  for (const child of item.children) {
    if (!matchesName(child, 'duration')) continue
    const text = plainText(child)
    if (text.length > 0) return text
  }
  for (const child of item.children) {
    if (!matchesName(child, 'content')) continue
    const duration = attr(child, ['duration'])
    if (duration !== undefined && duration.trim().length > 0) return duration.trim()
  }
  return undefined
}

function toItem(node: XmlNode, baseUrl?: string): RssItem {
  const titleNode = findChild(node, ['title'])
  const item: RssItem = {
    title: titleNode ? plainText(titleNode) : '',
    link: pickLink(node, baseUrl) ?? absoluteUrl(attr(node, ['about']) ?? '', baseUrl),
  }
  const summary = pickSummary(node)
  if (summary !== undefined) item.summary = summary
  const publishedAt = pickDate(node)
  if (publishedAt !== undefined) item.publishedAt = publishedAt
  const author = pickAuthor(node)
  if (author !== undefined) item.author = author
  const guid = pickGuid(node)
  if (guid !== undefined) item.guid = guid
  const image = pickImage(node, baseUrl)
  if (image !== undefined) item.image = image
  const duration = pickDuration(node)
  if (duration !== undefined) item.duration = duration
  return item
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

/**
 * 解析 RSS 2.0 / Atom 1.0 / RSS 1.0(RDF)。
 * **永不抛异常**；不认识的输入返回 `{ items: [] }`。
 */
export function parseFeed(xml: string, baseUrl?: string): RssFeed {
  try {
    if (typeof xml !== 'string' || xml.length === 0) return { items: [] }
    const root = parseDocument(xml)
    if (!root) return { items: [] }

    let meta: XmlNode
    let itemNodes: XmlNode[]

    if (root.local === 'rss') {
      meta = findChild(root, ['channel']) ?? root
      itemNodes = meta.children.filter((child) => matchesName(child, 'item'))
    } else if (root.local === 'feed') {
      meta = root
      itemNodes = root.children.filter((child) => matchesName(child, 'entry'))
    } else if (root.local === 'rdf') {
      // RSS 1.0：channel 放元数据，item 与 channel 平级（少数实现塞在 channel 里）
      const channel = findChild(root, ['channel'])
      meta = channel ?? root
      itemNodes = root.children.filter((child) => matchesName(child, 'item'))
      if (channel) {
        for (const child of channel.children) {
          if (matchesName(child, 'item')) itemNodes.push(child)
        }
      }
    } else {
      return { items: [] }
    }

    const feed: RssFeed = { items: itemNodes.map((node) => toItem(node, baseUrl)) }

    const titleNode = findChild(meta, ['title'])
    const title = titleNode ? plainText(titleNode) : ''
    if (title.length > 0) feed.title = title

    const link = pickLink(meta, baseUrl)
    if (link !== undefined && link.length > 0) feed.link = link

    const descNode = findChild(meta, ['description', 'subtitle'])
    const description = descNode ? cleanText(rawText(descNode)) : ''
    if (description.length > 0) feed.description = description

    return feed
  } catch {
    // 兜底：任何意外都降级成空 feed，绝不把异常抛给调用方
    return { items: [] }
  }
}
