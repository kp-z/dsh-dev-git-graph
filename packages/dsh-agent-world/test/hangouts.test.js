/**
 * 待命落点要避开家具（R47 P0-1）。
 *
 * ## 这份测试的两半，故意分开
 *
 * **前半是纯函数**：`placeHangouts({bounds, count, blocked, minGap})` 的性质。
 * 判据只有两条，都是可算的：**落点到每个 blocked 的距离 ≥ 它的 radius**（硬）、
 * **落点两两 ≥ minGap**（软：放不下时按固定顺序放宽，但**绝不**放弃家具那条）。
 * 输入是**几何事实**，不带任何内容条目——所以这一半完全不依赖当前小镇长什么样。
 *
 * **后半是真内容**：用 `createWorld` 造内置小镇，对**真实站点**做同一套判据，
 * 并把距离表打出来。这一半才是"三个角色站在沙发里"那个现场。
 *
 * ## 后半的家具尺寸是**独立测的**，不是从 `src/` 抄的
 *
 * 如果测试用 `STATION_CLEARANCE` 去检查 `STATION_CLEARANCE`，那叫自己验自己。
 * 所以下面 `MEASURED_FOOTPRINT` 是从**实际会被渲染的几何**独立测出来的：
 *
 * - 程序化变体：`web/scene/builders.js` 里每个构建器的字面尺寸
 *   （例：`breakroom` = 圆桌 `r0.5` + 凳子 `x±0.78, r0.17` → 最远点 `hypot(0.95,0.37)=1.02`）；
 * - Kenney 变体：解析 `src/vendor/kenney-furniture` 下各 `.glb` 里 POSITION 访问器的 min/max，
 *   乘 `ModelEntry.scale`（站点 1.5 / 角色 2）——**用 `node:fs` 现读文件**，
 *   所以模型文件换了、或者 `scale` 改了，这张表会自动跟着变红。
 *
 * 再断言"生产表 `STATION_CLEARANCE` 至少覆盖这张独立表 + 人物身位"——
 * 这是两边唯一的连接点，方向是"证伪"而不是"复述"。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { STATION_CLEARANCE, AGENT_BODY_RADIUS, DEFAULT_MIN_GAP, hangoutArea, placeHangouts, stationClearance } from '../lib/world/hangouts.js'
import { createWorld } from '../lib/world/create.js'

// ── 独立测量：真实家具/角色的 XZ 半对角线（世界单位） ─────────────────────────

const VENDOR = fileURLToPath(new URL('../src/vendor/', import.meta.url))

/** 解析一个 GLB，返回 POSITION 访问器并上节点变换后的 XZ 半尺寸。 */
function glbHalfExtents(relativePath) {
  const buf = readFileSync(`${VENDOR}${relativePath}`)
  assert.equal(buf.readUInt32LE(0), 0x46546c67, `${relativePath} 不是 GLB`)
  const jsonLength = buf.readUInt32LE(12)
  const gltf = JSON.parse(buf.slice(20, 20 + jsonLength).toString('utf8'))
  const boxes = []
  const walk = (nodeIndex, scale, translate) => {
    const node = gltf.nodes[nodeIndex]
    const nextScale = (node.scale ?? [1, 1, 1]).map((v, i) => v * scale[i])
    const nextTranslate = (node.translation ?? [0, 0, 0]).map((v, i) => v * scale[i] + translate[i])
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives ?? []) {
        const accessor = gltf.accessors[primitive.attributes.POSITION]
        if (!accessor?.min || !accessor?.max) continue
        boxes.push({
          min: accessor.min.map((v, i) => v * nextScale[i] + nextTranslate[i]),
          max: accessor.max.map((v, i) => v * nextScale[i] + nextTranslate[i]),
        })
      }
    }
    for (const child of node.children ?? []) walk(child, nextScale, nextTranslate)
  }
  const scene = gltf.scenes?.[gltf.scene ?? 0]
  for (const nodeIndex of scene?.nodes ?? gltf.nodes.map((_, i) => i)) walk(nodeIndex, [1, 1, 1], [0, 0, 0])
  assert.ok(boxes.length > 0, `${relativePath} 里没有带 min/max 的 POSITION 访问器`)
  const min = [0, 2].map((axis) => Math.min(...boxes.map((b) => b.min[axis])))
  const max = [0, 2].map((axis) => Math.max(...boxes.map((b) => b.max[axis])))
  return { hx: (max[0] - min[0]) / 2, hz: (max[1] - min[1]) / 2 }
}

