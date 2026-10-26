/* ============================================================
   飞书同步 · 客户端半体

   这一半只干一件事：在右侧栏开一个「飞书」页签，页签里嵌宿主路由
   `/dsh-feishu/panel`。面板本身是 self-contained HTML（宿主半体直出），
   所以这里不碰 React 状态机，只负责把 iframe 挂对、把主题传进去。

   ## 为什么走 `betterSidebar.registerTab`，而不是 `sidebarRightTabs`

   这个 profile 的右侧栏是 `dsh-better-sidebar` 提供的，它自己的服务名是
   `betterSidebar`，`registerTab({id,title,icon,order,single,component})` 是它
   真正消费的注册口（`dsh-daily` 走的就是这条）。官方 `sidebarRightTabs`
   在部分组合里根本不在客户端模块图里——注册会静默失败，页签永远不出现。

   ## 三条防御（都是踩过的坑）

   1. **不在 inject 里死等**：better-sidebar 自身激活可能晚于本插件，所以留空
      `inject`，自己轮询 `betterSidebar`（约 10 秒后放弃），服务一到 tab 就出现。
   2. **取服务必须 try/catch**：cordis 里访问未声明的服务会直接抛，
      而 apply 里抛异常不是「功能坏了」，是整条 boot 失败、界面变成错误页。
   3. **apply 整体再包一层 try/catch**：任何可选能力失败都不许拖垮宿主。
   ============================================================ */
