/**
 * 相机 / 拾取 / 锚点（R57）—— 两个渲染器**共用这一份**，所以测这一份就等于测两边。
 *
 * 为什么这份测试是"换渲染器不换行为"的凭据：
 * Pixi 那一半跑在浏览器里（它 import 'pixi.js'，node 里进不来），
 * 但**换算不归它管**——`cameraFor / pickActor / anchorFor` 由它和 canvas2D 同时调用。
 * 换算被钉住了，剩下能漂的就只有"谁调用它"，那件事由浏览器里的双后端对照覆盖
 * （同一批坐标喂两个后端，8 个角色都点回自己，锚点像素值逐字节相同）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ANCHOR_LIFT_PX, cameraFor, liveActors, pickActor, tilePhasePx } from '../web/core/scene-camera.js'
import { anchorFor } from '../web/core/scene-camera.js'

const SCENE = { extent: { half: 8 }, noteColors: { report: '#7C8CFF' } }
const WORLD = {
  agents: [
    { id: 'agent-1', name: '甲', position: { x: 1.6, z: 6.4 }, facing: 0, state: 'idle' },
    { id: 'agent-2', name: '乙', position: { x: 6.4, z: 1.6 }, facing: Math.PI, state: 'walking' },
  ],
}
const PLAN = {
  ...SCENE,
  actors: [
    { id: 'agent-1', name: '甲', role: 'lead', x: -4, z: -4, facing: 0, state: 'idle', color: '#FBBF24', modelId: 'model.a' },
    { id: 'agent-2', name: '乙', role: 'docs', x: 4, z: 4, facing: 0, state: 'idle', color: '#4ADE80', modelId: 'model.b' },
  ],
}

test('相机：整数倍缩放（真机那一档 1400×748 → 2 倍），坐标可往返', () => {
  const camera = cameraFor({ viewWidth: 1400, viewHeight: 748, half: 8 })
  assert.equal(camera.worldPx, 256, '世界 16×16 格 × 16px = 256 源像素')
  assert.equal(camera.zoom, 2, 'floor(748 / (256×1.06)) = 2 —— 取整是像素画的命')
  assert.equal(camera.scale, 32)
  // 世界中心在画布中心
  assert.equal(camera.toX(0), 700)
  assert.equal(camera.toY(0), 374)
  // 往返
  for (const value of [-7.5, -1, 0, 3.25, 7.5]) {
    assert.ok(Math.abs(camera.toWorldX(camera.toX(value)) - value) < 1e-9)
    assert.ok(Math.abs(camera.toWorldZ(camera.toY(value)) - value) < 1e-9)
  }
})

test('相机：缩放永远是整数，且被夹在 [1, 6]', () => {
  for (const [w, h] of [[4000, 3000], [1400, 748], [800, 600], [320, 240], [100, 100], [0, 0]]) {
    const camera = cameraFor({ viewWidth: w, viewHeight: h, half: 8 })
    assert.ok(Number.isInteger(camera.zoom), `zoom 必须是整数，实际 ${camera.zoom}（${w}×${h}）`)
    assert.ok(camera.zoom >= 1 && camera.zoom <= 6, `zoom=${camera.zoom} 越界（${w}×${h}）`)
  }
})

test('拾取：点角色脚下点中他自己；容差是**像素**不是世界单位', () => {
  const camera = cameraFor({ viewWidth: 1400, viewHeight: 748, half: 8 })
  const rect = { left: 0, top: 0 }
  const at = (a) => ({ clientX: camera.toX(a.position.x), clientY: camera.toY(a.position.z) })
  assert.equal(pickActor({ world: WORLD, camera, ...at(WORLD.agents[0]), rect }), 'agent-1')
  assert.equal(pickActor({ world: WORLD, camera, ...at(WORLD.agents[1]), rect }), 'agent-2')
  // 偏 5px 仍点中（容差内），偏 40px 点不中
  const near = at(WORLD.agents[0])
  assert.equal(pickActor({ world: WORLD, camera, rect, clientX: near.clientX + 5, clientY: near.clientY }), 'agent-1')
  assert.equal(pickActor({ world: WORLD, camera, rect, clientX: near.clientX + 40, clientY: near.clientY }), null)
  // 换算里带上了画布的页面偏移（rect.left/top）——否则气泡挂在画布上、点击跑到别处
  const shifted = { left: 300, top: 56 }
  assert.equal(pickActor({ world: WORLD, camera, rect: shifted, clientX: near.clientX + 300, clientY: near.clientY + 56 }), 'agent-1')
})

test('拾取：两个角色挨着时返回**更近**的那个；没人点不中；相机没尺寸也不炸', () => {
  const camera = cameraFor({ viewWidth: 1400, viewHeight: 748, half: 8 })
  const rect = { left: 0, top: 0 }
  const close = { agents: [
    { id: 'a', position: { x: 0, z: 0 } },
    { id: 'b', position: { x: 0.3, z: 0 } }, // 0.3 世界单位 = 9.6px（容差 16px 内）
  ] }
  assert.equal(pickActor({ world: close, camera, rect, clientX: camera.toX(0.25), clientY: camera.toY(0) }), 'b')
  assert.equal(pickActor({ world: close, camera, rect, clientX: camera.toX(0.05), clientY: camera.toY(0) }), 'a')
  assert.equal(pickActor({ world: { agents: [] }, camera, rect, clientX: 10, clientY: 10 }), null)
  assert.equal(pickActor({ world: WORLD, camera: null, rect, clientX: 10, clientY: 10 }), null)
  assert.equal(pickActor({ world: WORLD, camera: cameraFor({ viewWidth: 0, viewHeight: 0 }), rect, clientX: 10, clientY: 10 }), null)
})

test('锚点：角色头顶在**画布**里的像素位置（气泡挂钩用），未知 id 返回 null', () => {
  const camera = cameraFor({ viewWidth: 1400, viewHeight: 748, half: 8 })
  const anchor = anchorFor({ world: WORLD, camera, agentId: 'agent-1' })
  assert.deepEqual(anchor, {
    x: camera.toX(1.6), y: camera.toY(6.4) - ANCHOR_LIFT_PX, width: 1400, height: 748, behind: false,
  })
  assert.equal(anchorFor({ world: WORLD, camera, agentId: '没有这个人' }), null)
  assert.equal(anchorFor({ world: null, camera, agentId: 'agent-1' }), null)
})

test('liveActors：实时位姿来自 world、外观来自 plan（两个渲染器都靠它）', () => {
  const actors = liveActors(WORLD, PLAN)
  assert.equal(actors.length, 2)
  assert.deepEqual([actors[0].x, actors[0].z], [1.6, 6.4], '画的必须是**实时**位姿，不是快照那一帧')
  assert.equal(actors[0].color, '#FBBF24', '配色来自内容计划')
  assert.equal(actors[0].modelId, 'model.a')
  assert.equal(actors[1].state, 'walking')
  // 计划里没有的角色：用中性色，而不是凭空编一个人设（D37）
  const extra = liveActors({ agents: [{ id: 'x', name: '新来的', position: { x: 0, z: 0 } }] }, PLAN)
  assert.equal(extra[0].color, '#7C8CFF')
  assert.equal(extra[0].modelId, null)
  // 快照还没回来时退回计划本身
  assert.deepEqual(liveActors(null, PLAN), PLAN.actors)
})

test('平铺相位：按**世界网格**取相位（跨区花纹才对得上）', () => {
  // 8×8 的区、中心在 ±4 → 左边界落在整格上，相位 0
  assert.equal(tilePhasePx({ leftWorld: -8, tileUnits: 2, scale: 32 }), 0)
  assert.equal(tilePhasePx({ leftWorld: 0, tileUnits: 2, scale: 32 }), 0)
  // 左边界在 -0.5 → 上一格起点是 -2，偏了 1.5 单位 = 48px
  assert.equal(tilePhasePx({ leftWorld: -0.5, tileUnits: 2, scale: 32 }), 48)
  // 负半轴也成立
  assert.equal(tilePhasePx({ leftWorld: -0.25, tileUnits: 2, scale: 16 }), 28)
  assert.equal(tilePhasePx({}), 0)
})
