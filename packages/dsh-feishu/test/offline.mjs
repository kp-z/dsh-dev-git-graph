#!/usr/bin/env node
/** Run only isolated tests; the existing smoke explicitly uses live Feishu CLI. */
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const cwd = fileURLToPath(new URL('..', import.meta.url))
const files = readdirSync(new URL('.', import.meta.url)).filter((name) => name.endsWith('.mjs') && !['offline.mjs', 'smoke.mjs'].includes(name)).sort()
for (const file of files) {
  const result = spawnSync(process.execPath, ['test/' + file], { cwd, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}
for (const file of ['relations_api.py', 'comments_api.py']) {
  const result = spawnSync('python3', ['-B', 'test/' + file], { cwd, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}
console.log(`OFFLINE_OK: ${files.length} JavaScript files + 2 Python suites; live smoke excluded`)
