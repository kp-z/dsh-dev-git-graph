// Verify every plugin installed in a DSH Desktop profile against the *real*
// compatibility gate that DSH Desktop runs at profile startup.
//
// Usage: node verify-gate.mjs [profileDir] [--json]
//
// The gate itself is imported from the installed DSH Desktop app so this check
// cannot drift from production behaviour:
//   dsh-app-boot/lib/index.js -> evaluatePluginCompatibility(manifest, exemptions)
// A plugin whose declared @deepseek-ai/dsh* peers do not admit the running
// runtime version gets its loader row disabled by prepareProfileEntries() and
// never loads. That is the failure mode this script measures.
import fs from 'node:fs'
import path from 'node:path'

const APP = '/Applications/DSH Desktop.app/Contents/Resources/app'
const appBoot = await import(
  path.join(APP, 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')
)
const { evaluatePluginCompatibility, getDshRuntimeVersion } = appBoot

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const profileDir = path.resolve(
  args.find((a) => !a.startsWith('--')) ||
    path.join(process.env.HOME, '.dsh/profiles/desktop'),
)

const runtime = getDshRuntimeVersion()
const pkg = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'))
const deps = Object.keys(pkg.dependencies || {}).sort()

const rows = []
for (const name of deps) {
  const dir = path.join(profileDir, 'node_modules', name)
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    rows.push({ name, status: 'MISSING', note: 'not installed' })
    continue
  }
  let issue
  try {
    issue = evaluatePluginCompatibility(manifest, {})
  } catch (error) {
    rows.push({ name, version: manifest.version, status: 'INVALID', note: error.message })
    continue
  }
  rows.push(
    issue
      ? { name, version: manifest.version, status: 'DENIED', peers: issue.peers }
      : { name, version: manifest.version, status: 'PASS' },
  )
}

const denied = rows.filter((r) => r.status !== 'PASS')

if (asJson) {
  console.log(
    JSON.stringify(
      {
        runtime,
        profileDir,
        rows,
        deniedCount: denied.length,
        denied: denied.map((r) => `${r.name}@${r.version ?? '?'}`),
      },
      null,
      2,
    ),
  )
} else {
  console.log(`runtime: ${runtime}`)
  console.log(`profile: ${profileDir}`)
  console.log('')
  for (const r of rows) {
    const mark = r.status === 'PASS' ? '  ok  ' : ' FAIL '
    console.log(
      `${mark} ${r.name.padEnd(44)} ${(r.version || '-').padEnd(9)} ${r.status}`,
    )
    if (r.peers) {
      for (const [peer, range] of Object.entries(r.peers)) {
        console.log(`         ${peer} needs ${range}`)
      }
    }
    if (r.note) console.log(`         ${r.note}`)
  }
  console.log('')
  console.log(`${rows.length - denied.length}/${rows.length} plugins pass the compatibility gate`)
}

process.exit(denied.length === 0 ? 0 : 1)
