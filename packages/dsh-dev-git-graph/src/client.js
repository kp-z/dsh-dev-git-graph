window.__ModuleLoader__.load({
  id: "dsh-dev-git-graph",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    // ============ dsh-dev-git-graph client：Git Graph 提交图 ============
    // 渲染入口：① 会话头右上角「Git Graph」按钮 → 右侧面板（shell.overlay，固定 dock 或
    //   悬浮，面板头可切换）；② 入驻 dsh-tab-split 的 tabsplit.pane 窗格（如启用）。
    // 内容：移植版 git-graph iframe；inject(sessionId) 从 sessions 拿该会话 cwd。
    // 数据源：宿主路由 /dsh-dev-git-graph/gg/（入口）+ /dsh-dev-git-graph/gg/api（消息）。
    // 主题：从父页读真实 --dsw-alias-* 解析值 + body[data-ds-dark-theme]，postMessage 同步进 iframe。

    // 与 scripts/pack-web.mjs 的 MAP 对齐：需要透传给 iframe 的 DSH alias token。
    var THEME_TOKENS = [
      "--dsw-alias-font-family",
      "--dsw-alias-bg-base", "--dsw-alias-bg-layer-1", "--dsw-alias-bg-layer-2",
      "--dsw-alias-label-primary", "--dsw-alias-label-secondary", "--dsw-alias-label-tertiary",
      "--dsw-alias-border-l1", "--dsw-alias-border-l2",
      "--dsw-alias-interactive-bg-active", "--dsw-alias-interactive-bg-hover",
      "--dsw-alias-brand-primary",
      "--dsw-alias-button-primary-fill", "--dsw-alias-button-primary-hover",
      "--dsw-alias-button-elevated-fill", "--dsw-alias-button-floating-hover", "--dsw-alias-button-contrast-fill",
      "--dsw-alias-fill-l2",
      "--dsw-alias-state-error-primary", "--dsw-alias-state-error-secondary",
      "--dsw-alias-state-warn-primary", "--dsw-alias-state-success-primary",
      "--dsw-alias-shadow",
      "--dsw-alias-bg-highlight", "--dsw-alias-border-highlight"
    ];

    function readThemeTokens() {
      var out = {};
      var cs = getComputedStyle(document.body);
      for (var i = 0; i < THEME_TOKENS.length; i++) {
        var v = cs.getPropertyValue(THEME_TOKENS[i]);
        if (v && v.trim() !== "") out[THEME_TOKENS[i]] = v.trim();
      }
      return out;
    }

    function isDark() {
      return !!(document.body && document.body.hasAttribute("data-ds-dark-theme"));
    }

    function postTheme(frame) {
      if (!frame || !frame.contentWindow) return;
      try {
        frame.contentWindow.postMessage(
          { type: "dsh-dev-gg-theme", dark: isDark(), tokens: readThemeTokens() },
          window.location.origin
        );
      } catch (e) { /* ignore */ }
    }

    function sessionCwd(ctx, sessionId) {
      var sessions = ctx.sessions || (ctx.get ? ctx.get("sessions") : undefined);
      if (!sessions) return null;
      try {
        var b = sessions.binding(sessionId);
        var s = b && b.session && b.session.getSnapshot ? b.session.getSnapshot() : null;
        if (s && s.cwd) return s.cwd;
      } catch (e) { /* ignore */ }
      try {
        var snap = sessions.list && sessions.list.getSnapshot ? sessions.list.getSnapshot() : null;
        return (snap && snap.byId && snap.byId[sessionId] && snap.byId[sessionId].cwd) || null;
      } catch (e) { return null; }
    }

    function GitTreeView(props) {
      var sessionId = props.sessionId;
      var repoHint = props.repoHint || null;
      var ctxRef = props.ctxRef;
      var frameRef = React.useRef(null);
      var statePair = React.useState({ phase: "loading", url: null, err: null, cwd: null });
      var state = statePair[0], setState = statePair[1];

      React.useEffect(function () {
        var alive = true;
        Promise.resolve().then(function () {
          // repoHint（better-sidebar scope.repoRoot/cwd）优先；缺失走会话 cwd 探测。
          var cwd = repoHint || sessionCwd(ctxRef.current, sessionId);
          if (!cwd) { if (alive) setState({ phase: "err", err: "该会话没有工作区目录", url: null, cwd: null }); return; }
          if (!alive) return;
          setState({
            phase: "ok",
            cwd: cwd,
            err: null,
            url: "/dsh-dev-git-graph/gg/index.html?repo=" + encodeURIComponent(cwd)
          });
        });
        return function () { alive = false; };
      }, [sessionId, repoHint]);

      // iframe 就绪 + 宿主题切换时，把真实 token 值与暗色标记推进 iframe。
      React.useEffect(function () {
        if (state.phase !== "ok") return undefined;
        var frame = frameRef.current;
        var push = function () { postTheme(frame); };

        var obs = new MutationObserver(function (muts) {
          for (var k = 0; k < muts.length; k++) {
            if (muts[k].type === "attributes" && muts[k].attributeName === "data-ds-dark-theme") push();
          }
        });
        if (document.body) obs.observe(document.body, { attributes: true });

        if (frame) {
          frame.addEventListener("load", push);
          try { if (frame.contentDocument && frame.contentDocument.readyState === "complete") push(); } catch (e) { /* ignore */ }
        }
        return function () { obs.disconnect(); if (frame) frame.removeEventListener("load", push); };
      }, [state.phase, state.url]);

      if (state.phase === "loading") {
        return React.createElement("div", { className: "dsh-dev-git-graph-hint" }, "正在加载 Git Graph…");
      }
      if (state.phase === "err") {
        return React.createElement("div", { className: "dsh-dev-git-graph-hint err" }, state.err);
      }
      return React.createElement(
        "div",
        { className: "dsh-dev-git-graph-root" },
        React.createElement("iframe", {
          ref: frameRef,
          className: "dsh-dev-git-graph-frame",
          src: state.url,
          title: "Git Graph"
        })
      );
    }

    function ensureStyle() {
      if (document.getElementById("dsh-dev-git-graph-style")) return;
      var st = document.createElement("style");
      st.id = "dsh-dev-git-graph-style";
      st.textContent = [
        ".dsh-dev-git-graph-root{box-sizing:border-box;width:100%;height:100%;min-height:0;flex-direction:column;display:flex;overflow:hidden;background:var(--dsw-alias-bg-base)}",
        ".dsh-dev-git-graph-frame{flex:1;border:none;width:100%;min-height:0}",
        ".dsh-dev-git-graph-hint{padding:24px;font-size:13px;color:var(--dsw-alias-label-secondary)}",
        ".dsh-dev-git-graph-hint.err{color:var(--dsw-alias-state-error-primary)}",
        // ---- Git 树右侧面板（固定 dock：打开时给 AppFrame 加 padding-right 推开三列，
        //      Git 树占据最右缘腾出的空间；details 列左移并存，非悬浮覆盖） ----
        "body{--dgg-panel-w:420px}",
        "body[data-dgg-panel-open] .pI_x6G_frame{padding-right:var(--dgg-panel-w)}",
        ".dgg-sidepanel{position:fixed;top:0;right:0;bottom:0;z-index:30;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border-left:1px solid var(--dsw-alias-border-l2);pointer-events:auto}",
        ".dgg-sidepanel-float{box-shadow:-8px 0 24px var(--dsw-alias-shadow, rgba(0,0,0,.18))}",
        ".dgg-sidepanel-head{flex:none;display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}",
        ".dgg-sidepanel-title{flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        ".dgg-sidepanel-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}",
        ".dgg-sidepanel-body .dsh-dev-git-graph-root{border:none;box-shadow:none}",
        ".dgg-icon-btn{flex:none;min-width:24px;height:24px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:14px;line-height:1;display:grid;place-items:center;padding:0 4px}",
        ".dgg-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
        ".dgg-pin-btn svg{opacity:.45;transition:opacity .12s}",
        ".dgg-pin-btn[data-docked] svg{opacity:1;color:var(--dsw-alias-brand-primary)}",
        ".dgg-sidepanel-resize{position:absolute;top:0;left:-4px;bottom:0;width:8px;cursor:col-resize;z-index:2}",
        ".dgg-sidepanel-resize:hover,.dgg-sidepanel-resize[data-drag=true]{background:var(--dsw-alias-brand-primary);opacity:.4}",
        ".dgg-sidepanel-empty{flex:1;display:grid;place-items:center;color:var(--dsw-alias-label-tertiary);font-size:13px;padding:24px;text-align:center}"
      ].join("\n");
      document.head.appendChild(st);
    }

    function apply(ctx) {
      ensureStyle();
      var ctxRef = { current: ctx };

      // 响应 iframe 启动时的主题请求（见 vendor utils.ts 的 dsh-dev-gg-theme-init）。
      window.addEventListener("message", function (e) {
        if (e.source === window || !e.source) return;
        var data = e.data;
        if (data && data.type === "dsh-dev-gg-theme-init") {
          var frames = document.querySelectorAll("iframe.dsh-dev-git-graph-frame");
          for (var i = 0; i < frames.length; i++) postTheme(frames[i]);
        }
      });

      var slots = ctx.slots || (ctx.get ? ctx.get("slots") : undefined);
      if (!slots || !slots.inject) return;

      // 注：不再注册「Git 树」conversation.view tab（用户改走右侧栏叠加列方案）。

      // ================= Better Sidebar 原生 tab（可选，装了才注册） =================
      // 生态对齐 dsh-flowglass/ego-browser：装了 dsh-better-sidebar 就在其右侧栏
      // 「+」菜单出现 Git Graph 原生 tab；未装回退下方自建 overlay 面板（并存不互斥）。
      // scope.repoRoot/cwd 直接给 GitTreeView 当 repoHint，缺失走会话 cwd 探测。
      var betterSidebar = ctx.betterSidebar || (ctx.get ? ctx.get("betterSidebar") : undefined);
      if (betterSidebar && betterSidebar.registerTab) {
        try {
          var disposeBsTab = betterSidebar.registerTab({
            id: "dev-git-graph",
            title: function () { return "Git Graph"; },
            icon: function (size) {
              return React.createElement("svg", { width: size || 16, height: size || 16, viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": "true" },
                React.createElement("path", { d: "M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6A1 1 0 005 9.5v1.878a2.251 2.251 0 11-1.5 0V4.622a2.251 2.251 0 111.5 0v1.58A2.49 2.49 0 006 7h4a1 1 0 001-1v-.578A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" })
              );
            },
            order: 25,   // 内置 git tab order 20，紧随其后
            single: true,
            component: function (bsProps) {
              var scope = bsProps.scope || {};
              var onOpenDiff = bsProps.onOpenDiff;
              // 桥接 iframe 内「View Diff / View Diff with Working File」：
              // host 路由已把请求转为 SidebarDiffRef 同构载荷，这里经
              // TabComponentProps.onOpenDiff 打开 better-sidebar 原生 DiffTab，
              // 并给 iframe 回 ack（无 onOpenDiff 时回 unavailable 让前端报错）。
              var bridgeRef = React.useRef(null);
              React.useEffect(function () {
                if (bridgeRef.current) return undefined;
                bridgeRef.current = true;
                var onMsg = function (e) {
                  var data = e.data;
                  if (!data || data.type !== "dsh-dev-gg-open-diff") return;
                  var source = e.source;
                  var reply = function (type) {
                    try { source && source.postMessage({ type: type }, window.location.origin); } catch (err) { /* ignore */ }
                  };
                  var diff = data.diff;
                  if (!onOpenDiff || !diff || (diff.kind !== "worktree" && diff.kind !== "commit")) {
                    reply("dsh-dev-gg-bs-diff-unavailable");
                    return;
                  }
                  try {
                    var filePath = diff.kind === "worktree" ? diff.path : (diff.subject || diff.hashFull || "diff");
                    var tabId = diff.kind === "worktree"
                      ? "diff:w:" + encodeURIComponent(diff.repoRoot || "") + ":" + (diff.staged ? "s" : "u") + ":" + diff.path
                      : "diff:c:" + encodeURIComponent(diff.repoRoot || "") + ":" + (diff.hashFull || diff.hash);
                    onOpenDiff({
                      id: tabId,
                      type: "diff",
                      title: typeof filePath === "string" ? filePath.split("/").pop() : "Diff",
                      diff: diff
                    });
                    reply("dsh-dev-gg-bs-diff-ack");
                  } catch (err) {
                    reply("dsh-dev-gg-bs-diff-unavailable");
                  }
                };
                window.addEventListener("message", onMsg);
                return function () { window.removeEventListener("message", onMsg); };
              }, [onOpenDiff]);
              return React.createElement(GitTreeView, {
                sessionId: scope.sessionId,
                repoHint: scope.repoRoot || scope.cwd || null,
                ctxRef: ctxRef
              });
            }
          });
          if (ctx.effect) ctx.effect(function () { return disposeBsTab; });
        } catch (e) { /* 老版本 better-sidebar 不兼容时静默回退 overlay */ }
      }

      // 入驻 dsh-tab-split 的窗格 slot：让「Git 树」可被拆进分屏窗格。
      // slots.inject 在 tabsplit.pane 尚未声明时排队等待，声明出现后同步补注册。
      slots.inject("tabsplit.pane", function () {
        return slots.register(
          {
            name: "tabsplit.pane",
            id: "git-graph-pane",
            order: 20,
            label: function () { return "Git Graph"; }
          },
          function (props) { return React.createElement(GitTreeView, Object.assign({}, props, { ctxRef: ctxRef })); }
        );
      });

      // ================= Git 树右侧面板（固定 dock） =================
      // 官方对话/工具详情 100% 原生不动；面板 fixed 定位最右缘，打开时给 AppFrame 加
      // padding-right 把三列整体推窄——Git 树占据腾出的空间，details 列左移并存（固定非悬浮）。
      // shell.overlay 是 inset:0 + pointer-events:none 的覆盖层，面板自身 opt-in pointer-events。
      var sessionsSvc = ctx.sessions || (ctx.get ? ctx.get("sessions") : undefined);

      // 面板显隐（模块级，跨会话保持；默认关）。mode: "dock" 固定（推开三列）/ "float" 悬浮（覆盖）。
      var panelState = { open: false, width: 420, mode: "dock", listeners: new Set() };
      try {
        var w = window.localStorage.getItem("dsh.git-graph.sidepanel");
        if (w) { var pw = parseInt(w, 10); if (pw >= 280 && pw <= 720) panelState.width = pw; }
        var m = window.localStorage.getItem("dsh.git-graph.sidepanel.mode");
        if (m === "dock" || m === "float") panelState.mode = m;
      } catch (e) {}
      function syncLayout() {
        // 面板宽 -> CSS 变量；dock 且开 -> body 标记（驱动 AppFrame padding-right 推开三列）
        document.body.style.setProperty("--dgg-panel-w", panelState.width + "px");
        if (panelState.open && panelState.mode === "dock") document.body.setAttribute("data-dgg-panel-open", "");
        else document.body.removeAttribute("data-dgg-panel-open");
      }
      function setPanel(patch) {
        if (patch.width !== undefined) {
          panelState.width = Math.min(720, Math.max(280, patch.width));
          try { window.localStorage.setItem("dsh.git-graph.sidepanel", String(panelState.width)); } catch (e) {}
        }
        if (patch.open !== undefined) panelState.open = patch.open;
        if (patch.mode !== undefined) {
          panelState.mode = patch.mode;
          try { window.localStorage.setItem("dsh.git-graph.sidepanel.mode", patch.mode); } catch (e) {}
        }
        syncLayout();
        panelState.listeners.forEach(function (fn) { fn(); });
      }
      syncLayout();
      ctx.effect(function () {
        return function () {
          document.body.removeAttribute("data-dgg-panel-open");
          document.body.style.removeProperty("--dgg-panel-w");
        };
      });

      function useCurrentSessionId() {
        return React.useSyncExternalStore(
          function (fn) { return sessionsSvc.list.subscribe(fn); },
          function () { var s = sessionsSvc.list.getSnapshot(); return s ? s.current : undefined; }
        );
      }

      function SidePanel() {
        var _p = React.useState(0);
        var force = _p[1];
        React.useEffect(function () {
          var fn = function () { force(function (n) { return n + 1; }); };
          panelState.listeners.add(fn);
          return function () { panelState.listeners.delete(fn); };
        }, []);
        var sessionId = useCurrentSessionId();

        // keep-alive：关闭不卸载，display:none 保留 iframe DOM（重开秒出，不重载前端/重跑 git）。
        // 仅「从未打开过」才不渲染，避免首次进会话白加载 iframe。
        var everOpenedRef = React.useRef(false);
        if (panelState.open) everOpenedRef.current = true;

        var onResizeStart = React.useCallback(function (ev) {
          ev.preventDefault();
          var el = ev.currentTarget;
          el.setAttribute("data-drag", "true");
          var startX = ev.clientX, startW = panelState.width;
          function move(e) { setPanel({ width: startW + (startX - e.clientX) }); }
          function up() {
            el.removeAttribute("data-drag");
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          }
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }, []);

        if (!everOpenedRef.current) return null;
        var isDock = panelState.mode === "dock";
        return React.createElement("aside", {
            className: "dgg-sidepanel" + (isDock ? "" : " dgg-sidepanel-float"),
            style: { width: panelState.width, display: panelState.open ? "flex" : "none" },
            "data-mode": panelState.mode
          },
          React.createElement("div", { className: "dgg-sidepanel-resize", onPointerDown: onResizeStart }),
          React.createElement("div", { className: "dgg-sidepanel-head" },
            React.createElement("span", { className: "dgg-sidepanel-title" }, "Git Graph"),
            React.createElement("button", {
              className: "dgg-icon-btn dgg-pin-btn",
              "data-docked": isDock ? "" : undefined,
              title: isDock ? "已固定 — 点击切换为悬浮" : "悬浮中 — 点击固定",
              onClick: function () { setPanel({ mode: isDock ? "float" : "dock" }); }
            }, React.createElement("svg", { width: 14, height: 14, viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": "true" },
              React.createElement("path", { d: "M10 2 6 6l-2 1 4 4 1-2 4-4-3-3zM5 9l-3 5 5-3" })
            )),
            React.createElement("button", {
              className: "dgg-icon-btn", title: "关闭 Git Graph 侧栏",
              onClick: function () { setPanel({ open: false }); }
            }, "×")
          ),
          React.createElement("div", { className: "dgg-sidepanel-body" },
            sessionId
              ? React.createElement(GitTreeView, { sessionId: sessionId, ctxRef: ctxRef })
              : React.createElement("div", { className: "dgg-sidepanel-empty" }, "进入一个会话后显示该工作区的提交图")
          )
        );
      }

      // 面板本体（shell.overlay 覆盖层）
      try {
        slots.inject("shell.overlay", function () {
          return slots.register(
            { name: "shell.overlay", id: "git-graph-sidepanel", order: 60 },
            function () { return React.createElement(SidePanel); }
          );
        });
      } catch (e) { /* shell.overlay 不可用时静默降级：面板功能不注册 */ }

      // 会话头右上角开关按钮（header.utilities：Session log/知识节点那排）
      slots.inject("conversation.session.header.utilities", function () {
        return slots.register(
          { name: "conversation.session.header.utilities", id: "git-graph-sidepanel-toggle", order: 50 },
          function () {
            var _p = React.useState(0); var force = _p[1];
            React.useEffect(function () {
              var fn = function () { force(function (n) { return n + 1; }); };
              panelState.listeners.add(fn);
              return function () { panelState.listeners.delete(fn); };
            }, []);
            return React.createElement("button", {
              className: "dgg-icon-btn",
              title: panelState.open ? "关闭 Git Graph 侧栏" : "在右侧打开 Git Graph 侧栏",
              style: { width: "auto", padding: "0 8px", height: "24px", fontSize: "12px" },
              onClick: function () { setPanel({ open: !panelState.open }); }
            }, (panelState.open ? "✕ " : "⌥ ") + "Git Graph");
          }
        );
      });
    }

    exports.apply = apply;
    exports.inject = ["sessions", "slots", "betterSidebar"];
    return module.exports;
  }
});
