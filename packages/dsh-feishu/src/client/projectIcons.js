/**
 * 项目图标（内置图标集 + Emoji）。
 *
 * ## 图标从哪来
 *
 * 内置 **1461 个 Lucide 图标**（ISC，https://lucide.dev），数据由
 * `scripts/gen-lucide-icons.mjs` 从 lucide-static 生成到 `lucideIcons.js`，产物入库、**零运行时依赖**。
 * 全部 24×24 线性、stroke=currentColor，天然跟随宿主亮/暗主题。
 *
 * 另附一组 **Emoji**：有些项目用 emoji 比线性图标更好认（🐛 ☁️ 🎮 📊），而且零字节开销。
 *
 * ## 为什么要「搜索 + 推荐」
 *
 * 1000+ 图标直接铺出来反而找不到（用户原话：「很难和项目关联」）。所以：
 * - 选择器有**搜索框**（英文 id + 中文别名词都搜）；
 * - 打开时先给**按项目名推荐**的 8 个（`suggestIcons(name)`：名字里出现 viz/数据/游戏… 就推对应的）；
 * - 每个项目还能选一个**颜色**，气泡用它给图标/光环上色，一眼区分不同项目。
 */

import { LUCIDE_ICONS } from './lucideIcons.js'

/** 中文别名：只给高频图标写（搜「代码」「数据」能出来），其余按英文 id 搜 */
const ALIASES = {
  code: '代码 开发 编程', 'square-code': '代码', 'file-code': '代码文件', terminal: '终端 命令行 控制台',
  braces: '代码 括号 json', database: '数据 数据库 db', server: '服务 服务器 后端', 'hard-drive': '磁盘 存储',
  cloud: '云 云端', 'cloud-upload': '上传 云', 'cloud-download': '下载 云', cpu: '芯片 cpu 硬件', microchip: '芯片',
  network: '网络', wifi: '无线 网络', globe: '前端 web 全球 国际化', earth: '地球 全球', 'globe-2': '前端 web',
  shield: '安全 防护', 'shield-check': '安全 通过', lock: '锁 安全', key: '密钥', fingerprint: '指纹 身份',
  bug: '缺陷 bug 调试', rocket: '发布 上线 火箭', flask: '实验 测试 实验性', atom: '原子 物理 科学',
  dna: '基因 生物', microscope: '显微镜 研究', telescope: '望远镜 观测', satellite: '卫星', radar: '雷达',
  chart: '图表 统计', 'bar-chart': '柱状图 统计', 'line-chart': '折线图 趋势', 'pie-chart': '饼图 占比',
  'chart-spline': '趋势 曲线', 'chart-gantt': '甘特 排期', activity: '活动 心跳 监控', gauge: '仪表 性能',
  list: '列表 清单', 'list-checks': '清单 检查', 'clipboard-list': '清单 任务', kanban: '看板 任务板',
  workflow: '流程 工作流 编排', waypoints: '节点 路径', route: '路由 路径', milestone: '里程碑',
  layers: '分层 服务 堆栈', box: '制品 包', package: '包 依赖', blocks: '积木 组件', component: '组件',
  puzzle: '插件 扩展', cog: '配置 设置', settings: '设置', wrench: '构建 维修 工具', hammer: '构建',
  sparkles: 'AI 智能 魔法', brain: '智能 AI 大脑', bot: '机器人 agent', zap: '闪电 性能 加速',
  flame: '热门 火焰 压测', star: '星标 收藏', heart: '喜欢 关注', book: '文档 手册', notebook: '笔记',
  library: '库 依赖', pen: '编辑 写作', pencil: '编辑', brush: '设计 画笔', palette: '设计 配色',
  image: '图片 图像', video: '视频', camera: '相机 截图', music: '音乐 音频', mic: '麦克风 语音',
  gamepad: '游戏', joystick: '游戏 手柄', trophy: '奖杯 成就', target: '目标', 'crosshair': '定位 准星',
  map: '地图', compass: '指南针 方向', navigation: '导航', plane: '飞机 航班', car: '汽车 车辆',
  'train-front': '火车 列车', ship: '船 船运', truck: '卡车 物流', bike: '自行车',
  home: '首页 主页', building: '建筑 公司', factory: '工厂', warehouse: '仓库', store: '商店',
  'shopping-cart': '购物车 商城', wallet: '钱包 账户', 'credit-card': '卡 支付', receipt: '收据 账单',
  calendar: '日历 排期', clock: '时钟 时间', timer: '计时器', bell: '通知 提醒', mail: '邮件',
  message: '消息 聊天', phone: '电话', send: '发送', share: '分享', link: '链接',
  download: '下载', upload: '上传', refresh: '刷新 重试', rotate: '轮换', repeat: '循环',
  play: '播放 开始', pause: '暂停', stop: '停止', search: '搜索', filter: '筛选', sort: '排序',
  plus: '新增 添加', minus: '移除', check: '完成 勾选', x: '关闭 取消', 'alert-triangle': '告警 警告',
  info: '信息', 'circle-help': '帮助', loader: '加载 进行中', 'circle-dot': '点 当前',
  'layout-dashboard': '仪表盘 看板', 'layout-grid': '网格', table: '表格', columns: '列', rows: '行',
  eye: '查看 预览', scan: '扫描', qr: '二维码', hash: '编号 井号', 'at-sign': '提到 艾特', percent: '百分比',
  'circle-dollar-sign': '钱 费用', scale: '比例 天平', ruler: '尺子 尺寸', thermometer: '温度 监控',
  battery: '电池', plug: '插头 接入', power: '电源 关闭', sun: '太阳 白天 亮色', moon: '月亮 夜间 暗色',
  user: '用户 人', users: '团队 多人', contact: '联系人', 'id-card': '身份 名片', bookmark: '书签',
  tag: '标签', tags: '标签', badge: '徽章', award: '奖项 认证', medal: '奖牌', crown: '皇冠 首席',
  gem: '宝石', diamond: '钻石', sticker: '贴纸',
}

