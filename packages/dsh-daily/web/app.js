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
    digest: './api/digest'
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
    el.stats.appendChild(document.createTextNode(total + ' 条 · ' + unread + ' 未读'));
    if (health.total > 0) {
      el.stats.appendChild(document.createTextNode(' · '));
      var src = text('span', health.bad.length ? 'dd-stat-warn' : '', health.ok + '/' + health.total + ' 源正常');
      el.stats.appendChild(src);
    }
    if (state.items.length) {
      el.stats.appendChild(document.createTextNode(' · 已加载 ' + state.items.length));
    }

    el.refreshBtn.disabled = state.refreshBusy;
    el.refreshBtn.classList.toggle('dd-spin', state.refreshBusy);
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
      return emptyBlock('🌱', '今天还没抓取过', '点右上角刷新按钮开始第一次抓取，抓完条目会自动出现在这里。');
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
    var summaryText = String(it.summary || '');
    if (summaryText) {
      var isOpen = !!state.expanded[it.id];
      var sum = text('p', classNames('dd-item-summary', isOpen && 'is-open'), summaryText);
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

  var THUMB_TIMEOUT_MS = 6000;

  function renderThumb(it) {
    var wrap = text('div', 'dd-thumb');
    var url = safeUrl(it.thumb);
    if (url) {
      var img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';

      var settled = false;
      var swap = function () {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        // 封面挂了 → 换成纯色占位块，不显示破图图标
        if (img.parentNode) img.parentNode.removeChild(img);
        wrap.appendChild(thumbFallback());
      };
      // 有些源（实测 YouTube 缩略图）请求会一直挂着：既不 error 也不 load，
      // 光靠 onerror 会永远留一块空白。给一个上限，超时就当失败处理。
      var timer = window.setTimeout(swap, THUMB_TIMEOUT_MS);
      img.addEventListener('error', swap);
      img.addEventListener('load', function () {
        settled = true;
        window.clearTimeout(timer);
      });
      wrap.appendChild(img);
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
    var on = state.refreshBusy;
    el.progress.classList.toggle('is-on', on);
    el.progress.setAttribute('aria-hidden', on ? 'false' : 'true');
    el.capsule.hidden = !on;
    if (on) el.capsuleText.textContent = capsuleMessage();
  }

  function capsuleMessage() {
    var extra = el.capsuleExtra || '';
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
    if (s.date) state.date = String(s.date);
    state.generatedAt = s.generatedAt || null;
    state.lastRefresh = s.lastRefresh || null;
    state.refreshing = !!s.refreshing;
    state.counts = s.counts || { total: 0, unread: 0, byTopic: {} };
    state.sources = Array.isArray(s.sources) ? s.sources : [];
    state.prefs = s.prefs || null;
    state.digest = s.digest || { available: false };
    document.title = '日报 · ' + state.date;
  }

  function enterDemo(reason) {
    var mock = mockPayload();
    state.demo = true;
    state.demoNotice = '真实接口不可用（' + reason + '），当前展示内置演示数据。' +
      '把页面放在 /dsh-daily/ 下由宿主路由打开即可看到真实内容。';
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
    if (state.digest && state.digest.available === false) {
      showDigest('', '', '日报尚未生成：等一次刷新完成后会自动产出。');
      return;
    }

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
    el.capsuleExtra = '';
  }

  var searchTimer = null;

  function bindEvents() {
    // 刷新
    el.refreshBtn.addEventListener('click', startRefresh);

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
      e.preventDefault();
      e.stopPropagation();
      window.open(url, '_blank', 'noopener');
      return;
    }
    if (action === 'retry-items') {
      e.preventDefault();
      loadItems();
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
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', stopRefreshTimer);

    // 首屏骨架
    clear(el.chips);
    renderProgress();
    loadState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
