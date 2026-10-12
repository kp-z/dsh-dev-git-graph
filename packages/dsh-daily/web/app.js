/* ==========================================================================
 * dsh-daily 侧边栏网页 · 应用
 *
 * 分区（按出现顺序）：
 *   0. 常量与工具
 *   1. 内置演示数据（接口不可用时兜底，便于本地双击 index.html 肉眼检查）
 *   2. state —— 全局可变状态
 *   3. api   —— 后端契约封装（永不 throw，返回 { data, error }）
 *   4. render—— 纯渲染：把 state 映射成 DOM（不碰网络）
 *   5. events—— 交互绑定 / 事件委托 / 主题消息
 *   6. boot
 *
 * 硬约束：
 *   - 不用 innerHTML 拼后端数据（title/summary/sourceName 可能含任意字符）→ 一律
 *     document.createElement + textContent。唯一使用 innerHTML 的地方是常量 SVG 图标。
 *   - 不引用任何外部网络资源（无 CDN / 字体 / 图标库）。
 *   - 所有接口走相对路径（页面挂在 /dsh-daily/ 子路径下）。
 * ========================================================================== */
(function () {
  'use strict';

  /* ======================================================================
   * 0. 常量与工具
   * ==================================================================== */

  var API = {
    state: './api/state',
    items: './api/items',
    feedback: './api/feedback',
    tune: './api/tune',
    refresh: './api/refresh',
    digest: './api/digest',
    ai: './api/ai',
    archive: './api/archive',
    weekly: './api/weekly',
    // 订阅管理用的两个：opml 导入导出、自定义源列表与移除。
    // 加进这张表**必须**同步 —— 键名写错不会报错，只会去 fetch `undefined`，
    // 界面上表现为"转一下就没了"，非常难查（本轮就踩了一次：
    // 所以 test/client-contract.test.js 会静态核对"用到的键都在表里"）。
    opml: './api/opml',
    feeds: './api/feeds',
    projects: './api/projects'
  };

  var FETCH_TIMEOUT_MS = 20000;   // refresh 走后台，不需要长超时
  var ITEM_LIMIT = 200;           // 一次性拉全量，之后全部本地筛选（即时）
  var SEARCH_DEBOUNCE_MS = 120;
  var CAPSULE_TICK_MS = 15000;    // 刷新中胶囊上的"生成于"时间刷新频率
  var PLAY_ICON_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M8 5.5v13l11-6.5-11-6.5Z"/></svg>';
  var NOTES_PREVIEW_MAX = 6;

  /** 今天的本地日期 YYYY-MM-DD */
  function todayLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 安全解析时间：Date | number | 字符串 → Date，失败返回 null */
  function toDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  /** 本地时区 HH:MM */
  function formatClock(v) {
    var d = toDate(v);
    if (!d) return '';
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /** 本地时区 YYYY-MM-DD HH:MM */
  function formatDateTime(v) {
    var d = toDate(v);
    if (!d) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /** 相对时间：刚刚 / 12 分钟前 / 3 小时前 / 昨天 / 3 天前 / MM-DD */
  function formatRelative(v) {
    var d = toDate(v);
    if (!d) return '';
    var diff = Date.now() - d.getTime();
    if (diff < 0) diff = 0;                       // 轻微时钟漂移按"刚刚"处理
    var min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟前';
    var hours = Math.floor(min / 60);
    if (hours < 24) return hours + ' 小时前';
    if (hours < 48) return '昨天';
    // 跨天判断用本地日历日，避免 47h/49h 的边界歧义
    var days = localDayDiff(d, new Date());
    if (days === 1) return '昨天';
    if (days < 7) return days + ' 天前';
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function localDayDiff(a, b) {
    var da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    var db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((db - da) / 86400000);
  }

  /** 13200 → 1.3万；48213 → 4.8万；1200000 → 120万 */
  function formatCount(n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0) return '';
    var r = Math.round(n);
    if (r < 10000) return String(r);
    if (r < 100000000) return trimZero(r / 10000) + '万';
    return trimZero(r / 100000000) + '亿';
  }

  function trimZero(x) {
    var s = x >= 100 ? String(Math.round(x)) : x.toFixed(1);
    return s.replace(/\.0$/, '');
  }

  /** 只有 http(s) 才允许作为跳转目标（防 javascript:/data: 注入） */
  function safeUrl(raw) {
    if (typeof raw !== 'string') return null;
    var s = raw.trim();
    if (!/^https?:\/\//i.test(s)) return null;
    return s;
  }

  /** 平台 → 徽标文案 / 样式类 */
  function platformInfo(item) {
    var p = String(item.platform || '').toLowerCase();
    var src = item.sourceName || item.sourceId || '';
    if (item.kind === 'video') {
      if (p === 'bilibili') return { text: '哔哩哔哩', cls: 'dd-badge-bili' };
      if (p === 'youtube') return { text: 'YouTube', cls: 'dd-badge-yt' };
      return { text: src || '视频', cls: '' };
    }
    if (p === 'arxiv') return { text: 'arXiv', cls: '' };
    if (p === 'github') return { text: 'GitHub', cls: '' };
    if (p === 'hackernews') return { text: 'HN', cls: '' };
    if (p === 'web') return { text: src || '网页', cls: '' };
    return { text: src || p || '来源', cls: '' };
  }

  function classNames() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (a) out.push(a);
    }
    return out.join(' ');
  }

  /* ======================================================================
   * 1. 内置演示数据（./api/state 失败时兜底）
   *    形制与真实接口完全一致；刷新/调教/反馈在演示态下本地模拟，不请求后端。
   * ==================================================================== */

  function mockPayload() {
    var now = Date.now();
    var at = function (minAgo) { return new Date(now - minAgo * 60000).toISOString(); };
    var date = todayLocal();

    var items = [
      {
        id: 'demo-001', kind: 'video', platform: 'youtube', sourceId: 'youtube',
        sourceName: 'Two Minute Papers',
        title: 'DeepMind 的新模型把「蛋白质折叠」又推进了一步',
        url: 'https://www.youtube.com/watch?v=demo001',
        topic: 'AI', summary: '用一句话讲清楚这次改动的关键：训练目标变了，泛化能力随之提升。',
        publishedAt: at(34), author: 'Two Minute Papers',
        thumb: 'https://i.ytimg.com/vi/demo001/hqdefault.jpg',
        duration: '12:34', stats: { views: 48213 }, score: 87.3,
        reasons: ['主题命中 AI', '频道权重高'], read: false, liked: false, disliked: false, hidden: false
      },
      {
        id: 'demo-002', kind: 'web', platform: 'hackernews', sourceId: 'hn',
        sourceName: 'Hacker News',
        title: 'SQLite 是如何做到读操作几乎零拷贝的',
        url: 'https://example.com/sqlite-reads',
        topic: '技术', summary: '把 WAL 与 mmap 的组合拆开看，解释了为什么并发读不会被写阻塞。',
        publishedAt: at(96), author: 'HN 用户', thumb: null, duration: null,
        stats: { views: 128 }, score: 72.1,
        reasons: ['讨论热度高', '3 小时前发布'], read: false, liked: false, disliked: false, hidden: false
      },
      {
        id: 'demo-003', kind: 'video', platform: 'bilibili', sourceId: 'bilibili',
        sourceName: '硬核的Heymatt',
        title: '从零手写一个向量数据库：分词、索引、召回全流程',
        url: 'https://www.bilibili.com/video/BVdemo003',
        topic: 'AI', summary: '不依赖任何现成库，从倒排索引一路搭到 HNSW 的近似检索。',
        publishedAt: at(260), author: '硬核的Heymatt',
        thumb: 'https://i0.hdslb.com/bfs/archive/demo003.jpg',
        duration: '42:07', stats: { views: 132000 }, score: 68.4,
        reasons: ['主题命中 AI', '播放量高'], read: false, liked: false, disliked: false, hidden: false
      },
      {
        id: 'demo-004', kind: 'web', platform: 'github', sourceId: 'github',
        sourceName: 'GitHub Trending',
        title: '一个零依赖的 Agent 编排框架，今天涨了 800 星',
        url: 'https://github.com/example/zero-dep-agent',
        topic: '开源', summary: '核心只有 6 个文件，把工具调用与状态机分开，适合读源码学设计。',
        publishedAt: at(420), author: 'example', thumb: null, duration: null,
        stats: { views: 96 }, score: 65.0,
        reasons: ['开源热度', '主题命中 开源'], read: true, liked: true, disliked: false, hidden: false
      },
      {
        id: 'demo-005', kind: 'web', platform: 'arxiv', sourceId: 'arxiv',
        sourceName: 'arXiv cs.AI',
        title: '长上下文推理中的注意力稀疏化：一份实证分析',
        url: 'https://arxiv.org/abs/2510.00001',
        topic: '学术', summary: '在 6 个基准上比较了稀疏注意力，结论是收益主要集中在超长文档检索。',
        publishedAt: at(600), author: 'Anonymous et al.', thumb: null, duration: null,
        stats: { views: 41 }, score: 61.2,
        reasons: ['学术源', '主题命中 学术'], read: false, liked: false, disliked: false, hidden: false
      },
      {
        id: 'demo-006', kind: 'web', platform: 'web', sourceId: 'sspai',
        sourceName: '少数派',
        title: '我把每日阅读搬进了侧边栏：一个信息流工作流',
        url: 'https://sspai.com/post/900006',
        topic: '热点', summary: '作者分享了三种信息源分层方式，以及怎么避免每天被推送牵着走。',
        publishedAt: at(1500), author: '少数派编辑部', thumb: null, duration: null,
        stats: { views: 73 }, score: 54.8,
        reasons: ['中媒源'], read: false, liked: false, disliked: false, hidden: false
      },
      {
        id: 'demo-007', kind: 'web', platform: 'web', sourceId: 'ruanyf',
        sourceName: '阮一峰的网络日志',
        title: '科技爱好者周刊（第 331 期）',
        url: 'https://www.ruanyifeng.com/blog/2026/10/weekly-331.html',
        topic: '技术', summary: '本期值得关注的工具与文章清单，附一句话点评。',
        publishedAt: at(1800), author: '阮一峰', thumb: null, duration: null,
        stats: { views: 55 }, score: 52.3,
        reasons: ['中媒源', '主题命中 技术'], read: false, liked: false, disliked: false, hidden: false
      },
      {
        id: 'demo-008', kind: 'video', platform: 'youtube', sourceId: 'youtube',
        sourceName: 'Fireship',
        title: '100 秒讲完今年的前端构建工具变化',
        url: 'https://www.youtube.com/watch?v=demo008',
        topic: '技术', summary: '快节奏盘点：打包器、运行时、类型检查三条线各自发生了什么。',
        publishedAt: at(2600), author: 'Fireship',
        thumb: 'https://i.ytimg.com/vi/demo008/hqdefault.jpg',
        duration: '02:41', stats: { views: 2100000 }, score: 50.9,
        reasons: ['播放量高'], read: false, liked: false, disliked: false, hidden: false
      },
      {
        id: 'demo-009', kind: 'web', platform: 'hackernews', sourceId: 'hn',
        sourceName: 'Hacker News',
        title: '为什么我们把生产环境的 Postgres 换回了单机',
        url: 'https://example.com/postgres-single-node',
        topic: '技术', summary: '一次反直觉的迁移复盘：瓶颈从来不在数据库，而在网络与连接池。',
        publishedAt: at(4100), author: 'HN 用户', thumb: null, duration: null,
        stats: { views: 187 }, score: 47.6,
        reasons: ['讨论热度高'], read: true, liked: false, disliked: false, hidden: false
      },
      {
        id: 'demo-010', kind: 'web', platform: 'web', sourceId: 'solidot',
        sourceName: 'Solidot',
        title: '开源许可证变更引发的一次社区分裂',
        url: 'https://www.solidot.org/story?sid=900010',
        topic: '开源', summary: '从 CLA 到源码可用许可，社区的争议点集中在商业使用边界。',
        publishedAt: at(5200), author: 'Solidot', thumb: null, duration: null,
        stats: { views: 30 }, score: 43.2,
        reasons: ['开源话题'], read: false, liked: false, disliked: false, hidden: false
      }
    ];

    return {
      state: {
        ok: true,
        date: date,
        generatedAt: at(5),
        lastRefresh: { at: at(5), durationMs: 4231, ok: true },
        refreshing: false,
        counts: { total: items.length, unread: countUnread(items), byTopic: countByTopic(items) },
        sources: [
          { id: 'hn', name: 'Hacker News', kind: 'web', ok: true, count: 2, error: null },
          { id: 'arxiv', name: 'arXiv', kind: 'web', ok: true, count: 1, error: null },
          { id: 'github', name: 'GitHub Search', kind: 'web', ok: true, count: 1, error: null },
          { id: 'sspai', name: '少数派', kind: 'web', ok: true, count: 1, error: null },
          { id: 'ruanyf', name: '阮一峰的网络日志', kind: 'web', ok: true, count: 1, error: null },
          { id: 'solidot', name: 'Solidot', kind: 'web', ok: true, count: 1, error: null },
          { id: 'bilibili', name: '哔哩哔哩', kind: 'video', ok: true, count: 1, error: null },
          { id: 'youtube', name: 'YouTube', kind: 'video', ok: false, count: 0,
            error: '全部镜像不可用（rsshub.ktachibana.party: HTTP 502）' }
        ],
        prefs: {
          topics: ['AI', '开源'],
          keywords: [{ word: 'agent', weight: 1.5 }, { word: '推理', weight: 1.2 }],
          blocked: ['币圈'],
          dailyQuota: 30,
          tuningNotes: ['用户希望每天推 AI 相关新闻']
        },
        digest: { available: true, path: '~/.dsh/daily/digest/' + date + '.md', updatedAt: at(3) }
      },
      items: items
    };
  }

  function countUnread(items) {
    var n = 0;
    for (var i = 0; i < items.length; i++) if (!items[i].read) n++;
    return n;
  }

  function countByTopic(items) {
    var out = {};
    for (var i = 0; i < items.length; i++) {
      var t = items[i].topic || '未分类';
      out[t] = (out[t] || 0) + 1;
    }
    return out;
  }

  /* ======================================================================
   * 2. state
   * ==================================================================== */

  var state = {
    // 演示态：./api/state 失败时为 true，之后不再打后端
    demo: false,
    demoNotice: '',            // 降级原因（展示在错误条里）

    // 服务端状态
    date: todayLocal(),
    generatedAt: null,
    lastRefresh: null,
    refreshing: false,
    counts: { total: 0, unread: 0, byTopic: {} },
    sources: [],
    prefs: null,
    digest: { available: false, path: '', updatedAt: null },

    // 列表数据（全量本地筛选）
    items: [],
    hiddenIds: {},             // 本地已隐藏（立即从视图移除）
    querySyncing: false,       // 搜索是否正在向后端补拉
    queryServerHits: null,     // 后端对当前关键词的命中数（仅作提示，不替换数据集）

    // 筛选
    topic: '全部',
    query: '',
    unreadOnly: false,
    expanded: {},              // 已展开摘要的 id

    // 视图状态
    loading: true,             // 首屏/整体加载中
    itemsLoading: false,
    stateError: null,          // 顶部错误条
    itemsError: null,          // 列表错误条
    tuneBusy: false,
    tuneNote: null,            // { title, lines[] }
    refreshBusy: false,
    aiBusy: false,
    ai: { enabled: false, last: null },
    archive: [],            // 归档索引（新到旧），用于按天翻阅
    today: null,            // 服务端认为的"今天"
    datePinned: false,      // 用户是否手动翻到了某一天
    feedsCount: 0,          // 自定义源数量（页脚入口显示用）
    project: null,          // 当前项目 {dir,name,isDefault,dataDir}
    projects: [],           // 已知项目清单
    digestBusy: false
  };

  var el = {};

  /* ======================================================================
   * 3. api —— 一律返回 { data, error }，绝不 throw
   * ==================================================================== */

  function readJsonBody(res) {
    return res.text().then(function (text) {
      if (!text) return { data: null, error: null, empty: true };
      try {
        return { data: JSON.parse(text), error: null };
      } catch (e) {
        return { data: null, error: '返回内容不是 JSON（HTTP ' + res.status + '）' };
      }
    });
  }

  /** GET → { data, error }；data 已经是解包后的 JSON */
  function apiGet(path, params) {
    var url = path;
    if (params) {
      var parts = [];
      for (var k in params) {
        if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
        var v = params[k];
        if (v === null || v === undefined || v === '') continue;
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
      }
      if (parts.length) url += (url.indexOf('?') === -1 ? '?' : '&') + parts.join('&');
    }
    return fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    }).then(function (res) {
      if (!res.ok) return { data: null, error: 'HTTP ' + res.status + ' ' + res.statusText };
      return readJsonBody(res).then(function (r) {
        if (r.error) return { data: null, error: r.error };
        if (!r.data || typeof r.data !== 'object') return { data: null, error: '返回结构异常' };
        if (r.data.ok === false) return { data: null, error: r.data.error || '后端返回失败' };
        return { data: r.data, error: null };
      });
    }, function (err) {
      return { data: null, error: describeFetchError(err) };
    });
  }

  /** POST JSON → { data, error } */
  function apiPost(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    }).then(function (res) {
      if (!res.ok) return { data: null, error: 'HTTP ' + res.status + ' ' + res.statusText };
      return readJsonBody(res).then(function (r) {
        if (r.error) return { data: null, error: r.error };
        if (!r.data || typeof r.data !== 'object') return { data: null, error: '返回结构异常' };
        if (r.data.ok === false) return { data: null, error: r.data.error || '后端返回失败' };
        return { data: r.data, error: null };
      });
    }, function (err) {
      return { data: null, error: describeFetchError(err) };
    });
  }

  function describeFetchError(err) {
    if (!err) return '请求失败';
    if (err.name === 'TimeoutError') return '请求超时';
    if (err.name === 'AbortError') return '请求被取消';
    var m = err.message || String(err);
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
      return '无法连接插件路由（可能不在 /dsh-daily/ 下打开）';
    }
    return m;
  }

  /* ======================================================================
   * 4. render
   * ==================================================================== */

  function $(id) { return document.getElementById(id); }

  function text(tag, className, value) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (value !== null && value !== undefined) n.textContent = String(value);
    return n;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* ---------- 4.1 派生数据 ---------- */

  function visibleItems() {
    var q = state.query.trim().toLowerCase();
    var out = [];
    for (var i = 0; i < state.items.length; i++) {
      var it = state.items[i];
      if (state.hiddenIds[it.id]) continue;
      if (state.topic !== '全部' && (it.topic || '未分类') !== state.topic) continue;
      if (state.unreadOnly && it.read) continue;
      if (q && !matchesQuery(it, q)) continue;
      out.push(it);
    }
    return out;
  }

  function matchesQuery(it, q) {
    return (
      String(it.title || '').toLowerCase().indexOf(q) !== -1 ||
      String(it.summary || '').toLowerCase().indexOf(q) !== -1 ||
      // AI 摘要也要参与搜索：用户记住的往往是那句中文一句话
      String(it.aiSummary || '').toLowerCase().indexOf(q) !== -1 ||
      String(it.sourceName || '').toLowerCase().indexOf(q) !== -1 ||
      String(it.author || '').toLowerCase().indexOf(q) !== -1
    );
  }

  function topicCounts() {
    var counts = {};
    var total = 0;
    for (var i = 0; i < state.items.length; i++) {
      var it = state.items[i];
      if (state.hiddenIds[it.id]) continue;
      total++;
      var t = it.topic || '未分类';
      counts[t] = (counts[t] || 0) + 1;
    }
    var list = [];
    for (var k in counts) {
      if (Object.prototype.hasOwnProperty.call(counts, k)) list.push({ topic: k, count: counts[k] });
    }
    list.sort(function (a, b) { return b.count - a.count; });
    return { list: list, total: total };
  }

  function unreadCount() {
    var n = 0;
    for (var i = 0; i < state.items.length; i++) {
      var it = state.items[i];
      if (!state.hiddenIds[it.id] && !it.read) n++;
    }
    return n;
  }

  function sourceHealth() {
    var okCount = 0;
    var bad = [];
    for (var i = 0; i < state.sources.length; i++) {
      var s = state.sources[i];
      if (s.ok) okCount++;
      else bad.push(s);
    }
    return { ok: okCount, total: state.sources.length, bad: bad };
  }

  /* ---------- 4.2 顶部 ---------- */

  function renderHeader() {
    el.date.textContent = state.date || '';

    var total = state.items.length ? topicCounts().total : (state.counts.total || 0);
    var unread = state.items.length ? unreadCount() : (state.counts.unread || 0);
    var health = sourceHealth();

    clear(el.stats);
    // 演示数据必须在这一行就能看出来 —— 否则"10 条 · 8 未读 · 7/8 源正常"
    // 会被当成真实数字（标题与页脚虽然也标了，但那两处更容易被略过）。
    if (state.demo) {
      el.stats.appendChild(text('span', 'dd-stat-demo', '演示数据'));
      el.stats.appendChild(document.createTextNode(' · '));
    }
    el.stats.appendChild(document.createTextNode(total + ' 条 · ' + unread + ' 未读'));
    if (health.total > 0) {
      el.stats.appendChild(document.createTextNode(' · '));
      var src = text('span', health.bad.length ? 'dd-stat-warn' : '', health.ok + '/' + health.total + ' 源正常');
      // 把"正常源的补充说明"挂进 tooltip：轮转会让 YouTube 只抓 3/5 个频道，
      // 这不是故障 —— 但用户看到条数变少时会以为是故障，所以原因必须够得着。
      var noted = state.sources.filter(function (s) { return s.ok && s.error; });
      if (noted.length) {
        src.title = noted.map(function (s) { return s.name + '：' + s.error; }).join('\n');
      }
      el.stats.appendChild(src);
    }
    if (state.items.length) {
      el.stats.appendChild(document.createTextNode(' · 已加载 ' + state.items.length));
    }
    // 看历史时把"刷新不适用"写在统计行里。
    // 为什么不用"按钮 disabled + tooltip"就完事：实测点不动 disabled 按钮，
    // 提示永远不会出现，而 tooltip 又太容易被忽略 —— 放在用户一定会读的那一行才有效。
    if (state.today && state.date !== state.today) {
      el.stats.appendChild(document.createTextNode(' · '));
      el.stats.appendChild(
        text('span', 'dd-stat-history', '历史数据 · 刷新只抓今天'),
      );
    }

    var history = !!(state.today && state.date !== state.today);
    el.refreshBtn.disabled = state.refreshBusy || state.aiBusy || history;
    el.refreshBtn.classList.toggle('dd-spin', state.refreshBusy);
    el.refreshBtn.title = history ? '正在看历史数据：刷新只会抓今天' : '刷新订阅源';
    if (el.aiBtn) {
      el.aiBtn.disabled = state.refreshBusy || state.aiBusy;
      el.aiBtn.classList.toggle('dd-spin', state.aiBusy);
    }
    el.digestBtn.disabled = state.digestBusy;
  }

  /* ---------- 4.3 筛选行 ---------- */

  function renderFilters() {
    var tc = topicCounts();
    var list = [{ topic: '全部', count: tc.total }].concat(tc.list);

    clear(el.chips);
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'dd-chip';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', entry.topic === state.topic ? 'true' : 'false');
      b.dataset.topic = entry.topic;
      b.title = entry.topic + ' · ' + entry.count + ' 条';
      b.appendChild(document.createTextNode(entry.topic));
      b.appendChild(text('span', 'dd-chip-count', String(entry.count)));
      el.chips.appendChild(b);
    }
  }

  /* ---------- 4.4 列表 ---------- */

  function renderList() {
    var list = el.list;
    clear(list);
    list.setAttribute('aria-busy', state.itemsLoading ? 'true' : 'false');

    if (state.itemsError) {
      list.appendChild(emptyBlock('⚠', '列表加载失败', state.itemsError, '重试', 'retry-items'));
      return;
    }
    if (state.loading && !state.demo && state.items.length === 0) {
      for (var s = 0; s < 4; s++) list.appendChild(text('div', 'dd-skeleton'));
      return;
    }

    var items = visibleItems();

    if (items.length === 0) {
      list.appendChild(emptyBlockForCurrentFilter());
      return;
    }

    var frag = document.createDocumentFragment();
    for (var i = 0; i < items.length; i++) {
      frag.appendChild(renderItem(items[i]));
    }
    list.appendChild(frag);
  }

  function emptyBlockForCurrentFilter() {
    // 区分：还没抓取过 / 后端当天没数据 / 当前筛选下没有
    if (state.items.length === 0) {
      var total = state.counts.total || 0;
      if (total > 0) {
        return emptyBlock('📭', '本地没有这一天的条目', '后端记录 ' + total + ' 条，可能日期不匹配。点刷新重新抓取。');
      }
      return emptyBlock(
        '🌱',
        '今天还没抓取过',
        '点下面的按钮开始第一次抓取（大约 30–60 秒），抓完条目会自动出现在这里。',
        '开始抓取',
        'start-refresh'
      );
    }
    var parts = [];
    if (state.query) parts.push('关键词「' + state.query + '」');
    if (state.topic !== '全部') parts.push('主题「' + state.topic + '」');
    if (state.unreadOnly) parts.push('仅未读');
    var hint = parts.length ? '已排除 ' + parts.join(' + ') + '。按 Esc 清空筛选。' : '按 Esc 清空筛选。';
    // 本地没命中但后端命中过 → 说清楚，避免用户以为搜索坏了
    if (state.query && state.queryServerHits && state.queryServerHits.returned > 0) {
      hint = '后端对「' + state.query + '」命中 ' + state.queryServerHits.returned +
        ' 条，但都不在当前筛选范围内。' + hint;
    }
    return emptyBlock('🔍', '当前筛选下没有条目', hint);
  }

  function emptyBlock(icon, title, hint, actionLabel, actionName) {
    var box = text('div', 'dd-empty');
    box.appendChild(text('div', 'dd-empty-icon', icon));
    box.appendChild(text('div', 'dd-empty-title', title));
    if (hint) box.appendChild(text('p', 'dd-empty-hint', hint));
    if (actionLabel) {
      var b = text('button', 'dd-btn dd-empty-action', actionLabel);
      b.type = 'button';
      if (actionName) b.dataset.action = actionName;
      box.appendChild(b);
    }
    return box;
  }

  /* ---------- 4.5 打开外链（带完整的降级链） ---------- */

  /**
   * 打开外部链接。返回是否"已有人接手"。
   *
   * 为什么不能只写 `window.open(...)`：它的返回值**必须检查**。
   * 被拦时返回 null 且不抛异常 —— 表现就是用户报的"点卡片没反应"，而且没有任何痕迹。
   * 这是本项目真实踩过的坑（叠加了另一个 bug：整卡覆盖链接其实是 position:static，
   * 用户点到的根本不是链接。两个问题叠在一起，症状一模一样）。
   *
   * 降级顺序：
   *   1. window.open（本页上下文；有用户激活时通常可用）
   *   2. postMessage 给父级 —— 插件页面跑在 DSH 侧边栏的 iframe 里，
   *      父级（客户端半体）位于应用主窗口，它那里的 window.open 更可能被宿主接受
   *   3. 都不行 → 自动复制链接 + 给一条明确的提示（绝不留下一次"死点击"）
   */
  function openExternal(url) {
    var win = null;
    try {
      win = window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      win = null;
    }
    if (win) return true;

    if (window.parent && window.parent !== window) {
      // 父级会回执：成功静默，失败再走兜底提示（见 message 监听）
      pendingOpens[url] = true;
      try {
        window.parent.postMessage({ type: 'dsh-daily-open', url: url }, '*');
        return true;
      } catch (err) {
        /* 跨域等异常 → 落到兜底 */
      }
    }
    return false;
  }

  /** 最后一道兜底：把链接复制进剪贴板并说清楚，避免"点了没反应"。 */
  function showOpenFallback(url) {
    var copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url);
        copied = true;
      }
    } catch (err) {
      copied = false;
    }
    showTuneNote('没能自动打开', [
      copied ? '链接已复制到剪贴板，可以粘贴到浏览器打开。' : '请手动复制下面的链接。',
      url,
    ]);
  }

  var pendingOpens = {};

  /** 监听父级的回执（客户端半体打开失败时会告诉我们）。 */
  function onOpenAck(event) {
    var data = event && event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'dsh-daily-open-failed' && typeof data.url === 'string') {
      if (pendingOpens[data.url]) {
        delete pendingOpens[data.url];
        showOpenFallback(data.url);
      }
    } else if (data.type === 'dsh-daily-open-ok' && typeof data.url === 'string') {
      delete pendingOpens[data.url];
    }
  }

  function renderItem(it) {
    var item = document.createElement('article');
    item.className = classNames('dd-item', it.read && 'is-read');
    item.dataset.id = it.id;
    item.dataset.kind = it.kind || 'web';
    item.tabIndex = -1;

    var url = safeUrl(it.url);

    // 主链接：整卡覆盖式的 <a>，保证键盘 / 中键 / 右键复制链接可用
    if (url) {
      var a = document.createElement('a');
      a.className = 'dd-item-link';
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', String(it.title || '打开条目'));
      a.dataset.action = 'open';
      a.dataset.url = url;
      item.appendChild(a);
    }

    var main = text('div', 'dd-item-main');

    // 视频封面
    if (it.kind === 'video') main.appendChild(renderThumb(it));

    var body = text('div', 'dd-item-body');

    // 徽标 + 时间
    var head = text('div', 'dd-item-head');
    var pi = platformInfo(it);
    head.appendChild(text('span', classNames('dd-badge', pi.cls), pi.text));
    var rel = formatRelative(it.publishedAt);
    head.appendChild(text('span', 'dd-item-time', rel));
    body.appendChild(head);

    // 标题（最多 3 行，CSS clamp）
    body.appendChild(text('div', 'dd-item-title', String(it.title || '(无标题)')));

    // 摘要（最多 2 行，可折叠）
    // AI 摘要优先：它是中文一句话，比原文摘要更适合"扫一眼决定要不要点"。
    // 用一个 ✨ 标记把两者区分开 —— 用户有权知道这句是人写的还是模型写的，
    // 尤其在模型可能出错的前提下。
    var aiText = typeof it.aiSummary === 'string' ? it.aiSummary : '';
    var rawText = String(it.summary || '');
    var summaryText = aiText || rawText;
    if (summaryText) {
      var isOpen = !!state.expanded[it.id];
      var sum = text('p', classNames('dd-item-summary', isOpen && 'is-open'), summaryText);
      if (aiText) {
        sum.classList.add('is-ai');
        sum.title = 'AI 生成的一句话摘要';
        sum.insertBefore(text('span', 'dd-ai-mark', '✨'), sum.firstChild);
      }
      body.appendChild(sum);
      // 只有长到可能被截断时才给折叠按钮；用字符数粗判，省一次 layout 查询
      if (summaryText.length > 60) {
        var tog = text('button', 'dd-summary-toggle', isOpen ? '收起' : '展开');
        tog.type = 'button';
        tog.dataset.action = 'toggle-summary';
        body.appendChild(tog);
      }
    }

    // 元信息：作者 / 播放量 / 热度
    var meta = text('div', 'dd-item-meta');
    if (it.author) meta.appendChild(text('span', 'dd-meta-author', String(it.author)));
    if (it.stats && typeof it.stats.views === 'number') {
      var v = formatCount(it.stats.views);
      if (v) meta.appendChild(text('span', 'dd-meta-views', v + ' 播放'));
    }
    if (typeof it.score === 'number' && isFinite(it.score)) {
      meta.appendChild(text('span', 'dd-hot', '▲ ' + Math.round(it.score)));
    }
    // 讨论页：HN 这类源的价值一半在评论区。放在 meta 里而不是标题上，
    // 因为"打开正文"是主操作，"去看讨论"是次操作。
    if (it.discussUrl) {
      var discuss = text('button', 'dd-meta-discuss', '讨论');
      discuss.type = 'button';
      discuss.dataset.action = 'open';
      discuss.dataset.url = it.discussUrl;
      discuss.title = '打开讨论页';
      meta.appendChild(discuss);
    }
    if (meta.childNodes.length) body.appendChild(meta);

    main.appendChild(body);
    item.appendChild(main);

    // 动作排：👍 / 👎 / ✓ / 隐藏
    var actions = text('div', 'dd-item-actions');
    actions.appendChild(actionButton('like', it.liked ? '👍' : '👍', '有意思', it.liked));
    actions.appendChild(actionButton('dislike', '👎', '少推这类', it.disliked));
    actions.appendChild(actionButton('read', '✓', it.read ? '已读' : '已读', it.read));
    actions.appendChild(actionButton('hide', '✕', '隐藏', false));
    item.appendChild(actions);

    return item;
  }

  function actionButton(action, glyph, label, on) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = classNames('dd-act', on && 'is-on');
    b.dataset.action = action;
    b.title = label;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.appendChild(text('span', 'dd-act-icon', glyph));
    b.appendChild(text('span', 'dd-act-label', label));
    return b;
  }

  /**
   * 封面渲染。
   *
   * 结构是"占位块常驻底层 + 图片进入视口才插入并盖在上面"，
   * 这样**完全不需要超时计时器**：请求挂住的源（实测 YouTube 缩略图 i.ytimg.com
   * 100% 不可达，既不 error 也不 load）就只是永远盖不上来，占位块自然还在。
   *
   * 为什么不是"先插图片、失败/超时再换占位块"（上一版就是那样，实测踩了两个坑）：
   *  1. 图片是 lazy 的，屏幕外的卡片浏览器还没开始下载，计时器就已到期 →
   *     **可用封面被永久换成占位块**。实测：16 张视频封面（bilibili 明明 200/image-jpeg
   *     能拿到）在一次渲染后全部变成占位块。
   *  2. 页面处于隐藏态时（侧边栏被切走就是这个状态）Chrome 会**完全推迟** lazy 加载，
   *     计时器必然到期，于是把本来能加载的封面也换掉了。
   * 改"占位块打底"之后，这两个坑都不存在：没有"误杀"这回事，因为占位块本来就该在。
   */

  function renderThumb(it) {
    var wrap = text('div', 'dd-thumb');
    var url = safeUrl(it.thumb);
    if (url) {
      // 底层：占位块。它**永远在**，也永远不需要被移除 —— 图片加载成功会盖住它。
      var fallback = thumbFallback();
      wrap.appendChild(fallback);

      var img = document.createElement('img');
      img.className = 'dd-thumb-img';
      img.alt = '';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      var observer = null;
      var disconnectObserver = function () {
        if (observer) {
          observer.disconnect();
          observer = null;
        }
      };

      img.addEventListener('error', function () {
        // 真失败了就把 img 撤掉（占位块自然露出来），不留破图图标
        disconnectObserver();
        if (img.parentNode) img.parentNode.removeChild(img);
      });

      var insert = function () {
        disconnectObserver();
        if (img.parentNode) return;
        img.src = url;
        // 插在占位块之后、时长徽标之前：DOM 顺序保证图片盖住占位块、
        // 而时长徽标（absolute）仍显示在最上层
        wrap.insertBefore(img, fallback.nextSibling);
      };

      if (typeof window.IntersectionObserver === 'function') {
        // 进入视口才开始下载：既避免一次性拉几十张大图，
        // 也不依赖浏览器对 lazy 的启发式（页面隐藏时它会把加载无限期推迟）
        observer = new window.IntersectionObserver(function (entries) {
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].isIntersecting) {
              insert();
              return;
            }
          }
        });
        observer.observe(wrap);
      } else {
        // 老浏览器：没有观察器就直接加载（退化为"没有懒加载"，不影响正确性）
        insert();
      }
    } else {
      wrap.appendChild(thumbFallback());
    }
    if (it.duration) wrap.appendChild(text('span', 'dd-thumb-duration', String(it.duration)));
    return wrap;
  }

  function thumbFallback() {
    var box = text('div', 'dd-thumb-fallback');
    box.innerHTML = PLAY_ICON_SVG;   // 常量 SVG，无外部数据
    return box;
  }

  /* ---------- 4.5 提示条 / 偏好 / 页脚 / 弹层 ---------- */

  function renderNote() {
    var n = state.tuneNote;
    if (!n) { el.note.hidden = true; return; }
    el.note.hidden = false;
    el.note.classList.toggle('dd-note-error', !!n.isError);
    el.noteTitle.textContent = n.title;
    clear(el.noteList);
    for (var i = 0; i < n.lines.length && i < NOTES_PREVIEW_MAX; i++) {
      el.noteList.appendChild(text('li', '', n.lines[i]));
    }
  }

  function renderError() {
    var msg = state.stateError || state.itemsError || state.demoNotice;
    if (!msg) { el.error.hidden = true; return; }
    el.error.hidden = false;
    var isDemo = !!state.demo && !state.stateError && !state.itemsError;
    el.errorTitle.textContent = isDemo ? '已进入演示模式' : '加载失败';
    el.errorMsg.textContent = msg;
    // 即使进了演示态也保留重试：宿主路由恢复后用户能一键切回真实数据
    el.errorRetry.hidden = false;
  }

  function renderPrefs() {
    var p = state.prefs;
    if (!p) { el.prefs.hidden = true; return; }
    el.prefs.hidden = false;
    clear(el.prefsBody);

    var topics = Array.isArray(p.topics) ? p.topics : [];
    if (topics.length) {
      el.prefsBody.appendChild(prefsRow('主题', tags(topics, '')));
    }
    var kws = Array.isArray(p.keywords) ? p.keywords : [];
    if (kws.length) {
      var kwText = kws.map(function (k) {
        if (typeof k === 'string') return k;
        if (!k) return '';
        var w = (typeof k.weight === 'number' && k.weight !== 1) ? '(' + trimZero(k.weight) + ')' : '';
        return String(k.word || '') + w;
      }).filter(Boolean);
      el.prefsBody.appendChild(prefsRow('关键词', tags(kwText, '')));
    }
    var blocked = Array.isArray(p.blocked) ? p.blocked : [];
    if (blocked.length) {
      el.prefsBody.appendChild(prefsRow('屏蔽', tags(blocked, 'dd-tag-blocked')));
    }
    if (typeof p.dailyQuota === 'number') {
      el.prefsBody.appendChild(prefsRow('每日配额', text('span', '', p.dailyQuota + ' 条')));
    }
    var notes = Array.isArray(p.tuningNotes) ? p.tuningNotes : [];
    if (notes.length) {
      var ul = document.createElement('ul');
      ul.className = 'dd-prefs-notes';
      for (var i = 0; i < notes.length; i++) ul.appendChild(text('li', '', String(notes[i])));
      el.prefsBody.appendChild(ul);
    }
    if (!el.prefsBody.childNodes.length) {
      el.prefsBody.appendChild(text('div', 'dd-prefs-row', '尚未设置偏好，可以在上面输入框里调教。'));
    }
  }

  function prefsRow(label, valueNode) {
    var row = text('div', 'dd-prefs-row');
    row.appendChild(text('span', 'dd-prefs-label', label));
    var v = text('span', 'dd-prefs-value');
    v.appendChild(valueNode);
    row.appendChild(v);
    return row;
  }

  function tags(list, cls) {
    var box = text('span', 'dd-prefs-tags');
    for (var i = 0; i < list.length; i++) box.appendChild(text('span', classNames('dd-tag', cls), String(list[i])));
    return box;
  }

  function renderFooter() {
    clear(el.footer);
    if (state.generatedAt) {
      el.footer.appendChild(text('span', '', '数据生成于 ' + formatDateTime(state.generatedAt)));
    }
    var lr = state.lastRefresh;
    if (lr && lr.at) {
      el.footer.appendChild(text('span', '', '上次刷新 ' + formatRelative(lr.at) +
        (typeof lr.durationMs === 'number' ? '（' + (lr.durationMs / 1000).toFixed(1) + 's）' : '')));
    }
    var bad = sourceHealth().bad;
    if (bad.length) {
      var title = bad.map(function (s) { return (s.name || s.id) + ': ' + (s.error || '失败'); }).join('\n');
      var warn = text('span', 'dd-src-bad', bad.length + ' 个源异常');
      warn.title = title;
      el.footer.appendChild(warn);
    }
    if (state.demo) el.footer.appendChild(text('span', '', '演示数据'));

    // 入口放在页脚而不是标题栏：标题栏在 280px 下已经挤了 3 个图标按钮，
    // 再加两个就必然溢出；而页脚是"次级操作"的自然位置。
    if (!state.demo) {
      el.footer.appendChild(
        footerLink(
          state.feedsCount > 0 ? '订阅管理（' + state.feedsCount + '）' : '订阅管理',
          '导入 / 导出 OPML、移除自定义源',
          openFeedsModal
        )
      );
      el.footer.appendChild(footerLink('本周回顾', '汇总最近 7 天：最值得看 / 主题分布 / 每天条数 / 源健康', openWeeklyModal));
    }
  }

  function footerLink(label, title, handler) {
    var b = text('button', 'dd-footer-link', label);
    b.type = 'button';
    if (title) b.title = title;
    b.addEventListener('click', handler);
    return b;
  }

  function render() {
    renderHeader();
    renderFilters();
    renderList();
    renderNote();
    renderError();
    renderPrefs();
    renderFooter();
    renderProgress();
    syncSearchInputs();
  }

  /* ---------- 4.6 刷新中的绝对定位指示（不推版） ---------- */

  function renderProgress() {
    // 两种"耗时操作"共用同一条绝对定位进度条与胶囊：刷新、生成 AI 摘要。
    // 复用而不是各画一套 —— 用户不需要知道这俩在实现上有什么区别，
    // 他只需要知道"现在有东西在跑、大概跑了多久"。
    var on = state.refreshBusy || state.aiBusy;
    el.progress.classList.toggle('is-on', on);
    el.progress.setAttribute('aria-hidden', on ? 'false' : 'true');
    el.capsule.hidden = !on;
    if (on) el.capsuleText.textContent = capsuleMessage();
  }

  function capsuleMessage() {
    var extra = el.capsuleExtra || '';
    if (state.aiBusy) return '正在生成 AI 摘要' + extra;
    return '正在刷新订阅源 · 当前数据生成于 ' + (formatClock(state.generatedAt) || '—') + extra;
  }

  function syncSearchInputs() {
    // 只在值不同时写，避免打断用户输入（含中文输入法组合态）
    if (el.search.value !== state.query) el.search.value = state.query;
    el.searchClear.hidden = !state.query;
    el.searchWrap.classList.toggle('is-syncing', !!state.querySyncing);
    if (el.unreadOnly.checked !== state.unreadOnly) el.unreadOnly.checked = state.unreadOnly;
  }

  /* ======================================================================
   * 5. events
   * ==================================================================== */

  /* ---------- 4.6 项目（一个项目 = 一个工作目录） ---------- */

  /**
   * 项目切换器。
   *
   * 为什么它在这个插件里是一等公民：调研是**定向**的 —— 「这个项目缺的那块知识在哪」。
   * 同一台机器上给 A 项目调的「多推 Rust」绝不能污染 B 项目，所以偏好/索引/反馈都按目录隔离。
   */
  function loadProjects() {
    return apiGet(API.projects).then(function (r) {
      if (r.error || !r.data || !Array.isArray(r.data.projects)) return;
      state.projects = r.data.projects;
      renderProjectBar();
    });
  }

  /**
   * 项目状态：**只读**。
   * 项目跟着当前会话/工作区自动走，这里只说清"用的是哪个、怎么定的"。
   * 拿不到项目（识别失败）时**明说**，而不是假装在用某个项目 —— 否则用户会以为
   * "它在按我的项目搜"，其实搜的是默认数据。
   */
  function renderProjectBar() {
    if (!el.projectbar) return;
    var p = state.project;
    if (!p) {
      el.projectbar.hidden = true;
      return;
    }
    el.projectbar.hidden = false;
    var isAuto = p.source !== 'manual';
    var unresolved = !!(p.isDefault && isAuto);

    el.projectName.textContent = p.name + (p.isDefault ? '' : ' · ' + String(p.dir).split('/').slice(-2).join('/'));
    el.projectSource.textContent = unresolved ? '未识别到项目' : isAuto ? '自动识别' : '手动指定';
    el.projectSource.classList.toggle('is-warn', unresolved);

    el.projectbar.classList.toggle('is-scoped', !p.isDefault);
    el.projectbar.classList.toggle('is-unresolved', unresolved);
    el.projectbar.title =
      '当前项目：' + p.dir +
      '\n来源：' + (isAuto ? '自动识别（跟随当前会话 / 工作区）' : '手动指定') +
      (unresolved ? '\n未能自动识别项目，正在用默认数据 —— 在项目目录里开一个会话即可跟随' : '') +
      '\n数据目录：' + p.dataDir;
  }

  /** 切换项目：数据全换（偏好/索引/反馈都跟着走），所以要整页重载而不是只改一行。 */

  /* ---------- 4.7 按天翻阅（归档） ---------- */

  /**
   * 归档导航。
   *
   * 为什么值得单独做：`daily_search` 能按关键词找，"按天翻"是另一条检索路径 ——
   * 而且更符合人的回忆方式（"我记得是周二前后看到的"）。
   * 同时它让"哪天断采了"变得可见：某天条数骤降一眼就能看出来。
   */
  function loadArchive() {
    return apiGet(API.archive, { limit: 60 }).then(function (r) {
      if (r.error || !r.data || !Array.isArray(r.data.days)) return;
      state.archive = r.data.days;
      renderDateBar();
    });
  }

  function archiveIndex(date) {
    for (var i = 0; i < state.archive.length; i++) {
      if (state.archive[i].date === date) return i;
    }
    return -1;
  }

  function renderDateBar() {
    if (!el.datebar) return;
    // 只有一天数据时不显示（别给刚装上的用户添噪音）
    var meaningful = state.archive.length > 1;
    el.datebar.hidden = !meaningful;
    if (!meaningful) return;

    var index = archiveIndex(state.date);
    var older = index >= 0 ? state.archive[index + 1] : null;
    var newer = index >= 0 ? state.archive[index - 1] : null;
    el.datePrev.disabled = !older;
    el.dateNext.disabled = !newer;
    el.dateCurrent.textContent = state.date;
    var isToday = !state.today || state.date === state.today;
    el.dateToday.hidden = isToday;
    el.datebar.classList.toggle('is-history', !isToday);

    var day = index >= 0 ? state.archive[index] : null;
    el.dateCurrent.title = day
      ? day.date + ' · ' + day.total + ' 条 · ' + day.unread + ' 未读' + (day.digest ? ' · 有日报' : '')
      : state.date;
  }

  function selectDate(date) {
    if (!date || date === state.date) return;
    state.date = date;
    state.datePinned = !state.today || date !== state.today;
    // 换天等于换数据集：清掉只对旧数据有效的筛选与展开态，避免"筛选残留导致列表空空"
    state.topic = '全部';
    state.unreadOnly = false;
    state.expanded = {};
    state.hiddenIds = {};
    state.queryServerHits = null;
    syncSearchInputs();
    renderDateBar();
    loadItems();
    render();
  }

  function stepDate(delta) {
    var index = archiveIndex(state.date);
    if (index < 0) return;
    var target = state.archive[index + delta];
    if (target) selectDate(target.date);
  }

  /* ---------- 5.1 数据载入 ---------- */

  function loadState() {
    state.loading = true;
    return apiGet(API.state).then(function (r) {
      if (r.error || !r.data) {
        enterDemo(r.error || '接口没有返回数据');
        return;
      }
      applyStatePayload(r.data);
      state.stateError = null;
      state.demoNotice = '';
      state.loading = false;
      render();
      return loadItems();
    });
  }

  function applyStatePayload(s) {
    state.demo = false;
    // 服务端的"今天"始终采纳；但**用户手动翻到某一天后不能再被拽回来** ——
    // 状态轮询在点赞/调教后都会发生，否则用户看昨天的列表时点个 👍 就被弹回今天。
    if (s.date) {
      state.today = String(s.date);
      if (!state.datePinned) state.date = String(s.date);
    }
    state.generatedAt = s.generatedAt || null;
    state.lastRefresh = s.lastRefresh || null;
    state.refreshing = !!s.refreshing;
    // AI 摘要入口只在配置里打开时出现（默认关闭 —— 它会真的调模型、花 token）
    state.ai = s.ai || { enabled: false, last: null };
    if (el.aiBtn) el.aiBtn.hidden = !state.ai.enabled;
    state.feedsCount = typeof s.feeds === 'number' ? s.feeds : 0;
    if (s.project && typeof s.project === 'object') state.project = s.project;
    renderProjectBar();
    state.counts = s.counts || { total: 0, unread: 0, byTopic: {} };
    state.sources = Array.isArray(s.sources) ? s.sources : [];
    state.prefs = s.prefs || null;
    state.digest = s.digest || { available: false };
    document.title = '日报 · ' + state.date;
  }

  function enterDemo(reason) {
    var mock = mockPayload();
    state.demo = true;
    /**
     * 兜底提示要按**真实原因**分流。
     *
     * 原来的文案不区分情况，一律说"把页面放在 /dsh-daily/ 下由宿主路由打开" ——
     * 可当页面**已经**在 /dsh-daily/ 下、只是接口 503 时，这句话等于让用户去做一件
     * 他已经做过的事，方向完全跑偏（实测：注入 /api/state 故障后就是这个表现）。
     */
    var servedByHost = /^\/[^/]*dsh-daily\//.test(window.location.pathname) || window.location.pathname.indexOf('/dsh-daily') === 0;
    state.demoNotice = servedByHost
      ? '真实接口不可用（' + reason + '），当前展示内置演示数据。' +
        '点「重试」再试一次；若一直失败，说明插件没能正常提供服务。'
      : '真实接口不可用（' + reason + '），当前展示内置演示数据。' +
        '当前不是由宿主路由打开的，把页面放在 /dsh-daily/ 下即可看到真实内容。';
    state.loading = false;
    state.itemsError = null;
    state.stateError = null;
    state.hiddenIds = {};
    applyStatePayload(mock.state);
    state.demo = true;                       // applyStatePayload 会清掉，这里恢复
    state.items = mock.items.slice();
    state.date = mock.state.date;
    state.lastRefresh = mock.state.lastRefresh;
    state.generatedAt = mock.state.generatedAt;
    document.title = '日报 · 演示模式';
    render();
  }

  var itemsAbort = null;

  function loadItems(withQuery) {
    if (state.demo) { render(); return Promise.resolve(); }
    if (itemsAbort) itemsAbort.abort();      // 丢弃上一次未完成的请求
    itemsAbort = new AbortController();

    // 带 q 时同时把关键词交给后端（契约要求）。后端结果只作"权威命中提示"，
    // **绝不替换本地全量数据集** —— 否则用户清空搜索后会只剩空列表。
    var applyResult;
    if (withQuery && state.query) {
      state.querySyncing = true;
      applyResult = function (r) { state.querySyncing = false; state.queryServerHits = r; };
    } else {
      // 默认全量拉取，之后全部本地筛选（即时）
      state.itemsLoading = true;
      state.itemsError = null;
      render();
      applyResult = function (r) { commitItems(r); };
    }

    var url = API.items + '?date=' + encodeURIComponent(state.date) + '&limit=' + ITEM_LIMIT;
    if (withQuery && state.query) url += '&q=' + encodeURIComponent(state.query);

    return fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: itemsAbort.signal
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
      return res.json();
    }).then(function (data) {
      if (!data || data.ok === false || !Array.isArray(data.items)) {
        throw new Error('返回结构异常（缺少 items 数组）');
      }
      applyResult(data);
      render();
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;   // 被新请求取代，静默
      state.querySyncing = false;
      if (withQuery && state.query) return;           // 本地过滤已生效，补拉失败不影响可用性
      state.itemsLoading = false;
      state.loading = false;
      state.itemsError = describeFetchError(err);
      render();
    });
  }

  /** 全量拉取成功：替换本地数据集 */
  function commitItems(data) {
    state.items = data.items.map(normalizeItem);
    state.queryServerHits = null;
    if (typeof data.total === 'number') {
      state.counts.total = Math.max(state.counts.total || 0, data.total);
    }
    state.itemsLoading = false;
    state.itemsError = null;
    state.loading = false;
    state.hiddenIds = {};                  // 新数据集，清掉本地隐藏
    dropStaleTopicFilter();
  }

  function normalizeItem(raw) {
    if (!raw || typeof raw !== 'object') return { id: String(Math.random()), title: '(异常条目)' };
    return {
      id: String(raw.id || raw.url || Math.random()),
      title: raw.title,
      url: raw.url,
      kind: raw.kind === 'video' ? 'video' : 'web',
      platform: raw.platform,
      sourceId: raw.sourceId,
      sourceName: raw.sourceName,
      topic: raw.topic || '未分类',
      summary: raw.summary,
      // 页面用的是"字段白名单"映射：后端加了字段而这里忘了加，数据就会在
      // 这一层被静默丢掉（AI 摘要第一次就是这么丢的 —— 后端返回了、页面上什么都没有）。
      // 新增条目字段时**必须**同步这里。
      aiSummary: typeof raw.aiSummary === 'string' ? raw.aiSummary : undefined,
      // 讨论页（Hacker News 的 item 页）。这张白名单是靠
      // test/client-contract.test.js 守住的 —— 它静态核对"后端会返回的字段都在这里"，
      // 而这条断言刚写出来就抓到了 discussUrl 被漏掉（后端一直在返回、页面上从来没显示过）。
      discussUrl: typeof raw.discussUrl === 'string' ? raw.discussUrl : undefined,
      publishedAt: raw.publishedAt,
      author: raw.author,
      thumb: raw.thumb,
      duration: raw.duration,
      stats: raw.stats && typeof raw.stats === 'object' ? raw.stats : null,
      score: typeof raw.score === 'number' ? raw.score : null,
      reasons: Array.isArray(raw.reasons) ? raw.reasons : [],
      read: !!raw.read,
      liked: !!raw.liked,
      disliked: !!raw.disliked,
      hidden: !!raw.hidden
    };
  }

  function dropStaleTopicFilter() {
    if (state.topic === '全部') return;
    var list = topicCounts().list;
    for (var i = 0; i < list.length; i++) {
      if (list[i].topic === state.topic) return;
    }
    state.topic = '全部';
  }

  /* ---------- 5.2 反馈（乐观更新 + 失败回滚） ---------- */

  function findItem(id) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) return state.items[i];
    }
    return null;
  }

  function toggleFeedback(id, action) {
    var it = findItem(id);
    if (!it) return;

    var patch = {};
    if (action === 'read') {
      patch.read = !it.read;
    } else if (action === 'like') {
      patch.liked = !it.liked;
      if (patch.liked) patch.disliked = false;
    } else if (action === 'dislike') {
      patch.disliked = !it.disliked;
      if (patch.disliked) patch.liked = false;
    } else if (action === 'hide') {
      patch.hidden = true;
    } else {
      return;
    }

    var before = {};
    for (var k in patch) { if (Object.prototype.hasOwnProperty.call(patch, k)) before[k] = it[k]; }

    applyPatch(it, patch);
    render();

    // 演示态：不发请求，只保留本地视觉状态
    if (state.demo) {
      if (action === 'hide') removeFromView(id);
      return;
    }

    apiPost(API.feedback, { id: id, action: action }).then(function (r) {
      if (!r.error) {
        if (action === 'hide') removeFromView(id);
        return;
      }
      // 失败回滚
      applyPatch(it, before);
      render();
      showTuneNote('反馈提交失败', [r.error], true);
    });
  }

  function applyPatch(it, patch) {
    for (var k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) it[k] = patch[k];
    }
  }

  function removeFromView(id) {
    state.hiddenIds[id] = true;
    var node = el.list.querySelector('.dd-item[data-id="' + cssEscape(id) + '"]');
    if (node) {
      node.classList.add('is-hidden-item');
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    renderHeader();
    renderFilters();
  }

  /** 属性选择器里的 id 需要转义（id 来自后端，可能是任意字符串） */
  function cssEscape(v) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(v);
    return String(v).replace(/["\\\]]/g, '\\$&');
  }

  /* ---------- 5.3 调教 ---------- */

  function submitTune() {
    var raw = el.tuneInput.value;
    var text = raw.trim();
    if (!text || state.tuneBusy) return;

    state.tuneBusy = true;
    el.tuneSubmit.disabled = true;
    el.tuneSubmit.textContent = '…';

    if (state.demo) {
      // 演示态：本地假装解析一下，让交互可见
      window.setTimeout(function () {
        state.tuneBusy = false;
        el.tuneSubmit.disabled = false;
        el.tuneSubmit.textContent = '调教';
        showTuneNote('已应用（演示）', ['演示模式不会写入偏好：' + text]);
        el.tuneInput.value = '';
      }, 260);
      return;
    }

    apiPost(API.tune, { text: text }).then(function (r) {
      state.tuneBusy = false;
      el.tuneSubmit.disabled = false;
      el.tuneSubmit.textContent = '调教';

      if (r.error) {
        showTuneNote('调教失败', [r.error]);
        return;
      }
      var applied = Array.isArray(r.data.applied) ? r.data.applied : [];
      showTuneNote('已应用到偏好', applied.length ? applied : ['已记录，下次刷新生效']);
      if (r.data.prefs) {
        state.prefs = r.data.prefs;
        renderPrefs();
      }
      el.tuneInput.value = '';
      // 偏好变了，排序会变；重新拉一次列表
      loadItems();
    });
  }

  function showTuneNote(title, lines, isError) {
    state.tuneNote = { title: title, lines: lines, isError: !!isError };
    renderNote();
  }

  /* ---------- 5.4 刷新订阅源 ---------- */

  var capsuleTimer = null;
  var capsuleStartedAt = 0;

  function startRefresh() {
    if (state.refreshBusy || state.demo) return;
    // 刷新只对"今天"有意义：抓取总会写进当天。
    // 按钮在历史态下是 disabled（点不动的），所以正常情况下走不到这里；
    // 这段是**兜底**：万一将来有别的入口（快捷键/命令）调用它，也不能静默什么都不做。
    if (state.today && state.date !== state.today) {
      showTuneNote('只能刷新今天', [
        '当前正在查看 ' + state.date + ' 的历史数据。',
        '点日期条上的「回到今天」再刷新。',
      ]);
      return;
    }

    state.refreshBusy = true;
    el.capsuleExtra = '';
    capsuleStartedAt = Date.now();
    render();

    if (capsuleTimer) window.clearInterval(capsuleTimer);
    capsuleTimer = window.setInterval(function () {
      if (!state.refreshBusy) return;
      var secs = Math.round((Date.now() - capsuleStartedAt) / 1000);
      el.capsuleExtra = ' · 已用时 ' + secs + 's';
      el.capsuleText.textContent = capsuleMessage();
    }, CAPSULE_TICK_MS);

    apiPost(API.refresh, {}).then(function (r) {
      stopRefreshTimer();

      if (r.error) {
        state.refreshBusy = false;
        state.stateError = '刷新失败：' + r.error;
        render();
        return;
      }
      var sum = r.data.summary || {};
      var msg = '刷新完成';
      if (typeof sum.total === 'number') msg += ' · 共 ' + sum.total + ' 条';
      if (typeof sum.new === 'number') msg += ' · 新增 ' + sum.new;
      if (typeof sum.durationMs === 'number') msg += ' · ' + (sum.durationMs / 1000).toFixed(1) + 's';
      if (typeof sum.failedSources === 'number' && sum.failedSources > 0) {
        msg += ' · ' + sum.failedSources + ' 个源失败';
      }
      showTuneNote('刷新完成', [msg]);
      state.stateError = null;
      state.refreshBusy = false;
      // 平滑落地：重新拉 state + items
      return loadState();
    });
  }

  function stopRefreshTimer() {
    if (capsuleTimer) {
      window.clearInterval(capsuleTimer);
      capsuleTimer = null;
    }
  }

  /**
   * 对**已抓到的**条目补 AI 摘要（不重新抓取）。
   *
   * 存在的意义：用户很可能先用几天、觉得不错再去打开 AI 摘要 ——
   * 那时当天数据已经在了，让他等第二天才看到摘要不合理。
   */
  function startAiSummaries() {
    if (state.aiBusy || state.refreshBusy || state.demo) return;

    state.aiBusy = true;
    el.capsuleExtra = '';
    capsuleStartedAt = Date.now();
    render();

    if (capsuleTimer) window.clearInterval(capsuleTimer);
    capsuleTimer = window.setInterval(function () {
      if (!state.aiBusy) return;
      var secs = Math.round((Date.now() - capsuleStartedAt) / 1000);
      el.capsuleExtra = ' · 已用时 ' + secs + 's';
      el.capsuleText.textContent = capsuleMessage();
    }, CAPSULE_TICK_MS);

    apiPost(API.ai, { date: state.date }).then(function (r) {
      stopRefreshTimer();
      state.aiBusy = false;

      if (r.error) {
        state.stateError = 'AI 摘要失败：' + r.error;
        render();
        return;
      }
      var st = (r.data && r.data.stats) || {};
      var lines = [
        '新生成 ' + (st.generated || 0) + ' 条 · 缓存命中 ' + (st.fromCache || 0) + ' 条 · 失败 ' + (st.failed || 0) + ' 条',
      ];
      if (st.model) lines.push('模型：' + st.model);
      if (st.reasons && st.reasons.length) lines.push('失败原因：' + st.reasons.join('；'));
      showTuneNote('AI 摘要', lines);
      state.stateError = null;
      if (state.ai) state.ai.last = st;
      loadItems();
    });
  }

  /* ---------- 5.5 日报预览 ---------- */

  var lastFocused = null;

  function openDigest() {
    if (state.digestBusy) return;
    lastFocused = document.activeElement;

    // 演示态：直接给一份示例 Markdown，便于检查渲染
    if (state.demo) {
      showDigest('# 今日日报（演示）\n\n- 演示数据，共 ' + state.items.length + ' 条\n- 真实接口可用时会显示后端生成的 Markdown\n',
        '（演示模式，无真实文件路径）');
      return;
    }
    // 这里**不再**用全局的 state.digest.available 提前 return：
    // 它描述的是"最近一次日报"，而用户可能正在看某一天的历史 ——
    // 那个判断会让"看历史日报"这件正确的事被错误地挡住。按日期问后端才是对的。
    state.digestBusy = true;
    el.digestBtn.disabled = true;
    apiGet(API.digest, { date: state.date }).then(function (r) {
      state.digestBusy = false;
      el.digestBtn.disabled = false;
      if (r.error) {
        state.stateError = '日报预览失败：' + r.error;
        renderError();
        return;
      }
      // 这一天没有日报是正常状态（比如刚装、或那天没开机），
      // 该在弹层里说清楚，而不是让页面报错、按钮看起来像坏了。
      if (!r.data.markdown) {
        showDigest(
          '',
          '',
          state.date + ' 还没有日报。日报在每次采集完成后自动生成；也可以点右上角刷新抓一轮。'
        );
        return;
      }
      showDigest(r.data.markdown, r.data.path || (state.digest && state.digest.path) || '');
    });
  }

  function showDigest(markdown, path, message) {
    el.modalPath.textContent = path || '';
    clear(el.modalBody);
    if (message) {
      el.modalBody.appendChild(text('p', 'dd-md-p', message));
    } else {
      el.modalBody.appendChild(renderMarkdown(String(markdown || '')));
    }
    el.modal.hidden = false;
    el.modalClose.focus();
  }

  function closeDigest() {
    el.modal.hidden = true;
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  /* ---------- 5.5.1 通用弹层 ---------- */

  /**
   * 通用弹层。
   *
   * 之前只有"日报预览"这一个弹层，于是"订阅管理 / 周报"这类需要交互的界面
   * 就只剩工具与 HTTP 入口 —— 用户要么对模型说、要么用 curl，这是当时最明显的可用性缺口。
   * 抽出一个通用壳之后，这些界面都能在侧边栏里就地完成。
   */
  function openModal(title, pathText, buildBody) {
    el.modalTitle.textContent = title;
    el.modalPath.textContent = pathText || '';
    clear(el.modalBody);
    buildBody(el.modalBody);
    el.modal.hidden = false;
    el.modalClose.focus();
  }

  /* ---------- 5.5.2 订阅管理 ---------- */

  function openFeedsModal() {
    openModal('订阅管理', '', function (body) {
      body.appendChild(
        text('p', 'dd-md-p',
          '这里只管**运行期追加**的源（OPML 导入进来的）。内置源（Hacker News / arXiv / GitHub / YouTube / 哔哩哔哩 / 少数派 / IT之家 / Solidot / 阮一峰）由插件本身提供，不在此列。')
      );

      var status = text('p', 'dd-md-note', '');
      var list = text('div', 'dd-feeds-list');

      var actions = text('div', 'dd-feeds-actions');
      var file = document.createElement('input');
      file.type = 'file';
      file.accept = '.opml,.xml,application/xml,text/xml';
      file.className = 'dd-file';
      file.setAttribute('aria-label', '选择 OPML 文件导入');
      file.addEventListener('change', function () {
        var chosen = file.files && file.files[0];
        if (!chosen) return;
        status.textContent = '正在读取 ' + chosen.name + '…';
        var reader = new FileReader();
        reader.onerror = function () { status.textContent = '文件读取失败'; };
        reader.onload = function () {
          status.textContent = '正在导入…';
          apiPost(API.opml, { xml: String(reader.result || '') }).then(function (r) {
            if (r.error) { status.textContent = '导入失败：' + r.error; return; }
            var d = r.data || {};
            status.textContent =
              '导入完成：解析 ' + (d.parsed || 0) + ' 条 · 新增 ' + (d.added || 0) +
              ' 条 · 重复 ' + (d.duplicated || 0) + ' 条 · 跳过 ' + (d.skipped || 0) + ' 条。下一次刷新即生效。';
            loadFeeds(list, status);
            loadState();
          });
        };
        reader.readAsText(chosen);
      });
      actions.appendChild(file);

      var copyBtn = text('button', 'dd-btn', '复制 OPML');
      copyBtn.type = 'button';
      copyBtn.addEventListener('click', function () {
        apiGet(API.opml).then(function (r) {
          if (r.error) { status.textContent = '导出失败：' + r.error; return; }
          var xml = r.data.xml || '';
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(xml).then(
              function () { status.textContent = '已复制 ' + (r.data.count || 0) + ' 个订阅源到剪贴板。'; },
              function () { status.textContent = '剪贴板不可用（可能不是安全上下文），请改用「下载 OPML」。'; }
            );
          } else {
            status.textContent = '剪贴板不可用，请改用「下载 OPML」。';
          }
        });
      });
      actions.appendChild(copyBtn);

      var dlBtn = text('button', 'dd-btn', '下载 OPML');
      dlBtn.type = 'button';
      dlBtn.addEventListener('click', function () {
        apiGet(API.opml).then(function (r) {
          if (r.error) { status.textContent = '导出失败：' + r.error; return; }
          try {
            var blob = new Blob([r.data.xml || ''], { type: 'text/xml' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'dsh-daily-feeds.opml';
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
            status.textContent = '已导出 ' + (r.data.count || 0) + ' 个订阅源（含内置源）。';
          } catch (e) {
            status.textContent = '下载失败：' + (e && e.message ? e.message : String(e));
          }
        });
      });
      actions.appendChild(dlBtn);

      body.appendChild(actions);
      body.appendChild(status);
      body.appendChild(list);
      loadFeeds(list, status);
    });
  }

  /** 拉取自定义源清单并渲染（带"移除"）。 */
  function loadFeeds(list, status) {
    clear(list);
    list.appendChild(text('p', 'dd-md-p', '载入中…'));
    apiGet(API.feeds).then(function (r) {
      clear(list);
      if (r.error) {
        list.appendChild(text('p', 'dd-md-p', '读取失败：' + r.error));
        return;
      }
      var feeds = (r.data && r.data.feeds) || [];
      if (feeds.length === 0) {
        list.appendChild(
          text('p', 'dd-md-p', '还没有自定义源。用上面的文件选择导入一份 OPML 就行 —— 从别的阅读器导出即可。')
        );
        return;
      }
      list.appendChild(text('p', 'dd-md-p', '共 ' + feeds.length + ' 个自定义源：'));
      feeds.forEach(function (feed) {
        var row = text('div', 'dd-feed-row');
        var info = text('div', 'dd-feed-info');
        info.appendChild(text('div', 'dd-feed-name', feed.name || feed.url));
        info.appendChild(text('div', 'dd-feed-url', feed.url));
        if (feed.topic) info.appendChild(text('span', 'dd-feed-topic', feed.topic));
        row.appendChild(info);
        var rm = text('button', 'dd-feed-remove', '移除');
        rm.type = 'button';
        rm.title = '移除后不再抓取；已有的历史条目不受影响';
        rm.addEventListener('click', function () {
          rm.disabled = true;
          apiPost(API.feeds, { action: 'remove', url: feed.url }).then(function (res) {
            if (res.error) {
              rm.disabled = false;
              if (status) status.textContent = '移除失败：' + res.error;
              return;
            }
            if (status) status.textContent = '已移除「' + (feed.name || feed.url) + '」。';
            loadFeeds(list, status);
            loadState();
          });
        });
        row.appendChild(rm);
        list.appendChild(row);
      });
    });
  }

  /* ---------- 5.5.3 本周回顾 ---------- */

  function openWeeklyModal() {
    openModal('本周回顾', '正在汇总最近 7 天…', function (body) {
      body.appendChild(text('p', 'dd-md-p', '正在汇总最近 7 天…'));
    });
    apiGet(API.weekly).then(function (r) {
      // 用户可能在等待期间关掉了弹层；那就不要再往里写
      if (el.modal.hidden) return;
      clear(el.modalBody);
      if (r.error) {
        el.modalBody.appendChild(text('p', 'dd-md-p', '周报生成失败：' + r.error));
        return;
      }
      el.modalPath.textContent = 'digest/' + (r.data.name || '');
      el.modalBody.appendChild(renderMarkdown(String(r.data.markdown || '')));
    });
  }

  /**
   * 极简 Markdown → DOM（只支持日报用到的子集：标题/无序列表/引用/代码/粗体/分隔线）。
   * 全程 createElement + textContent，从不拼 HTML 字符串。
   */
  function renderMarkdown(md) {
    var pre = text('pre', 'dd-md-body-pre');
    if (!md) {
      pre.textContent = '（空）';
      return pre;
    }
    var frag = document.createDocumentFragment();
    var lines = md.split(/\r?\n/);
    var i = 0;
    var sawBlock = false;

    while (i < lines.length) {
      var line = lines[i];

      // 围栏代码块原样保留
      if (/^\s*```/.test(line)) {
        i++;
        var buf = [];
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        var code = text('pre', 'dd-md-code-block');
        code.textContent = buf.join('\n');
        frag.appendChild(code);
        sawBlock = true;
        continue;
      }
      if (/^\s*$/.test(line)) { i++; continue; }

      var m;
      if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
        var lvl = m[1].length;
        var h = document.createElement(lvl === 1 ? 'h2' : (lvl === 2 ? 'h3' : 'h4'));
        h.className = 'dd-md-h' + lvl;
        appendInline(h, m[2]);
        frag.appendChild(h);
        sawBlock = true;
        i++;
        continue;
      }
      if (/^\s*([-*+])\s+/.test(line)) {
        while (i < lines.length) {
          var lm = /^\s*([-*+])\s+(.*)$/.exec(lines[i]);
          if (!lm) break;
          var li = text('div', 'dd-md-li');
          appendInline(li, lm[2]);
          frag.appendChild(li);
          sawBlock = true;
          i++;
        }
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        while (i < lines.length) {
          var om = /^\s*\d+\.\s+(.*)$/.exec(lines[i]);
          if (!om) break;
          var oli = text('div', 'dd-md-li dd-md-oli');
          appendInline(oli, om[1]);
          frag.appendChild(oli);
          sawBlock = true;
          i++;
        }
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        var q = text('div', 'dd-md-quote');
        appendInline(q, line.replace(/^\s*>\s?/, ''));
        frag.appendChild(q);
        sawBlock = true;
        i++;
        continue;
      }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
        var hr = document.createElement('hr');
        hr.className = 'dd-md-hr';
        frag.appendChild(hr);
        sawBlock = true;
        i++;
        continue;
      }

      var p = text('p', 'dd-md-p');
      appendInline(p, line);
      frag.appendChild(p);
      sawBlock = true;
      i++;
    }

    if (!sawBlock) frag.appendChild(pre);
    return frag;
  }

  /** 行内：**粗体** / `代码` / [文本](链接) —— 一律用 textContent */
  function appendInline(parent, src) {
    var text2 = String(src);
    var re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
    var last = 0;
    var m;
    while ((m = re.exec(text2)) !== null) {
      if (m.index > last) parent.appendChild(document.createTextNode(text2.slice(last, m.index)));
      if (m[2] !== undefined) {
        parent.appendChild(text('strong', '', m[2]));
      } else if (m[4] !== undefined) {
        parent.appendChild(text('code', 'dd-md-code', m[4]));
      } else if (m[6] !== undefined) {
        var a = document.createElement('a');
        a.className = 'dd-md-a';
        a.href = m[7];
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = m[6];
        a.dataset.action = 'open';
        a.dataset.url = m[7];
        parent.appendChild(a);
      }
      last = re.lastIndex;
    }
    if (last < text2.length) parent.appendChild(document.createTextNode(text2.slice(last)));
  }

  /* ---------- 5.6 主题热切换 ---------- */

  function applyTheme(theme) {
    if (theme !== 'dark' && theme !== 'light') return;
    if (document.documentElement.getAttribute('data-theme') === theme) return;
    document.documentElement.setAttribute('data-theme', theme);
  }

  function onMessage(ev) {
    var d = ev && ev.data;
    if (!d) return;
    if (typeof d === 'string') {
      // 兼容纯字符串形式的主题消息
      if (d === 'dark' || d === 'light') applyTheme(d);
      return;
    }
    if (d.type === 'dsh-daily-theme' || d.type === 'dsh-theme') {
      applyTheme(d.theme || d.value);
    }
  }

  /* ---------- 5.7 绑定 ---------- */

  function cacheEls() {
    el.date = $('dd-date');
    el.stats = $('dd-stats');
    el.refreshBtn = $('dd-refresh');
    el.digestBtn = $('dd-digest');
    el.aiBtn = $('dd-ai');
    el.projectbar = $('dd-projectbar');
    el.projectName = $('dd-project-name');
    el.projectSource = $('dd-project-source');
    el.datebar = $('dd-datebar');
    el.datePrev = $('dd-date-prev');
    el.dateNext = $('dd-date-next');
    el.dateCurrent = $('dd-date-current');
    el.dateToday = $('dd-date-today');
    el.progress = $('dd-progress');
    el.capsule = $('dd-capsule');
    el.capsuleText = $('dd-capsule-text');
    el.tuneForm = $('dd-tune-form');
    el.tuneInput = $('dd-tune-input');
    el.tuneSubmit = $('dd-tune-submit');
    el.note = $('dd-note');
    el.noteTitle = $('dd-note-title');
    el.noteList = $('dd-note-list');
    el.noteClose = $('dd-note-close');
    el.error = $('dd-error');
    el.errorTitle = $('dd-error-title');
    el.errorMsg = $('dd-error-msg');
    el.errorRetry = $('dd-error-retry');
    el.chips = $('dd-chips');
    el.searchWrap = $('dd-search-wrap');
    el.search = $('dd-search');
    el.searchClear = $('dd-search-clear');
    el.unreadOnly = $('dd-unread-only');
    el.list = $('dd-list');
    el.prefs = $('dd-prefs');
    el.prefsBody = $('dd-prefs-body');
    el.footer = $('dd-footer');
    el.modal = $('dd-modal');
    el.modalBackdrop = $('dd-modal-backdrop');
    el.modalClose = $('dd-modal-close');
    el.modalBody = $('dd-modal-body');
    el.modalPath = $('dd-modal-path');
    el.modalTitle = $('dd-modal-title');
    el.capsuleExtra = '';
  }

  var searchTimer = null;

  function bindEvents() {
    // 刷新
    el.refreshBtn.addEventListener('click', startRefresh);
    if (el.aiBtn) el.aiBtn.addEventListener('click', startAiSummaries);

    // 日报预览
    el.digestBtn.addEventListener('click', openDigest);
    el.modalClose.addEventListener('click', closeDigest);
    el.modalBackdrop.addEventListener('click', closeDigest);
    el.modal.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeDigest(); }
    });

    // 调教
    el.tuneForm.addEventListener('submit', function (e) {
      e.preventDefault();
      submitTune();
    });

    // 提示条关闭
    el.noteClose.addEventListener('click', function () {
      state.tuneNote = null;
      renderNote();
    });

    // 错误条重试
    el.errorRetry.addEventListener('click', function () {
      state.stateError = null;
      state.itemsError = null;
      state.demoNotice = '';
      state.demo = false;
      state.loading = true;
      render();
      loadState();
    });

    // 主题 chip（委托）
    el.chips.addEventListener('click', function (e) {
      var chip = e.target.closest ? e.target.closest('.dd-chip') : null;
      if (!chip) return;
      state.topic = chip.dataset.topic || '全部';
      renderFilters();
      renderList();
      renderHeader();
    });

    // 搜索：本地即时过滤（保证即时），并带 q 去后端做一次权威刷新
    el.search.addEventListener('input', function () {
      state.query = el.search.value;
      el.searchClear.hidden = !state.query;
      renderList();
      renderHeader();
      if (searchTimer) window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(function () {
        // 本地过滤已经是主路径；这里只做一次轻量的后端补拉（页面不在 /dsh-daily/ 下时静默失败）
        if (!state.demo) loadItemsWithQuery();
      }, SEARCH_DEBOUNCE_MS + 280);
    });

    el.searchClear.addEventListener('click', function () {
      state.query = '';
      el.search.value = '';
      el.searchClear.hidden = true;
      renderList();
      renderHeader();
      el.search.focus();
    });

    el.unreadOnly.addEventListener('change', function () {
      state.unreadOnly = !!el.unreadOnly.checked;
      renderList();
      renderHeader();
    });

    // 列表交互（委托：动作 / 打开 / 折叠 / 空态重试）
    el.list.addEventListener('click', onListClick);

    // 按天翻阅（归档）
    el.datePrev.addEventListener('click', function () { stepDate(1); });
    el.dateNext.addEventListener('click', function () { stepDate(-1); });
    el.dateToday.addEventListener('click', function () {
      if (state.today) selectDate(state.today);
    });
  }

  function onListClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var actionNode = t.closest('[data-action]');
    if (!actionNode) return;
    var action = actionNode.dataset.action;

    if (action === 'open') {
      var url = safeUrl(actionNode.dataset.url);
      if (!url) { e.preventDefault(); return; }
      var handled = openExternal(url);
      // 只有确实有人接手时才阻止默认行为；否则让 <a target="_blank"> 走浏览器/宿主的原生路径
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (action === 'retry-items') {
      e.preventDefault();
      loadItems();
      return;
    }
    // 空态里的"开始第一次抓取"：与其让用户去找右上角那个图标，不如就在他正看着的地方给个按钮
    if (action === 'start-refresh') {
      e.preventDefault();
      startRefresh();
      return;
    }

    var itemNode = t.closest('.dd-item');
    if (!itemNode) return;
    var id = itemNode.dataset.id;

    if (action === 'toggle-summary') {
      state.expanded[id] = !state.expanded[id];
      var sum = itemNode.querySelector('.dd-item-summary');
      if (sum) sum.classList.toggle('is-open', !!state.expanded[id]);
      actionNode.textContent = state.expanded[id] ? '收起' : '展开';
      return;
    }
    if (action === 'read' || action === 'like' || action === 'dislike' || action === 'hide') {
      toggleFeedback(id, action);
    }
  }

  /** 带 q 的后端补拉（契约的 q 参数）；本地过滤为最终裁判 */
  function loadItemsWithQuery() {
    return loadItems(true);
  }

  /* ---------- 5.8 键盘 ---------- */

  function onKeydown(e) {
    var t = e.target || {};
    var tag = (t.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;

    if (e.key === 'Escape') {
      if (!el.modal.hidden) { closeDigest(); return; }
      if (state.query || state.topic !== '全部' || state.unreadOnly) {
        state.query = '';
        state.topic = '全部';
        state.unreadOnly = false;
        render();
        if (typing && typeof t.blur === 'function') t.blur();
      }
      return;
    }
    if (e.key === '/' && !typing) {
      e.preventDefault();
      el.search.focus();
      el.search.select();
    }
  }

  /* ---------- 5.9 可见性：宿主可能在别处触发了刷新 ---------- */

  function onVisibility() {
    if (document.visibilityState !== 'visible') return;
    if (state.demo) return;
    var prevGen = state.generatedAt;
    var prevDate = state.date;

    apiGet(API.state).then(function (r) {
      if (r.error || !r.data) return;
      applyStatePayload(r.data);
      var changed = (r.data.generatedAt !== prevGen) || (state.date !== prevDate);
      render();
      // 宿主的定时任务在后台跑完了（数据换代）→ 重新拉列表
      if (changed) loadItems();
    });
  }

  /* ======================================================================
   * 6. boot
   * ==================================================================== */

  function boot() {
    cacheEls();
    bindEvents();

    // 首屏主题兜底再做一次（?theme= 已在 <head> 内联脚本处理）
    try {
      var t = new URLSearchParams(location.search).get('theme');
      if (t === 'dark' || t === 'light') applyTheme(t);
    } catch (err) { /* 忽略 */ }

    window.addEventListener('message', onMessage);
    window.addEventListener('message', onOpenAck);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', stopRefreshTimer);

    // 首屏骨架
    clear(el.chips);
    renderProgress();
    loadState();
    // 归档索引与首屏数据并行拉，谁先到都不影响另一边
    loadArchive();
    loadProjects();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
