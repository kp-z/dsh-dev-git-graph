/**
 * 右侧栏「飞书」页签 + 会话跳转桥（历史实现，保持 iframe）。
 *
 * 为什么这里仍然是 iframe：右边栏那张面板是既有的 self-contained 页面（panel.html，1 万多行），
 * 本轮只重写「左侧栏总览」；总览已经改成宿主页面里的 React 组件，不再走 iframe。
 *
 * 三条防御（都是踩过的坑）：
 *   1. 不在 inject 里死等 betterSidebar——它可能晚于本插件激活，自己轮询（约 10 秒后放弃）；
 *   2. 取服务必须 try/catch：cordis 访问未声明的服务会直接抛；
 *   3. 任何可选能力失败都不许拖垮宿主。
 */

export const TAB_ID = 'feishu';
export const PANEL_URL = '/dsh-feishu/panel';

export function createSidebarHalf({ React, h }) {
  var TAB = "feishu";
  var PANEL_URL = "/dsh-feishu/panel";
  /* 右侧栏页签里就是一个铺满的 iframe（面板 HTML 由宿主直出）。 */
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

  function workspaceContextOf(props) {
    props = props || {};
    var scope = props.scope || {};
    var id = typeof scope.workspaceId === 'string' ? scope.workspaceId : typeof props.workspaceId === 'string' ? props.workspaceId : '';
    var path = [scope.cwd, scope.repoRoot, scope.workspacePath, props.path, props.workspacePath].find(function (value) { return typeof value === 'string' && value; }) || '';
    return { workspaceId: id, workspacePath: path };
  }

  var lastWorkspaceContext = { workspaceId: '', workspacePath: '' };
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
    var sendContext = function (sessionId) {
      lastSessionId = sessionId;
      lastWorkspaceContext = workspaceContextOf(latestProps && latestProps.current || props);
      var frame = frameRef.current;
      if (!frame || !frame.contentWindow) return;
      try {
        frame.contentWindow.postMessage({ type: "dsh-feishu:context", sessionId: sessionId, workspaceId: lastWorkspaceContext.workspaceId, workspacePath: lastWorkspaceContext.workspacePath }, "*");
      } catch (e) {}
    };
    var pushContext = React.useCallback(function () {
      sendContext(currentSessionId);
    }, [currentSessionId]);

    /* 兜底：切换会话时右侧栏不一定换 props（不同实现有缓存/复用），
       这里每秒对一次「props 里的会话 id」，变了就补推；窗口重新获得焦点时也补一次。
       代价是一次字符串比较，换来的是一整类「切了会话卡片还停在旧任务」的 bug 不再出现。 */
    var latestProps = React.useRef(props);
    latestProps.current = props;
    React.useEffect(function () {
      var sync = function () {
        var next = sessionIdOf(latestProps.current);
        var workspace = workspaceContextOf(latestProps.current);
        if (next === lastSessionId && workspace.workspaceId === lastWorkspaceContext.workspaceId && workspace.workspacePath === lastWorkspaceContext.workspacePath) return;
        sendContext(next);
      };
      var timer = setInterval(sync, 1000);
      window.addEventListener("focus", sync);
      document.addEventListener("visibilitychange", sync);
      return function () {
        clearInterval(timer);
        window.removeEventListener("focus", sync);
        document.removeEventListener("visibilitychange", sync);
      };
    }, []);

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
  /* betterSidebar 可能晚于本插件激活：轮询等它出现（约 10 秒放弃）。
     定时器挂在 ctx.effect 上，插件卸载/禁用时立刻停，不留幽灵轮询。 */
  function waitForSidebar(ctx, done) {
    var tries = 0;
    var timer = 0;
    function attempt() {
      var service = safeService(ctx, "betterSidebar");
      if (service && service.registerTab) { done(service); return; }
      if (++tries >= 40) return;
      timer = setTimeout(attempt, 250);
    }
    attempt();
    if (ctx && ctx.effect) ctx.effect(function () { return function () { if (timer) clearTimeout(timer); }; });
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

  /**
   * 等一帧再核对是否真的切过去了。
   *
   * 两道检查：
   * 1. `uiWorkspace.selection` 能读就比 session id（最准）；
   * 2. 读不到 selection 时退回窗口标题：会话名默认 = 任务名，标题对不上说明切到了别处。
   *    这一步只做「对不上就报告」，不做纠正——宿主侧怎么解析是它的事。
   */
  function verifyOpened(ui, wanted, expectedTitle, reply) {
    var settle = typeof setTimeout === "function" ? setTimeout : null;
    var check = function () {
      var actual = currentSelection(ui);
      if (actual) {
        if (actual === wanted) reply(true, "");
        else reply(false, "宿主实际切到了 " + actual + "，不是 " + wanted);
        return;
      }
      var snippet = String(expectedTitle || "").replace(/\s+/g, "").slice(0, 8);
      var docTitle = "";
      try {
        docTitle = typeof document !== "undefined" && document.title ? String(document.title) : "";
      } catch (e) {
        docTitle = "";
      }
      if (!snippet || !docTitle) {
        reply(true, "");
        return;
      }
      var normalized = docTitle.replace(/\s+/g, "");
      if (normalized.indexOf(snippet) !== -1) reply(true, "");
      else reply(false, "窗口标题是「" + docTitle.slice(0, 28) + "」，和这张卡的任务名对不上");
    };
    if (settle) settle(check, 260);
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
              { type: "dsh-feishu:context", sessionId: lastSessionId, workspaceId: lastWorkspaceContext.workspaceId, workspacePath: lastWorkspaceContext.workspacePath }, "*");
          } catch (e) {}
          return;
        }
        if (data.type !== "dsh-feishu:open-session") return;
        var sessionId = typeof data.sessionId === "string" ? data.sessionId : "";
        var expectedTitle = typeof data.expectedTitle === "string" ? data.expectedTitle : "";
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
          verifyOpened(ui, sessionId, expectedTitle, reply);
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


  return {
    workspaceContextOf,
    apply(ctx) {
      installStyles();
      installSessionBridge(ctx);
      waitForSidebar(ctx, function (betterSidebar) {
        try {
          var disposeTab = betterSidebar.registerTab({
            id: TAB_ID,
            title: function () { return "飞书"; },
            icon: FeishuIcon,
            order: 72,
            single: true,
            component: FeishuPanel
          });
          if (ctx.effect) ctx.effect(function () { return disposeTab; });
        } catch (e) {
          /* 注册失败静默：本插件还有总览入口，不能因此炸掉宿主 */
        }
      });
    }
  };
}
