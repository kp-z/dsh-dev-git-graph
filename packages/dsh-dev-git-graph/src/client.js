window.__ModuleLoader__.load({
  id: "dsh-dev-git-graph",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    // ============ dsh-dev-git-graph client：Git Graph 提交图 ============
    // 渲染入口：dsh-better-sidebar 右侧栏原生 tab（唯一入口，前置依赖 dsh-better-sidebar）；
    //   另入驻 dsh-tab-split 的 tabsplit.pane 窗格（如启用）。
    // 内容：移植版 git-graph iframe；repo 取 better-sidebar scope.repoRoot/cwd，缺失从 sessions 拿会话 cwd。
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
        ".dsh-dev-git-graph-hint.err{color:var(--dsw-alias-state-error-primary)}"
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

      // ================= Better Sidebar 原生 tab（唯一入口） =================
      // 本插件只入驻 dsh-better-sidebar 右侧栏（「+」菜单出现 Git Graph tab）；
      // scope.repoRoot/cwd 直接给 GitTreeView 当 repoHint，缺失走会话 cwd 探测。
      // 未装 better-sidebar 时静默无 UI（插件定位即 better-sidebar 生态页，无回退面板/按钮）。
      // cordis 4.x 的 ctx.get 对未声明服务名硬抛（without inject），故 try/catch 兜底。
      var betterSidebar;
      try {
        betterSidebar = ctx.betterSidebar || (ctx.get ? ctx.get("betterSidebar") : undefined);
      } catch {
        betterSidebar = undefined;
      }
      var hasBs = !!(betterSidebar && betterSidebar.registerTab);
      if (hasBs) {
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
        } catch (e) { /* better-sidebar 注册失败时静默（插件无其他 UI 入口） */ }
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
    }

    exports.apply = apply;
    exports.inject = ["sessions", "slots", "betterSidebar"];
    return module.exports;
  }
});
