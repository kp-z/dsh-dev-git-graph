/* ============================================================
   协议管家 · 客户端

   这一半刻意做得极薄：它只干一件事——在右侧栏里开一个页签，页签内容是宿主路由
   `/dsh-contract-butler/panel`。

   为什么不把面板直接写成宿主组件：面板要画树、卡片、时光轴和实时流，形态跟宿主现有组件
   差得远，硬塞进宿主的渲染树只会两边都别扭；而 iframe 里的面板可以用 curl 看、可以在浏览器
   里单独调、可以独立迭代，不必跟着宿主的组件契约走。代价是主题要自己同步一次。

   **页签必须注册两样东西**（原先只做了第二样，于是界面上什么都没有）：
   1. `sidebarRightTabs.register({id, kind, title, guide})` —— 注册"页签类型"本身。
      侧栏的页签条与"添加页签"列表都认这个注册；`guide` 就是列表里的那一条。
   2. `slots.register({name: 'sidebar.right.pane.tab', key: id}, Component)` —— 注册页签内容，
      key 必须与页签类型的 id 一致，否则侧栏找不到内容。
   `sidebarRightTabs` 由宿主的 `@deepseek-ai/dsh-client-ui-sidebar-right` 提供。
   ============================================================ */
window.__ModuleLoader__.load({
  id: "dsh-contract-butler",
  factory: (require) => {
    var module = { exports: {} };
    var React = require("react");
    var h = React.createElement;

    var TAB = "dsh-contract-butler";
    var KIND = "contract-butler";
    var SLOT = "sidebar.right.pane.tab";
    var PANEL_URL = "/dsh-contract-butler/panel";

    var CSS = [
      ".dcb-wrap{display:flex;flex-direction:column;width:100%;height:100%;min-height:0}",
      ".dcb-bar{flex:none;display:flex;align-items:center;gap:8px;padding:6px 10px;",
      "border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(128,128,140,.22));",
      "font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a8a92)}",
      ".dcb-bar a{color:inherit;text-decoration:none;margin-left:auto;",
      "border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,140,.22));",
      "border-radius:999px;padding:2px 8px}",
      ".dcb-frame{flex:1;min-height:0;width:100%;border:0;background:transparent;display:block}"
    ].join("");

    function installStyles() {
      if (document.getElementById("dsh-contract-butler-style")) return;
      var style = document.createElement("style");
      style.id = "dsh-contract-butler-style";
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    /* 页签图标：一个简单的对勾方框，表示"契约已核对"。 */
    function Icon() {
      return h("svg", {
        width: 14, height: 14, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: 1.4,
        strokeLinecap: "round", strokeLinejoin: "round"
      },
        h("rect", { x: 2, y: 3, width: 12, height: 10, rx: 2 }),
        h("path", { d: "M5 8.2l2 2 4-4" }));
    }

    /* iframe 里的面板取不到宿主的 CSS 变量，所以把当前是深色还是浅色传进去。 */
    function isDark() {
      try {
        if (document.body.classList.contains("dark")) return true;
        var scheme = getComputedStyle(document.documentElement).colorScheme || "";
        return scheme.indexOf("dark") !== -1;
      } catch (e) { return false; }
    }

    /* apply 拿到的宿主上下文；页签内容要靠它读会话的工作目录。 */
    var hostCtx = null;

    /* 当前会话的工作目录。右侧栏把 sessionId 交给页签内容，会话服务里带 cwd。
       任何一步缺失都只是"没有提示"，不该让面板打不开。 */
    function sessionCwd(sessionId) {
      if (!sessionId || !hostCtx || typeof hostCtx.get !== "function") return "";
      try {
        var sessions = hostCtx.get("sessions");
        var snapshot = sessions && sessions.list && sessions.list.getSnapshot
          ? sessions.list.getSnapshot()
          : null;
        var record = snapshot && snapshot.byId ? snapshot.byId[sessionId] : null;
        return record && record.cwd ? String(record.cwd) : "";
      } catch (e) { return ""; }
    }

    /* 面板 URL：把当前项目带过去，面板一打开就落在你正在干的目录上。 */
    function panelUrl(sessionId) {
      var parts = [];
      var cwd = sessionCwd(sessionId);
      if (cwd) parts.push("cwd=" + encodeURIComponent(cwd));
      if (isDark()) parts.push("theme=dark");
      return parts.length ? PANEL_URL + "?" + parts.join("&") : PANEL_URL;
    }

    function Panel(props) {
      var [tick, setTick] = React.useState(0);
      var frameRef = React.useRef(null);
      React.useEffect(function () {
        // 宿主切主题时，通知面板同步一次。
        var observer = new MutationObserver(function () { setTick(function (n) { return n + 1; }); });
        try {
          observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
        } catch (e) {}
        return function () { observer.disconnect(); };
      }, []);
      React.useEffect(function () {
        var frame = frameRef.current;
        if (!frame) return;
        try {
          frame.contentWindow.postMessage({ type: "dsh-contract-butler:theme", dark: isDark() }, "*");
        } catch (e) {}
      }, [tick]);

      // 右侧栏把当前会话交给页签内容，于是面板能知道"当前项目"是哪个。
      var src = panelUrl(props && props.sessionId);
      return h("div", { className: "dcb-wrap" },
        h("div", { className: "dcb-bar" },
          h("span", null, "契约在这里被盯着"),
          h("a", { href: PANEL_URL, target: "_blank", rel: "noreferrer" }, "在新窗口打开")),
        h("iframe", {
          ref: frameRef,
          className: "dcb-frame",
          src: src,
          title: "协议管家",
          allow: "clipboard-write"
        }));
    }

    function apply(ctx) {
      installStyles();
      hostCtx = ctx;
      var disposers = [];

      // 一、页签类型本身。侧栏的页签条与"添加页签"列表都认这个注册。
      try {
        var tabs = ctx.get("sidebarRightTabs");
        if (tabs && typeof tabs.register === "function") {
          disposers.push(tabs.register({
            id: TAB,
            kind: KIND,
            title: function () { return "契约"; },
            guide: [{
              order: 60,
              title: function () { return "契约"; },
              description: function () { return "看契约变了什么、现在对不对"; },
              icon: Icon
            }]
          }));
        }
      } catch (e) {
        // 侧栏服务不在（比如换了宿主）不该让整个插件挂掉。
        console.warn("[contract-butler] 注册页签类型失败：", e);
      }

      // 二、页签内容，key 必须与页签 id 一致。
      try {
        var slots = ctx.get("slots");
        if (slots && typeof slots.inject === "function") {
          disposers.push(slots.inject(SLOT, function () {
            return slots.register({ name: SLOT, key: TAB }, Panel);
          }));
        }
      } catch (e) {
        console.warn("[contract-butler] 注册页签内容失败：", e);
      }

      ctx.effect(function () {
        return function () {
          for (var i = 0; i < disposers.length; i++) {
            if (typeof disposers[i] === "function") disposers[i]();
          }
          var style = document.getElementById("dsh-contract-butler-style");
          if (style) style.remove();
        };
      });
    }

    module.exports = { name: "contract-butler", inject: ["slots", "sidebarRightTabs"], apply: apply };
    return module.exports;
  }
});
