/**
 * 内置内容包 `pack.default`（BACKLOG M1-4）。
 *
 * 这是**默认内容**：一座 4 地块 / 10 站点的小镇、一队 8 人角色、两条工作流。
 *
 * ## 为什么内置内容要编译进代码，而不是随包发 JSON
 *
 * 本仓库有一条很坑的约定（见 `docs/DEVELOPMENT.md` §7）：`file:` 依赖装进 profile 时是**硬链接副本**，
 * 已存在的文件会被原地重写（inode 相同）所以能同步，但**新增文件是全新 inode，没有任何环节会把它
 * 链进 profile** —— 表现为"源码里明明有这个文件，运行时却说找不到"，而且 dsh 是插件树加载失败就
 * 整体不启动。
 *
 * 所以：**内置内容 = TS 常量（编译进 lib/，不产生新文件）；外部内容 = `<workspace>/.agent-world/content/`
 * 下的 JSON（用户可替换，M1-6 实现）**。这样既"方便替换"，又不踩同步的坑。→ 决策 D14。
 *
 * ## 表现库现在是占位
 *
 * 模型与动作当前全是**程序化**（`clip: null`），因为角色资产要到 M5 才进来（Kenney Mini Characters）。
 * 到那时新增一个 `pack.kenney-mini`，在清单里显式 `overrides` 掉 `action.*` 与 `model.agent.base`
 * 即可 —— **模拟内核一行不用改**。这正是内容库层存在的意义，也是它第一次真正被验证。
 */
import { kenneyMiniPack } from './kenney-mini.js'
import type { ContentPack } from '../kinds.js'
import { CONTENT_SCHEMA_VERSION } from '../kinds.js'

/** 小镇半边长。与 `SceneEntry.groundSize` 保持一致（地块 bounds 由它推）。 */
const HALF = 8

/** 生成地块的矩形 bounds：`min` 到 `max`。 */
function box(x1: number, z1: number, x2: number, z2: number): { min: { x: number; z: number }; max: { x: number; z: number } } {
  return { min: { x: x1, z: z1 }, max: { x: x2, z: z2 } }
}

