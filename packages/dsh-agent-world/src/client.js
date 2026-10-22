/*
 * dsh-agent-world 的 **Client half**（R164）—— 把世界放进会话的 **conversation.view**。
 *
 * ## 放在哪里
 *
 * 不再占「全局面板」（`sidebar.panellist` + `main`）。注册
 * `conversation.view` / id `agent-world` / label「Agent World」/ order 20：
 * 它会出现在每个会话 header 的「对话 / 轨迹」后面，作为**这个会话自己的一个视图**。
 * 切会话、切视图由 Conversation 自己管；离开视图就 dispose 游戏，不常驻后台。
 *
 * ## 会话绑定
 *
 * `conversation.view` 是 session-scoped slot，组件直接拿到 `sessionId`。
 * 标题从 `sessions.list.byId[sessionId].title` 读（与左侧工作区行同一份 summary）；
 * 通过 `setWorldSession({ id, title })` 交给页面 header。切会话/改标题会同步。
 *
 * ⚠️ 世界引擎目前仍是**单实例**（一个 stateDir / 一个世界）。这个 view 只保证
 * “入口和展示跟着会话走”，不等于每个会话有独立世界；独立世界需要后端按 sessionId
 * 分库，属于另一轮。
 */

window.__ModuleLoader__.load({
  id: 'dsh-agent-world',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const VIEW_KEY = 'agent-world';
    const BASE_URL = (typeof window !== 'undefined' && window.__AGENT_WORLD_BASE__) || '/agent-world';

    /**
     * R279：把 better-sidebar 的 SubagentView bundle 挂进页面容器。
     *
     * 这不是重画：bundle 由 scripts/build-subagent-view.mjs 从
     * dsh-better-sidebar/src/client/SubagentView.tsx 直接打包，数据仍走它自己的
     * ctx/sessions/jobs 路径。宿主 primitives 用本地 shim，视觉细节由它自带 CSS。
     */
    function mountSubagentView(container, sessionId, pluginCtx) {
      if (container === null || container === undefined) return Promise.reject(new Error('没有挂载容器'));
      return import(BASE_URL + '/subagent-view.js').then((mod) => {
        if (typeof mod.mount !== 'function') throw new Error('subagent-view bundle 没有 mount');
        const linkId = 'aw-subagent-view-css';
        if (document.getElementById(linkId) === null) {
          const link = document.createElement('link');
          link.id = linkId;
          link.rel = 'stylesheet';
          link.href = BASE_URL + '/subagent-view.css';
          document.head.append(link);
        }
        return mod.mount(container, pluginCtx, sessionId);
      });
    }

    /**
     * 让 Host 切到**这个会话自己的世界**（R166）。
     *
     * 同一时刻只有这一个世界在内存/推进；旧视图的 `deactivate` 会先保存并卸下。
     */
    async function activateSession(sessionId) {
      const response = await fetch(BASE_URL + '/api/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (response.ok !== true) {
        const detail = await response.text().catch(() => '');
        if (response.status === 404 || response.status === 405) {
          throw new Error(
            (response.status === 405
              ? '宿主里 Agent World 路由没有注册（插件未激活），POST 被静态兜底拒成 405。'
              : '宿主还是旧版：没有 /api/activate。') +
            '请重启 DSH 宿主；如果仍失败，重装 dsh-agent-world（确保 lib 里的新文件一起进 profile）；' +
            `服务端返回：${detail.slice(0, 200)}`,
          );
        }
        throw new Error(`activate 失败（HTTP ${response.status}）${detail === '' ? '' : `：${detail.slice(0, 200)}`}`);
      }
    }

    function deactivateSession() {
      try {
        void fetch(BASE_URL + '/api/deactivate', { method: 'POST', keepalive: true });
      } catch (e) {
        // 页面已经在卸载；下一个视图会重新 activate。
      }
    }

    /** 从 sessions 服务的列表快照里取当前会话的标题（拿不到就只给 id）。 */
    function readSessionTitle(sessions, sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return null;
      try {
        const summary = sessions?.list?.getSnapshot?.()?.byId?.[sessionId];
        const title = typeof summary?.title === 'string' && summary.title !== '' ? summary.title : null;
        return { id: sessionId, title };
      } catch (e) {
        return { id: sessionId, title: null };
      }
    }

    /**
     * 官方 Agent Teams Session projection（R178）。
     *
     * 与 better-sidebar 同源：`SessionListState.projectionsBySession[lead]`
     * `.values.agentTeam`。不轮询 host、不解析 tool call；projection 里直接有
     * `members`（id/name/role/phase/error）和 `tasks`（id/revision/status/ownerName…）。
     */
    function readTeamProjection(sessions, sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return null;
      try {
        const snapshot = sessions?.list?.getSnapshot?.();
        const team = snapshot?.projectionsBySession?.[sessionId]?.values?.agentTeam;
        return team === undefined ? null : team;
      } catch (e) {
        return null;
      }
    }

    /**
     * DSH session 树（R273）：只取画拓扑要用的字段，避免把整个 snapshot 塞给页面。
     *
     * - byId：会话 summary 的 parentId/title/displayTitle/running；
     * - catalogs：每层 parent 的 subagentCatalog entries（id/label/mode）。
     * 页面用 web/core/team-graph.js 把两者组装成 TeamGraph。
     */
    function readSessionGraph(sessions, sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return null;
      try {
        const snapshot = sessions?.list?.getSnapshot?.();
        if (snapshot === null || snapshot === undefined) return null;
        const byId = {};
        for (const [id, summary] of Object.entries(snapshot.byId ?? {})) {
          if (summary === null || typeof summary !== 'object') continue;
          byId[id] = {
            id,
            parentId: typeof summary.parentId === 'string' ? summary.parentId : null,
            title: typeof summary.title === 'string' ? summary.title : null,
            displayTitle: typeof summary.displayTitle === 'string' ? summary.displayTitle : null,
            running: summary.running === true,
            mode: typeof summary.mode === 'string' ? summary.mode : null,
          };
        }
        const catalogs = {};
        for (const [id, projection] of Object.entries(snapshot.projectionsBySession ?? {})) {
          const catalog = projection?.values?.subagentCatalog;
          if (catalog === null || catalog === undefined) continue;
          if (catalog.state !== 'ready' || !Array.isArray(catalog.entries)) continue;
          catalogs[id] = {
            entries: catalog.entries.map((entry) => ({
              id: typeof entry?.id === 'string' ? entry.id : '',
              label: typeof entry?.label === 'string' ? entry.label : '',
              mode: typeof entry?.mode === 'string' ? entry.mode : null,
            })).filter((entry) => entry.id !== ''),
          };
        }
        return { rootId: sessionId, byId, catalogs };
      } catch (e) {
        return null;
      }
    }

    /** 订阅 session 列表，图变化时把 session 树交给页面；立即回调一次。 */
    function watchSessionGraph(sessions, sessionId, onChange) {
      let last = null;
      let timer = null;
      const emit = () => {
        if (timer !== null) return;
        timer = setTimeout(() => {
          timer = null;
          const next = readSessionGraph(sessions, sessionId);
          let fingerprint = 'null';
          try { fingerprint = next === null ? 'null' : JSON.stringify(next); } catch (e) { fingerprint = String(next); }
          if (fingerprint === last) return;
          last = fingerprint;
          onChange(next);
        }, 120);
      };
      emit();
      const list = sessions?.list;
      if (typeof list?.subscribe !== 'function') {
        return function () { if (timer !== null) clearTimeout(timer); };
      }
      const dispose = list.subscribe(emit);
      return function () {
        if (timer !== null) clearTimeout(timer);
        try { dispose(); } catch (e) { /* 已经释放 */ }
      };
    }

    /** 订阅 session 列表，projection 变化时把官方 team 交给页面；立即回调一次。 */
    function watchTeamProjection(sessions, sessionId, onChange) {
      let last = null;
      const emit = () => {
        const next = readTeamProjection(sessions, sessionId);
        let fingerprint = 'null';
        try { fingerprint = next === null ? 'null' : JSON.stringify(next); } catch (e) { fingerprint = String(next); }
        if (fingerprint === last) return;
        last = fingerprint;
        onChange(next);
      };
      emit();
      const list = sessions?.list;
      if (typeof list?.subscribe !== 'function') return function () {};
      const dispose = list.subscribe(emit);
      return function () {
        try { dispose(); } catch (e) { /* 已经释放 */ }
      };
    }

    /**
     * 调页面 handle 上的**可选 hook**（setWorldSession / setTeamProjection）。
     *
     * 这些 hook 是附加信息：页面可能来自另一份构建、team projection 也随宿主版本变化。
     * 以前这里直接 `handle.setTeamProjection(team)`——只要 handle 上没有这个方法，
     * 异常就会从 effect 里冒出去，整个 Agent World 直接变成错误浮层（最常见的启动崩溃）。
     * 所以统一在这里守一次：handle / 方法不存在就跳过，调用抛错也吞掉，
     * 世界照常启动，只是少了那部分信息。
     */
    function callHandleHook(handle, method, value) {
      if (handle === null || handle === undefined) return;
      const fn = handle[method];
      if (typeof fn !== 'function') return;
      try {
        fn.call(handle, value);
      } catch (e) {
        // 附加 hook 失败只影响展示，不影响世界本身。
      }
    }

    /** 订阅 session 列表（标题改名）并立即回调一次；返回退订函数。 */
    function watchSessionTitle(sessions, sessionId, onChange) {
      let last;
      const emit = () => {
        const next = readSessionTitle(sessions, sessionId);
        const fingerprint = next === null ? 'null' : `${next.id}\u0000${next.title ?? ''}`;
        if (fingerprint === last) return;
        last = fingerprint;
        onChange(next);
      };
      emit();
      const list = sessions?.list;
      if (typeof list?.subscribe !== 'function') return function () {};
      const dispose = list.subscribe(emit);
      return function () {
        try { dispose(); } catch (e) { /* 已经释放 */ }
      };
    }

    /**
     * 打开 Agent World 时隐藏下方的**对话输入面板**（composer），让世界铺满会话主体。
     *
     * 不直接改 DSH 组件的状态（composer 的 owner props 里没有“当前 view”），
     * 而是在 body 上挂一个类 + 一条 :has 规则：命中 `conversation.composer` 的直接父节点
     * （`.composerSeat`，带 128px 高度）并 `display:none`。离开视图时摘掉类。
     *
     * 为什么用 CSS 而不是 `element.style.display`：会话重渲染时 React 可能重建 seat，
     * 类规则会继续命中新节点；inline style 会跟着旧节点一起消失。
     */
    const COMPOSER_HIDE_CLASS = 'agent-world-view-active';
    const COMPOSER_HIDE_STYLE_ID = 'agent-world-hide-composer';

    function setComposerHidden(hidden) {
      const doc = globalThis.document;
      if (doc === undefined || doc.body === null) return;
      if (hidden) {
        if (doc.getElementById(COMPOSER_HIDE_STYLE_ID) === null) {
          const style = doc.createElement('style');
          style.id = COMPOSER_HIDE_STYLE_ID;
          style.textContent = `body.${COMPOSER_HIDE_CLASS} *:has(> [data-slot="conversation.composer"]) { display: none !important; }`;
          doc.head.append(style);
        }
        doc.body.classList.add(COMPOSER_HIDE_CLASS);
      } else {
        doc.body.classList.remove(COMPOSER_HIDE_CLASS);
        doc.getElementById(COMPOSER_HIDE_STYLE_ID)?.remove();
      }
    }

    /* ── 会话视图：只做容器的生命周期 ─────────────────────────────────────── */
    function AgentWorldView(props) {
      const hostRef = React.useRef(null);
      const handleRef = React.useRef(null);
      const [phase, setPhase] = React.useState('loading');
      const [error, setError] = React.useState(null);
      const sessionId = props.sessionId;

      // 视图存活期间隐藏 composer；切回「对话/轨迹」时组件卸载，cleanup 会恢复。
      React.useEffect(function () {
        setComposerHidden(true);
        return function () {
          setComposerHidden(false);
        };
      }, [sessionId]);

      React.useEffect(function () {
        let disposed = false;
        let handle = null;
        let stopTitleWatch = null;
        let stopTeamWatch = null;
        let stopGraphWatch = null;
        setPhase('loading');
        setError(null);
        (async function () {
          try {
            if (typeof sessionId === 'string' && sessionId !== '') await activateSession(sessionId);
            const mod = await import(BASE_URL + '/embed.js');
            if (disposed) return;
            // 宿主服务的 lib/web 与浏览器缓存可能落后于 client.js：给出可执行的提示，
            // 而不是一句难以定位的 "xxx is not a function"。
            if (typeof mod.mountEmbeddedApp !== 'function') {
              throw new Error('Agent World 的前端资源版本不一致（embed.js 里没有 mountEmbeddedApp）。请重启 DSH 宿主，让插件重新加载后再打开。');
            }
            handle = await mod.mountEmbeddedApp(hostRef.current, { baseUrl: BASE_URL, sessionId });
            handleRef.current = handle;
            if (disposed) {
              handle.dispose();
              handle = null;
              return;
            }
            // 会话视图的 header 名 = 这个会话在左侧工作区里的标题。
            stopTitleWatch = watchSessionTitle(props.sessions, sessionId, function (info) {
              callHandleHook(handle, 'setWorldSession', info);
            });
            stopTeamWatch = watchTeamProjection(props.sessions, sessionId, function (team) {
              callHandleHook(handle, 'setTeamProjection', team);
            });
            stopGraphWatch = watchSessionGraph(props.sessions, sessionId, function (graph) {
              callHandleHook(handle, 'setSessionGraph', graph);
            });
            const mountNative = (container) => mountSubagentView(container, sessionId, props.pluginCtx);
            globalThis.__awMountSubagentView = mountNative;
            setPhase('ready');
          } catch (err) {
            if (!disposed) {
              setError(err instanceof Error ? err.message : String(err));
              setPhase('error');
            }
          }
        })();
        return function () {
          disposed = true;
          if (stopTitleWatch !== null) {
            stopTitleWatch();
            stopTitleWatch = null;
          }
          if (stopTeamWatch !== null) {
            stopTeamWatch();
            stopTeamWatch = null;
          }
          if (stopGraphWatch !== null) {
            stopGraphWatch();
            stopGraphWatch = null;
          }
          if (handle !== null) {
            try {
              if (typeof handle.dispose === 'function') handle.dispose();
            } catch (e) { /* 页面已经没了 */ }
            handle = null;
            handleRef.current = null;
          }
          if (typeof sessionId === 'string' && sessionId !== '') deactivateSession();
        };
      }, [sessionId]);

      const overlay = phase === 'ready' ? null : h(
        'div',
        {
          style: {
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexDirection: 'column', gap: 8,
            background: 'var(--dsw-alias-bg-primary, #0a0e16)',
            color: 'var(--dsw-alias-text-secondary, #94a3be)',
            font: '13px/1.6 var(--dsw-alias-font-family, system-ui)',
            padding: 24, textAlign: 'center', zIndex: 2,
          },
        },
        h('strong', { style: { color: 'var(--dsw-alias-text-primary, #e6ecf8)' } },
          phase === 'error' ? 'Agent World 没能启动' : '正在连接 Agent World…'),
        phase === 'error' ? h('span', null, error) : null,
      );

      return h(
        'div',
        { style: { position: 'absolute', inset: 0, overflow: 'hidden' } },
        h('div', { ref: hostRef, style: { position: 'absolute', inset: 0 } }),
        overlay,
      );
    }

    return {
      name: 'agent-world-ui',
      inject: ['slots', 'sessions'],
      apply(ctx) {
        const sessions = ctx.get('sessions');
        ctx.effect(function () {
          const dispose = ctx.slots.inject('conversation.view', function () {
            return ctx.slots.register(
              { name: 'conversation.view', id: VIEW_KEY, order: 20, label: 'Agent World' },
              function (slotProps) {
                return h(AgentWorldView, { ...slotProps, sessions: sessions, pluginCtx: ctx });
              },
            );
          });
          return function () {
            if (typeof dispose === 'function') dispose();
          };
        });
      },
    };
  },
});
