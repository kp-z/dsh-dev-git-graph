/**
 * 成员贴图头像（R157）—— 纯函数单测。
 *
 * 判据三层：
 *   1. 找得到：actor → model → sheet → 动画 → 图集 URL；
 *   2. 找得到但**形状不对**（缺 sheet / 缺动画 / 缺尺寸）→ 必须返回 null，让调用方退回字母头像，
 *      而不是拿一个 NaN 去拼 CSS（`url(undefined)` / `background-position(NaN)` 都是静默坏）；
 *   3. 算得出：背景三件套的位移与缩放要用同一把尺子（头像尺寸变了不会错位）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AVATAR_CROP_Y, AVATAR_PX, resolveMemberSprite, spriteAvatarStyle } from '../web/core/member-avatar.js'

function sceneWith(overrides = {}) {
  return {
    actors: [{ id: 'agent-1', modelId: 'model.agent.tom' }],
    models: [
      {
        id: 'model.agent.tom',
        url: 'microverse/characters/Tomx32.png',
        sheet: {
          cellW: 32,
          cellH: 64,
          animations: { 'idle.down': { col: 18, row: 1, frames: 6 } },
        },
      },
    ],
    ...overrides,
  }
}

test('找得到：actor → model → idle.down 首帧', () => {
  const sprite = resolveMemberSprite(sceneWith(), 'agent-1')
  assert.deepEqual(sprite, {
    url: './vendor/microverse/characters/Tomx32.png',
    col: 18,
    row: 1,
    cellW: 32,
    cellH: 64,
  })
})

test('找不到就返回 null（调用方退回字母头像）', () => {
  assert.equal(resolveMemberSprite(null, 'agent-1'), null)
  assert.equal(resolveMemberSprite(sceneWith(), 'agent-unknown'), null)
  assert.equal(resolveMemberSprite(sceneWith(), null), null)
  assert.equal(resolveMemberSprite(sceneWith({ actors: [] }), 'agent-1'), null)
  assert.equal(
    resolveMemberSprite(sceneWith({ models: [{ id: 'model.agent.tom', url: 'a.png', sheet: null }] }), 'agent-1'),
    null,
    '没有 sheet（程序化模型）时不能拼出一张图',
  )
  assert.equal(
    resolveMemberSprite(sceneWith({ models: [{ id: 'model.agent.tom', url: null, sheet: { cellW: 32, cellH: 64 } }] }), 'agent-1'),
    null,
    '没有 url 时不能拼 url(null)',
  )
  assert.equal(
    resolveMemberSprite(sceneWith({ models: [{ id: 'model.agent.tom', url: 'a.png', sheet: { cellW: 0, cellH: 64 } }] }), 'agent-1'),
    null,
    '尺寸 0 会让缩放除零',
  )
  assert.equal(
    resolveMemberSprite(
      sceneWith({ models: [{ id: 'model.agent.tom', url: 'a.png', sheet: { cellW: 32, cellH: 64, animations: {} } }] }),
      'agent-1',
    ),
    null,
    '没有任何动画时不能猜一帧',
  )
})

test('没有 idle.down 时退回 idle，再退回第一条（不猜名字）', () => {
  const withIdle = sceneWith({
    models: [
      {
        id: 'model.agent.tom',
        url: 'a.png',
        sheet: { cellW: 32, cellH: 64, animations: { idle: { col: 6, row: 1 } } },
      },
    ],
  })
  assert.equal(resolveMemberSprite(withIdle, 'agent-1')?.col, 6)

  const withAny = sceneWith({
    models: [
      {
        id: 'model.agent.tom',
        url: 'a.png',
        sheet: { cellW: 32, cellH: 64, animations: { 'sit.down': { col: 18, row: 4 } } },
      },
    ],
  })
  assert.equal(resolveMemberSprite(withAny, 'agent-1')?.row, 4)
})

test('背景三件套：用图集原始像素（不能把整张图压成 30px）', () => {
  const style = spriteAvatarStyle({
    url: './vendor/microverse/characters/Tomx32.png',
    col: 18,
    row: 1,
    cellW: 32,
    cellH: 64,
  })
  assert.equal(style.backgroundImage, 'url(./vendor/microverse/characters/Tomx32.png)')
  // ⚠️ 这条是 R157 真机 bug 的回归判据：`30px auto` 会把 1792px 的图集压成一格 0.5px。
  assert.equal(style.backgroundSize, 'auto')
  assert.equal(style.backgroundPosition, `-${18 * 32}px -${1 * 64 + AVATAR_CROP_Y}px`)
})

test('位移只由格号与格子尺寸决定（与头像框大小无关）', () => {
  const sprite = { url: 'a.png', col: 2, row: 3, cellW: 32, cellH: 64 }
  const style = spriteAvatarStyle(sprite)
  assert.equal(style.backgroundPosition, `${-2 * 32}px ${-(3 * 64 + AVATAR_CROP_Y)}px`)
})

test('图集 URL：裸路径补 ./vendor/，绝对/相对路径原样使用', () => {
  const withUrl = (url) =>
    resolveMemberSprite(
      sceneWith({
        models: [
          {
            id: 'model.agent.tom',
            url,
            sheet: { cellW: 32, cellH: 64, animations: { idle: { col: 0, row: 0 } } },
          },
        ],
      }),
      'agent-1',
    )?.url
  assert.equal(withUrl('https://cdn.example/a.png'), 'https://cdn.example/a.png')
  assert.equal(withUrl('/assets/a.png'), '/assets/a.png')
  assert.equal(withUrl('./x/a.png'), './x/a.png')
  assert.equal(
    resolveMemberSprite(
      sceneWith({
        models: [{ id: 'model.agent.tom', url: '', sheet: { cellW: 32, cellH: 64, animations: { idle: { col: 0, row: 0 } } } }],
      }),
      'agent-1',
    ),
    null,
    '空 url 不能拼成 url()',
  )
})
