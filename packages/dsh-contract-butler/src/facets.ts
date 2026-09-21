import type { ContractRecord, ShapeNode } from './types.js'

/**
 * 分面：把"几百条契约该怎么看"这件事，从面板手里收回来放在宿主侧算一次。
 *
 * 面板自己的头注已经定下原则——判定在宿主算好，两边各算一次必然会分叉。分面归属是判定，
 * 所以在这里算；面板只按 tag 做集合运算（过滤与计数），从机制上不可能和宿主对不上。
 *
 * tag 一律形如 `轴:取值`，前缀就是轴 id。
 */
export type FacetTag = string

export interface FacetAxis {
  id: string
  label: string
  /** 这个轴回答的问题。界面上直接显示，省得人去猜每个分面是干什么的。 */
  hint: string
  /** 这个轴的取值是不是可能同时有多个（事态：既变过又有不符）。 */
  multiple?: boolean
}

/**
 * 轴的顺序就是界面上从左到右的顺序，也是"人的问题"的顺序：
 * 先问"现在要不要我看"，再问"它属于哪儿、是谁跟谁在说话"，最后才是"怎么抽出来的"。
 */
export const FACET_AXES: FacetAxis[] = [
  { id: 'state', label: '事态', hint: '现在需不需要你看', multiple: true },
  { id: 'module', label: '模块', hint: '属于哪块功能' },
  { id: 'channel', label: '通道', hint: '谁和谁在通信' },
  { id: 'kind', label: '种类', hint: '边界的形态' },
  { id: 'source', label: '来源', hint: '抽取的保真度' },
  { id: 'shape', label: '形状', hint: '纳管后看不看得见内容' },
  { id: 'dup', label: '重复', hint: '同一形状的多份表示' },
]

/** 形状里有没有实际字段。全是空对象的形状等于"看得见这个契约，看不见它的内容"。 */
export function hasFields(shape: ShapeNode | null): boolean {
  if (shape === null || typeof shape !== 'object') return false
  const fields = (shape as { fields?: unknown }).fields
  if (fields === null || typeof fields !== 'object') return false
  return Object.keys(fields as Record<string, unknown>).length > 0
}

export function isShapeless(contract: ContractRecord): boolean {
  return !hasFields(contract.input) && !hasFields(contract.output)
}

/**
 * 模块：文件路径的顶层目录。放在根下的文件归到 `(根)`，否则一个项目会被拆出一堆同名分组。
 */
export function moduleOf(file: string): string {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '')
  const cut = normalized.indexOf('/')
  if (cut <= 0) return '(根)'
  return normalized.slice(0, cut)
}

const HTTP_METHODS = /^(get|post|put|patch|delete|head|options)$/

/**
 * 通道：边界字符串的第一个词。`tool:example_echo` 是 `tool`，`POST /x/y` 是 `http`。
 * 认不出来就老实说 `other`，不要硬猜一个漂亮的分类。
 */
export function channelOf(contract: ContractRecord): string {
  const boundary = contract.boundary
  const cut = boundary.search(/[:\s]/)
  const head = (cut < 0 ? boundary : boundary.slice(0, cut)).toLowerCase()
  if (head === '') return 'other'
  if (HTTP_METHODS.test(head)) return 'http'
  return head
}

/**
 * 与时间无关的分面。事态那一条不在这里——它要等演化与观测的记录都算好才知道。
 */
export function structuralFacets(contract: ContractRecord): FacetTag[] {
  return [
    `module:${moduleOf(contract.file)}`,
    `channel:${channelOf(contract)}`,
    `kind:${contract.boundaryKind}`,
    `source:${contract.source}`,
    `shape:${isShapeless(contract) ? 'none' : 'has'}`,
    `dup:${contract.twins.length > 0 ? 'yes' : 'no'}`,
  ]
}

/**
 * 事态分面：唯独这个轴会同时挂多个取值——一条契约可以既变过又有不符，那是两件要分别处理的事。
 */
export function stateFacets(input: { changed: boolean; finding: boolean }): FacetTag[] {
  const tags: FacetTag[] = []
  if (input.changed) tags.push('state:changed')
  if (input.finding) tags.push('state:finding')
  return tags
}

/** 取值的中文标签。面板直接用，避免同一个取值在两处被写成两种说法。 */
export const FACET_VALUE_LABELS: Record<string, Record<string, string>> = {
  state: { changed: '变过', finding: '有不对', clean: '无变化' },
  shape: { has: '有形状', none: '没形状' },
  dup: { yes: '有重复', no: '无重复' },
}

export function facetValueLabel(axis: string, value: string): string {
  const axisLabels = FACET_VALUE_LABELS[axis]
  if (axisLabels !== undefined && axisLabels[value] !== undefined) return axisLabels[value] as string
  return value
}