#!/usr/bin/env node
/**
 * 把 **Tiled** 里画的碰撞矩形导回运行时（R233 的"用现成编辑器"路线）。
 *
 * 用法：
 *   node scripts/import-tiled-colliders.mjs [tools/office-colliders.tmx] [--dry-run]
 *
 * 支持 Tiled 的 `.tmx`（XML）与 `.tmj`/`.json` 导出（JSON）。规则：
 * - 取名为 `colliders` 的对象图层（没有就取第一个对象图层）；
 * - 每个矩形对象的 x/y/width/height 直接当地图像素写进覆盖文件；
 * - 写 `src/vendor/microverse/scene/office-colliders-override.json`，
 *   以及本机所有 `~/.dsh/profiles/<p>/node_modules/dsh-agent-world/lib/vendor/...`。
 *
 * 覆盖文件存在时宿主**完全以它为准**（见 `src/routes/api.ts` 的 readOverride），
 * 刷新 Agent World 页面即可看到，不用重启。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const file = resolve(args.find((a) => !a.startsWith('--')) ?? 'tools/office-colliders.tmx')
const REL = 'src/vendor/microverse/scene/office-colliders-override.json'
const LIB_DIR = 'lib/vendor/microverse/scene'
const OVERRIDE_NAME = 'office-colliders-override.json'

function fromTmx(text) {
  const group = /<objectgroup\b[^>]*name="colliders"[^>]*>([\s\S]*?)<\/objectgroup>/i.exec(text)
    ?? /<objectgroup\b[^>]*>([\s\S]*?)<\/objectgroup>/i.exec(text)
  if (group === null) return []
  const rects = []
  for (const m of group[1].matchAll(/<object\b([^>]*?)\/?>/g)) {
    const attr = (name) => {
      const hit = new RegExp(`${name}="([^"]*)"`).exec(m[1])
      return hit === null ? null : Number(hit[1])
    }
    const x = attr('x')
    const y = attr('y')
    const w = attr('width') ?? 0
    const h = attr('height') ?? 0
    if (![x, y, w, h].every((v) => v !== null && Number.isFinite(v)) || w <= 0 || h <= 0) continue
    rects.push([Math.round(x), Math.round(y), Math.round(w), Math.round(h)])
  }
  return rects
}

function fromJson(text) {
  const map = JSON.parse(text)
  const layers = Array.isArray(map?.layers) ? map.layers : []
  const layer = layers.find((l) => l?.type === 'objectgroup' && l?.name === 'colliders') ?? layers.find((l) => l?.type === 'objectgroup')
  if (!layer || !Array.isArray(layer.objects)) return []
  const rects = []
  for (const o of layer.objects) {
    const [x, y, w, h] = [Number(o.x), Number(o.y), Number(o.width ?? 0), Number(o.height ?? 0)]
    if (![x, y, w, h].every((v) => Number.isFinite(v)) || w <= 0 || h <= 0) continue
    rects.push([Math.round(x), Math.round(y), Math.round(w), Math.round(h)])
  }
  return rects
}

if (!existsSync(file)) {
  console.error(`✗ 找不到 ${file}`)
  process.exit(1)
}
const text = readFileSync(file, 'utf8')
const rects = file.endsWith('.tmx') ? fromTmx(text) : fromJson(text)
if (rects.length === 0) {
  console.error('✗ 没读到矩形对象。检查对象图层是否叫 colliders、且矩形有 width/height。')
  process.exit(1)
}
rects.sort((a, b) => a[1] - b[1] || a[0] - b[0])

const targets = [resolve(REL)]
const profiles = join(homedir(), '.dsh', 'profiles')
if (existsSync(profiles)) {
  for (const name of readdirSync(profiles)) {
    const dir = join(profiles, name, 'node_modules', 'dsh-agent-world', LIB_DIR)
    if (existsSync(dir)) targets.push(join(dir, OVERRIDE_NAME))
  }
}

if (dryRun) {
  console.log(`· dry-run：读到 ${rects.length} 个矩形；将写 ${targets.length} 处：`)
  for (const t of targets) console.log(`    ${t}`)
  process.exit(0)
}
for (const target of targets) writeFileSync(target, JSON.stringify({ rects, savedAt: new Date().toISOString() }))
console.log(`✓ 已导入 ${rects.length} 个矩形 → ${targets.length} 处覆盖文件；刷新页面即可。`)
