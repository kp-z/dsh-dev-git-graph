import React from 'react'
import { createRoot } from 'react-dom/client'
import { SubagentView } from 'dsh-better-sidebar/src/client/SubagentView.tsx'

export function mount(container, ctx, sessionId) {
  const root = createRoot(container)
  root.render(React.createElement(SubagentView, {
    sessionId,
    active: true,
    ctx,
    onOpenChild: (address) => { globalThis.__awOpenChild?.(address) },
  }))
  return () => root.unmount()
}
