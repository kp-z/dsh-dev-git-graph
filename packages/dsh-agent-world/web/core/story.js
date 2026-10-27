/*
 * R411：任务 → 章节。纯函数，不碰 DOM，便于单测。
 *
 * 章节不是装饰：它把“当前应该看什么”讲清楚——没人接单时看集结，有人走动时看执行，
 * 全部完成时看交付。任务面板只负责显示，故事线只负责判断。
 */
export function buildStory(world) {
  const stationKind = new Map((world?.stations ?? []).map((station) => [station.id, station.kind]))
  const meeting = (world?.agents ?? []).filter((agent) => (agent.state === 'talking' || agent.state === 'working') && stationKind.get(agent.station) === 'meeting').length
  const tasks = Array.isArray(world?.tasks) ? world.tasks : []
  const total = tasks.length
  const done = tasks.filter((task) => task.status === 'done').length
  const failed = tasks.filter((task) => task.status === 'failed').length
  const inProgress = tasks.filter((task) => task.status === 'in_progress').length
  const ready = tasks.filter((task) => task.status === 'ready').length
  const progress = total === 0 ? 0 : Math.round(((done + failed) / total) * 100)

  if (total === 0) {
    return { id: 'prologue', act: '序章', title: '等待第一张工单', hint: '派一张任务集，办公室才会亮起来。', progress: 0, tone: 'idle' }
  }
  if (done + failed >= total) {
    return {
      id: failed > 0 ? 'epilogue-fail' : 'epilogue',
      act: '终章', title: failed > 0 ? '交付有缺口' : '交付完成',
      hint: failed > 0 ? `${failed} 张失败，先看失败原因再重开。` : `${done} 张工单完成，团队可以收工。`,
      progress, tone: failed > 0 ? 'danger' : 'done',
    }
  }
  if (inProgress > 0) {
    return {
      id: 'act-2', act: '第二章',
      title: meeting > 0 ? '执行中 · 会议' : '执行中',
      hint: meeting > 0 ? `会议中：${meeting} 人在会议室对齐计划。` : `${inProgress} 人正在工位推进任务。`,
      progress, tone: 'working',
    }
  }
  if (ready > 0) {
    return { id: 'act-1', act: '第一章', title: '集结', hint: `${ready} 张待领，先开会再分工。`, progress, tone: 'ready' }
  }
  return { id: 'act-3', act: '第三章', title: '验收', hint: '任务已派出，等待完成或评审。', progress, tone: 'review' }
}
