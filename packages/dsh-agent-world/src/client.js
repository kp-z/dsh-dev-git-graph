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
        if (response.status === 404) {
          throw new Error(
            '宿主还是旧版：没有 /api/activate。请重启 DSH 宿主（或重新安装这个插件）让 Host 与面板版本一致；' +
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
        globalThis.__awSnapKeys = snapshot === undefined ? null : Object.keys(snapshot);
        globalThis.__awProjKeys = snapshot?.projectionsBySession === undefined ? null : Object.keys(snapshot.projectionsBySession);
        const team = snapshot?.projectionsBySession?.[sessionId]?.values?.agentTeam;
        return team === undefined ? null : team;
      } catch (e) {
        return null;
      }
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
                return h(AgentWorldView, { ...slotProps, sessions: sessions });
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
