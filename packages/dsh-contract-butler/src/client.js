/* ============================================================
   协议管家 · 客户端

   这一半刻意做得极薄：它只干一件事——在右侧栏里开一个页签，页签内容是一个指向宿主路由
   `/dsh-contract-butler/panel` 的 iframe。

   为什么不把面板直接写成宿主组件：面板要画树、卡片、时光轴和实时流，形态跟宿主现有组件
   差得远，硬塞进宿主的渲染树只会两边都别扭；而 iframe 里的面板可以用 curl 看、可以在浏览器
   里单独调、可以独立迭代，不必跟着宿主的组件契约走。代价是主题要自己同步一次。
   ============================================================ */
window.__ModuleLoader__.load({
  id: "dsh-contract-butler",
  factory: (require) => {
    var module = { exports: {} };
    var React = require("react");
    var h = React.createElement;

    var TAB = "dsh-contract-butler";
    var SLOT = "sidebar.right.pane.tab";
    var TITLE_SLOT = "sidebar.right.pane.tab.title";
    var PANEL_URL = "/dsh-contract-butler/panel";

    var CSS = [
      ".dcb-wrap{display:flex;flex-direction:column;width:100%;height:100%;min-height:0}",
      ".dcb-bar{flex:none;display:flex;align-items:center;gap:8px;padding:6px 10px;",
      "border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(128,128,140,.22));",
      "font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a8a92)}",
      ".dcb-bar a{color:inherit;text-decoration:none;margin-left:auto;",
      "border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,140,.22));",
      "border-radius:999px;padding:2px 8px}",
      ".dcb-frame{flex:1;min-height:0;width:100%;border:0;background:transparent;display:block}",
      ".dcb-tab-title{display:inline-flex;align-items:center;gap:5px}"
    ].join("");

    function installStyles() {
      if (document.getElementById("dsh-contract-butler-style")) return;
      var style = document.createElement("style");
      style.id = "dsh-contract-butler-style";
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    /* iframe 里的面板取不到宿主的 CSS 变量，所以把当前是深色还是浅色传进去。 */
    function isDark() {
      try {
        if (document.body.classList.contains("dark")) return true;
        var scheme = getComputedStyle(document.documentElement).colorScheme || "";
        return scheme.indexOf("dark") !== -1;
      } catch (e) { return false; }
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

      var src = PANEL_URL + (isDark() ? "?theme=dark" : "");
      void props;
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

    function Title() {
      return h("span", { className: "dcb-tab-title" }, "契约");
    }

    function apply(ctx) {
      installStyles();
      var slots = null;
      try { slots = ctx.get("slots"); } catch (e) {}
      if (!slots || typeof slots.inject !== "function") return;
      var disposers = [];
      disposers.push(slots.inject(SLOT, function () {
        return slots.register({ name: SLOT, key: TAB }, Panel);
      }));
      disposers.push(slots.inject(TITLE_SLOT, function () {
        return slots.register({ name: TITLE_SLOT, key: TAB }, Title);
      }));
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

    module.exports = { name: "contract-butler", inject: ["slots"], apply: apply };
    return module.exports;
  }
});
