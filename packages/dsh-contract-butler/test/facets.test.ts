import assert from 'node:assert/strict'
import test from 'node:test'
import type { ContractRecord, ShapeNode } from '../lib/types.js'
import {
  FACET_AXES,
  channelOf,
  facetValueLabel,
  isShapeless,
  moduleOf,
  stateFacets,
  structuralFacets,
} from '../lib/facets.js'

/**
 * 分面是"几百条怎么看"的依据，判错了界面就会把人引到错的地方去，所以每条规则都要钉住。
 */
function contract(patch: Partial<ContractRecord> = {}): ContractRecord {
  return {
    id: 'c_1',
    projectId: 'p_1',
    file: 'src/a.ts',
    boundary: 'tool:example_echo',
    boundaryKind: 'tool',
    source: 'tools-runtime',
    title: 'example_echo',
    symbol: 'example_echo',
    input: null,
    output: null,
    twins: [],
    evidence: { line: 1, hash: 'h' },
    confidence: 0.95,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  }
}

function shape(fields: Record<string, ShapeNode>): ShapeNode {
  return { kind: 'object', fields } as unknown as ShapeNode
}

test('模块：顶层目录归堆，根下的文件单独一组', () => {
  assert.equal(moduleOf('src/a.ts'), 'src')
  assert.equal(moduleOf('packages/x/src/y.ts'), 'packages')
  assert.equal(moduleOf('index.ts'), '(根)')
  assert.equal(moduleOf('./src/a.ts'), 'src')
})

test('通道：认得 tool 与 http，认不出来就说 other 而不是硬猜', () => {
  assert.equal(channelOf(contract({ boundary: 'tool:example_echo' })), 'tool')
  assert.equal(channelOf(contract({ boundary: 'POST /x/y' })), 'http')
  assert.equal(channelOf(contract({ boundary: 'get /a' })), 'http')
  assert.equal(channelOf(contract({ boundary: 'type:Config' })), 'type')
  assert.equal(channelOf(contract({ boundary: '' })), 'other')
})

test('形状：全是空对象的形状等于没有形状', () => {
  assert.equal(isShapeless(contract()), true)
  assert.equal(isShapeless(contract({ output: shape({}) })), true)
  assert.equal(isShapeless(contract({ output: shape({ a: shape({}) }) })), false)
  assert.equal(isShapeless(contract({ input: shape({ a: shape({}) }), output: null })), false)
})

test('结构分面：六个轴一次给全，形状与重复按实际值标', () => {
  const tags = structuralFacets(contract({ twins: ['c_2'] }))
  assert.deepEqual(tags, [
    'module:src',
    'channel:tool',
    'kind:tool',
    'source:tools-runtime',
    'shape:none',
    'dup:yes',
  ])
  assert.deepEqual(structuralFacets(contract({ output: shape({ a: shape({}) }) })), [
    'module:src',
    'channel:tool',
    'kind:tool',
    'source:tools-runtime',
    'shape:has',
    'dup:no',
  ])
})

test('事态分面：可以同时挂两个——变过和有不对是两件要分别处理的事', () => {
  assert.deepEqual(stateFacets({ changed: false, finding: false }), [])
  assert.deepEqual(stateFacets({ changed: true, finding: false }), ['state:changed'])
  assert.deepEqual(stateFacets({ changed: false, finding: true }), ['state:finding'])
  assert.deepEqual(stateFacets({ changed: true, finding: true }), ['state:changed', 'state:finding'])
})

test('取值标签：认识的给中文，不认识的原样返回而不是编一个', () => {
  assert.equal(facetValueLabel('state', 'changed'), '变过')
  assert.equal(facetValueLabel('shape', 'none'), '没形状')
  assert.equal(facetValueLabel('source', 'ts-pattern'), 'ts-pattern')
  assert.equal(facetValueLabel('nope', 'x'), 'x')
})

test('轴的定义齐备且 id 唯一——面板按这个顺序铺，缺一个就是少一个入口', () => {
  const ids = FACET_AXES.map((axis) => axis.id)
  assert.deepEqual(ids, ['state', 'module', 'channel', 'kind', 'source', 'shape', 'dup'])
  assert.equal(new Set(ids).size, ids.length)
  for (const axis of FACET_AXES) {
    assert.ok(axis.label.length > 0)
    assert.ok(axis.hint.length > 0)
  }
  // 事态是唯一一个一条契约可能同时命中多个取值的轴。
  assert.equal(FACET_AXES.filter((axis) => axis.multiple === true).length, 1)
})