window.__ModuleLoader__.load({
  id: "dsh-daily",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    // ============ dsh-daily client：右侧栏「日报」tab ============
    // 渲染形态：host 路由 /dsh-daily/ 下的静态页，用 iframe 载入。
    //
    // 为什么是 iframe 而不是原生 React 组件：
    // 日报页面本身就是个完整的列表应用（筛选 / 搜索 / 反馈 / 调教输入 / 视频卡），
    // 而且是 host 直出的静态资源、零构建步骤。把它重写成宿主组件树，
    // 换来的只是"更原生"的观感，代价是要维护第二套渲染器 —— 而第二套一定会和
    // host 侧的接口契约漂移。这里只做桥：给 iframe 挂主题与尺寸，别的不插手。
    //
    // 主题两条路都要走：?theme= 管首屏（不闪），postMessage 管之后的明暗切换。
    // 若把 theme 放进 src 并随主题重算，切一次明暗整页会重载，筛选状态和滚动位置全丢。

    var THEME_MSG = "dsh-daily-theme";

    function isDark() {
      return !!(document.body && document.body.hasAttribute("data-ds-dark-theme"));
    }

    function themeName() {
      return isDark() ? "dark" : "light";
    }

    function entryUrl() {
      return "/dsh-daily/?embed=1&theme=" + themeName();
    }

    function postTheme(frame) {
      if (!frame || !frame.contentWindow) return;
      try {
        // 同源（都从宿主出），但仍写明确 target origin，别用 "*"
        frame.contentWindow.postMessage(
          { type: THEME_MSG, theme: themeName() },
          window.location.origin
        );
      } catch (e) {
        /* 未加载完时忽略 */
      }
    }

    function DailyView() {
      var frameRef = React.useRef(null);
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
          // 缓存命中时不会再触发 load，补推一次
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
        { className: "dsh-daily-root" },
        React.createElement("iframe", {
          ref: frameRef,
          className: "dsh-daily-frame",
          src: urlRef.current,
          title: "日报",
        })
      );
    }

    function ensureStyle() {
      if (document.getElementById("dsh-daily-style")) return;
      var st = document.createElement("style");
      st.id = "dsh-daily-style";
      st.textContent = [
        ".dsh-daily-root{box-sizing:border-box;width:100%;height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base)}",
        ".dsh-daily-frame{flex:1;border:none;width:100%;min-height:0}",
      ].join("\n");
      document.head.appendChild(st);
    }

    function DailyIcon(size) {
      // 一张报纸：外框 + 头条横线 + 两栏短线
      var s = size || 16;
      return React.createElement(
        "svg",
        {
          width: s, height: s, viewBox: "0 0 16 16",
          fill: "none", stroke: "currentColor", strokeWidth: "1.3",
          strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
        },
        React.createElement("rect", { x: "2", y: "3", width: "12", height: "10", rx: "1.5" }),
        React.createElement("path", { d: "M4.5 6h7" }),
        React.createElement("path", { d: "M4.5 8.6h3.2" }),
        React.createElement("path", { d: "M4.5 10.8h3.2" }),
        React.createElement("path", { d: "M9.6 8.6h1.9v2.2H9.6z" })
      );
    }

    function apply(ctx) {
      ensureStyle();

      var betterSidebar;
      try {
        betterSidebar = ctx.betterSidebar || (ctx.get ? ctx.get("betterSidebar") : undefined);
      } catch (e) {
        betterSidebar = undefined;
      }

      if (betterSidebar && betterSidebar.registerTab) {
        try {
          var disposeTab = betterSidebar.registerTab({
            id: "daily",
            title: function () { return "日报"; },
            icon: DailyIcon,
            order: 27,
            single: true,
            component: function () {
              return React.createElement(DailyView, null);
            },
          });
          if (ctx.effect) ctx.effect(function () { return disposeTab; });
        } catch (e) { /* 注册失败静默：本插件没有别的入口 */ }
      }

      // 也让日报能进分屏窗格（分屏比侧边栏宽得多，看视频卡更舒服）
      var slots = ctx.slots || (ctx.get ? ctx.get("slots") : undefined);
      if (slots && slots.inject && slots.register) {
        slots.inject("tabsplit.pane", function () {
          return slots.register(
            { name: "tabsplit.pane", id: "daily-pane", order: 22, label: function () { return "日报"; } },
            function () { return React.createElement(DailyView, null); }
          );
        });
      }
    }

    exports.apply = apply;
    exports.inject = ["slots", "betterSidebar"];
    return module.exports;
  },
});
