/**
 * 抽取器的单元测试。
 *
 * 断言对齐的是**实际输出**（先跑出来看过再写），不是设想中的输出——抽取器最容易出的问题
 * 不是抛错，而是"安静地少抽了一个字段"。所以每个格式都同时钉住候选数量与关键形状。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openApiExtractor, jsonSchemaExtractor } from '../lib/extract/jsonFiles.js'
import { protoExtractor } from '../lib/extract/proto.js'
import { tsPatternExtractor } from '../lib/extract/tsPattern.js'
import { candidateId, linkTwins } from '../lib/extract/registry.js'
import { candidatesFromTools, RUNTIME_FILE } from '../lib/extract/tools.js'

const ctx = { root: '/tmp', read: async () => null }

test('proto：抽 message / enum / rpc，boundary 带 package 前缀', () => {
  const text = `syntax = "proto3";
package shop.v1;
message User {
  string id = 1;
  repeated string tags = 2;
  map<string, int32> scores = 3;
}
message Req { string id = 1; }
message Resp { User user = 1; }
enum Status { UNKNOWN = 0; ACTIVE = 1; }
service UserService {
  rpc Get (Req) returns (Resp);
  rpc Watch (Req) returns (stream Resp) {}
}
`
  const list = protoExtractor.extract('proto/user.proto', text, ctx)
  const boundaries = list.map((item) => item.boundary).sort()
  assert.deepEqual(boundaries, [
    'proto:shop.v1.Req',
    'proto:shop.v1.Resp',
    'proto:shop.v1.Status',
    'proto:shop.v1.User',
    'rpc:shop.v1.UserService.Get',
    'rpc:shop.v1.UserService.Watch',
  ])

  const user = list.find((item) => item.boundary === 'proto:shop.v1.User')
  assert.ok(user, '应当抽到 User')
  assert.equal(user.boundaryKind, 'proto')
  assert.equal(user.output?.kind, 'object')
  assert.deepEqual(user.output?.fields?.tags, { kind: 'array', of: { kind: 'string' } })
  assert.deepEqual(user.output?.fields?.scores, { kind: 'object' })

  const rpc = list.find((item) => item.boundary === 'rpc:shop.v1.UserService.Get')
  assert.equal(rpc?.input?.kind, 'object')
  assert.equal(rpc?.output?.kind, 'object')
})

test('proto：单行 enum 体不能只认第一个取值', () => {
  const oneLine = protoExtractor.extract('a.proto', 'enum E { A = 0; B = 1; C = 2; }', ctx)
  const multiLine = protoExtractor.extract('a.proto', 'enum E {\n A = 0;\n B = 1;\n C = 2;\n}', ctx)
  assert.deepEqual(oneLine[0]?.output, { kind: 'string', enumValues: ['A', 'B', 'C'] })
  assert.deepEqual(multiLine[0]?.output, oneLine[0]?.output)
})

test('proto：字段类型引用 message 时展开，引用 enum 时带上取值', () => {
  const text = `message Outer { Inner inner = 1; Color color = 2; }
message Inner { string x = 1; }
enum Color { RED = 0; BLUE = 1; }`
  const list = protoExtractor.extract('a.proto', text, ctx)
  const outer = list.find((item) => item.boundary === 'proto:Outer')
  assert.equal(outer?.output?.fields?.inner?.kind, 'object')
  assert.deepEqual(outer?.output?.fields?.inner?.fields?.x, { kind: 'string' })
  assert.deepEqual(outer?.output?.fields?.color?.enumValues, ['RED', 'BLUE'])
})

test('proto：proto3 的单数字段标为可选，repeated/map 不标', () => {
  const text = `syntax = "proto3";
message M {
  string a = 1;
  repeated string b = 2;
  map<string, string> c = 3;
}`
  const [message] = protoExtractor.extract('a.proto', text, ctx)
  assert.equal(message?.output?.fields?.a?.optional, true)
  assert.equal(message?.output?.fields?.b?.optional, undefined)
  assert.equal(message?.output?.fields?.c?.optional, undefined)
  assert.equal(message?.output?.fields?.b?.of?.kind, 'string')
})

test('proto：坏输入返回空数组而不抛错', () => {
  for (const bad of ['}}} 不是 proto ((', 'message A { string x = 1;', '', 'service']) {
    assert.doesNotThrow(() => protoExtractor.extract('a.proto', bad, ctx))
    assert.deepEqual(protoExtractor.extract('a.proto', bad, ctx), [])
  }
})

test('proto：只匹配 .proto 文件', () => {
  assert.equal(protoExtractor.match('a.proto'), true)
  assert.equal(protoExtractor.match('a.PROTO'), true)
  assert.equal(protoExtractor.match('a.txt'), false)
})

test('OpenAPI：operation 抽成 http 边界，components.schemas 抽成 schema 边界', () => {
  const document = JSON.stringify({
    openapi: '3.0.0',
    paths: {
      '/users/{id}': {
        get: {
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { id: { type: 'string' }, age: { type: 'integer' } },
                    required: ['id'],
                  },
                },
              },
            },
          },
        },
      },
    },
    components: { schemas: { User: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  })
  const list = openApiExtractor.extract('openapi.json', document, ctx)
  const operation = list.find((item) => item.boundary === 'GET /users/{id}')
  assert.ok(operation, `应当抽到 operation，实际 ${list.map((item) => item.boundary).join(', ')}`)
  assert.equal(operation.boundaryKind, 'http')
  assert.equal(operation.output?.fields?.age?.kind, 'number')
  assert.equal(operation.input?.fields?.id?.kind, 'string')
  assert.ok(list.some((item) => item.boundary === 'schema:User'))
})

test('JSON Schema：抽成一条 schema 候选并展开 type 数组里的 null', () => {
  const document = JSON.stringify({
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: ['string', 'null'] } },
    required: ['a'],
  })
  const list = jsonSchemaExtractor.extract('schema.json', document, ctx)
  assert.equal(list.length, 1)
  assert.equal(list[0]?.boundaryKind, 'schema')
  assert.equal(list[0]?.output?.fields?.a?.kind, 'string')
  assert.equal(list[0]?.output?.fields?.b?.nullable, true)
})

test('JSON Schema：$ref 走本地解析', () => {
  const document = JSON.stringify({
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: { user: { $ref: '#/definitions/User' } },
    definitions: { User: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  })
  const list = jsonSchemaExtractor.extract('schema.json', document, ctx)
  assert.equal(list[0]?.output?.fields?.user?.fields?.id?.kind, 'string')
})

test('ts-pattern：抽 export interface 与 export type', () => {
  const text = `export interface Order {
  id: string
  total: number
  tags?: string[]
  state: 'new' | 'done'
  user: { name: string }
  nick: string | null
}
export type Id = string
`
  const list = tsPatternExtractor.extract('src/types.ts', text, ctx)
  const order = list.find((item) => item.boundary === 'type:Order')
  assert.ok(order, `应当抽到 Order，实际 ${list.map((item) => item.boundary).join(', ')}`)
  assert.equal(order.boundaryKind, 'schema')
  assert.equal(order.confidence, 0.7)
  assert.deepEqual(order.output?.fields?.tags, { kind: 'array', of: { kind: 'string' }, optional: true })
  assert.deepEqual(order.output?.fields?.state?.enumValues, ['new', 'done'])
  assert.equal(order.output?.fields?.user?.fields?.name?.kind, 'string')
  assert.equal(order.output?.fields?.nick?.nullable, true)
  assert.ok(list.some((item) => item.boundary === 'type:Id'))
})

test('ts-pattern：抽 defineTool 调用（含 parameters DSL 与输出 schema）', () => {
  const text = `export const t = defineTool({
  name: 'read_file',
  description: 'x',
  parameters: { path: { type: 'string', required: true }, limit: { type: 'number' } },
  output: { schema: { type: 'object', properties: { text: { type: 'string' } } } },
})`
  const list = tsPatternExtractor.extract('src/tool.ts', text, ctx)
  const tool = list.find((item) => item.boundary === 'tool:read_file')
  assert.ok(tool, `应当抽到 defineTool，实际 ${list.map((item) => item.boundary).join(', ')}`)
  assert.equal(tool.boundaryKind, 'tool')
  assert.equal(tool.confidence, 0.8)
  assert.equal(tool.input?.fields?.path?.optional, undefined)
  assert.equal(tool.input?.fields?.limit?.optional, true)
  assert.equal(tool.output?.fields?.text?.kind, 'string')
})

test('ts-pattern：忽略声明文件，坏输入不抛错', () => {
  assert.equal(tsPatternExtractor.match('a.d.ts'), false)
  assert.equal(tsPatternExtractor.match('a.tsx'), true)
  assert.equal(tsPatternExtractor.match('a.mjs'), true)
  assert.doesNotThrow(() => tsPatternExtractor.extract('a.ts', 'export interface {', ctx))
  assert.deepEqual(tsPatternExtractor.extract('a.ts', '}}}}', ctx), [])
})

test('工具注册表：参数与输出各自的 schema 抽成一条 tool 边界', () => {
  const list = candidatesFromTools([
    {
      name: 'read_file',
      description: 'x',
      parameters: { path: { type: 'string', required: true }, limit: { type: 'number' } },
      output: { schema: { type: 'object', properties: { text: { type: 'string' } } } },
    },
    { name: 'no_schema_tool' },
  ])
  const tool = list.find((item) => item.boundary === 'tool:read_file')
  assert.ok(tool)
  assert.equal(tool.boundaryKind, 'tool')
  assert.equal(tool.file, RUNTIME_FILE)
  assert.equal(tool.confidence, 0.95)
  assert.equal(tool.input?.fields?.path?.kind, 'string')
  assert.equal(tool.output?.fields?.text?.kind, 'string')
  // 没有任何声明的工具不该产出候选：没有可对照的东西。
  assert.ok(!list.some((item) => item.boundary === 'tool:no_schema_tool'))
})

test('candidateId 与行号无关：同一个边界在文件里挪位置不会产生新契约', () => {
  const a = candidateId('a.proto', 'proto:X', 'X')
  const b = candidateId('a.proto', 'proto:X', 'X')
  assert.equal(a, b)
  assert.match(a, /^c_[0-9a-f]{12}$/)
  assert.notEqual(a, candidateId('b.proto', 'proto:X', 'X'))
})

test('linkTwins 把输入输出指纹相同的候选互相串起来', () => {
  const shape = { kind: 'object' as const, fields: { id: { kind: 'string' as const } } }
  const make = (id: string, boundary: string) => ({
    id,
    file: 'a.ts',
    boundary,
    boundaryKind: 'tool' as const,
    source: 'x',
    title: id,
    symbol: id,
    input: null,
    output: shape,
    twins: [],
    evidence: { line: 1, hash: 'h' },
    confidence: 1,
    note: '',
  })
  const linked = linkTwins([make('c_1', 'tool:a'), make('c_2', 'tool:b')])
  assert.deepEqual(linked[0]?.twins, ['c_2'])
  assert.deepEqual(linked[1]?.twins, ['c_1'])
})
