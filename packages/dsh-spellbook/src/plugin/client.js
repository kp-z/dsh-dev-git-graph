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

    // ============ 应用到对话 ============
    //
    // 站点（iframe 里那半边）够不着对话的输入框 —— 能碰到它的只有这里，
    // 因为 composer 槽位的 props 里才有 inputActions。所以这条路上有两个端点：
    //
    //   站点 → 这里   {type:'spellbook:apply', requestId, prompt, mode}
    //   这里 → 站点   {type:'spellbook:apply-result', requestId, ok, reason?}
    //
    // 回执是必须的：插入被拒在这个系统里是**常规**分支（草稿版本变了、正在提交、
    // 压根没有会话），而这些都不该让站点那侧的按钮假装成功。
    //
    // 下面这两个模块级变量，就是侧边栏 tab 与 composer 槽位之间的那条通道 ——
    // 两者注册在树上两个互不相干的位置，却跑在同一个模块实例里。
    // 这是本功能唯一一处隐式耦合，所以单独写清楚：
    //   spellbookFrame  侧边栏那个 iframe 的 window（用来认消息来源）
    //   composerSinks   由 composer 槽位挂上来的「把文本放进输入框」的能力，**是个栈**
    var spellbookFrame = null;
    var composerSinks = [];

    /**
     * 为什么是栈不是单个变量：这个槽位是 session 作用域的，分屏或同时开着两个
     * 会话时会各挂一个实例。用栈就是「谁在最后谁说话」—— 而切会话时 actions
     * 变了、effect 重跑，那一个会被重新推到栈顶，正好就是当前该说话的那个。
     *
     * 单个变量试过，坏在卸载上：两个实例都在时，任何一个卸载都会把 sink 置空，
     * 而另一个明明还活着 —— 表现是「点应用回『没有会话』，可会话就开着」。
     */
    function currentSink() {
      return composerSinks.length ? composerSinks[composerSinks.length - 1] : null;
    }

    var APPLY_MSG = "spellbook:apply";
    var APPLY_RESULT_MSG = "spellbook:apply-result";

    function replyToFrame(payload) {
      if (!spellbookFrame) return;
      try {
        spellbookFrame.postMessage(payload, window.location.origin);
      } catch (e) {
        // 窗口没了就算了：站点那边每条请求都有超时兜底，
        // 不会因为这一条回执丢了就一直转圈。
      }
    }

    function handleApplyMessage(event) {
      var data = event && event.data;
      if (!data || data.type !== APPLY_MSG) return;

      // 三重校验，缺一不可：
      //   1. 来源必须是侧边栏那个 iframe。宿主页面上还嵌着 300 多个预览文档，
      //      它们同样同源、同样能 postMessage，不能听错人。
      //   2. 原点必须是本站。
      //   3. 载荷形状必须对。「同源」不等于「可信」—— 站点里一个坏掉的脚本
      //      照样能发出形状不对的消息；形状不对就直接拒，不猜、不兜底。
      if (!spellbookFrame || event.source !== spellbookFrame) return;
      if (event.origin !== window.location.origin) return;

      var requestId = typeof data.requestId === "string" ? data.requestId : "";
      var mode = data.mode === "send" ? "send" : "insert";

      if (!requestId || typeof data.prompt !== "string" || !data.prompt) {
        replyToFrame({
          type: APPLY_RESULT_MSG, requestId: requestId, ok: false, reason: "bad-request"
        });
        return;
      }

      var sink = currentSink();
      if (!sink) {
        // 没有会话，或者输入框还没挂载。这是正常情况，不是错误 ——
        // 照实回话，别静默，也别假装成功。
        replyToFrame({
          type: APPLY_RESULT_MSG, requestId: requestId, ok: false, reason: "no-sink"
        });
        return;
      }

      var ok = false;
      try {
        ok = !!sink(data.prompt, mode);
      } catch (e) {
        ok = false;
      }
      replyToFrame({
        type: APPLY_RESULT_MSG,
        requestId: requestId,
        ok: ok,
        reason: ok ? undefined : "rejected"
      });
    }

    /**
     * composer 左侧槽位。它**不画任何东西**，存在的唯一理由是：
     * 这个槽位的 standard props 里有 inputActions，而那是唯一能把文本
     * 放进输入框的门。
     *
     * 为什么不在这里画个按钮：真正的入口在侧边栏里 —— 那里能翻、能搜、
     * 能看活预览。在输入框旁边再摆一个，等于把同一件事做成两个入口，
     * 而那个入口只能列出一串 slug，看不了东西。
     */
    function SpellbookComposerSeat(props) {
      var actions = props && props.inputActions;

      React.useEffect(function () {
        if (!actions) return undefined;

        var mine = function (text, mode) {
          // insertText 是「一次可撤销的纯文本编辑」，但**只在草稿版本没变、
          // 且编辑器允许编辑时**才生效，否则返回 false。捕获与插入之间理论上
          // 没有别人动草稿的机会，但这是理论：用户可能正在用输入法，
          // 上一次提交也可能还在飞。所以失败就重取一次新鲜的 span 再试，
          // 仍失败才算真被拒 —— 一次就放弃会让「点了没反应」变成常态。
          for (var attempt = 0; attempt < 2; attempt++) {
            var span = actions.captureInsertion();
            if (actions.insertText(text, span)) {
              if (mode === "send") actions.submit();
              return true;
            }
          }
          return false;
        };
        composerSinks.push(mine);

        return function () {
          // 只摘掉**自己的**那一个。
          //
          // 两个实例都在时，先挂的那个一旦被卸载，若无条件清空就会把另一个
          // 还活着的实例一并抹掉 —— 表现是「侧边栏点应用，回没有会话」，
          // 而那个会话明明开着。spellbookFrame 那边有同一条判据，别只写一半。
          var at = composerSinks.indexOf(mine);
          if (at !== -1) composerSinks.splice(at, 1);
        };
      }, [actions]);

      return null;
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
          // 记下这个 iframe 的 window：「应用到对话」那条路靠它认消息来源。
          // 同一个 iframe 里再跳页（目录 → 条目页）也是同一个 WindowProxy，
          // 所以这个引用不会因为站内导航而失效。
          spellbookFrame = frame.contentWindow;
          frame.addEventListener("load", push);
          // 已经载好了（缓存命中）就不会再有 load，补推一次
          try {
            if (frame.contentDocument && frame.contentDocument.readyState === "complete") push();
          } catch (e) { /* 忽略 */ }
        }
        return function () {
          obs.disconnect();
          if (frame) {
            frame.removeEventListener("load", push);
            if (spellbookFrame === frame.contentWindow) spellbookFrame = null;
          }
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

      // composer 左侧那个不画东西的槽位：只为拿到 inputActions。
      // 它注册失败是**有可见后果**的（「应用」会一直回「没有会话」），
      // 所以这里不照搬上面那个静默 catch —— 至少留一条 warn 给人查。
      if (slots && slots.inject && slots.register) {
        try {
          slots.inject("conversation.input.left", function () {
            return slots.register(
              { name: "conversation.input.left", id: "spellbook-apply-seat", order: 30 },
              SpellbookComposerSeat
            );
          });
        } catch (e) {
          console.warn("[dsh-spellbook] composer 槽位没挂上，「应用到对话」会一直回「没有会话」", e);
        }
      }

      // 站点发来的应用请求。监听器只有这一个，所以放在 apply 里注册一次，
      // 随插件一起 dispose —— 装在组件里会随挂载次数越挂越多。
      window.addEventListener("message", handleApplyMessage);
      if (ctx.effect) {
        ctx.effect(function () {
          return function () {
            window.removeEventListener("message", handleApplyMessage);
            spellbookFrame = null;
            composerSinks = [];
          };
        });
      }
    }

    exports.apply = apply;
    exports.inject = ["slots", "betterSidebar"];
    return module.exports;
  },
});