/**
 * 独立测出来的两套外观。
 *
 * - `glb` + `glbScale`：Kenney 变体。渲染器摆放时把它**居中**在 anchor 上
 *   （`recenterOnGround`），所以"从 anchor 到几何最远点"≈ 包围盒半对角线。
 * - `procedural`：程序化构建器的**盒尺寸**（用于"人是否穿进盒里"那条）+ `radius`
 *   （= 从 anchor 到该构建器最远点的距离，用于和 `STATION_CLEARANCE` 对账）。
 *   两者不一样：方块类构件的 `radius` 就是盒半对角线，圆柱类构件是 `中心距 + 半径`
 *   （休息区是圆桌 + 两只凳子，盒角是空角，`hypot(hx,hz)` 会比真实最远点大 0.1）。
 */
const MEASURED_FOOTPRINT = {
  desk: { glb: 'kenney-furniture/desk.glb', glbScale: 1.5, procedural: { hx: 0.475, hz: 0.325, radius: 0.575 } },
  meeting: { glb: 'kenney-furniture/table.glb', glbScale: 1.5, procedural: { hx: 0.75, hz: 0.45, radius: 0.875 } },
  server: { glb: 'kenney-furniture/bookcaseClosedWide.glb', glbScale: 1.5, procedural: { hx: 0.275, hz: 0.3, radius: 0.407 } },
  mailroom: { glb: 'kenney-furniture/cardboardBoxOpen.glb', glbScale: 1.5, procedural: { hx: 0.43, hz: 0.28, radius: 0.513 } },
  lab: { glb: 'kenney-furniture/deskCorner.glb', glbScale: 1.5, procedural: { hx: 0.5, hz: 0.35, radius: 0.61 } },
  breakroom: { glb: 'kenney-furniture/loungeSofa.glb', glbScale: 1.5, procedural: { hx: 0.95, hz: 0.5, radius: 0.975 } },
}

/** 某种 kind 在**最不利的那套外观**下，从 anchor 到几何最远点的距离。 */
function measuredRadius(kind) {
  const spec = MEASURED_FOOTPRINT[kind]
  const glb = glbHalfExtents(spec.glb)
  return Math.max(Math.hypot(glb.hx * spec.glbScale, glb.hz * spec.glbScale), spec.procedural.radius)
}

// ── 前半：纯函数的性质 ──────────────────────────────────────────────────────

const BOX = { min: { x: 0, z: 0 }, max: { x: 12, z: 12 } }
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
const minGapOf = (points) => {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) best = Math.min(best, dist(points[i], points[j]))
  }
  return best
}

test('placeHangouts：落点都在矩形内、个数正好、互不重合', () => {
  const points = placeHangouts({ bounds: BOX, count: 8 })
  assert.equal(points.length, 8)
  for (const p of points) {
    assert.ok(p.x > 0 && p.x < 12 && p.z > 0 && p.z < 12, `落点跑到地块外了：${JSON.stringify(p)}`)
  }
  assert.equal(new Set(points.map((p) => `${p.x},${p.z}`)).size, 8, '落点重合了')
})

test('placeHangouts：**确定性** —— 同输入同输出（同 seed 重开一局必须长得一样）', () => {
  const blocked = [{ at: { x: 6, z: 6 }, radius: 2.5 }]
  const a = placeHangouts({ bounds: BOX, count: 6, blocked, minGap: 1.8 })
  const b = placeHangouts({ bounds: BOX, count: 6, blocked, minGap: 1.8 })
  assert.deepEqual(a, b)
})

