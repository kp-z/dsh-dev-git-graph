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
        setPhase('loading');
        setError(null);
        (async function () {
          try {
            const mod = await import(BASE_URL + '/embed.js');
            if (disposed) return;
            handle = await mod.mountEmbeddedApp(hostRef.current, { baseUrl: BASE_URL });
            if (disposed) {
              handle.dispose();
              handle = null;
              return;
            }
            // 会话视图的 header 名 = 这个会话在左侧工作区里的标题。
            stopTitleWatch = watchSessionTitle(props.sessions, sessionId, function (info) {
              handle?.setWorldSession(info);
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
          if (handle !== null) {
            try { handle.dispose(); } catch (e) { /* 页面已经没了 */ }
            handle = null;
          }
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
        { style: { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' } },
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
