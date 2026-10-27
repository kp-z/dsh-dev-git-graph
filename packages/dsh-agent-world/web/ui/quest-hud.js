/**
 * R349：舞台左上角的游戏目标 HUD。
 * 只消费 buildQuestState 的结果；不自己算业务。
 */
export function createQuestHud({ root, doc = globalThis.document } = {}) {
  const mount = root ?? doc?.querySelector?.('#quest-hud') ?? null
  if (mount === null || mount === undefined) return { update() {}, ready: false }
  mount.textContent = ''
  const head = doc.createElement('div')
  head.className = 'quest-head'
  const title = doc.createElement('b')
  title.textContent = '今日目标'
  const score = doc.createElement('span')
  score.className = 'quest-score'
  score.textContent = '0 分'
  head.append(title, score)
  const list = doc.createElement('ul')
  list.className = 'quest-list'
  const rows = new Map()
  for (const id of ['first-task', 'first-meeting', 'first-report', 'team-five']) {
    const li = doc.createElement('li')
    li.className = 'quest-row'
    li.dataset.quest = id
    const check = doc.createElement('i')
    check.className = 'quest-check'
    const label = doc.createElement('span')
    label.className = 'quest-label'
    const detail = doc.createElement('em')
    detail.className = 'quest-detail'
    const bar = doc.createElement('span')
    bar.className = 'quest-bar'
    const fill = doc.createElement('span')
    bar.append(fill)
    li.append(check, label, detail, bar)
    list.append(li)
    rows.set(id, { li, check, label, detail, fill })
  }
  mount.append(head, list)

  let lastKey = ''
  const doneIds = new Set()
  function update(state) {
    if (state === null || state === undefined) return
    const key = JSON.stringify(state)
    if (key === lastKey) return
    lastKey = key
    score.textContent = `${state.score} 分`
    for (const quest of state.quests) {
      const row = rows.get(quest.id)
      if (row === undefined) continue
      row.li.classList.toggle('is-done', quest.done)
      if (quest.done && !doneIds.has(quest.id)) {
        doneIds.add(quest.id)
        row.li.classList.add('quest-pop')
        setTimeout(() => row.li.classList.remove('quest-pop'), 900)
      }
      row.check.textContent = quest.done ? '✓' : '○'
      row.label.textContent = quest.title
      row.detail.textContent = quest.detail
      row.fill.style.width = `${Math.round(Math.max(0, Math.min(1, quest.progress)) * 100)}%`
    }
  }
  return { update, ready: true }
}
