/**
 * 模块 id **必须等于 package.json 的 `name`**（构建时由 copy-assets.mjs 注入）。
 *
 * 这个坑极隐蔽，值得写下来：DSH 组装客户端模块清单时用的是**包名**
 * （`window.__DSH_BOOT__.entries[].id` 实测为 `@kpeace/dsh-daily`），
 * 而这里若硬编码成 `dsh-daily`（包还没改名时写下的值），会出现：
 *   客户端 bundle **被正常请求、返回 200**，但 Loader 等的 id 永远等不到它 →
 *   **模块加载了却永不激活**，右侧栏 tab 不出现，而 host 半体一切正常（`/dsh-daily/` 照旧 200）。
 * 因为症状全在"加载契约"上而不在代码里，单测抓不到，只有重启真实 GUI 才暴露。
 * 所以这里不写死：占位符在构建时替换成真实包名，另有一条安装校验兜底。
 */
window.__ModuleLoader__.load({
  id: "__DSH_PACKAGE_NAME__",
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

    /**
     * 取 `betterSidebar` 服务；没就绪时**自己重试**一段时间再放弃。
     *
     * 为什么不靠 `exports.inject` 保证顺序：实测 `dsh-better-sidebar@0.25.0` 自身的 inject 里列了
     * `@deepseek-ai/dsh-client-ui-slots`，而那个模块**根本不在 dsh 0.2.0-rc.2 的客户端模块图里**
     * —— 于是 better-sidebar 自己永不激活、服务永不提供。谁若 `inject: ['dsh-better-sidebar']`，
     * 就会跟着一起永远等下去（症状极具迷惑性：bundle 正常 200，模块却完全不执行）。
     * 所以 inject 留空、改由这里轮询：服务什么时候来，tab 就什么时候出现；
     * 宿主没装 better-sidebar 时也只是安静地不注册 tab，页面本职功能不受影响。
     */
    function waitForSidebar(ctx, done) {
      var tries = 0;
      function attempt() {
        var service = safeService(ctx, "betterSidebar");
        if (service && service.registerTab) { done(service); return; }
        if (++tries >= 40) return;            // 约 10 秒后放弃：不打扰宿主，也不刷日志
        setTimeout(attempt, 250);
      }
      attempt();
    }

    /**
     * 安全取客户端服务。
     *
     * **必须用 try/catch 包住**：cordis 里访问一个**未在 `exports.inject` 里声明**的服务会
     * 直接抛（`cannot get property "X" without inject`）。而 `apply()` 里抛异常不是"功能坏了"，
     * 是**整条 boot 挂掉**（条目 fiber 变成 failed，宿主 GUI 被错误页替掉）。
     *
     * 这个坑我踩得很实：本文件里 `betterSidebar` 的取值一直有 try/catch，
     * 而 `slots` 那处漏了 —— 就这一处漏，把用户的界面打成了错误页。
     */
    function safeService(ctx, name) {
      try {
        if (ctx && ctx[name]) return ctx[name];
        return ctx && ctx.get ? ctx.get(name) : undefined;
      } catch (e) {
        return undefined;
      }
    }

    /**
     * `apply()` **整体再包一层** try/catch。
     *
     * 这是最后一道防线，也是本插件最重要的一条结构约定：
     * 本插件的任何可选能力（右侧栏 tab、分屏窗格）失败，都**绝不允许**拖垮宿主启动。
     * 单独给每个服务取值加保护仍然可能漏掉（上一版就漏了一处）；
     * 有了这一层，即使将来再加代码忘了保护，最坏结果也只是"日报入口不出现"，
     * 而不是"用户打不开 DSH"。
     */
    function apply(ctx) {
      try {
        applyInner(ctx);
      } catch (e) {
        try {
          // 不复用 logger（它本身也可能不可用），只在 console 留一行便于排查
          if (typeof console !== "undefined" && console.warn) {
            console.warn("[dsh-daily] 客户端半体初始化失败，已忽略（不影响宿主启动）：", e);
          }
        } catch (_) { /* 连 console 都没有就只能静默 */ }
      }
    }

    function applyInner(ctx) {
      ensureStyle();

      waitForSidebar(ctx, function (betterSidebar) {
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
      });

      // 也让日报能进分屏窗格（分屏比侧边栏宽得多，看视频卡更舒服）
      var slots = safeService(ctx, "slots");
      if (slots && slots.inject && slots.register) {
        try {
          slots.inject("tabsplit.pane", function () {
            return slots.register(
              { name: "tabsplit.pane", id: "daily-pane", order: 22, label: function () { return "日报"; } },
              function () { return React.createElement(DailyView, null); }
            );
          });
        } catch (e) { /* 分屏入口失败静默：侧边栏 tab 仍可用 */ }
      }
    }

    exports.apply = apply;
    // **必须声明用到的服务**，否则访问它们就是非法的（会抛，见 safeService 注释）。
    // 服务名用短名（与 dsh-dev-git-graph 的 ['sessions','slots','betterSidebar'] 一致）。
    exports.inject = ["slots", "betterSidebar"];
    return module.exports;
  },
});