test('placeHangouts：没有家具时，人际间距达到目标（这是原来的行为，不该退化）', () => {
  const points = placeHangouts({ bounds: BOX, count: 9, minGap: 2 })
  assert.ok(minGapOf(points) >= 2, `最小间距 ${minGapOf(points).toFixed(3)} 没到目标 2`)
})

test('placeHangouts：家具是**硬约束** —— 任何落点到任何 blocked 的距离 ≥ 它的 radius', () => {
  const blocked = [
    { at: { x: 3, z: 3 }, radius: 2.2 },
    { at: { x: 9, z: 8 }, radius: 1.6 },
  ]
  for (const minGap of [2.5, 1.8, 0.6]) {
    const points = placeHangouts({ bounds: BOX, count: 10, blocked, minGap })
    assert.equal(points.length, 10)
    for (const p of points) {
      for (const spot of blocked) {
        assert.ok(
          dist(p, spot.at) >= spot.radius - 1e-9,
          `minGap=${minGap}：落点 ${JSON.stringify(p)} 离家具 ${JSON.stringify(spot)} 只有 ${dist(p, spot.at).toFixed(3)}，要求 ≥ ${spot.radius}`,
        )
      }
    }
  }
})

test('placeHangouts：挤不下时**先放弃人际间距**，不放弃家具约束（lead 定的优先级）', () => {
  // 一块只有 5×5 的空地，家具占掉中间一大块：10 个人按 minGap=2 肯定摆不开。
  const bounds = { min: { x: 0, z: 0 }, max: { x: 5, z: 5 } }
  const blocked = [{ at: { x: 2.5, z: 2.5 }, radius: 0.6 }]
  const points = placeHangouts({ bounds, count: 10, blocked, minGap: 2 })
  assert.equal(points.length, 10)
  for (const p of points) {
    assert.ok(dist(p, blocked[0].at) >= blocked[0].radius - 1e-9, `放宽间距时把家具约束也放掉了：${JSON.stringify(p)}`)
  }
  const gap = minGapOf(points)
  assert.ok(gap < 2, `这块地摆不下 10 个人还保持 2 的间距，应当放宽了：实际 ${gap.toFixed(3)}`)
  assert.ok(gap > 0, '放宽不等于重合')
})

test('placeHangouts：病态内容（地几乎被家具占满）也要**返回 count 个点**，且优先离家具远', () => {
  // 用一组重叠的圆覆盖左边 3/4，只留右边一条窄带。
  const blocked = []
  for (let x = 0; x <= 9; x += 1) for (let z = 0; z <= 12; z += 1) blocked.push({ at: { x, z }, radius: 1.05 })
  const points = placeHangouts({ bounds: BOX, count: 6, blocked, minGap: 1.8 })
  assert.equal(points.length, 6, '返回少于 count 会让调用方 i % length 把两个人分到同一格')
  assert.equal(new Set(points.map((p) => `${p.x},${p.z}`)).size, 6)
  for (const p of points) {
    assert.ok(p.x > 9.2, `安全区只剩右边那条带，落点应当在里面：${JSON.stringify(p)}`)
  }
})

test('placeHangouts：count<=0 给空数组；没有家具也不会除零', () => {
  assert.deepEqual(placeHangouts({ bounds: BOX, count: 0 }), [])
  assert.deepEqual(placeHangouts({ bounds: BOX, count: -3 }), [])
  // 退化成一条线/一个点的地块（宽或高为 0）也不该崩。
  assert.equal(placeHangouts({ bounds: { min: { x: 2, z: 2 }, max: { x: 2, z: 2 } }, count: 1 }).length, 1)
  assert.equal(placeHangouts({ bounds: { min: { x: 0, z: 3 }, max: { x: 10, z: 3 } }, count: 4 }).length, 4)
})

