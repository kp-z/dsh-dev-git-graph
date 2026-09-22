#!/usr/bin/env node
/**
 * 咒语库命令行。
 *
 *   node scripts/vault.mjs rebuild [--force]
 *   node scripts/vault.mjs stats
 *   node scripts/vault.mjs search "玻璃面板" [--limit 5] [--tier all] [--category 材质]
 *   node scripts/vault.mjs get liquid-glass
 *   node scripts/vault.mjs drift
 *   node scripts/vault.mjs events [--limit 20]
 *   node scripts/vault.mjs propose "要个跟着指针动的按钮" [--limit 3]
 *   node scripts/vault.mjs inbox
 *
 * 环境变量 SPELLBOOK_VAULT 可以指定数据库路径，默认 packages/dsh-spellbook/data/vault.db。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defaultVaultPaths, openVault, VaultError } from '../shared/vault.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(arg)
    }
  }
  return { flags, positional }
}

const paths = defaultVaultPaths(ROOT)
if (process.env.SPELLBOOK_VAULT) paths.dbPath = process.env.SPELLBOOK_VAULT

const { flags, positional } = parseArgs(process.argv.slice(2))
const command = positional[0]

if (!command || command === 'help' || flags.help) {
  console.log(`咒语库命令：
  rebuild [--force]                        把 content/effects/*.md 投影进库里
  stats                                    条目、分层、事件计数
  search "关键词" [--limit 5] [--tier all]  检索（默认只从 core 出）
  get <slug>                               取一条完整咒语
  drift                                    报告投影与 md 的差异
  events [--limit 20]                      最近的事件
  propose "一句话需求" [--limit 3]          跑检索并记成待决提议
  inbox [--state new]                      收件箱
  export [--out 路径]                      导出唯一不可重建的那部分
  import <备份文件>                        合并一份备份（按内容去重，可重复导入）
库位置：${paths.dbPath}`)
  process.exit(0)
}

const vault = openVault(paths)

try {
  switch (command) {
    case 'rebuild': {
      const result = vault.rebuild({ force: Boolean(flags.force) })
      console.log(
        result.skipped
          ? `内容没变，跳过重建（${result.entries} 条）`
          : `已重建：${result.entries} 条咒语 → ${paths.dbPath}`,
      )
      break
    }

    case 'stats': {
      const s = vault.stats()
      console.log(`咒语 ${s.entries} 条`)
      console.log(`  分层  ${Object.entries(s.byTier).map(([k, v]) => `${k} ${v}`).join('  ') || '（空）'}`)
      console.log(`  分类  ${Object.entries(s.byCategory).map(([k, v]) => `${k} ${v}`).join('  ') || '（空）'}`)
      console.log(`事件 ${s.events} 条　待决提议 ${s.pendingProposals}　待策展 ${s.inboxNew}`)
      console.log(`构建于 ${s.builtAt ?? '（还没建过）'}`)
      break
    }

    case 'search': {
      const query = positional.slice(1).join(' ')
      if (!query) throw new VaultError('search 需要关键词')
      const hits = vault.search(query, {
        limit: Number(flags.limit ?? 8),
        tier: flags.tier ?? 'core',
        category: flags.category ?? null,
      })
      if (!hits.length) {
        console.log(`「${query}」没有命中（tier=${flags.tier ?? 'core'}）`)
        break
      }
      for (const [i, hit] of hits.entries()) {
        console.log(
          `${i + 1}. ${hit.slug}  ${hit.title}  [${hit.category}/${hit.tier}]  ${hit.score.toFixed(4)}  ${hit.why}`,
        )
        console.log(`   ${hit.when}`)
        // 边界跟着命中一起端出来：采纳之前，用户最该知道的是这条什么时候不管用。
        if (hit.caveats?.length) console.log(`   边界：${hit.caveats.join(' / ')}`)
      }
      break
    }

    case 'get': {
      const slug = positional[1]
      if (!slug) throw new VaultError('get 需要 slug')
      const entry = vault.get(slug)
      if (!entry) {
        console.log(`没有 ${slug}`)
        break
      }
      console.log(`${entry.meta.title}（${entry.meta.slug}）`)
      console.log(`分类 ${entry.meta.category}　舞台 ${entry.meta.stage}　分层 ${entry.meta.tier}`)
      console.log(`场合 ${entry.meta.when}`)
      console.log(`出处 ${entry.meta.source}　收录 ${entry.meta.since}`)
      console.log(`机制 ${entry.mechanisms.join(' / ')}`)
      console.log(`标签 ${entry.tags.join(' ') || '（无）'}`)
      console.log(`旋钮 ${entry.params.map((p) => p.name).join(' ') || '（无）'}`)
      console.log(`代码块 ${entry.code.length}（${entry.code.map((c) => c.lang).join(',')}）`)
      console.log(`备注 ${entry.notes.length} 条`)
      for (const caveat of entry.caveats) console.log(`  边界 · ${caveat}`)
      break
    }

    case 'drift': {
      const d = vault.drift()
      if (d.inSync) {
        console.log('投影与 md 一致')
        break
      }
      if (d.changed.length) console.log(`内容变了未重建：${d.changed.join(' ')}`)
      if (d.added.length) console.log(`新增未入库：${d.added.join(' ')}`)
      if (d.missing.length) console.log(`库里还在但文件没了：${d.missing.join(' ')}`)
      break
    }

    case 'events': {
      const rows = vault.events({ limit: Number(flags.limit ?? 20) })
      if (!rows.length) {
        console.log('还没有任何事件')
        break
      }
      for (const e of rows) {
        const when = new Date(e.ts).toISOString().replace('T', ' ').slice(0, 19)
        console.log(`#${e.id} ${when}  ${e.kind.padEnd(8)} ${e.slug ?? '-'}  ${e.query ?? ''}  ${e.reason ?? ''}`)
      }
      break
    }

    case 'propose': {
      const query = positional.slice(1).join(' ')
      if (!query) throw new VaultError('propose 需要一句话需求')
      const proposals = vault.propose(query, { limit: Number(flags.limit ?? 3) })
      if (!proposals.length) {
        console.log(`「${query}」没有候选`)
        break
      }
      for (const p of proposals) {
        console.log(`提议 #${p.proposalId}  ${p.title}  ${p.score.toFixed(4)}  ${p.why}`)
      }
      break
    }

    case 'inbox': {
      const rows = vault.inbox({ state: flags.state ?? 'new', limit: Number(flags.limit ?? 20) })
      if (!rows.length) {
        console.log('收件箱空的')
        break
      }
      for (const r of rows) {
        console.log(`#${r.id}  ${r.origin}  ${r.raw_ref ?? ''}  ${r.title_guess ?? ''}  [${r.state}]`)
      }
      break
    }

    case 'export': {
      const out = flags.out ?? join(ROOT, 'data', 'vault-state.json')
      const state = vault.exportState()
      writeFileSync(out, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
      console.log(
        `已导出 ${state.events.length} 条事件、${state.inbox.length} 条收件箱、${state.proposals.length} 条提议 → ${out}`,
      )
      console.log('这份文件是唯一不可重建的东西的备份；A 区不需要备份，rebuild 就能回来。')
      break
    }

    case 'import': {
      const input = positional[1] ?? flags.in
      if (!input) throw new VaultError('import 需要备份文件路径')
      const state = JSON.parse(readFileSync(input, 'utf8'))
      const added = vault.importState(state)
      console.log(`已合并：事件 +${added.events}，收件箱 +${added.inbox}`)
      break
    }

    default:
      console.error(`不认识命令：${command}`)
      process.exit(2)
  }
} catch (error) {
  console.error(error instanceof VaultError ? `✗ ${error.message}` : error)
  process.exit(1)
} finally {
  vault.close()
}