/** Emoji 面板：按场景分组，给「图标不够直观」的项目用（零字节开销） */
const EMOJI_GROUPS = [
  { key: 'dev', label: '开发', items: ['💻', '🖥️', '⌨️', '🐛', '🧪', '🧰', '🔧', '⚙️', '🧩', '📦', '🧱', '🔌', '🛠️', '🚧', '🔬', '🧬'] },
  { key: 'data', label: '数据', items: ['📊', '📈', '📉', '🗄️', '🗃️', '📋', '🧮', '📑', '🔢', '💾', '🗂️', '📌'] },
  { key: 'ai', label: 'AI', items: ['🤖', '🧠', '✨', '🔮', '🪄', '🛰️', '⚡', '🌀', '🧿', '🫧'] },
  { key: 'cloud', label: '云端/运维', items: ['☁️', '🌐', '🛰️', '🔐', '🛡️', '🔥', '💧', '🧊', '🚀', '🛫', '🏗️', '🧯'] },
  { key: 'media', label: '媒体', items: ['🎮', '🎬', '🎨', '🎵', '📷', '🖼️', '🎧', '📺', '🕹️', '🎯'] },
  { key: 'work', label: '工作', items: ['📝', '📚', '📅', '⏰', '✅', '📌', '🏁', '🎓', '💡', '📢', '🤝', '🧭'] },
  { key: 'misc', label: '其他', items: ['⭐', '❤️', '🍀', '🌱', '🌊', '🏔️', '🌙', '☀️', '🧭', '🎁', '🏆', '⚗️'] },
]

/** 项目名 → 推荐图标的规则（先命中先生效；只给「一眼能猜对」的映射） */
const NAME_RULES = [
  [/viz|chart|dashboard|看板|图表|insight/i, ['chart-spline', 'line-chart', 'layout-dashboard', 'activity']],
  [/m viz|mviz|scene|场景|3d|render|渲染/i, ['box', 'layers', 'globe', 'image']],
  [/qviz|前端|front|web|ui|react|vue/i, ['globe', 'code', 'component', 'monitor']],
  [/back|后端|server|服务|api|gateway/i, ['server', 'network', 'cloud', 'cable']],
  [/data|数据|db|database|存储/i, ['database', 'hard-drive', 'table', 'layers']],
  [/dsh|plugin|插件|extension/i, ['puzzle', 'blocks', 'code', 'component']],
  [/feishu|飞书|lark|sync|同步/i, ['refresh', 'link', 'message', 'share']],
  [/bug|fix|缺陷|排查|debug/i, ['bug', 'wrench', 'alert-triangle', 'search']],
  [/test|测试|qa|校验/i, ['flask', 'clipboard-check', 'check', 'shield-check']],
  [/game|游戏|关卡|scene3d/i, ['gamepad', 'joystick', 'trophy', 'target']],
  [/doc|文档|wiki|手册/i, ['book', 'file-text', 'notebook', 'library']],
  [/ci|cd|deploy|发布|上线|release/i, ['rocket', 'package', 'git-branch', 'cloud-upload']],
  [/ai|agent|模型|llm/i, ['sparkles', 'brain', 'bot', 'zap']],
  [/cloud|云端|机器|machine|host/i, ['cloud', 'server', 'cpu', 'terminal']],
]

const DEFAULT_SUGGEST = ['folder', 'code', 'layers', 'box', 'cube', 'app-window', 'squares-subtract', 'component']

/** 颜色盘（气泡用它给图标/光环上色；顺序稳定，索引即色） */
export const ICON_COLORS = [
  { id: '', label: '默认（跟随主题）' },
  { id: 'blue', label: '蓝', hex: '#3b82f6' },
  { id: 'green', label: '绿', hex: '#22c55e' },
  { id: 'purple', label: '紫', hex: '#a855f7' },
  { id: 'amber', label: '琥珀', hex: '#f59e0b' },
  { id: 'red', label: '红', hex: '#ef4444' },
  { id: 'teal', label: '青', hex: '#14b8a6' },
  { id: 'pink', label: '粉', hex: '#ec4899' },
]

const COLOR_HEX = Object.fromEntries(ICON_COLORS.filter((c) => c.hex).map((c) => [c.id, c.hex]))

