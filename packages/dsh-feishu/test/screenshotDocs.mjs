import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

// Privacy regression: screenshots are intentionally not published with this plugin.
const root = fileURLToPath(new URL('..', import.meta.url))
async function imagesIn(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const files = []
  for (const entry of entries) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) files.push(...await imagesIn(path))
    else if (/\.(?:png|jpe?g|webp|gif)$/i.test(entry.name)) files.push(path)
  }
  return files
}
assert.deepEqual(await imagesIn(resolve(root, 'docs/shots')), [], 'No screenshot files in publication directory')
for (const file of ['README.md', 'docs/USER-GUIDE.md']) {
  const text = await readFile(resolve(root, file), 'utf8')
  assert.ok(!/!?\[[^\]]*\]\([^)]*(?:docs\/)?shots\//.test(text), 'No screenshot links: ' + file)
}
console.log('SCREENSHOT_PRIVACY_OK: no published screenshot images or screenshot links; runtime art untouched')
