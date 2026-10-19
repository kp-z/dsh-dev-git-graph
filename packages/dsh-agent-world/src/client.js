/*
 * dsh-agent-world 的 **Client half**（R161）—— 把世界放进 DSH 的侧边栏主面板。
 *
 * ## 它注册了什么
 *
 * · `sidebar.panellist` / id `agent-world`
 *     侧边栏里的一个全局面板图标。DSH 的约定是：**这个 id 同时就是 main 面板的 key**，
 *     侧边栏自己画按钮、自己解析 label，点击后把 `main` 切到同 id 的面板。
 * · `main` / key `agent-world`
 *     主面板内容。这里渲染一个"宿主容器"，再由 `/agent-world/embed.js` 把
 *     同一套 Phaser 页面挂进去（不是 iframe：悬浮层靠脚本文档拿不到宿主主题）。
 *
 * ## 为什么主面板只做一个容器
 *
 * 游戏本体是既有的一整套模块（`web/main.js` + `web/scene/*` + `web/ui/*`），
 * 已经支持"挂到任意 root"（R161 的 `mountAgentWorld`）。Client 这一层只负责
 * 生命周期：加载、挂载、卸载。真正的装配与数据都在那一份代码里，不复制。
 */

window.__ModuleLoader__.load({
  id: 'dsh-agent-world',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const PANEL_KEY = 'agent-world';
    const BASE_URL = (typeof window !== 'undefined' && window.__AGENT_WORLD_BASE__) || '/agent-world';

    /* ── 侧边栏图标：和页面 brand-mark 同源的菱形星座 ─────────────────────── */
    function AgentWorldIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 18;
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block', opacity: props.active === false ? 0.75 : 1 },
        },
        h('path', { d: 'M12 3.6 20 12l-8 8.4L4 12Z' }),
        h('path', { d: 'M4 12h16' }),
        h('circle', { cx: 12, cy: 3.6, r: 2.2, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 20, cy: 12, r: 2.2, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 12, cy: 20.4, r: 2.2, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 4, cy: 12, r: 2.2, fill: 'currentColor', stroke: 'none' }),
      );
    }

    /* ── 左侧工作区当前会话：读 uiSession 的 current binding + sessions 的标题 ── */

    /**
     * 读当前选中会话的 `{ id, title }`。
     *
     * `uiSession.adapter.current` 是 DSH 自己维护的“主视图会话”绑定
     * （`@deepseek-ai/dsh-client-ui-session` 的 `publishMain()`），`binding.key` 就是 session id。
     * 标题在 `sessions.list` 的 `byId[id].title`；拿不到就只给 id，由 header 决定怎么显示。
     */
    function readWorkspaceSession(sessions, uiSession) {
      try {
        const binding = uiSession?.adapter?.current?.getSnapshot?.();
        const id = binding?.key ?? binding?.sessionId;
        if (typeof id !== 'string' || id === '') return null;
        const summary = sessions?.list?.getSnapshot?.()?.byId?.[id];
        const title = typeof summary?.title === 'string' && summary.title !== '' ? summary.title : null;
        return { id, title };
      } catch (e) {
        return null;
      }
    }

    /**
     * 订阅“当前会话”的变化（选中别的会话、标题改名），返回退订函数。
     * 首次会立刻回调一次；没有选中会话时回调 `null`（页面据此隐藏 header 里的会话名）。
     */
    function watchWorkspaceSession(sessions, uiSession, onChange) {
      let last = Symbol('unset');
      const emit = () => {
        const next = readWorkspaceSession(sessions, uiSession);
        const fingerprint = next === null ? 'null' : `${next.id}\u0000${next.title ?? ''}`;
        if (fingerprint === last) return;
        last = fingerprint;
        onChange(next);
      };
      emit();
      const disposers = [];
      const current = uiSession?.adapter?.current;
      if (typeof current?.subscribe === 'function') disposers.push(current.subscribe(emit));
      const list = sessions?.list;
      if (typeof list?.subscribe === 'function') disposers.push(list.subscribe(emit));
      return function () {
        for (const dispose of disposers) {
          try { dispose(); } catch (e) { /* 已经释放 */ }
        }
      };
    }

    /* ── 主面板：只做容器的生命周期 ──────────────────────────────────────── */
    function AgentWorldPanel(props) {
      const hostRef = React.useRef(null);
      const [phase, setPhase] = React.useState('loading');
      const [error, setError] = React.useState(null);

      React.useEffect(function () {
        let disposed = false;
        let handle = null;
        let stopSessionWatch = null;
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
            // header 要显示**左侧工作区里当前会话的名字**，不是团队/队长的会话。
            // 没有选中会话时传 null，页面会把会话名隐藏（而不是退回团队名）。
            if (props.sessions !== undefined && props.uiSession !== undefined) {
              stopSessionWatch = watchWorkspaceSession(props.sessions, props.uiSession, function (info) {
                handle?.setWorldSession(info);
              });
            }
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
          if (stopSessionWatch !== null) {
            stopSessionWatch();
            stopSessionWatch = null;
          }
          if (handle !== null) {
            try { handle.dispose(); } catch (e) { /* 页面已经没了 */ }
            handle = null;
          }
        };
      }, []);

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
      inject: ['slots', 'sessions', 'uiSession'],
      apply(ctx) {
        const sessions = ctx.get('sessions');
        const uiSession = ctx.get('uiSession');
        ctx.effect(function () {
          const disposers = [
            ctx.slots.inject('sidebar.panellist', function () {
              return ctx.slots.register(
                { name: 'sidebar.panellist', id: PANEL_KEY, order: 20, label: 'Agent World' },
                AgentWorldIcon,
              );
            }),
            ctx.slots.inject('main', function () {
              return ctx.slots.register({ name: 'main', key: PANEL_KEY }, function (slotProps) {
                return h(AgentWorldPanel, { ...slotProps, sessions: sessions, uiSession: uiSession });
              });
            }),
          ];
          return function () {
            for (const dispose of disposers) {
              if (typeof dispose === 'function') dispose();
            }
          };
        });
      },
    };
  },
});