/** 图标 id 列表（Lucide 全量 + 稳定顺序） */
export const ICON_IDS = Object.keys(LUCIDE_ICONS)

/** 兼容旧调用：PROJECT_ICONS[id] = { label, paths } */
export const PROJECT_ICONS = Object.fromEntries(ICON_IDS.map((id) => [id, { label: ALIASES[id] || id, paths: [] }]))

export function iconLabel(id) {
  return ALIASES[id] || id
}

export function emojiGroups() {
  return EMOJI_GROUPS
}

export function colorHex(colorId) {
  return COLOR_HEX[String(colorId || '')] || ''
}

/**
 * 把「图标 / emoji / 空」统一成一个值：`lucide:code`、`emoji:🚀`、`''`。
 * 旧数据（只有图标 id 的字符串）照样兼容。
 */
export function normalizeIcon(value) {
  const raw = String(value == null ? '' : value).trim()
  if (!raw) return ''
  if (raw.startsWith('emoji:')) {
    const ch = raw.slice(6).trim()
    return ch ? `emoji:${ch}` : ''
  }
  const id = raw.startsWith('lucide:') ? raw.slice(7) : raw
  return Object.prototype.hasOwnProperty.call(LUCIDE_ICONS, id) ? `lucide:${id}` : ''
}

/** 只有图标 id 的旧值（宿主里可能还是纯字符串）→ 规范成 `lucide:xxx` */
export function normalizeIconId(value) {
  const v = normalizeIcon(value)
  return v.startsWith('lucide:') ? v.slice(7) : ''
}

export function isIconId(value) {
  return normalizeIcon(value).startsWith('lucide:')
}

/** 解析极简标记 → [{ tag, attrs }]（带缓存；1461 个图标按需解析） */
const parseCache = new Map()
export function iconNodes(id) {
  const key = String(id || '')
  if (parseCache.has(key)) return parseCache.get(key)
  const raw = LUCIDE_ICONS[key]
  if (!raw) { parseCache.set(key, null); return null }
  const nodes = []
  const re = /<([a-z]+)\s([^>]*)>/g
  let m
  while ((m = re.exec(raw))) {
    const tag = m[1]
    const attrs = {}
    const attrRe = /([a-z-]+)="([^"]*)"/g
    let a
    while ((a = attrRe.exec(m[2]))) {
      const name = a[1]
      attrs[name === 'w' ? 'width' : name === 'h' ? 'height' : name] = a[2]
    }
    nodes.push({ tag, attrs })
  }
  parseCache.set(key, nodes)
  return nodes
}

const TAG_MAP = { p: 'path', c: 'circle', r: 'rect', l: 'line', pl: 'polyline', pg: 'polygon' }

/** 渲染一个图标（`h` 来自 React）：24×24 线性，颜色跟随 currentColor */
export function renderIcon(deps, value, size) {
  const h = deps && deps.h
  const norm = normalizeIcon(value)
  if (!h || !norm) return null
  const s = Math.max(8, Number(size) || 16)
  if (norm.startsWith('emoji:')) {
    return h('span', {
      'aria-hidden': 'true',
      style: { fontSize: `${Math.round(s)}px`, lineHeight: 1, display: 'block' },
    }, norm.slice(6))
  }
  const nodes = iconNodes(norm.slice(7))
  if (!nodes) return null
  return h('svg', {
    width: s, height: s, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
  }, nodes.map((node, i) => h(TAG_MAP[node.tag] || 'path', { key: i, ...node.attrs })))
}

/** 气泡里用的是「原始标记」（要画进 SVG，不能塞 DOM）；返回 { paths, nodes } 由调用方选 */
export function iconDrawNodes(value) {
  const norm = normalizeIcon(value)
  if (!norm || !norm.startsWith('lucide:')) return null
  return iconNodes(norm.slice(7))
}

/** 搜索：匹配 id 与中文别名（空格分隔任一词命中） */
export function searchIcons(query, limit) {
  const q = String(query || '').trim().toLowerCase()
  const max = Math.max(1, Number(limit) || 120)
  if (!q) return ICON_IDS.slice(0, max)
  const words = q.split(/\s+/).filter(Boolean)
  const scored = []
  for (const id of ICON_IDS) {
    const alias = (ALIASES[id] || '').toLowerCase()
    const hay = `${id} ${alias}`
    let score = 0
    for (const w of words) {
      if (id === w) score += 100
      else if (id.startsWith(w)) score += 40
      else if (id.includes(w)) score += 20
      else if (alias.includes(w)) score += 15
      else { score = -1; break }
    }
    if (score > 0) scored.push([score, id])
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]))
  return scored.slice(0, max).map(([, id]) => id)
}

/** 按项目名推荐图标（先命中先生效，去重） */
export function suggestIcons(name, limit) {
  const text = String(name || '')
  const out = []
  const push = (id) => { if (id && ICON_IDS.includes(id) && !out.includes(id)) out.push(id) }
  for (const [re, ids] of NAME_RULES) if (re.test(text)) ids.forEach(push)
  DEFAULT_SUGGEST.forEach(push)
  return out.slice(0, Math.max(4, Number(limit) || 8))
}
