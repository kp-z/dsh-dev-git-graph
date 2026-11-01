import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

// Documentation integrity only. This test does not claim pixel/visual review.
const root = fileURLToPath(new URL('..', import.meta.url))
const readme = await readFile(resolve(root, 'README.md'), 'utf8')
const manifest = JSON.parse(await readFile(resolve(root, 'docs/shots/v021/manifest.json'), 'utf8'))
const images = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1])
assert.equal(images.length, manifest.images.length, 'Every embedded screenshot has provenance')
assert.ok(images.every((path) => path.startsWith('docs/shots/v021/')), 'Old screenshots are not embedded')
assert.equal(new Set(images).size, images.length, 'No duplicate screenshot embeds')
for (const image of manifest.images) {
  const path = resolve(root, 'docs/shots/v021', image.file)
  const textReview = manifest.textReview?.results.find((row) => row.file === image.file)
  assert.ok(textReview && textReview.missing.length === 0, 'Embedded screenshot passes recorded local OCR text checks: ' + image.file)
  await access(path)
  assert.ok(images.includes('docs/shots/v021/' + image.file), image.file + ' must be documented')
  const bytes = await readFile(path)
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature')
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), image.sha256, 'Image changed: repeat content checks before updating provenance')
  assert.deepEqual({ width, height }, image.pixelSize, 'Recorded screenshot dimensions match')
  assert.ok(width > 0 && height > 0, 'Nonempty screenshot')
  assert.ok(image.region.width === undefined && image.region.w > 0 && image.region.h > 0)
  for (const target of image.targets) {
    const rect = target.rect, crop = image.region
    assert.ok(rect.x >= crop.x - 3 && rect.y >= crop.y - 3, 'Target starts inside source crop: ' + image.file)
    assert.ok(rect.x + rect.width <= crop.x + crop.w + 3 && rect.y + rect.height <= crop.y + crop.h + 3, 'Target fits source crop: ' + image.file)
  }
}
for (const rejected of manifest.rejected || []) assert.ok(!images.includes('docs/shots/v021/' + rejected.file), 'Rejected screenshot cannot be embedded')
assert.equal(manifest.visualReview, 'not-performed-model-has-no-image-input')
assert.ok(!JSON.stringify(manifest).includes('/Users/'), 'No private raw screenshot paths')
assert.match(readme, /非评论历史截图/)
assert.match(readme, /当前截图模型不支持图像输入/)
assert.ok(!readme.includes('<!-- screenshot:'))
console.log('SCREENSHOT_DOCS_OK: references, unique provenance, PNG headers and target bounds; not visual review')
