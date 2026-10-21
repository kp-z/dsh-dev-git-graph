#!/usr/bin/env node
/**
 * 把 `tools/office-scene.tmx` 里每个对象的 `sort` / `depthBias` / 位置导回运行时（R234）。
 *
 * 用法：node scripts/import-scene-objects.mjs [tools/office-scene.tmx] [--dry-run]
 *
 * 产物：`src/vendor/microverse/scene/office-objects-override.json`
 * + 本机所有 profile 的 `lib/vendor/...`（存在才写）。
 * 运行时按对象 id（`tile:12` / `wall:3` / `chair:0`）读回，刷新页面即可生效。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const file = resolve(args.find((a) => !a.startsWith('--')) ?? 'tools/office-scene.tmx')
if (!existsSync(file)) { console.error(`✗ 找不到 ${file}`); process.exit(1) }
const text = readFileSync(file, 'utf8')

const objects = {}
for (const group of text.matchAll(/<objectgroup\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/objectgroup>/g)) {
  const layer = group[1]
  for (const m of group[2].matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const attrs = m[1]
    const attr = (name) => {
      const hit = new RegExp(`${name}="([^"]*)"`).exec(attrs)
      return hit === null ? null : hit[1]
    }
    const props = {}
    for (const p of m[2].matchAll(/<property\b([^>]*)\/?>/g)) {
      const name = /name="([^"]*)"/.exec(p[1])?.[1]
      const value = /value="([^"]*)"/.exec(p[1])?.[1]
      if (name !== undefined && value !== undefined) props[name] = value
    }
    const id = props.id
    if (id === undefined) continue
    const sort = props.sort ?? (layer === 'above' ? 'above' : 'sortable')
    const depthBias = Number(props.depthBias ?? 0)
    const x = Number(attr('x') ?? NaN)
    const y = Number(attr('y') ?? NaN)
    objects[id] = {
      sort,
      depthBias: Number.isFinite(depthBias) ? depthBias : 0,
      ...(Number.isFinite(x) ? { x } : {}),
      ...(Number.isFinite(y) ? { y } : {}),
    }
  }
}

const ids = Object.keys(objects)
if (ids.length === 0) { console.error('✗ 没读到对象（检查 objectgroup/property）'); process.exit(1) }
console.log(`· 读到 ${ids.length} 个对象（sortable/above/stations）`)

const REL = 'src/vendor/microverse/scene/office-objects-override.json'
const targets = [resolve(REL)]
const profiles = join(homedir(), '.dsh', 'profiles')
if (existsSync(profiles)) {
  for (const name of readdirSync(profiles)) {
    const dir = join(profiles, name, 'node_modules', 'dsh-agent-world', 'lib/vendor/microverse/scene')
    if (existsSync(dir)) targets.push(join(dir, 'office-objects-override.json'))
  }
}
if (dryRun) {
  console.log(`· dry-run：将写 ${targets.length} 处`)
  for (const t of targets) console.log(`    ${t}`)
  process.exit(0)
}
const payload = JSON.stringify({ objects })
for (const t of targets) writeFileSync(t, payload)
console.log(`✓ 已写 ${targets.length} 处覆盖文件；刷新页面即可。`)
