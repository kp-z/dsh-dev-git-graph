/**
 * R349：游戏目标（纯函数）。
 *
 * 这里只回答“现在完成了哪些目标、多少分”，不碰 DOM。
 * 目标必须来自世界事实（tasks/messages/agents/stations），不能是装饰性进度。
 */
export function buildQuestState(world, stations = []) {
  const tasks = Array.isArray(world?.tasks) ? world.tasks : []
  const agents = Array.isArray(world?.agents) ? world.agents : []
  const messages = Array.isArray(world?.messages) ? world.messages : []
  const meetingIds = new Set((stations ?? []).filter((s) => s.kind === 'meeting').map((s) => s.id))
  const done = tasks.filter((t) => t.status === 'done').length
  const meeting = agents.filter((a) => a.state === 'working' && meetingIds.has(a.station)).length
  const reports = messages.filter((m) => m.kind === 'report' && m.deliveredAtTick !== null).length
  const team = agents.length
  const quests = [
    { id: 'first-task', title: '完成第一张工单', done: done > 0, progress: tasks.length === 0 ? 0 : Math.min(1, done / Math.max(1, tasks.length)), detail: `${done}/${tasks.length}` },
    { id: 'first-meeting', title: '让团队开一次会', done: meeting > 0, progress: meeting > 0 ? 1 : 0, detail: meeting > 0 ? `${meeting} 人在会` : '无人开会' },
    { id: 'first-report', title: '收到第一份报告', done: reports > 0, progress: reports > 0 ? 1 : 0, detail: `${reports} 份` },
    { id: 'team-five', title: '团队达到 5 人', done: team >= 5, progress: Math.min(1, team / 5), detail: `${team}/5` },
  ]
  const completed = quests.filter((q) => q.done).length
  const score = done * 100 + reports * 20 + Math.min(meeting, 4) * 15 + team * 5
  return { quests, completed, total: quests.length, score }
}
