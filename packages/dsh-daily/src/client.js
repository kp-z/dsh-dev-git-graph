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

      /**
       * 打开外部链接的**回执方**。
       *
       * 插件页面跑在侧边栏的 iframe 里，它的 `window.open` 可能被宿主拦下（返回 null）。
       * 而这一半跑在 DSH 应用主窗口，在这里发起打开更可能被接受 ——
       * 所以页面那边失败后会 postMessage 过来，由这里再试一次，并把结果回执回去。
       * 回执很关键：页面据此决定是否展示"没能自动打开"的兜底提示，
       * 而不是让用户面对一次毫无反馈的死点击。
       */
      function handleOpenRequest(event) {
        var data = event && event.data;
        if (!data || typeof data !== "object" || data.type !== "dsh-daily-open") return;
        var url = typeof data.url === "string" ? data.url : "";
        // 只接受 http(s)，别成了任意协议的执行入口
        if (!/^https?:\/\//i.test(url)) return;

        var reply = function (type) {
          try {
            if (event.source && event.source.postMessage) {
              event.source.postMessage({ type: type, url: url }, "*");
            }
          } catch (e) {
            /* 忽略 */
          }
        };

        var win = null;
        try {
          win = window.open(url, "_blank", "noopener,noreferrer");
        } catch (e) {
          win = null;
        }
        if (win) {
          reply("dsh-daily-open-ok");
          return;
        }
        // 再退一步：原生 <a target="_blank"> 的激活路径与 window.open 不完全等价
        try {
          var a = document.createElement("a");
          a.href = url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          document.body.appendChild(a);
          a.click();
          a.remove();
          reply("dsh-daily-open-ok");
        } catch (e) {
          reply("dsh-daily-open-failed");
        }
      }

      React.useEffect(function () {
        var frame = frameRef.current;
        var push = function () { postTheme(frame); };
        window.addEventListener("message", handleOpenRequest);

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
          window.removeEventListener("message", handleOpenRequest);
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
    exports.inject = ['@deepseek-ai/dsh-client-ui-slots', 'dsh-better-sidebar'];
    return module.exports;
  },
});
