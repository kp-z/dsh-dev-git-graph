/**
 * 项目画像的回归测试。
 *
 * 画像会被**送进模型**，所以这里的重点不是"能不能抽到关键词"，而是三条硬约束：
 * - **敏感文件绝不读**（不能"读了再过滤" —— 不读才是真的安全）
 * - **有界**（单文件/总量/文件数都有上限，别把几 G 的目录读一遍）
 * - **可审计**（读了什么、跳过了什么、为什么，都要能查）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
	collectProjectProfile,
	depsFromPackageJson,
	describeProfile,
	extractKeywords,
	isSensitiveName,
	shouldSkipDir,
	shouldSkipFile,
} from '../lib/profile.js'

// ---------- 敏感文件 ----------

test('isSensitiveName：凭据类文件名必须被挡下（宁可漏信息，不能送密钥）', () => {
	const dangerous = [
		'.env',
		'.env.local',
		'.env.production',
		'id_rsa',
		'id_ed25519',
		'secret.pem',
		'private.key',
		'credentials.json',
		'credentials',
		'secrets.yaml',
		'.npmrc',
		'.netrc',
		'.git-credentials',
		'keystore.jks',
		'service-account-prod.json',
		'.htpasswd',
	]
	for (const name of dangerous) {
		assert.equal(isSensitiveName(name), true, `${name} 应被判定为敏感`)
	}
	const safe = ['README.md', 'package.json', 'tsconfig.json', 'main.ts', 'index.js', 'LICENSE']
	for (const name of safe) {
		assert.equal(isSensitiveName(name), false, `${name} 不该被误判`)
	}
})

test('shouldSkipDir / shouldSkipFile：依赖与大目录不进去，锁文件不读', () => {
	for (const name of ['node_modules', '.git', 'dist', 'build', 'target', '.venv', '__pycache__', '.next']) {
		assert.equal(shouldSkipDir(name), true, `${name}/ 应跳过`)
	}
	assert.equal(shouldSkipDir('src'), false)
	assert.equal(shouldSkipDir('.github'), false, '.github 含 CI 配置，是有效信息')

	for (const name of ['pnpm-lock.yaml', 'package-lock.json', 'Cargo.lock', 'go.sum']) {
		assert.equal(shouldSkipFile(name), true, `${name} 应跳过（体积大、信息量低）`)
	}
	assert.equal(shouldSkipFile('.env'), true, '敏感文件也算 skip')
	assert.equal(shouldSkipFile('src.ts'), false)
})

// ---------- 关键词 ----------

test('extractKeywords：英文词去掉停用词、中文取双字组、顺序稳定', () => {
	const keywords = extractKeywords(
		'RSS 解析器 parser parser the and with 日报 日报 主动 推荐 推荐 RSS',
		10,
	)
	assert.ok(keywords.includes('parser'), `应保留实体词：${keywords.join(',')}`)
	assert.ok(keywords.includes('rss'))
	assert.ok(!keywords.includes('the') && !keywords.includes('and'), '停用词该被滤掉')
	assert.ok(keywords.includes('日报') || keywords.includes('推荐'), `应含中文双字组：${keywords.join(',')}`)
	// 高频优先（rss 与 parser 都出现 2 次 → 同频按字典序 → parser 在前）
	assert.deepEqual(keywords.slice(0, 2).sort(), ['parser', 'rss'], `前两名应是最高频的两个：${keywords.join(',')}`)
	// 同样的输入两次结果一致（可复现）
	assert.deepEqual(extractKeywords('abc abc def', 5), extractKeywords('abc abc def', 5))
})

test('extractKeywords：limit 生效；空输入不炸', () => {
	assert.equal(extractKeywords('a b c d e f g h', 3).length, 0, '长度 <3 的都不算词')
	assert.ok(extractKeywords('alpha beta gamma delta epsilon', 2).length <= 2)
	assert.deepEqual(extractKeywords('', 5), [])
})

// ---------- 依赖 ----------

test('depsFromPackageJson：合并运行时/peer/开发依赖、去重、容错', () => {
	const deps = depsFromPackageJson({
		name: 'x',
		dependencies: { a: '1', b: '2' },
		peerDependencies: { b: '3', c: '4' },
		devDependencies: { d: '5' },
	})
	assert.deepEqual(deps, ['a', 'b', 'c', 'd'], '运行时在前、去重、版本号不带')
	assert.deepEqual(depsFromPackageJson(null), [])
	assert.deepEqual(depsFromPackageJson({ dependencies: 'nope' }), [])
})

// ---------- 采集（真实文件系统） ----------

async function makeProject(t, files) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-profile-'))
	t.after(() => rm(dir, { recursive: true, force: true }))
	for (const [rel, content] of Object.entries(files)) {
		const full = path.join(dir, rel)
		await mkdir(path.dirname(full), { recursive: true })
		await writeFile(full, content, 'utf8')
	}
	return dir
}

test('采集：`src/` 目录**不能**当成 Python 的证据（实测误报过）', async (t) => {
	// 典型的 TS 项目：顶层有 src/ 但没有 pyproject/requirements
	const dir = await makeProject(t, {
		'package.json': '{"name":"ts-app"}',
		'tsconfig.json': '{}',
		'src/index.ts': 'export const x = 1',
	})
	const profile = await collectProjectProfile(dir)
	assert.ok(
		!profile.languages.some((l) => l.name === 'Python'),
		`不该把 src/ 当 Python 证据：${JSON.stringify(profile.languages)}`,
	)
})

test('采集：cmd/ 与 internal/ 成对出现时判为 Go（没有 manifest 也能认）', async (t) => {
	const dir = await makeProject(t, {
		'cmd/server/main.go': 'package main',
		'internal/store/store.go': 'package store',
	})
	const profile = await collectProjectProfile(dir)
	assert.ok(profile.languages.some((l) => l.name === 'Go'), JSON.stringify(profile.languages))
	assert.ok(!profile.languages.some((l) => l.name === 'Node.js'), '没有 package.json 就不该报 Node')
})

test('采集：读出 README/manifest，识别技术栈与依赖', async (t) => {
	const dir = await makeProject(t, {
		'README.md': '# 我的项目\n\n这是一个用来验证画像的**测试项目**，处理 RSS 与视频索引。\n',
		'package.json': JSON.stringify({
			name: 'demo-app',
			dependencies: { fastify: '^5', zod: '^3' },
			devDependencies: { typescript: '^5' },
		}),
		'tsconfig.json': '{"compilerOptions":{}}',
		'src/main.ts': 'export const x = 1',
	})
	await mkdir(path.join(dir, 'node_modules', 'junk'), { recursive: true })
	await writeFile(path.join(dir, 'node_modules', 'junk', 'a.js'), 'x'.repeat(1000))

	const profile = await collectProjectProfile(dir)
	assert.equal(profile.name, path.basename(dir))
	assert.deepEqual(profile.files.map((f) => f.path).sort(), ['README.md', 'package.json', 'tsconfig.json'])
	assert.ok(profile.languages.some((l) => l.name === 'TypeScript'))
	assert.ok(profile.languages.some((l) => l.name === 'Node.js'))
	assert.deepEqual(profile.dependencies, ['fastify', 'zod', 'typescript'])
	assert.ok(profile.topLevel.includes('node_modules'), '顶层应记录 node_modules（不进目录也是信息）')
	assert.ok(!profile.topLevel.includes('a.js'), '绝不该读到 node_modules 里的文件')
	assert.ok(profile.keywords.length > 0)
	assert.ok(profile.summary.includes('fastify'), '摘要里应带依赖')
})

test('采集：**敏感文件绝不读** —— 内容一个字都不能进画像', async (t) => {
	const SECRET = 'sk-live-DO-NOT-LEAK-0123456789abcdef'
	const dir = await makeProject(t, {
		'README.md': '# 项目\n正常内容。\n',
		'.env': `API_KEY=${SECRET}\n`,
		'.env.local': `TOKEN=${SECRET}\n`,
		'id_rsa': SECRET,
		'certs/server.pem': SECRET,
		'credentials.json': JSON.stringify({ token: SECRET }),
	})

	const profile = await collectProjectProfile(dir)

	// 1) 一个都不该被读
	const readPaths = profile.files.map((f) => f.path)
	for (const name of ['.env', '.env.local', 'id_rsa', 'certs/server.pem', 'credentials.json']) {
		assert.ok(!readPaths.includes(name), `${name} 绝不该出现在"已读"里`)
	}
	// 2) 秘密字符串不能出现在任何输出里（这是最重要的一条断言）
	const haystack = JSON.stringify(profile)
	assert.ok(!haystack.includes(SECRET), '密钥泄漏进了画像 —— 这是最严重的问题')
	// 3) 但用户要能看到"跳过了什么"（可审计）
	const sensitiveSkipped = profile.skipped.filter((s) => s.reason.includes('敏感'))
	assert.ok(sensitiveSkipped.length >= 3, `应记录跳过的敏感文件，实际 ${JSON.stringify(profile.skipped)}`)
	assert.ok(sensitiveSkipped.some((s) => s.path === '.env'))
})

test('采集：单文件与总量都有上限，超长会被截断并标注', async (t) => {
	const dir = await makeProject(t, {
		'README.md': 'x'.repeat(50_000),
		'package.json': JSON.stringify({ name: 'big' }),
	})
	const profile = await collectProjectProfile(dir, { maxFileBytes: 1000, maxTotalBytes: 1500, readmeChars: 200 })
	const readme = profile.files.find((f) => f.path === 'README.md')
	assert.ok(readme, 'README 应被读到')
	assert.equal(readme.truncated, true, '超长应标记为截断')
	assert.ok(readme.bytes <= 1000, `单文件不该超过上限，实际 ${readme.bytes}`)
	assert.ok(profile.bytes <= 1500, `总量不该超过上限，实际 ${profile.bytes}`)
	assert.ok(profile.summary.length < 4000, `摘要要有界，实际 ${profile.summary.length}`)
})

test('采集：文件数上限生效，超出部分记为跳过', async (t) => {
	const dir = await makeProject(t, {
		'README.md': '# a',
		'package.json': '{"name":"x"}',
		'tsconfig.json': '{}',
		'Makefile': 'all:',
	})
	const profile = await collectProjectProfile(dir, { maxFiles: 2 })
	assert.equal(profile.files.length, 2)
	assert.ok(profile.skipped.some((s) => s.reason.includes('上限')))
})

test('采集：目录不存在时返回空画像而不是抛异常', async () => {
	const profile = await collectProjectProfile('/tmp/definitely-not-here-' + Date.now())
	assert.deepEqual(profile.files, [])
	assert.equal(profile.keywords.length, 0)
	assert.match(profile.summary, /无法读取/)
	assert.ok(profile.skipped.length > 0, '失败原因要留下来')
})

test('describeProfile：一句话能说清画像', async (t) => {
	const dir = await makeProject(t, {
		'package.json': '{"name":"x"}',
		'.env': 'A=1',
	})
	const profile = await collectProjectProfile(dir)
	const text = describeProfile(profile)
	assert.match(text, /Node\.js/)
	assert.match(text, /读了 \d+ 个文件/)
	assert.match(text, /已跳过 1 个敏感文件/)
})

// ---------- 真实项目自检 ----------

test('真实自检：给本插件自己的源码目录做画像', async () => {
	const dir = path.resolve(import.meta.dirname, '..')
	const profile = await collectProjectProfile(dir)

	// 它是 TypeScript + Node 项目，依赖里有 dsh-tools
	assert.ok(profile.languages.some((l) => l.name === 'TypeScript'), '应识别出 TypeScript')
	assert.ok(profile.languages.some((l) => l.name === 'Node.js'))
	assert.ok(
		profile.dependencies.some((d) => d.includes('dsh-tools')),
		`依赖应含 dsh-tools，实际 ${profile.dependencies.slice(0, 8).join(',')}`,
	)
	// 读了 README 与 package.json
	const read = profile.files.map((f) => f.path)
	assert.ok(read.includes('package.json'))
	assert.ok(read.some((p) => p.startsWith('README')), `应读到 README，实际读了 ${read.join(',')}`)
	// 有界
	assert.ok(profile.bytes <= 256 * 1024, `不该超预算，实际 ${profile.bytes}`)
	assert.ok(profile.files.length <= 24)
	// node_modules 没被读进来
	assert.ok(!read.some((p) => p.includes('node_modules')))
	// 摘要可用（至少说了技术栈与目录）
	assert.ok(profile.summary.includes('工作目录'))
	assert.ok(profile.summary.length > 100)
})
