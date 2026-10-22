import React from 'react'

const icon = (name) => {
  const C = (props = {}) => React.createElement('span', { className: 'bs-icon', 'data-icon': name, style: { display: 'inline-flex', width: props.size ?? 12, height: props.size ?? 12 } })
  C.displayName = name
  return C
}

export const IconRefreshOutlineRegular = icon('refresh')
export const IconUserOutlineRegular = icon('user')
export const IconAgentPresetOutlineRegular = icon('agent')
export const IconBranchOutlineRegular = icon('branch')
export const IconCloseFillRegular = icon('close')
export const IconCloseOutlineRegular = icon('close-o')
export const IconChevronUpOutlineRegular = icon('up')
export const IconChevronDownOutlineRegular = icon('down')
export const IconRightUpOutlineRegular = icon('right-up')
export const IconCopyOutlineRegular = icon('copy')
export const IconPanelLeftOutlineRegular = icon('panel-left')
export const IconCodeOutlineRegular = icon('code')
export const IconTerminalOutlineRegular = icon('terminal')
export const IconSearchOutlineRegular = icon('search')
export const IconSettingsOutlineRegular = icon('settings')
export const IconFolderOutlineRegular = icon('folder')
export const IconFileOutlineRegular = icon('file')
export const IconPlayOutlineRegular = icon('play')
export const IconStopOutlineRegular = icon('stop')
export const IconCheckOutlineRegular = icon('check')
export const IconWarningOutlineRegular = icon('warning')

export function Button(props) {
  const { children, variant, size, icon, ...rest } = props
  return React.createElement('button', { type: 'button', ...rest, className: ['bs-button', rest.className].filter(Boolean).join(' ') }, icon ?? null, children)
}
export function Modal(props) { return React.createElement('div', { className: 'bs-modal' }, props.children) }
export function Menu(props) { return React.createElement('div', { className: 'bs-menu' }, props.children) }
export function Tag(props) { return React.createElement('span', { className: 'bs-tag' }, props.children) }
export function StateDot(props) { return React.createElement('i', { className: 'bs-dot', 'data-state': props.state }) }
export function MarkdownText(props) { return React.createElement('div', { className: 'bs-markdown' }, props.text ?? props.children) }
export function MarkdownDelegateProvider(props) { return props.children }
export function JsonTree(props) { return React.createElement('pre', null, JSON.stringify(props.value ?? props.data ?? null, null, 2)) }
export function FileTypeIcon(props) { return React.createElement('span', { className: 'bs-file-icon' }, '·') }
export function writeClipboard() { return Promise.resolve() }

export const IconContextInjectionOutlineRegular = icon("IconContextInjectionOutlineRegular")
export const IconEditOutlineRegular = icon("IconEditOutlineRegular")
export const IconEllipsisOutlineRegular = icon("IconEllipsisOutlineRegular")
export const IconGlobeOutlineRegular = icon("IconGlobeOutlineRegular")
export const IconPlanOutlineRegular = icon("IconPlanOutlineRegular")
export const IconWarningTriangleOutlineRegular = icon("IconWarningTriangleOutlineRegular")
export const IconChecklistOutlineRegular = icon("IconChecklistOutlineRegular")
export const IconFullscreenOutlineRegular = icon("IconFullscreenOutlineRegular")
export const IconLoadingOutlineRegular = icon("IconLoadingOutlineRegular")
export const IconQuestionOutlineRegular = icon("IconQuestionOutlineRegular")
export const IconThinkOutlineRegular = icon("IconThinkOutlineRegular")
export const IconUsersOutlineRegular = icon("IconUsersOutlineRegular")
export const IconChevronRightOutlineRegular = icon("IconChevronRightOutlineRegular")
export const IconStopFillRegular = icon("IconStopFillRegular")
export const IconTreeCornerRegular = icon("IconTreeCornerRegular")
export const MenuSurface = icon("MenuSurface")
export const Switch = icon("Switch")
export const TerminalBlock = icon("TerminalBlock")
export const IconPlusOutlineRegular = icon("IconPlusOutlineRegular")
export const IconTrashOutlineRegular = icon("IconTrashOutlineRegular")
export const Input = icon("Input")
export const Pill = icon("Pill")
export const useDismissOnOutsidePointer = icon("useDismissOnOutsidePointer")
