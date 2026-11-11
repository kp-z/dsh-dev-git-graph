/**
 * 范围树：三层（全部任务 / 自定义目录 / 项目）—— 工厂组件，模块顶层不 import react。
 *
 * task-17 起它是 **rail 里「关系」这个一级菜单的二级菜单**（`.fo-subnav`），页面里不再有第二列；
 * `compact` = 二级菜单形态：行更矮更小（30px / 12px）、左侧缩进按层级给、不再重复一个分组标题。
 *
 * 能力（照 task-8 规格）：
 * - ARIA tree：role=tree/treeitem、aria-level / aria-expanded / aria-selected + roving tabindex；
 *   ←→ 折叠展开、↑↓ 移动、Home/End 到两端、Enter/Space 选中、F2 就地重命名、
 *   Shift+F10 / 菜单键在行上开右键菜单。
 * - 目录的新建 / 就地重命名 / 删除：输入框与按钮都在**组件内**，写操作通过 props 回调交给
 *   OverviewPanel（组件自己不 fetch、不碰 localStorage、不碰 document.body）。
 * - 拖拽：项目行可拖，目录行 / 未分组行 / 全部任务行是放置目标；拖到「未分组」= 移出目录。
 *
 * props（由 OverviewPanel 传）：
 *   tree                     model.buildTree(...) 的结果 {rows, byKey, lanes, scope, selected}
 *   renamingId, creating     '' / 目录 id；creating=true 时显示新建输入行
 *   creatingFor              '' | 项目 key（新建后自动移入该项目）
 *   dragKey, dropKey         拖拽中的行 key / 悬停的放置目标 key
 *   busy                     写操作进行中（禁用按钮）
 *   onSelect(row) onToggle(row) onMenu(row, {x,y})
 *   onDragKey(key) onDropKey(key) onDrop(projectKey, targetRow)
 *   onRenameStart(row) onRenameCommit(id, name) onRenameCancel()
 *   onCreateStart(projectKey) onCreateCommit(name) onCreateCancel()
 *   compact                  二级菜单形态（rail 里用），默认 false
 */

import { renderIcon, normalizeIcon, autoIconFor } from './projectIcons.js'
import { brandVar, decoVar } from './styles.js'

const KIND_LABEL = { all: '全部任务', group: '目录', project: '项目' }

