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
import { DEFAULT_DISTRICTS } from './districts.js'
import { DEFAULT_STATIONS } from './stations.js'
import { pixelPack } from './pixel.js'
import { officePack } from './office.js'
import { kenneyMiniPack } from './kenney-mini.js'
import { kenneyFurniturePack } from './kenney-furniture.js'
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
    // `DEFAULT_DISTRICTS` 单独导出：美术包要按区声明地板图（R55），
    // 整条重写会让边界坐标分叉成两份（与 `DEFAULT_STATIONS` 同一条理由）。
    districts: DEFAULT_DISTRICTS,


    // ── 站点库 ──────────────────────────────────────────────────────────────
    //
    // `relativeTo` 让坐标是相对地块中心的偏移：改小镇尺寸时不用手改十个坐标。
    //
    // `DEFAULT_STATIONS` 单独导出：`pack.kenney-furniture` 要**复用同一份锚点与能力**
    // 再加 `props`（M4-11）。整条重写会让坐标分叉成两份，改一处忘一处时
    // 表现是"某个家具飘到隔壁区"——那种错很难归因。
    stations: DEFAULT_STATIONS,

    // ── 皮肤库 ──────────────────────────────────────────────────────────────
    //
    // 配色来自 docs/ASSETS.md §6 的美术配方。色彩纪律：饱和度分三层，
    // 大面积低饱和表面 / 中间调家具 / 每个功能分区只有一个饱和强调色。
    skins: [
      {
        id: 'skin.default',
        name: '夜色工作室（默认）',
        // R32 换的是**色值，不是 token 名**。两套皮肤若用同名 token，`port.ts colors()`
        // 会按 id 排序叠加、后者静默覆盖前者——那样"换皮肤"就变成了"赌装载顺序"。
        // 所以换风格的正确做法是就地改值；它仍然兑现 D31 那句承诺：
        // **场景换了一个样子，`src/sim|domain|protocol|routes` 一行没改。**
        //
        // 风格：夜间工作室。深蓝灰底 + 每块被灯照亮的台面。
        // 纪律是**色相表意、明度分轻重**（与看板那组同一条），并且地块明度一律高于背景——
        // 地块要像"台面"，而不是像"背景上的污渍"（旧值 #6F7D5A 之类正是后者）。
        colors: {
          // ── 配色**从美术出发**（R57，决策 D52）──────────────────────────────
          //
          // R54 我曾把配色对齐到 MvizLite（`MvizLiteTheme.less`）。**那条约束已撤销**：
          // 用户明确说"不需要对齐 MvizLite 配色，你自己设计就行，这个和 MvizLite 没关系"。
          // 那套深灰蓝是给数据可视化面板用的，不是给游戏场景用的。
          //
          // 现在这组色是**量出来的**：我把要用的 26 件家具与角色图的主色统计了一遍，
          // 它们自己就是一族**偏紫的蓝灰**（`#3A3A50` 20% / `#46465E` 11% / `#565972` 9% /
          // `#6C6E85` 7%），配暖色点缀（木 `#D0BE9C`、头发 `#B37B3F`、皮肤 `#FFCBB0`）。
          //
          // 设计原则两条：
          //  ① **底色用美术自己那族紫蓝灰** —— 家具因此"长在场景里"，而不是贴上去的；
          //  ② **角色用高饱和亮色** —— 32px 的小人在暗底上必须一眼认得出是谁。
          'paper': '#D4DEE6',
          'ground': '#1C1A26',
          'wall': '#3A3A50',
          'wood': '#D0BE9C',
          'moss': '#5C7A5A',
          'teal': '#465E62',
          'ink': '#14121C',
          'fog': '#1C1A26',

          // 地块地面：**以 MvizLite 的卡片底色 `#2f343c` 为基准，往各自强调色的色相偏一点**。
          //
          // 为什么不直接拿四个强调色当地面：那四色是**前景色**（图标/描边/文字），
          // 铺满一块地会把画面压死。而纯用 `#2f343c` 四块地又长得一样——
          // R47 的 3D 评估就吃过这个亏（"四个区几乎全黑、分不出哪是哪"）。
          // 所以取中间：**低饱和、但色相分得开**，且全部落在 MvizLite 的冷灰蓝基调里。
          //   engineering ← 蓝 `#5B91F4` · infra ← 亮青 `#6CDCE7`
          //   meeting     ← 紫 `#A680FF` · commons ← 橙 `#F36600`
          // R55：**提亮过**。原来这四个是 `#333A48` 一类（亮度 ~50），乘上地砖之后
          // 整个地板只剩 38~44 级亮度，真机截图里"几乎接近黑色、纹理看不见"。
          // 现在亮度 ~62~79，仍然在 MvizLite 的冷灰蓝基调里（对方卡片底 `#2f343c` 是 52），
          // 但地板能看出来了。
          'ground.engineering': '#3E4E6E',
          'ground.infra': '#37504F',
          'ground.meeting': '#463A5C',
          'ground.commons': '#57462F',

          // 消息纸条（M2.5-2 让纸条真的会出现）。手头这张纸上最重要的一件事是
          // **一眼分清"交接"还是"汇报"**，所以两类给冷暖对比鲜明的两色。
          // 刻意避开全部 role.* 色：纸条会和角色圆点同时出现在画面上，
          // 撞色会让人以为"那个角色在发光"。
          'message.handoff': '#FFD166',
          'message.report': '#9AE6FF',
          'message.question': '#FFB4A2',
          'message.answer': '#A0E7A0',
          'message.dispatch': '#E0C3FC',

          // 分区强调色：与上面的地面色同色相、高明度——地块边缘的灯带。
          'accent.engineering': '#4FA8FF',
          'accent.infra': '#3FD0C9',
          'accent.meeting': '#B98CFF',
          'accent.commons': '#FFB259',

          // 角色职业色：高饱和、高明度。它们是画面里最小、最需要被看见的东西，
          // 所以是整张调色板里唯一允许"亮"的一组；彼此色相拉开，同屏八个人不撞色。
          'role.lead': '#FFC94D',
          'role.engineer': '#4FA8FF',
          // R51：**三个工程师席位需要三种颜色**。原来它们共用 `role.engineer`，
          // 于是 8 个角色只有 6 种颜色——2D 渲染里三个人长得一模一样（panel 数出来的：
          // agent-2/3/4 全是 #38BDF8）。同族拉开色相，保证"一眼能认出谁是谁"而不打乱蓝色=工程师这条语义。
          'role.engineer.2': '#7C7CFF',
          'role.engineer.3': '#3FD0C9',
          'role.reviewer': '#B98CFF',
          'role.researcher': '#5FD68A',
          'role.ops': '#FF8A4C',
          'role.docs': '#FF7EB6',

          // 站点色：比所在地块再亮一档的中间调，像台面上的设备，不抢角色的戏。
          'station.desk': '#5B7A99',
          'station.meeting': '#7A5C99',
          'station.server': '#4B5B8F',
          'station.mailroom': '#99784F',
          'station.lab': '#3F8F82',
          'station.breakroom': '#99694F',

          // 执行看板（M7-1）——取自 docs/ROADMAP.md §3.5 从参考图（DSH 内置 Agent Teams 看板）
          // 提取的目标值。看板与 3D 小镇**同屏并排**，所以这组色刻意比场景暗、比场景低饱和：
          // 它是"信息层"，不该跟会走动的小人抢视觉重心。
          //
          // 六态**直接用 TaskStatus**（不新造一套）：done 绿 / failed 红 / ready 琥珀 /
          // in_progress 蓝 / blocked 灰 / pending 更暗的灰。§3.5 只给了成功/失败/验证三个目标值，
          // 其余三个按"六态一眼可分"选，并且都服从同一条纪律：**色相表意，明度分轻重**。
          'board.bg': '#121212',
          'board.card': '#2C2C2C',
          'board.fg': '#E0E0E0',
          'board.dim': '#A0A0A0',
          // 依赖连线：淡，不抢节点（§3.5）。比 card 亮一点点，正好能在深底上看见。
          'board.line': '#444444',
          'board.cardLine': '#3A3A3A',
          // 边框语义（§3.5）：完成=实线深绿；验证=虚线橙；失败=实线红 + 微红底。
          'board.doneLine': '#15803D',
          'board.verify': '#F59E0B',
          'board.failBg': '#3A1D1D',
          // 选中：微弱发光，与"高亮"区分开（§3.5 最后一行）。
          'board.select': '#60A5FA',
          'board.status.pending': '#4B5563',
          'board.status.ready': '#F59E0B',
          'board.status.in_progress': '#3B82F6',
          'board.status.blocked': '#6B7280',
          'board.status.done': '#22C55E',
          'board.status.failed': '#EF4444',
          // 缺 token 时的哨兵色。**它是内容而不是代码里的字面量**：面板缺哪个 token
          // 就用它画，一眼看得出来（沿用 scene.ts resolveColor 里"品红=缺东西"的口径）。
          'board.missing': '#FF00FF',
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

      // ── 8 个席位的**占位**外观（R51）───────────────────────────────────────
      //
      // 花名册的每个席位声明了 `appearance`（"这个人长什么样"），所以那 8 个 id
      // **必须由基础包提供**——否则"只装 pack.default"的世界里，8 个角色会指向不存在的模型。
      // 这里给的是程序化 avatar 占位；`pack.pixel` 会把它们覆盖成像素图集。
      //
      // 与 `DEFAULT_STATIONS` 同一条思路：**基础包自洽**，艺术包负责升级外观。
      ...['tom', 'lea', 'jack', 'joe', 'stephen', 'alice', 'grace', 'monica'].map((n) => ({
        id: `model.agent.mv-${n}`,
        name: `席位外观（程序化）${n}`,
        source: { kind: 'procedural' as const, builder: 'avatar' },
        scale: 1,
        rotationY: 0,
        anchorY: 0,
      })),
    ],

    // ── 动作库 ──────────────────────────────────────────────────────────────
    //
    // `clip: null` = 程序化动画（起伏/挤压/倾斜）。每个 AgentState 都要有动作，
    // 否则角色进入那个状态会僵在上一帧（注册表的 validate() 会因此报错）。
    // ── 动作库（R60 起 **2D 渲染器真的读它了**）─────────────────────────────
    //
    // `band` = 像素图集里那条带。我们的 Microverse 图集只有三条带：
    // **`idle`（站着，6 帧，会轻微起伏）/ `walk`（走）/ `sit`（坐着，6 帧，与 idle 不同）**。
    // 所以"打字/喝咖啡/伸懒腰"这类姿态**这套图没有**——别在 `band` 里编一个不存在的名字，
    // 渲染器找不到就会退回 `idle`，看起来像"没生效"。
    //
    // `weight`：同一个状态下挑哪个。**干活给了 `sit` 更高的权重**——人坐在工位上干活
    // 比站着自然，而这套 `sit` 美术从 R51 入库起就一直是死数据（M13-4）。
    actions: [
      { id: 'action.idle', name: '待命', state: 'idle', clip: null, band: 'idle', weight: 1, loop: true, speedScale: 0.6, fadeMs: 200 },
      { id: 'action.walk', name: '走路', state: 'walking', clip: null, band: 'walk', weight: 1, loop: true, speedScale: 1, fadeMs: 150 },
      // 干活：多数坐姿 + 少数站姿（白板前、机柜前站着更合理）。
      { id: 'action.work.sit', name: '坐着干活', state: 'working', clip: null, band: 'sit', weight: 3, loop: true, speedScale: 1, fadeMs: 200 },
      { id: 'action.work.stand', name: '站着干活', state: 'working', clip: null, band: 'idle', weight: 1, loop: true, speedScale: 1, fadeMs: 200 },
      { id: 'action.talk', name: '交谈', state: 'talking', clip: null, band: 'idle', weight: 1, loop: true, speedScale: 0.8, fadeMs: 200 },
      { id: 'action.blocked', name: '受阻', state: 'blocked', clip: null, band: 'idle', weight: 1, loop: true, speedScale: 0.5, fadeMs: 250 },
      // 庆祝/休息**这套图集没有对应动作**：`band: null` 是**如实声明走不了**，
      // 让渲染器退回 idle，而不是硬播一个错的。
      { id: 'action.celebrate', name: '庆祝', state: 'celebrating', clip: null, band: null, weight: 1, loop: false, speedScale: 1.2, fadeMs: 150 },
      { id: 'action.sleep', name: '休息', state: 'sleeping', clip: null, band: 'sit', weight: 1, loop: true, speedScale: 0.4, fadeMs: 400 },
    ],

    // ── 主题库 ──────────────────────────────────────────────────────────────
    //
    // R32 起这套光照是**为深色场景调的**：主光偏冷白（像顶上的工作灯），
    // 环境光偏暖（像桌面反射），天光取皮肤里的夜色。
    // 换光照 = 改这里，`web/` 一行不用改——这也是 D31 那条"表现是内容"的一部分。
    themes: [
      {
        id: 'theme.cozy-isometric',
        name: '夜色工作室',
        camera: { projection: 'orthographic', yawDeg: 45, pitchDeg: 35.264, fov: null, zoom: 1.1 },
        // 雾比旧版浓一点：深色场景里远处的台面会自然融进背景，场景边缘不再"硬切"。
        fog: { color: 'skin.fog', density: 0.016 },
        lighting: {
          hemisphere: { sky: 'skin.paper', ground: 'skin.ground', intensity: 0.7 },
          // 主光：冷白，从左上打下来，负责"这是一张被照亮的工作台"。
          directional: { color: '#DCE6FF', intensity: 1.35, position: { x: 10, y: 20, z: 12 }, castShadow: true, shadowMapSize: 2048 },
          // 环境光：暖橙，很轻。它的作用是让阴影里不死黑，同时给冷色场景一点温度。
          ambient: { color: '#3A2E22', intensity: 0.45 },
        },
        post: { toneMapping: 'ACESFilmic', exposure: 1.15, bloom: { enabled: false, threshold: 0.9, strength: 0.35 } },
      },
    ],

    // ── 角色库 ──────────────────────────────────────────────────────────────
    rosters: [
      {
        id: 'roster.software-team',
        name: '软件团队',
        // 每个席位的 `persona` / `speechStyle` 会变成那个角色 DSH Agent 的 system prompt。
        // **这就是"跟小人物说话时他有自己的语气"的全部来源**——代码里没有任何一句台词（D37）。
        seats: [
          {
            role: 'lead',
            name: '工头阿金',
            palette: 'skin.role.lead',
            appearance: 'model.agent.mv-tom',
            model: null,
            persona:
              '带五个人的工程组长，排期与拍板的人。最怕的不是写错代码，而是"没人知道现在卡在谁身上"。' +
              '对进度比对代码更敏感，会主动把大活拆小。',
            speechStyle:
              '短句、直接、爱用祈使句。常挂嘴边的是「先做这个」「卡在哪？」「这事我来拍」。' +
              '不说客套话，也不解释自己为什么这么排——他觉得那是浪费时间。',
          },
          {
            role: 'engineer',
            name: '小蓝',
            palette: 'skin.role.engineer',
            appearance: 'model.agent.mv-lea',
            model: null,
            persona: '主力工程师，团队里写代码最快的那个。习惯先把问题复现出来再动手，讨厌凭感觉改。',
            speechStyle:
              '务实、干脆，爱说「我先复现一下」「我本地过不了」。会不自觉地蹦出英文术语，' +
              '而且不觉得这有什么问题。',
          },
          {
            role: 'engineer',
            name: '小铁',
            palette: 'skin.role.engineer.2',
            appearance: 'model.agent.mv-jack',
            model: null,
            persona: '工程师，稳的那一个。宁可慢半天也要把边界条件想清楚，最听不得"应该没问题"。',
            speechStyle:
              '语速慢，爱加限定条件：「如果并发上来呢」「边界是空的会怎样」。' +
              '不轻易说完成，说完成时会补一句自己没验的部分。',
          },
          {
            role: 'engineer',
            name: '小绿',
            palette: 'skin.role.engineer.3',
            appearance: 'model.agent.mv-joe',
            model: null,
            persona: '刚加入的工程师，好奇、问得多、不怕承认自己不会。学得很快，也因此经常先问再动。',
            speechStyle:
              '轻松、句子偏长。爱问「这个我可以问吗」「为什么这里要这么写」。' +
              '听不懂时会直接说听不懂，不会装作懂了。',
          },
          {
            role: 'reviewer',
            name: '小紫',
            palette: 'skin.role.reviewer',
            appearance: 'model.agent.mv-stephen',
            model: null,
            persona: '评审者，只认证据。见过太多"测过了"其实没测的提交，所以对断言比对人更信任。',
            speechStyle:
              '爱追问：「你怎么知道」「跑给我看」「这条断言能红吗」。' +
              '挑刺但不刻薄——挑的是证据的毛病，不是人的毛病。',
          },
          {
            role: 'researcher',
            name: '小青',
            palette: 'skin.role.researcher',
            appearance: 'model.agent.mv-alice',
            model: null,
            persona: '调研者，负责在动手之前把未知变成已知。宁可多花半天查，也不愿赌一个没验证的假设。',
            speechStyle:
              '谨慎，爱说「我不确定，先查一下」「这里有个反例」。' +
              '给结论时会说明这个结论有多牢，以及什么情况下会不成立。',
          },
          {
            role: 'ops',
            name: '小绯',
            palette: 'skin.role.ops',
            appearance: 'model.agent.mv-grace',
            model: null,
            persona: '运维，盯着稳定性。上线要经他签字，所以他对影响面与回滚方案最敏感，对"看起来没问题"零容忍。',
            speechStyle:
              '像值班日志：先讲影响面，再讲处置，最后讲回滚点。' +
              '常问「回滚点在哪」。语气平稳，越是出事越简短。',
          },
          {
            role: 'docs',
            name: '小雯',
            palette: 'skin.role.docs',
            appearance: 'model.agent.mv-monica',
            model: null,
            persona: '文档，把发生过的事写成别人能看懂的东西。会替读者提问，也因此常常发现没人注意到的前提缺失。',
            speechStyle:
              '耐心、爱追问「读者会怎么读这句」「这里少了个前提」。' +
              '喜欢把话一次说清，不喜欢靠上下文让对方猜。',
          },
        ],
      },
    ],

    // ── 任务库 ──────────────────────────────────────────────────────────────
    //
    // 一个条目 = 一条工作流。派单时一次派出一整条流水线，依赖关系由本库声明。
    tasks: [
      {
        // ⚠️ 这一套要**代码工具**（改文件、跑命令），而居民现在没有（R43 真机实测全卡在"改代码"）。
        // 留着是因为它描述了"居民拿到沙箱化代码工具之后"的活（D46）；在那之前派它必然卡住。
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
        // ── 小镇自己干得了的活（R44）────────────────────────────────────────────
        //
        // 居民的工具面**只有**看世界 / 读内容 / 派单（D35 + 部署的 toolPolicies），
        // 所以任何"改文件、跑命令"的活在当前能力面下**天生做不了**。
        // 实测（R43 真机）三条 software-feature/quick-fix 流水线全卡在"改代码"：
        // 成员如实报"我手上没有能改代码的工具"，判 failed，且拒绝伪造改动——它们是对的。
        //
        // 那套软件工程流水线留着（它描述的是"等居民拿到代码工具之后"的活，见 D46），
        // 但**小镇开局应该派这一套**：每一步都只用现有工具就能走完，产出是文字结论，
        // 而结论会随 `taskComplete` 落进 `task.output`，看板上直接读得到。
        id: 'task.town-inspection',
        name: '巡检一次小镇',
        description: '只用「看世界 / 读内容 / 派单」就能走完的流水线：盘点现状 → 核对工单 → 出结论。',
        tasks: [
          { key: 'survey', title: '盘点小镇现状', description: '用 agent_world_status 读一遍当前盘面：时钟、在岗的人、工单、站点占用。', requires: ['research'], dependsOn: [], acceptance: '报出当前 tick、在岗人数与各类工单的数量', estimateTicks: 240, role: 'researcher' },
          { key: 'check', title: '核对工单状态', description: '找出停滞或失败的工单，说清它卡在哪一步、为什么。', requires: ['review'], dependsOn: ['survey'], acceptance: '逐张列出异常工单的 id、状态与卡点', estimateTicks: 300, role: 'reviewer' },
          { key: 'report', title: '出巡检结论', description: '把发现写成一段结论交给队长：事实、判断、建议三段。', requires: ['deliver'], dependsOn: ['check'], acceptance: '结论含事实与判断，且不含未经验证的断言', estimateTicks: 180, role: 'ops' },
        ],
      },
      {
        // ⚠️ 同 `task.software-feature`：需要代码工具，当前能力面下走不完（见 D46）。
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
        // 小镇居民的共同规矩（R42 起是内容，不再写死在代码里）。
        residentRules: [
          '用你自己的语气说话，别模仿别人，也别替别人说话。',
          '要改变小镇上的事，只能通过工具去做；做不到就直说做不到，**不要声称你已经做了**。',
          '不知道的事就说不知道。',
          // M7-13（R41 真机）：agent-teams 的成员人设把说话的人框成"队长/船长"，并要求向队长汇报，
          // 于是角色对玩家说"已回复船长：…"。玩家是走过来跟你说话的人，不是你的上级。
          '跟你说话的是走到你面前的玩家。直接对他说话、回答他的问题；不要把他叫作"队长"或"船长"，也不要用"已汇报""已回复"这种向上级交差的口吻。',
        ],
      },
    ],
  },
}

/** 当前内置的全部内容包（按推荐装载顺序）。 */
export function builtinPacks(): ContentPack[] {
  // 顺序 = 装载顺序。表现包放后面（它 `overrides` 掉基础包里的条目）。
  return [
    defaultPack,
    kenneyMiniPack,
    kenneyFurniturePack,
    pixelPack,
    // R62：**原版办公室**。它整条覆盖 districts/stations 并提供底图——
    // 装在最后 = 它说了算（内容包按装载顺序叠加）。想去掉它回到"我们手搭的小镇"，
    // 把它从这一行删掉即可。
    officePack,
  ]
}
