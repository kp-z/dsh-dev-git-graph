/*
 * 轻量 Markdown → DOM（对话气泡用）。
 *
 * 不用 innerHTML / 第三方渲染器：消息是模型写的，任何 HTML 注入面都不开。
 * 支持：标题、段落、粗体/斜体/删除线、行内代码、围栏代码、无序/有序列表、
 * 引用、分隔线、表格、http(s) 链接。够聊天用，不追求 CommonMark 全量。
 */

function el(doc, tag, className, text) {
  const node = doc.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function safeHref(raw) {
  const value = String(raw ?? '').trim()
  if (/^https?:\/\//i.test(value)) return value
  return null
}

function inline(doc, text) {
  const fragment = doc.createDocumentFragment()
  let rest = String(text ?? '')
  // 行内标记按出现位置切；不能先整体 split，否则链接里的 `*` 会被误判。
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  for (const match of rest.matchAll(pattern)) {
    if (match.index > last) fragment.append(doc.createTextNode(rest.slice(last, match.index)))
    const token = match[0]
    if (token.startsWith('`')) {
      fragment.append(el(doc, 'code', 'md-code', token.slice(1, -1)))
    } else if (token.startsWith('**')) {
      const strong = el(doc, 'strong')
      strong.append(inline(doc, token.slice(2, -2)))
      fragment.append(strong)
    } else if (token.startsWith('~~')) {
      const del = el(doc, 'del')
      del.append(inline(doc, token.slice(2, -2)))
      fragment.append(del)
    } else if (token.startsWith('*')) {
      const em = el(doc, 'em')
      em.append(inline(doc, token.slice(1, -1)))
      fragment.append(em)
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      const href = link === null ? null : safeHref(link[2])
      if (href === null) {
        fragment.append(doc.createTextNode(token))
      } else {
        const a = el(doc, 'a', 'md-link', link[1])
        a.href = href
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        fragment.append(a)
      }
    }
    last = match.index + token.length
  }
  if (last < rest.length) fragment.append(doc.createTextNode(rest.slice(last)))
  return fragment
}

function tableBlock(doc, lines) {
  const table = el(doc, 'table', 'md-table')
  const rows = lines.map((line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()))
  const separator = rows[1]?.every((cell) => /^:?-{3,}:?$/.test(cell)) === true
  const head = el(doc, 'thead')
  const headRow = el(doc, 'tr')
  for (const cell of rows[0] ?? []) headRow.append(el(doc, 'th', undefined, cell))
  head.append(headRow)
  table.append(head)
  const body = el(doc, 'tbody')
  for (const row of rows.slice(separator ? 2 : 1)) {
    const tr = el(doc, 'tr')
    for (const cell of row) tr.append(el(doc, 'td', undefined, cell))
    body.append(tr)
  }
  table.append(body)
  return table
}

export function renderMarkdown(doc, raw) {
  const fragment = doc.createDocumentFragment()
  const lines = String(raw ?? '').replace(/\r\n/g, '\n').split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (line.trim() === '') { index += 1; continue }

    const fence = /^```([^\s`]*)\s*$/.exec(line.trim())
    if (fence !== null) {
      const code = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index].trim())) { code.push(lines[index]); index += 1 }
      index += 1
      const pre = el(doc, 'pre', 'md-pre')
      pre.append(el(doc, 'code', 'md-code-block', code.join('\n')))
      fragment.append(pre)
      continue
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line)
    if (heading !== null) {
      const node = el(doc, `h${heading[1].length}`)
      node.append(inline(doc, heading[2]))
      fragment.append(node)
      index += 1
      continue
    }

    if (/^\s*\|?.+\|.+\|?\s*$/.test(line) && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const tableLines = [line, lines[index + 1]]
      index += 2
      while (index < lines.length && /^\s*\|/.test(lines[index])) { tableLines.push(lines[index]); index += 1 }
      fragment.append(tableBlock(doc, tableLines))
      continue
    }

    if (/^\s*([-*+])\s+/.test(line)) {
      const list = el(doc, 'ul', 'md-list')
      while (index < lines.length && /^\s*([-*+])\s+/.test(lines[index])) {
        const item = el(doc, 'li')
        item.append(inline(doc, lines[index].replace(/^\s*[-*+]\s+/, '')))
        list.append(item)
        index += 1
      }
      fragment.append(list)
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const list = el(doc, 'ol', 'md-list')
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        const item = el(doc, 'li')
        item.append(inline(doc, lines[index].replace(/^\s*\d+\.\s+/, '')))
        list.append(item)
        index += 1
      }
      fragment.append(list)
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote = el(doc, 'blockquote', 'md-quote')
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.append(el(doc, 'div', undefined, lines[index].replace(/^>\s?/, '')))
        index += 1
      }
      fragment.append(quote)
      continue
    }

    if (/^---+$/.test(line.trim())) {
      fragment.append(el(doc, 'hr', 'md-hr'))
      index += 1
      continue
    }

    const paragraph = [line]
    index += 1
    while (index < lines.length && lines[index].trim() !== '' &&
      !/^(#{1,4}\s|```|>\s?|\s*[-*+]\s+|\s*\d+\.\s+|---+$)/.test(lines[index]) &&
      !/^\s*\|/.test(lines[index])) {
      paragraph.push(lines[index])
      index += 1
    }
    const p = el(doc, 'p', 'md-p')
    p.append(inline(doc, paragraph.join('\n')))
    fragment.append(p)
  }
  return fragment
}