export const defaultPack: ContentPack = {
  manifest: {
    id: 'pack.default',
    name: '默认小镇',
    version: '1.0.0',
    schemaVersion: CONTENT_SCHEMA_VERSION,
    description: '4 地块 / 10 站点的默认小镇、8 人软件团队花名册、两条工作流；表现层全部程序化，零外部资产。',
    requires: [],
    provides: ['districts', 'stations', 'scenes', 'rosters', 'tasks', 'models', 'actions', 'skins', 'themes'],
    overrides: [],
  },

  entries: {
    // ── 地块库 ──────────────────────────────────────────────────────────────
    districts: [
      { id: 'district.engineering', name: '工程区', kind: 'engineering', bounds: box(-HALF, -HALF, 0, 0), ground: 'skin.ground.engineering' },
      { id: 'district.infra', name: '机房', kind: 'infra', bounds: box(0, -HALF, HALF, 0), ground: 'skin.ground.infra' },
      { id: 'district.meeting', name: '会议区', kind: 'meeting', bounds: box(-HALF, 0, 0, HALF), ground: 'skin.ground.meeting' },
      { id: 'district.commons', name: '公共区', kind: 'commons', bounds: box(0, 0, HALF, HALF), ground: 'skin.ground.commons' },
    ],

    // ── 站点库 ──────────────────────────────────────────────────────────────
    //
    // `relativeTo` 让坐标是相对地块中心的偏移：改小镇尺寸时不用手改十个坐标。
    stations: [
      { id: 'station.desk-a', name: '工位 A', kind: 'desk', district: 'district.engineering', relativeTo: 'district.engineering', anchor: { x: -1, z: -1 }, capacity: 1, capabilities: ['code'], model: 'model.station.desk' },
      { id: 'station.desk-b', name: '工位 B', kind: 'desk', district: 'district.engineering', relativeTo: 'district.engineering', anchor: { x: 1.5, z: -1 }, capacity: 1, capabilities: ['code'], model: 'model.station.desk' },
      { id: 'station.desk-c', name: '工位 C', kind: 'desk', district: 'district.engineering', relativeTo: 'district.engineering', anchor: { x: -1, z: 1.5 }, capacity: 1, capabilities: ['code'], model: 'model.station.desk' },
      { id: 'station.review-table', name: '评审桌', kind: 'desk', district: 'district.engineering', relativeTo: 'district.engineering', anchor: { x: 1.5, z: 1.5 }, capacity: 2, capabilities: ['review'], model: 'model.station.desk' },

      { id: 'station.server-rack', name: '机柜', kind: 'server', district: 'district.infra', relativeTo: 'district.infra', anchor: { x: -2, z: -1 }, capacity: 1, capabilities: ['compute'], model: 'model.station.server' },
      { id: 'station.lab-bench', name: '实验台', kind: 'lab', district: 'district.infra', relativeTo: 'district.infra', anchor: { x: 1.5, z: -1 }, capacity: 1, capabilities: ['research'], model: 'model.station.lab' },

      { id: 'station.war-room', name: '作战室', kind: 'meeting', district: 'district.meeting', relativeTo: 'district.meeting', anchor: { x: -1, z: -1 }, capacity: 4, capabilities: ['converse'], model: 'model.station.meeting' },
      { id: 'station.board', name: '告示板', kind: 'meeting', district: 'district.meeting', relativeTo: 'district.meeting', anchor: { x: 1.5, z: -1 }, capacity: 1, capabilities: ['review', 'converse'], model: 'model.station.meeting' },

      { id: 'station.mailroom', name: '收发室', kind: 'mailroom', district: 'district.commons', relativeTo: 'district.commons', anchor: { x: -1, z: -1 }, capacity: 1, capabilities: ['deliver'], model: 'model.station.mailroom' },
      { id: 'station.breakroom', name: '休息区', kind: 'breakroom', district: 'district.commons', relativeTo: 'district.commons', anchor: { x: 1.5, z: -1 }, capacity: 3, capabilities: ['rest'], model: 'model.station.breakroom' },
    ],

    // ── 皮肤库 ──────────────────────────────────────────────────────────────
    //
    // 配色来自 docs/ASSETS.md §6 的美术配方。色彩纪律：饱和度分三层，
    // 大面积低饱和表面 / 中间调家具 / 每个功能分区只有一个饱和强调色。
    skins: [
      {
        id: 'skin.default',
        name: '舒适等距沙盘（默认）',
        colors: {
          // 环境（大面积、低饱和）
          'paper': '#CFE6F5',
          'ground': '#E8D5B7',
          'wall': '#F7EFE3',
          'wood': '#B98A5E',
          'moss': '#8FA97C',
          'teal': '#4E8C8A',
          'ink': '#3B3A38',
          'fog': '#F2E8DC',

          // 地块地面（每个分区一个色，靠明度区分而非色相）
          'ground.engineering': '#6F7D5A',
          'ground.infra': '#5C6B78',
          'ground.meeting': '#8A7A5C',
          'ground.commons': '#7D6F5A',

          // 消息纸条（M2.5-2 让纸条真的会出现）。手头这张纸上最重要的一件事是
          // **一眼分清"交接"还是"汇报"**，所以两类给冷暖对比鲜明的两色。
          // 刻意避开全部 role.* 色：纸条会和角色圆点同时出现在画面上，
          // 撞色会让人以为"那个角色在发光"。
          'message.handoff': '#FFD166',
          'message.report': '#9AE6FF',
          'message.question': '#FFB4A2',
          'message.answer': '#A0E7A0',
          'message.dispatch': '#E0C3FC',

          // 分区强调色
          'accent.engineering': '#4FA3D1',
          'accent.infra': '#7FE3D4',
          'accent.meeting': '#D97A5A',
          'accent.commons': '#8E7CC3',

          // 角色职业色（中间调，保证一群 agent 读起来像一个团队）
          'role.lead': '#F0B429',
          'role.engineer': '#4FA3D1',
          'role.reviewer': '#A86BD1',
          'role.researcher': '#3FB8A8',
          'role.ops': '#E05A8A',
          'role.docs': '#6FBF73',

          // 站点色
          'station.desk': '#C9A227',
          'station.meeting': '#B06A3B',
          'station.server': '#4A5A6A',
          'station.mailroom': '#8F6F4A',
          'station.lab': '#5F8F7A',
          'station.breakroom': '#7A8F5F',
        },
      },
    ],

    // ── 模型库 ──────────────────────────────────────────────────────────────
    //
    // 全是程序化几何：零外部资产、零许可风险、零加载时间。M5 换 Kenney GLB 时只改这个库。
    models: [
      { id: 'model.agent.base', name: '角色（程序化）', source: { kind: 'procedural', builder: 'avatar' }, scale: 1, rotationY: 0, anchorY: 0 },
      { id: 'model.station.desk', name: '工位（程序化）', source: { kind: 'procedural', builder: 'desk' }, scale: 1, rotationY: 0, anchorY: 0 },
      { id: 'model.station.meeting', name: '会议桌（程序化）', source: { kind: 'procedural', builder: 'meeting' }, scale: 1, rotationY: 0, anchorY: 0 },
      { id: 'model.station.server', name: '机柜（程序化）', source: { kind: 'procedural', builder: 'server' }, scale: 1, rotationY: 0, anchorY: 0 },
      { id: 'model.station.mailroom', name: '收发室（程序化）', source: { kind: 'procedural', builder: 'mailroom' }, scale: 1, rotationY: 0, anchorY: 0 },
      { id: 'model.station.lab', name: '实验台（程序化）', source: { kind: 'procedural', builder: 'lab' }, scale: 1, rotationY: 0, anchorY: 0 },
      { id: 'model.station.breakroom', name: '休息区（程序化）', source: { kind: 'procedural', builder: 'breakroom' }, scale: 1, rotationY: 0, anchorY: 0 },
      { id: 'model.prop.delivery', name: '投递物（程序化）', source: { kind: 'procedural', builder: 'delivery' }, scale: 1, rotationY: 0, anchorY: 0 },
    ],

    // ── 动作库 ──────────────────────────────────────────────────────────────
    //
    // `clip: null` = 程序化动画（起伏/挤压/倾斜）。每个 AgentState 都要有动作，
    // 否则角色进入那个状态会僵在上一帧（注册表的 validate() 会因此报错）。
    actions: [
      { id: 'action.idle', name: '待命', state: 'idle', clip: null, loop: true, speedScale: 0.6, fadeMs: 200 },
      { id: 'action.walk', name: '走路', state: 'walking', clip: null, loop: true, speedScale: 1, fadeMs: 150 },
      { id: 'action.work', name: '干活', state: 'working', clip: null, loop: true, speedScale: 1, fadeMs: 200 },
      { id: 'action.talk', name: '交谈', state: 'talking', clip: null, loop: true, speedScale: 0.8, fadeMs: 200 },
      { id: 'action.blocked', name: '受阻', state: 'blocked', clip: null, loop: true, speedScale: 0.5, fadeMs: 250 },
      { id: 'action.celebrate', name: '庆祝', state: 'celebrating', clip: null, loop: false, speedScale: 1.2, fadeMs: 150 },
      { id: 'action.sleep', name: '休息', state: 'sleeping', clip: null, loop: true, speedScale: 0.4, fadeMs: 400 },
    ],

    // ── 主题库 ──────────────────────────────────────────────────────────────
    themes: [
      {
        id: 'theme.cozy-isometric',
        name: '舒适等距沙盘',
        camera: { projection: 'orthographic', yawDeg: 45, pitchDeg: 35.264, fov: null, zoom: 1.1 },
        fog: { color: 'skin.fog', density: 0.01 },
        lighting: {
          hemisphere: { sky: 'skin.paper', ground: 'skin.ground', intensity: 0.55 },
          directional: { color: '#FFD9A0', intensity: 1.5, position: { x: 12, y: 18, z: 8 }, castShadow: true, shadowMapSize: 2048 },
          ambient: { color: '#FFF3E0', intensity: 0.2 },
        },
        post: { toneMapping: 'ACESFilmic', exposure: 1.05, bloom: { enabled: false, threshold: 0.9, strength: 0.35 } },
      },
    ],

    // ── 角色库 ──────────────────────────────────────────────────────────────
    rosters: [
      {
        id: 'roster.software-team',
        name: '软件团队',
        seats: [
          { role: 'lead', name: '工头阿金', palette: 'skin.role.lead', model: null },
          { role: 'engineer', name: '小蓝', palette: 'skin.role.engineer', model: null },
          { role: 'engineer', name: '小铁', palette: 'skin.role.engineer', model: null },
          { role: 'engineer', name: '小绿', palette: 'skin.role.engineer', model: null },
          { role: 'reviewer', name: '小紫', palette: 'skin.role.reviewer', model: null },
          { role: 'researcher', name: '小青', palette: 'skin.role.researcher', model: null },
          { role: 'ops', name: '小绯', palette: 'skin.role.ops', model: null },
          { role: 'docs', name: '小雯', palette: 'skin.role.docs', model: null },
        ],
      },
    ],

    // ── 任务库 ──────────────────────────────────────────────────────────────
    //
    // 一个条目 = 一条工作流。派单时一次派出一整条流水线，依赖关系由本库声明。
    tasks: [
      {
        id: 'task.software-feature',
        name: '做一个功能',
        description: '从调研到交付的一条完整流水线。调研定方案 → 并行实现与测试 → 评审 → 文档 → 交付。',
        tasks: [
          { key: 'design', title: '调研并确定方案', description: '看清楚现状与约束，产出一个可执行的方案。', requires: ['research'], dependsOn: [], acceptance: '方案写明了改哪些文件、为什么这么改、有什么风险', estimateTicks: 900, role: 'researcher' },
          { key: 'impl-core', title: '实现核心逻辑', description: '按方案落地核心部分。', requires: ['code'], dependsOn: ['design'], acceptance: '核心逻辑有测试覆盖，typecheck 通过', estimateTicks: 1800, role: 'engineer' },
          { key: 'impl-api', title: '接入接口层', description: '把核心逻辑接到工具/HTTP 等对外入口。', requires: ['code'], dependsOn: ['design'], acceptance: '对外入口可用，有冒烟验证', estimateTicks: 1200, role: 'engineer' },
          { key: 'test', title: '跑一遍回归', description: '全量测试与构建。', requires: ['compute'], dependsOn: ['impl-core'], acceptance: '测试全绿，构建产物可用', estimateTicks: 600, role: 'ops' },
          { key: 'review', title: '评审实现', description: '对着验收条件逐条看。', requires: ['review'], dependsOn: ['impl-api', 'test'], acceptance: '每个验收条件都有明确的通过或打回理由', estimateTicks: 900, role: 'reviewer' },
          { key: 'docs', title: '补文档', description: '把新行为写进 README 与设计文档。', requires: ['code'], dependsOn: ['impl-core'], acceptance: '文档与实现一致，没有过期描述', estimateTicks: 600, role: 'docs' },
          { key: 'ship', title: '交付归档', description: '合并、打标签、归档这一局。', requires: ['deliver'], dependsOn: ['review', 'docs'], acceptance: '变更已合并，记录已归档', estimateTicks: 300, role: 'lead' },
        ],
      },
      {
        id: 'task.quick-fix',
        name: '快速修一个 bug',
        description: '短流程：定界 → 修 → 验。适合明确的小问题。',
        tasks: [
          { key: 'triage', title: '定位问题边界', description: '复现并缩小范围。', requires: ['research'], dependsOn: [], acceptance: '能稳定复现，且指出可疑范围', estimateTicks: 600, role: 'researcher' },
          { key: 'patch', title: '改代码', description: '按定位结果动手。', requires: ['code'], dependsOn: ['triage'], acceptance: '修复生效且未破坏其它行为', estimateTicks: 900, role: 'engineer' },
          { key: 'verify', title: '验证修复', description: '跑测试 + 手工确认。', requires: ['compute'], dependsOn: ['patch'], acceptance: '测试全绿，原问题不复现', estimateTicks: 300, role: 'ops' },
        ],
      },
    ],

    // ── 场景库 ──────────────────────────────────────────────────────────────
    scenes: [
      {
        id: 'scene.default-town',
        name: '默认小镇',
        districts: ['district.engineering', 'district.infra', 'district.meeting', 'district.commons'],
        stations: [
          'station.desk-a',
          'station.desk-b',
          'station.desk-c',
          'station.review-table',
          'station.server-rack',
          'station.lab-bench',
          'station.war-room',
          'station.board',
          'station.mailroom',
          'station.breakroom',
        ],
        spawn: { x: 0, z: 0 },
        groundSize: HALF,
        theme: 'theme.cozy-isometric',
        roster: 'roster.software-team',
        agentModel: 'model.agent.base',
      },
    ],
  },
}

/** 当前内置的全部内容包（按推荐装载顺序）。 */
export function builtinPacks(): ContentPack[] {
  // 顺序 = 装载顺序。表现包放后面（它 `overrides` 掉基础包里的条目）。
  return [defaultPack, kenneyMiniPack]
}