export function createTreeNav(deps) {
  const { React, h, model } = deps || {}
  const { useCallback, useEffect, useRef, useState } = React

  return function TreeNav(props) {
    /** 行 key → 元素，用于 roving tabindex 的 .focus()（只走 ref，不做 DOM 查询）。 */
    const itemRefs = useRef({})
    const pendingFocus = useRef(false)
    const {
      tree,
      renamingId = '',
      creating = false,
      creatingFor = '',
      dragKey = '',
      dropKey = '',
      busy = false,
      onSelect,
      onToggle,
      onMenu,
      onDragKey,
      onDropKey,
      onDrop,
      onRenameStart,
      onRenameCommit,
      onRenameCancel,
      onCreateStart,
      onCreateCommit,
      onCreateCancel,
      compact = false,
    } = props || {}
    /* 二级菜单形态：行更紧凑、缩进从 24px 起（一级项 padding 是 12px），字号交给 CSS。 */
    const indent = (depth) => `${(compact ? 24 : 12) + (Number(depth) || 0) * (compact ? 12 : 14)}px`

    const rows = tree && Array.isArray(tree.rows) ? tree.rows : []
    const [active, setActive] = useState(() => (tree && tree.selected ? tree.selected.key : 'all'))

    const visible = rows
    const focusKey = (key) => { pendingFocus.current = true; setActive(key) }

    useEffect(() => {
      if (!pendingFocus.current) return
      pendingFocus.current = false
      const node = itemRefs.current[active]
      if (node && typeof node.focus === 'function') node.focus()
    })

    /* 选中项变了（含从 store 恢复）→ 光标跟着走，别停在空气上。 */
    useEffect(() => {
      if (tree && tree.selected && tree.selected.key !== active) setActive(tree.selected.key)
    }, [tree && tree.selected ? tree.selected.key : ''])

    const rowElement = (row, index) => {
      if (!row) return null
      /* 入场递延：--fo-i 让 CSS 用 calc(i * 20ms) 逐行错开，上限 8 行（styles.js 里做动画）。 */
      const stagger = Math.min(Math.max(Number(index) || 0, 0), 7)
      const isGroup = row.kind === 'group'
      const isProject = row.kind === 'project'
      const canDrop = row.kind === 'all' || isGroup
      /* 色点：项目行 = 该项目在目录里的分色槽；根行 = 品牌色；目录行 = 中性色。 */
      const color = isProject && Number.isFinite(row.colorIndex)
        ? { '--fo-c': decoVar(row.colorIndex) }
        : (row.kind === 'all' ? { '--fo-c': brandVar() } : undefined)
      const label = row.label
      const count = isGroup ? `${row.count} 项目` : `${row.count} 任务`

      const children = []
      children.push(h('span', {
        key: 'caret',
        className: 'fo-caret',
        'data-collapsed': row.collapsed === true ? '1' : '0',
        'data-leaf': isProject ? '1' : '0',
        'aria-hidden': 'true',
        onClick: (event) => { if (isProject) return; event.stopPropagation(); toggleOf(row) },
      }, isProject ? '' : '▾'))
      /* 项目行：配了图标就把色点换成图标（颜色沿用项目选的颜色），没配才是色点 */
      /* 手动配的图标优先；没配就按项目名自动推（与气泡同一套规则） */
      const manualLogo = isProject ? normalizeIcon(row.logo) : ''
      const autoLogo = isProject && !manualLogo ? autoIconFor(row.label) : null
      const logoIcon = manualLogo || (autoLogo ? autoLogo.icon : '')
      if (logoIcon) {
        /* 面板这一层的红线是「只用宿主令牌、零字面量颜色」，所以这里**不注入十六进制色**，
           沿用该项目的 deco 色（--fo-deco-N）或品牌色；八色板只用于运行页气泡（那张表允许原值）。 */
        children.push(h('span', {
          key: 'dot',
          className: 'fo-dot is-logo',
          style: color || undefined,
          'aria-hidden': 'true',
        }, renderIcon({ h }, logoIcon, 12)))
      } else {
        children.push(h('span', { key: 'dot', className: 'fo-dot', style: color, 'aria-hidden': 'true' }))
      }
      children.push(h('span', { key: 'label', className: 'fo-row-label', title: row.path || label }, label))
      if (row.blocked > 0) children.push(h('span', { key: 'badge', className: 'fo-row-badge', title: `${row.blocked} 个任务被阻塞` }, String(row.blocked)))
      children.push(h('span', { key: 'count', className: 'fo-row-count' }, count))
      if (isGroup && !row.ungrouped) {
        children.push(h('button', {
          key: 'menu',
          type: 'button',
          className: 'fo-btn fo-row-menu',
          'data-size': 'sm',
          'data-variant': 'ghost',
          'aria-label': `目录 ${row.label} 的操作`,
          disabled: busy,
          onClick: (event) => {
            event.stopPropagation()
            const box = event.currentTarget.getBoundingClientRect()
            if (typeof onMenu === 'function') onMenu(row, { x: box.left, y: box.bottom + 4 })
          },
        }, '⋯'))
      }

      const rename = renamingId && renamingId === row.id && isGroup
      if (rename) {
        return h('div', { key: row.key, className: 'fo-row', 'data-kind': row.kind, style: { paddingLeft: indent(row.depth), '--fo-i': stagger } },
          h('input', {
            className: 'fo-input',
            defaultValue: row.label,
            autoFocus: true,
            'aria-label': '目录名',
            disabled: busy,
            onFocus: (event) => event.currentTarget.select(),
            onKeyDown: (event) => {
              if (event.key === 'Enter') { event.preventDefault(); const value = String(event.currentTarget.value || '').trim(); if (value) onRenameCommit(row.id, value); else onRenameCancel() }
              else if (event.key === 'Escape') { event.preventDefault(); onRenameCancel() }
            },
            onBlur: (event) => { const value = String(event.currentTarget.value || '').trim(); if (value && value !== row.label) onRenameCommit(row.id, value); else onRenameCancel() },
          }),
        )
      }

      return h('div', {
        key: row.key,
        ref: (node) => { itemRefs.current[row.key] = node },
        className: `fo-row${dropKey === row.key ? ' is-drop' : ''}${dragKey === row.key ? ' is-drag' : ''}`,
        role: 'treeitem',
        tabIndex: (active === row.key || (!visible.some((item) => item.key === active) && visible[0] && visible[0].key === row.key)) ? 0 : -1,
        'aria-level': row.depth + 1,
        'aria-selected': row.selected === true,
        'aria-expanded': (isGroup && !row.ungrouped) || row.kind === 'all' ? (row.collapsed !== true) : undefined,
        'data-kind': row.kind,
        'data-key': row.key,
        'data-id': row.id,
        style: { paddingLeft: indent(row.depth), '--fo-i': stagger },
        draggable: isProject,
        title: `${KIND_LABEL[row.kind] || ''}：${label}`,
        onClick: () => { focusKey(row.key); if (typeof onSelect === 'function') onSelect(row) },
        onDoubleClick: () => { if (isGroup && !row.ungrouped && typeof onRenameStart === 'function') onRenameStart(row) },
        onContextMenu: (event) => {
          event.preventDefault()
          focusKey(row.key)
          if (typeof onMenu === 'function') onMenu(row, { x: event.clientX, y: event.clientY })
        },
        onDragStart: (event) => {
          if (!isProject) return
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move'
            try { event.dataTransfer.setData('text/plain', row.id) } catch (error) { /* 某些宿主禁止 setData */ }
          }
          if (typeof onDragKey === 'function') onDragKey(row.key)
        },
        onDragEnd: () => { if (typeof onDragKey === 'function') onDragKey('') },
        onDragOver: (event) => {
          if (!canDrop) return
          event.preventDefault()
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
          if (dropKey !== row.key && typeof onDropKey === 'function') onDropKey(row.key)
        },
        onDragLeave: () => { if (dropKey === row.key && typeof onDropKey === 'function') onDropKey('') },
        onDrop: (event) => {
          if (!canDrop) return
          event.preventDefault()
          let key = ''
          try { key = event.dataTransfer ? event.dataTransfer.getData('text/plain') : '' } catch (error) { key = '' }
          if (!key && dragKey) key = String(dragKey).replace(/^project:/, '')
          if (typeof onDropKey === 'function') onDropKey('')
          if (key && typeof onDrop === 'function') onDrop(key, row)
        },
      }, children)
    }

    const toggleOf = (row) => {
      if (!row) return
      if (typeof onToggle === 'function') onToggle(row)
    }

    const onKeyDown = useCallback((event) => {
      if (!visible.length) return
      const at = visible.findIndex((row) => row.key === active)
      const index = at < 0 ? 0 : at
      const current = visible[index]
      const move = (target) => { if (target) { event.preventDefault(); focusKey(target.key) } }

      if (event.key === 'ArrowDown') move(visible[index + 1])
      else if (event.key === 'ArrowUp') move(visible[index - 1])
      else if (event.key === 'Home') move(visible[0])
      else if (event.key === 'End') move(visible[visible.length - 1])
      else if (event.key === 'ArrowRight') {
        if ((current.kind === 'group' || current.kind === 'all') && current.collapsed === true) toggleOf(current)
        else {
          const next = visible[index + 1]
          move(next && next.depth > current.depth ? next : null)
        }
      } else if (event.key === 'ArrowLeft') {
        if ((current.kind === 'group' || current.kind === 'all') && current.collapsed !== true && current.count > 0) toggleOf(current)
        else {
          let parent = null
          for (let i = index - 1; i >= 0; i -= 1) { if (visible[i].depth < current.depth) { parent = visible[i]; break } }
          move(parent)
        }
      } else if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault()
        if (typeof onSelect === 'function') onSelect(current)
      } else if (event.key === 'F2') {
        if (current.kind === 'group' && !current.ungrouped && typeof onRenameStart === 'function') { event.preventDefault(); onRenameStart(current) }
      } else if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && typeof onMenu === 'function') {
        event.preventDefault()
        const node = itemRefs.current[current.key]
        const box = node && typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null
        if (box) onMenu(current, { x: box.left + 24, y: box.bottom })
      }
    }, [active, visible, onSelect, onToggle, onMenu, onRenameStart])

    const onListDrop = (event) => {
      if (!dragKey) return
      event.preventDefault()
      if (typeof onDropKey === 'function') onDropKey('')
      if (typeof onDrop === 'function') onDrop(String(dragKey).replace(/^project:/, ''), null)
    }

    const items = []
    visible.forEach((row, index) => {
      items.push(rowElement(row, index))
      if (row.kind === 'group' && row.missing > 0 && row.collapsed !== true) {
        items.push(h('div', { key: `note:${row.key}`, className: 'fo-scope-note' }, `${row.missing} 个成员已不在当前任务集里`))
      }
    })
    if (creating) {
      items.push(h('div', { key: 'create', className: 'fo-create-row' },
        h('input', {
          className: 'fo-input',
          autoFocus: true,
          placeholder: creatingFor ? '新目录名（创建后自动移入）' : '新目录名',
          'aria-label': '新目录名',
          disabled: busy,
          onKeyDown: (event) => {
            if (event.key === 'Enter') { event.preventDefault(); const value = String(event.currentTarget.value || '').trim(); if (value) onCreateCommit(value); else onCreateCancel() }
            else if (event.key === 'Escape') { event.preventDefault(); onCreateCancel() }
          },
          onBlur: () => onCreateCancel(),
        }),
      ))
    }

    return h('div', { className: 'fo-scope', 'data-compact': compact ? '1' : '0' },
      h('div', { className: 'fo-scope-head' },
        /* 二级菜单里不再重复一个分组标题：一级项已经叫「关系」，标题只会是第二份同义文案。 */
        compact ? null : h('span', { className: 'fo-scope-title' }, '任务分组'),
        h('button', {
          type: 'button',
          className: 'fo-btn',
          'data-size': 'sm',
          disabled: busy,
          onClick: () => { if (typeof onCreateStart === 'function') onCreateStart('') },
        }, '新建目录'),
      ),
      h('div', { className: 'fo-scope-body', onDragOver: (event) => { if (dragKey) event.preventDefault() }, onDrop: onListDrop },
        h('div', {
          className: 'fo-scope-list',
          role: 'tree',
          'aria-label': '任务分组（全部任务 / 自定义目录 / 项目）',
          'aria-multiselectable': false,
          onKeyDown,
        }, items),
      ),
    )
  }
}

export default createTreeNav