test('hangoutArea：优先广场，没有广场就退到最大的地块，都没有就退到原点附近', () => {
  const districts = [
    { id: 'a', kind: 'engineering', bounds: { min: { x: -20, z: -20 }, max: { x: 0, z: 0 } } },
    { id: 'b', kind: 'commons', bounds: { min: { x: 0, z: 0 }, max: { x: 4, z: 4 } } },
  ]
  assert.deepEqual(hangoutArea(districts), districts[1].bounds, '有广场就用广场，哪怕它不是最大的')
  assert.deepEqual(hangoutArea([districts[0]]), districts[0].bounds, '没广场退到最大的地块')
  assert.deepEqual(hangoutArea([]), { min: { x: -2, z: -2 }, max: { x: 2, z: 2 } }, '什么都没有也要给一块地方')
})

// ── 后半：真内容（内置小镇） ────────────────────────────────────────────────

function makeWorld() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({
    content,
    scene: 'scene.default-town',
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets: ['task.quick-fix'],
  })
}

/** 距离表（失败信息里直接贴这个，省得再去手算）。 */
function distanceTable(world) {
  const rows = world.agents.map((agent) => {
    const nearest = world.stations
      .map((station) => ({
        id: station.id.replace('station.', ''),
        d: dist(agent.hangout, station.anchor),
        margin: dist(agent.hangout, station.anchor) - stationClearance(station.kind),
      }))
      .sort((a, b) => a.margin - b.margin)[0]
    return `${agent.name.padEnd(5)} @ ${agent.hangout.x.toFixed(2)},${agent.hangout.z.toFixed(2)} → 最近 ${nearest.id.padEnd(9)} 距中心 ${nearest.d.toFixed(3)} 余量 ${nearest.margin.toFixed(3)}`
  })
  return rows.join('\n')
}

test('真内容：每个待命落点都避开**所有**站点（判据 = 到中心的距离 ≥ 该 kind 的半径）', () => {
  const world = makeWorld()
  for (const agent of world.agents) {
    assert.ok(agent.hangout !== null, `${agent.name} 没有歇脚点`)
    for (const station of world.stations) {
      const d = dist(agent.hangout, station.anchor)
      const need = stationClearance(station.kind)
      assert.ok(
        d >= need - 1e-9,
        `${agent.name} 站在 ${station.id} 里：距离 ${d.toFixed(3)} < 需要空出的 ${need}\n${distanceTable(world)}`,
      )
    }
  }
})

test('真内容：**旧的网格落点确实会撞上沙发**（这条钉住"修的不是幻觉"）', () => {
  const world = makeWorld()
  // 旧实现：把广场摊成 3×3 的栅格（1.6/4.0/6.4），它不认识站点。
  const LEGACY_GRID = [1.6, 4, 6.4].flatMap((x) => [1.6, 4, 6.4].map((z) => ({ x, z })))
  const breakroom = world.stations.find((s) => s.id === 'station.breakroom')
  assert.ok(breakroom, '内置场景应当有 station.breakroom')

  const violations = LEGACY_GRID.filter((p) => dist(p, breakroom.anchor) < stationClearance('breakroom'))
  assert.ok(
    violations.length > 0,
    `旧栅格里应当有点落在沙发的占地范围里（否则这条测试在验一个不存在的问题）：${JSON.stringify(LEGACY_GRID.map((p) => [p.x, p.z, dist(p, breakroom.anchor).toFixed(3)]))}`,
  )

  // 而新落点里，一个都不许是这些违规点。
  for (const agent of world.agents) {
    for (const bad of violations) {
      assert.ok(
        dist(agent.hangout, bad) > 1e-6,
        `${agent.name} 又落回旧的问题点 ${bad.x},${bad.z} 了\n${distanceTable(world)}`,
      )
    }
  }
})

