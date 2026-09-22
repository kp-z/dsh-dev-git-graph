window.__ModuleLoader__.load({
  id: "dsh-spellbook",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    // ============ dsh-spellbook client：咒语书 ============
    // 渲染入口：dsh-better-sidebar 右侧栏原生 tab。
    // 内容：宿主路由 /dsh-spellbook/ 下的静态站（构建产物），用 iframe 载入。
    //
    // 为什么是 iframe 而不是把站点重写成 React 组件：
    // 咒语书自己已经是一套完整的站点，而它的每个条目都带一个**真在跑**的预览
    // （独立文档，靠 sandbox iframe 隔离）。把站点塞进宿主组件树要重写渲染与预览两套
    // 东西，还会让那 332 个预览跟宿主页共享文档 —— 那正是它们必须隔离的原因。
    // 这里只做桥：给 iframe 挂上主题与尺寸，别的一概不插手。
    //
    // 主题：宿主明暗经 ?theme= 传进首屏（不闪），之后靠 postMessage 跟。
    //   —— 两条路都要：参数管首屏，消息管切换。

    var THEME_MSG = "dsh-spellbook-theme";

    function isDark() {
      return !!(document.body && document.body.hasAttribute("data-ds-dark-theme"));
    }

    function themeName() {
      return isDark() ? "dark" : "light";
    }

    /** 组装入口 URL。embed=1 让站点收起「书封」那截刊头。 */
    function entryUrl() {
      return "/dsh-spellbook/?embed=1&theme=" + themeName();
    }

    function postTheme(frame) {
      if (!frame || !frame.contentWindow) return;
      try {
        // 同源（都从宿主出），但还是写明确 target origin，别用 "*"
        frame.contentWindow.postMessage(
          { type: THEME_MSG, theme: themeName() },
          window.location.origin
        );
      } catch (e) { /* 未加载完时忽略 */ }
    }

    function SpellbookView() {
      var frameRef = React.useRef(null);
      // URL 只在挂载时算一次：主题变化走 postMessage，不重载 iframe。
      // 若把 theme 放进 URL 并随主题重算 src，切一次明暗整个站点会重载 —— 读到一半的条目就没了。
      var urlRef = React.useRef(null);
      if (urlRef.current === null) urlRef.current = entryUrl();

      React.useEffect(function () {
        var frame = frameRef.current;
        var push = function () { postTheme(frame); };

        var obs = new MutationObserver(function (muts) {
          for (var i = 0; i < muts.length; i++) {
            if (muts[i].type === "attributes" && muts[i].attributeName === "data-ds-dark-theme") push();
          }
        });
        if (document.body) obs.observe(document.body, { attributes: true });

        if (frame) {
          frame.addEventListener("load", push);
          // 已经载好了（缓存命中）就不会再有 load，补推一次
          try {
            if (frame.contentDocument && frame.contentDocument.readyState === "complete") push();
          } catch (e) { /* 忽略 */ }
        }
        return function () {
          obs.disconnect();
          if (frame) frame.removeEventListener("load", push);
        };
      }, []);

      return React.createElement(
        "div",
        { className: "dsh-spellbook-root" },
        React.createElement("iframe", {
          ref: frameRef,
          className: "dsh-spellbook-frame",
          src: urlRef.current,
          title: "咒语书",
          // 这里**故意不加** sandbox 属性。
          //
          // 嵌套 iframe 的 sandbox 标记是往下取并集的：外层若写了 allow-same-origin，
          // 里面那 332 个 `sandbox="allow-scripts"` 的预览文档会一并拿到同源 ——
          // 而它们之所以被关进沙箱，正是为了**拿不到**同源。
          // 不加 sandbox 就是普通的同源 iframe：站点要的同源有了（检索索引、localStorage），
          // 预览文档的隔离也原样保留。
        })
      );
    }

    function ensureStyle() {
      if (document.getElementById("dsh-spellbook-style")) return;
      var st = document.createElement("style");
      st.id = "dsh-spellbook-style";
      st.textContent = [
        ".dsh-spellbook-root{box-sizing:border-box;width:100%;height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base)}",
        ".dsh-spellbook-frame{flex:1;border:none;width:100%;min-height:0}",
      ].join("\n");
      document.head.appendChild(st);
    }

    function apply(ctx) {
      ensureStyle();

      var betterSidebar;
      try {
        betterSidebar = ctx.betterSidebar || (ctx.get ? ctx.get("betterSidebar") : undefined);
      } catch (e) {
        betterSidebar = undefined;
      }
      if (!betterSidebar || !betterSidebar.registerTab) return;

      try {
        var disposeTab = betterSidebar.registerTab({
          id: "spellbook",
          title: function () { return "咒语书"; },
          icon: function (size) {
            // 一本摊开的书：左页 + 右页 + 书脊
            return React.createElement(
              "svg",
              {
                width: size || 16, height: size || 16, viewBox: "0 0 16 16",
                fill: "none", stroke: "currentColor", strokeWidth: "1.3",
                strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
              },
              React.createElement("path", { d: "M8 3.5C6.9 2.8 5.3 2.5 3 2.5v9.2c2.3 0 3.9.3 5 1 1.1-.7 2.7-1 5-1V2.5c-2.3 0-3.9.3-5 1z" }),
              React.createElement("path", { d: "M8 3.5v9.2" })
            );
          },
          order: 26,
          single: true,
          component: function () {
            return React.createElement(SpellbookView, null);
          },
        });
        if (ctx.effect) ctx.effect(function () { return disposeTab; });
      } catch (e) { /* 注册失败时静默：本插件没有别的入口 */ }

      // 也让咒语书能进 dsh-tab-split 的窗格（分屏看时比侧边栏宽得多）
      var slots = ctx.slots || (ctx.get ? ctx.get("slots") : undefined);
      if (slots && slots.inject && slots.register) {
        slots.inject("tabsplit.pane", function () {
          return slots.register(
            { name: "tabsplit.pane", id: "spellbook-pane", order: 21, label: function () { return "咒语书"; } },
            function () { return React.createElement(SpellbookView, null); }
          );
        });
      }
    }

    exports.apply = apply;
    exports.inject = ["slots", "betterSidebar"];
    return module.exports;
  },
});