window.__ModuleLoader__.load({
  id: "dsh-feishu",
  factory: (require) => {
    var module = { exports: {} };
    var React = require("react");
    var h = React.createElement;

    var TAB = "feishu";
    var PANEL_URL = "/dsh-feishu/panel";

    var CSS = [
      ".dfe-wrap{display:flex;flex-direction:column;width:100%;height:100%;min-height:0}",
      ".dfe-frame{flex:1;min-height:0;width:100%;border:0;background:transparent;display:block}"
    ].join("");

    function installStyles() {
      if (document.getElementById("dsh-feishu-style")) return;
      var style = document.createElement("style");
      style.id = "dsh-feishu-style";
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    /* tab 图标：一只朝前的纸飞机（14px 下比云雀更认得出）。 */
    function FeishuIcon() {
      return h("svg", {
        width: 14, height: 14, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: 1.4,
        strokeLinecap: "round", strokeLinejoin: "round"
      },
        h("path", { d: "M14 2 7 9" }),
        h("path", { d: "M14 2l-4.2 12-2.8-5-5-2.8L14 2z" }));
    }

    function isDark() {
      try {
        if (document.body.classList.contains("dark")) return true;
        var scheme = getComputedStyle(document.documentElement).colorScheme || "";
        return scheme.indexOf("dark") !== -1;
      } catch (e) { return false; }
    }

    /**
     * 当前会话 id 藏在哪，取决于右侧栏实现：
     *   - 官方 sidebar-right：props.sessionId
     *   - better-sidebar：props.scope.sessionId（TabContent 把 {ctx,store,scope,tab,...} 传进来）
     * 两处都读，拿不到就是空字符串（面板会显示「未识别当前会话」）。
     */
    function sessionIdOf(props) {
      if (!props) return "";
      var candidates = [
        props.sessionId,
        props.scope && props.scope.sessionId,
        props.tab && props.tab.sessionId,
        props.tab && props.tab.scope && props.tab.scope.sessionId
      ];
      for (var i = 0; i < candidates.length; i++) {
        if (typeof candidates[i] === "string" && candidates[i]) return candidates[i];
      }
      return "";
    }

    /* 页签内容：一个铺满的 iframe。宿主切换主题时把深浅色再推一次。 */
    function FeishuPanel(props) {
      var state = React.useState(0);
      var tick = state[0], setTick = state[1];
      var frameRef = React.useRef(null);
      var currentSessionId = sessionIdOf(props);

      React.useEffect(function () {
        var observer = new MutationObserver(function () { setTick(function (n) { return n + 1; }); });
        try {
          observer.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
          observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
        } catch (e) {}
        return function () { observer.disconnect(); };
      }, []);

      /* 面板要知道「当前是哪条会话」，才能提供「绑定到当前会话」。 */
      var pushContext = React.useCallback(function () {
        lastSessionId = currentSessionId;
        var frame = frameRef.current;
        if (!frame || !frame.contentWindow) return;
        try {
          frame.contentWindow.postMessage({ type: "dsh-feishu:context", sessionId: currentSessionId }, "*");
        } catch (e) {}
      }, [currentSessionId]);

      React.useEffect(function () {
        var frame = frameRef.current;
        if (!frame) return;
        try {
          frame.contentWindow.postMessage({ type: "dsh-feishu:theme", dark: isDark() }, "*");
          pushContext();
        } catch (e) {}
      }, [tick, pushContext]);

      return h("iframe", {
        ref: frameRef,
        className: "dfe-frame",
        src: isDark() ? PANEL_URL + "?theme=dark" : PANEL_URL,
        title: "飞书同步",
        onLoad: pushContext
      });
    }

    /**
     * 取可选服务。两段必须分开 try：
     * `ctx.xxx` 在没写进 inject 时会抛「cannot get property ... without inject」，
     * 以前的写法一抛就整体 catch 掉了，连 `ctx.get(name)` 都不会再试。
     */
    function safeService(ctx, name) {
      if (!ctx) return undefined;
      try {
        if (ctx[name]) return ctx[name];
      } catch (e) {
        /* 没有 inject 权限，走下面的 ctx.get */
      }
      try {
        return typeof ctx.get === "function" ? ctx.get(name) : undefined;
      } catch (e) {
        return undefined;
      }
    }

    /* betterSidebar 可能比本插件晚激活：轮询等到服务出现再注册，约 10 秒后放弃。 */
    function waitForSidebar(ctx, done) {
      var tries = 0;
      function attempt() {
        var service = safeService(ctx, "betterSidebar");
        if (service && service.registerTab) { done(service); return; }
        if (++tries >= 40) return;
        setTimeout(attempt, 250);
      }
      attempt();
    }

    /* 最近一次已知的会话 id：面板主动索取上下文时用它回填。 */
    var lastSessionId = "";

    /** 读回宿主当前选中的会话；读不到就返回空串（表示「无法核对」）。 */
    function currentSelection(ui) {
      try {
        var snap = ui && ui.selection && typeof ui.selection.getSnapshot === "function"
          ? ui.selection.getSnapshot()
          : null;
        if (snap && typeof snap.sessionId === "string") return snap.sessionId;
      } catch (e) {
        /* 读不到就算了 */
      }
      return "";
    }

    /** 等一帧再核对：openSession 可能异步落库，立刻读会读到旧值。 */
    function verifyOpened(ui, wanted, reply) {
      if (!ui || !ui.selection) {
        reply(true, "");
        return;
      }
      var settle = typeof setTimeout === "function" ? setTimeout : null;
      var check = function () {
        var actual = currentSelection(ui);
        if (!actual) reply(true, "");
        else if (actual === wanted) reply(true, "");
        else reply(false, "宿主实际切到了 " + actual + "，不是 " + wanted);
      };
      if (settle) settle(check, 200);
      else check();
    }

    /* 面板发来的「打开会话」：交给宿主的 uiWorkspace.openSession。 */
    function installSessionBridge(ctx) {
      function onMessage(event) {
        try {
          if (event.origin && window.location.origin && event.origin !== window.location.origin) return;
          var data = event.data;
          if (!data) return;
          /* 面板刚加载完可能错过了首帧推送，允许它主动要一次。 */
          if (data.type === "dsh-feishu:request-context") {
            var frame = document.querySelector("iframe.dfe-frame");
            try {
              frame && frame.contentWindow && frame.contentWindow.postMessage(
                { type: "dsh-feishu:context", sessionId: lastSessionId }, "*");
            } catch (e) {}
            return;
          }
          if (data.type !== "dsh-feishu:open-session") return;
          var sessionId = typeof data.sessionId === "string" ? data.sessionId : "";
          if (!sessionId) return;
          /* 回执发给「发消息的那个窗口」，而不是重新 query 一个 iframe：
             面板未必带 dfe-frame 这个 class，重新查会查空，回执就静默丢了——
             面板于是永远等不到结果，用户只看到「没反应」。 */
          var source = event.source;
          function reply(ok, reason) {
            try {
              var target = source;
              if (!target) {
                var frame = typeof document !== "undefined" && document.querySelector
                  ? document.querySelector("iframe.dfe-frame")
                  : null;
                target = frame && frame.contentWindow;
              }
              target && target.postMessage(
                { type: "dsh-feishu:open-session-result", sessionId: sessionId, ok: ok, reason: reason || "" },
                "*",
              );
            } catch (e) {
              /* 回执失败不影响跳转 */
            }
          }
          var ui = safeService(ctx, "uiWorkspace");
          if (!ui) {
            reply(false, "宿主没有 uiWorkspace 服务");
            return;
          }
          if (typeof ui.openSession !== "function") {
            reply(false, "uiWorkspace 没有 openSession 方法");
            return;
          }
          try {
            ui.openSession(sessionId);
            /* openSession 是「尽力而为」的：宿主解析不到这条会话时不一定抛错，
               而是把主视图切到它以为对的那条上——表现就是「点了 A 跳到 B」。
               所以这里读回宿主真正的选择，和目标不一致就把真相报回面板，
               别让用户以为按钮没反应。 */
            verifyOpened(ui, sessionId, reply);
          } catch (error) {
            reply(false, error && error.message ? error.message : String(error));
          }
        } catch (e) {
          /* 跳转失败不该影响面板本身 */
        }
      }
      window.addEventListener("message", onMessage);
      if (ctx.effect) ctx.effect(function () {
        return function () { window.removeEventListener("message", onMessage); };
      });
    }

    function applyInner(ctx) {
      installStyles();
      installSessionBridge(ctx);
      waitForSidebar(ctx, function (betterSidebar) {
        try {
          var disposeTab = betterSidebar.registerTab({
            id: TAB,
            title: function () { return "飞书"; },
            icon: FeishuIcon,
            order: 72,
            single: true,
            component: FeishuPanel
          });
          if (ctx.effect) ctx.effect(function () { return disposeTab; });
        } catch (e) {
          /* 注册失败静默：本插件没有别的入口，但也不能因此炸掉宿主 */
        }
      });
    }

    function apply(ctx) {
      try {
        applyInner(ctx);
      } catch (e) {
        try {
          if (typeof console !== "undefined" && console.warn) {
            console.warn("[dsh-feishu] 客户端半体初始化失败，已忽略（不影响宿主启动）：", e);
          }
        } catch (_) { /* 连 console 都没有就只能静默 */ }
      }
    }

    /* 与 dsh-daily 一致：短名声明用到的客户端服务，同时保留 waitForSidebar 兜底。 */
    module.exports = { name: "dsh-feishu", inject: ["slots", "betterSidebar"], apply: apply };
    return module.exports;
  }
});