test('真内容：家具盒（独立测的真实包围盒）里没有人 —— 两种外观都算过', () => {
  const world = makeWorld()
  for (const agent of world.agents) {
    for (const station of world.stations) {
      const spec = MEASURED_FOOTPRINT[station.kind]
      const glb = glbHalfExtents(spec.glb)
      const variants = [
        { name: 'Kenney GLB', hx: glb.hx * spec.glbScale, hz: glb.hz * spec.glbScale },
        { name: '程序化', hx: spec.procedural.hx, hz: spec.procedural.hz },
      ]
      for (const variant of variants) {
        const dx = Math.abs(agent.hangout.x - station.anchor.x)
        const dz = Math.abs(agent.hangout.z - station.anchor.z)
        const gap = Math.hypot(Math.max(0, dx - variant.hx), Math.max(0, dz - variant.hz))
        assert.ok(
          gap >= AGENT_BODY_RADIUS - 1e-9,
          `${agent.name} 的落点穿进了 ${station.id}（${variant.name} 外观）：到盒面 ${gap.toFixed(3)} < 身位 ${AGENT_BODY_RADIUS}\n${distanceTable(world)}`,
        )
      }
    }
  }
})

test('真内容：生产表 `STATION_CLEARANCE` 覆盖独立测出的真实尺寸（这是两边的连接点）', () => {
  for (const kind of Object.keys(STATION_CLEARANCE)) {
    const needed = measuredRadius(kind) + AGENT_BODY_RADIUS
    const declared = STATION_CLEARANCE[kind]
    assert.ok(
      declared >= needed - 0.02,
      `STATION_CLEARANCE.${kind} = ${declared} 小于"独立测出的最远点 ${measuredRadius(kind).toFixed(3)} + 身位 ${AGENT_BODY_RADIUS}" = ${needed.toFixed(3)}。` +
        '内容换了更大的家具、或 GLB 尺寸变了，就该更新这张表（或者把它挪进内容）。',
    )
  }
})

test('真内容：落点仍在广场里、互不重合、间距不劣于目标（原有性质不许退化）', () => {
  const world = makeWorld()
  // ⚠️ R62 起断言的是"**落在某个地块里**"，不再是"落在广场里"。
  //
  // 旧断言绑定了"内置场景只有一个 commons"这件事。而 R62 换上原版办公室（9 个房间）之后，
  // 玩家落点**按房间分配**（`hangoutsForWorld`）——那是刻意的：旧做法取"第一个 commons"，
  // 换成 9 个房间后 8 个人**全挤在健身房里**（真机实测），而且会把全世界的包围盒当候选区，
  // 于是人会落进**墙里**（`blocked` 只知道家具、不知道墙）。
  //
  // 真正要守的不变式是"落点在某个房间内部"（所以人不会站在墙里），下面还照旧查
  // 互不重合与间距——那两条才是这个测试的原始价值。
  const inside = (p) =>
    world.districts.some(
      (d) =>
        p.x >= Math.min(d.bounds.min.x, d.bounds.max.x) &&
        p.x <= Math.max(d.bounds.min.x, d.bounds.max.x) &&
        p.z >= Math.min(d.bounds.min.z, d.bounds.max.z) &&
        p.z <= Math.max(d.bounds.min.z, d.bounds.max.z),
    )
  const points = world.agents.map((a) => a.hangout)

  for (const p of points) {
    assert.ok(inside(p), `落点跑到所有地块之外了（会站在墙里）：${JSON.stringify(p)}`)
  }
  assert.equal(new Set(points.map((p) => `${p.x},${p.z}`)).size, points.length, '落点重合了（M2.5-1 的原始 bug）')
  assert.ok(
    minGapOf(points) >= DEFAULT_MIN_GAP - 1e-9,
    `最小人际间距 ${minGapOf(points).toFixed(3)} 低于目标 ${DEFAULT_MIN_GAP}\n${distanceTable(world)}`,
  )
})
