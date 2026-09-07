window.__ModuleLoader__.load({
  id: "dsh-dev-agent-mode",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    // ============ dsh-dev-agent-mode client：左侧对话栏 Agent 模式 ============
    // 目标：把左侧栏从「官方 workspace 浏览器」切换为「拟人化 Agent 视角」——
    //   每个 workspace = 一个 Agent（确定性头像 + 名称 + 路径 + 会话数），
    //   workspace 只是该 Agent 的一个标签（cwd）。
    // 机制：始终注册 sidebar.workspaces 孔位（single，entriesOfSlot()[0] 胜出），
    //   组件内部按模式渲染：agent -> AgentModeBrowser；official -> OfficialBrowser
    //   （行为等价官方 WorkspaceBrowser 的精简实现，保证切回后功能不丢）。
    //   模式开关：sidebar.footer.action list 孔位（优先），DOM 注入兜底。
    // 数据：完全复用官方 hooks（useWorkspaces/useSessions 由 slot 系统注入）。
    // 构建：无打包器，src/client.js 直接拷贝为 lib/client.js（仿 dsh-dev-git-graph）。

    var STORAGE_KEY = "dsh-dev-agent-mode.mode";
    var MODE_OFFICIAL = "official";
    var MODE_AGENT = "agent";
    var ENTRY_ATTR = "data-dsh-agent-mode-entry";

    // ---------- 纯函数：Agent 身份派生（与 src/agent-identity.js 同构） ----------
    function fnv1a(input) {
      var h = 0x811c9dc5;
      for (var i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = (h >>> 0) * 0x01000193;
      }
      return h >>> 0;
    }
    var HUES = [210, 262, 325, 14, 152, 90, 190, 45, 275, 330, 165, 25];
    function hueFor(id) {
      if (typeof id !== "string" || id.length === 0) return HUES[0];
      return HUES[fnv1a(id) % HUES.length];
    }
    function initialFor(title, id) {
      var t = String(title || "");
      var m = t.match(/\S/);
      if (m) return m[0].toUpperCase();
      var i2 = String(id || "").match(/\S/);
      if (i2) return i2[0].toUpperCase();
      return "?";
    }
    function gradientFor(id) {
      var hue = hueFor(id);
      return "linear-gradient(135deg, hsl(" + hue + " 62% 46%), hsl(" + ((hue + 40) % 360) + " 70% 60%))";
    }
    function agentIdentity(id, title) {
      return { hue: hueFor(id), initial: initialFor(title, id), gradient: gradientFor(id) };
    }

    // ---------- 模式存储（localStorage + 内存兜底） ----------
    function normalizeMode(v) {
      return v === MODE_AGENT ? MODE_AGENT : MODE_OFFICIAL;
    }
    function readMode() {
      try {
        var v = window.localStorage.getItem(STORAGE_KEY);
        return normalizeMode(v);
      } catch (e) {
        return MODE_OFFICIAL;
      }
    }
    function writeMode(m) {
      try {
        window.localStorage.setItem(STORAGE_KEY, m);
        return true;
      } catch (e) {
        return false;
      }
    }

    // ---------- 相对时间（官方同款：{n}d / {n}mo / {n}y） ----------
    function relativeTime(ts, now) {
      var diff = Math.max(0, (now || Date.now()) - ts);
      var min = 60 * 1000, hour = 60 * min, day = 24 * hour;
      if (diff < min) return "now";
      if (diff < hour) return Math.floor(diff / min) + "m";
      if (diff < day) return Math.floor(diff / hour) + "h";
      if (diff < 30 * day) return Math.floor(diff / day) + "d";
      if (diff < 365 * day) return Math.floor(diff / (30 * day)) + "mo";
      return Math.floor(diff / (365 * day)) + "y";
    }

    // ---------- 数据提取（复用官方 hooks，含降级） ----------
    // 返回 { items, sessions, current, archived }
    function extractData(props) {
      var useWorkspaces = props.useWorkspaces;
      var useSessions = props.useSessions;
      var ws, ses;
      try {
        ws = useWorkspaces ? useWorkspaces(function (s) { return s; }) : null;
        ses = useSessions ? useSessions(function (s) { return s; }) : null;
      } catch (e) {
        ws = null;
        ses = null;
      }
      var items = (ws && ws.items) || [];
      var byId = (ses && ses.byId) || {};
      var ids = (ses && ses.ids) || [];
      var current = ses ? ses.current : undefined;
      return { items: items, byId: byId, ids: ids, current: current };
    }

    // 过滤出某 workspace 的可见会话（官方语义：subagent 不算、archived 不算、blank 只留当前）
    function visibleMembers(workspace, byId, current, archivedSet) {
      return (workspace.sessionIds || [])
        .map(function (sid) { return byId[sid]; })
        .filter(function (s) {
          if (!s) return false;
          if (s.origin === "subagent") return false;
          if (archivedSet.has(s.id)) return false;
          if (s.blank && s.id !== current) return false;
          return true;
        });
    }

    // ---------- 组件：Agent 模式浏览器（核心） ----------
    function AgentModeBrowser(props) {
      var wide = !!props.wide;
      var data = extractData(props);
      var byId = data.byId, current = data.current;
      var archivedSet = new Set((props.archivedSessionIds) || []);
      var expandedPair = React.useState({});
      var expanded = expandedPair[0];
      var setExpanded = expandedPair[1];

      function toggle(id) {
        setExpanded(function (prev) {
          var next = {};
          for (var k in prev) if (Object.prototype.hasOwnProperty.call(prev, k) && k !== id) next[k] = prev[k];
          if (!prev[id]) next[id] = true;
          return next;
        });
      }

      var rows = data.items.map(function (ws) {
        var identity = agentIdentity(ws.workspaceId, ws.title);
        var members = visibleMembers(ws, byId, current, archivedSet);
        var isOpen = !!expanded[ws.workspaceId];
        var isActive = ws.sessionIds && ws.sessionIds.indexOf(current) !== -1;

        return React.createElement("div", {
          key: ws.workspaceId,
          className: "dsh-agent-row" + (isActive ? " active" : ""),
          "data-dsh-agent-id": ws.workspaceId
        },
          React.createElement("button", {
            type: "button",
            className: "dsh-agent-card",
            onClick: function () { toggle(ws.workspaceId); },
            title: ws.path || "",
            "aria-expanded": isOpen
          },
            React.createElement("span", {
              className: "dsh-agent-avatar",
              style: { background: identity.gradient }
            }, identity.initial),
            React.createElement("span", { className: "dsh-agent-info" },
              React.createElement("span", { className: "dsh-agent-name" },
                ws.title || "(untitled)",
                isActive ? React.createElement("span", { className: "dsh-agent-dot" }) : null),
              React.createElement("span", { className: "dsh-agent-meta" },
                ws.path || "",
                members.length > 0 ? " · " + members.length + " 会话" : "")
            ),
            React.createElement("span", { className: "dsh-agent-chevron" }, isOpen ? "▾" : "▸")
          ),
          isOpen ? React.createElement("div", { className: "dsh-agent-sessions" },
            members.map(function (s) {
              return React.createElement("button", {
                key: s.id,
                type: "button",
                className: "dsh-agent-session" + (s.id === current ? " current" : ""),
                onClick: function () {
                  try { props.open(s.id); } catch (e) { /* 会话打开失败：不崩卡片 */ }
                }
              },
                React.createElement("span", { className: "dsh-agent-session-title" },
                  s.blank ? "(new session)" : (s.displayTitle || s.title || "(untitled)")),
                React.createElement("span", { className: "dsh-agent-session-time" },
                  s.updatedAt ? relativeTime(s.updatedAt) : "")
              );
            }),
            React.createElement("button", {
              type: "button",
              className: "dsh-agent-new",
              onClick: function () {
                try { props.startSession(ws.workspaceId); } catch (e) { /* ignore */ }
              }
            }, "+ 新会话")
          ) : null
        );
      });

      var empty = data.items.length === 0
        ? React.createElement("div", { className: "dsh-agent-empty" }, "还没有 workspace —— 先创建一个会话")
        : null;

      return React.createElement("div", { className: "dsh-agent-browser" },
        React.createElement("div", { className: "dsh-agent-header" },
          React.createElement("span", { className: "dsh-agent-header-title" }, "Agents"),
          React.createElement("span", { className: "dsh-agent-header-count" }, data.items.length)
        ),
        rows,
        empty
      );
    }

    // ---------- 组件：官方模式浏览器（精简等价实现，切回后功能不丢） ----------
    // 还原官方分组：每 workspace 一组 + 会话树；支持展开/折叠 + 打开会话。
    function OfficialBrowser(props) {
      var data = extractData(props);
      var byId = data.byId, current = data.current;
      var archivedSet = new Set((props.archivedSessionIds) || []);
      var groupsPair = React.useState({});
      var groups = groupsPair[0];
      var setGroups = groupsPair[1];

      function toggleGroup(wsId) {
        setGroups(function (prev) {
          var next = {};
          for (var k in prev) if (Object.prototype.hasOwnProperty.call(prev, k) && k !== wsId) next[k] = prev[k];
          if (!prev[wsId]) next[wsId] = true;
          return next;
        });
      }

      // 分组标题取路径 basename（官方 workspaceLabel 语义）
      function labelOf(ws) {
        var p = ws.path || "";
        if (!p) return ws.title || "";
        var parts = p.split(/[\\/]/).filter(Boolean);
        return parts.length ? parts[parts.length - 1] : p;
      }

      var rows = data.items.map(function (ws) {
        var members = visibleMembers(ws, byId, current, archivedSet);
        var isOpen = !!groups[ws.workspaceId];
        return React.createElement("div", { key: ws.workspaceId, className: "dsh-off-group" },
          React.createElement("button", {
            type: "button",
            className: "dsh-off-group-header" + (isOpen ? " open" : ""),
            onClick: function () { toggleGroup(ws.workspaceId); }
          },
            React.createElement("span", { className: "dsh-off-chevron" }, isOpen ? "▾" : "▸"),
            React.createElement("span", { className: "dsh-off-folder" }, "📁"),
            React.createElement("span", { className: "dsh-off-group-title" }, labelOf(ws)),
            React.createElement("span", { className: "dsh-off-group-count" }, members.length)
          ),
          isOpen ? React.createElement("div", { className: "dsh-off-sessions" },
            members.map(function (s) {
              return React.createElement("button", {
                key: s.id,
                type: "button",
                className: "dsh-off-session" + (s.id === current ? " current" : ""),
                onClick: function () { try { props.open(s.id); } catch (e) { /* ignore */ } }
              },
                React.createElement("span", { className: "dsh-off-session-title" },
                  s.blank ? "(new session)" : (s.displayTitle || s.title || "(untitled)")),
                React.createElement("span", { className: "dsh-off-session-time" },
                  s.updatedAt ? relativeTime(s.updatedAt) : "")
              );
            }),
            React.createElement("button", {
              type: "button",
              className: "dsh-off-new",
              onClick: function () { try { props.startSession(ws.workspaceId); } catch (e) { /* ignore */ } }
            }, "+ 新会话")
          ) : null
        );
      });

      var empty = data.items.length === 0
        ? React.createElement("div", { className: "dsh-agent-empty" }, "还没有 workspace —— 先创建一个会话")
        : null;

      return React.createElement("div", { className: "dsh-off-browser" },
        React.createElement("div", { className: "dsh-agent-header" },
          React.createElement("span", { className: "dsh-agent-header-title" }, "Workspaces"),
          React.createElement("span", { className: "dsh-agent-header-count" }, data.items.length)
        ),
        rows,
        empty
      );
    }

    // ---------- 模式开关（sidebar.footer.action 孔位） ----------
    function ModeToggle(props) {
      var mode = props.mode();
      return React.createElement("button", {
        type: "button",
        className: "dsh-agent-toggle",
        onClick: props.onSwitch,
        title: mode === MODE_AGENT ? "切回官方 workspace 模式" : "切换为 Agent 模式"
      },
        React.createElement("span", { className: "dsh-agent-toggle-icon" }, mode === MODE_AGENT ? "👥" : "🤖"),
        React.createElement("span", { className: "dsh-agent-toggle-label" },
          mode === MODE_AGENT ? "官方模式" : "Agent 模式")
      );
    }

    // ---------- 孔位代理组件：按模式渲染两种浏览器 ----------
    function BrowserSwitch(props) {
      var bumpPair = React.useState(0);
      var bump = bumpPair[1];
      React.useEffect(function () {
        return props.subscribeMode(function () { bump(function (n) { return n + 1; }); });
      }, []);
      return props.mode() === MODE_AGENT
        ? React.createElement(AgentModeBrowser, props)
        : React.createElement(OfficialBrowser, props);
    }

    // ---------- 注册 ----------
    function apply(ctx) {
      var listeners = new Set();
      var currentMode = readMode();

      function notify() {
        listeners.forEach(function (l) { try { l(); } catch (e) { /* ignore */ } });
      }
      function setMode(m) {
        currentMode = normalizeMode(m);
        writeMode(currentMode);
        notify();
      }
      function subscribeMode(l) {
        listeners.add(l);
        return function () { listeners.delete(l); };
      }

      // 注入 CSS（放在 apply 内：factory 顶层没有 ctx，放外面会在加载时崩）
      var styleEl = document.createElement("style");
      styleEl.textContent = css;
      document.head.appendChild(styleEl);
      ctx.effect(function () { return function () { styleEl.remove(); }; });

      // 1) sidebar.workspaces：注册即替换官方浏览器（组件内按模式渲染）
      ctx.slots.inject("sidebar.workspaces", function () {
        return ctx.slots.register({
          name: "sidebar.workspaces",
          locale: "agent-mode",
          inject: function () {
            return {
              mode: function () { return currentMode; },
              subscribeMode: subscribeMode,
              onSwitchMode: function () { setMode(currentMode === MODE_AGENT ? MODE_OFFICIAL : MODE_AGENT); }
            };
          }
        }, BrowserSwitch);
      });

      // 2) sidebar.footer.action：模式开关（list 孔位，可注入）
      ctx.slots.inject("sidebar.footer.action", function () {
        return ctx.slots.register({
          name: "sidebar.footer.action",
          id: "agent-mode-toggle",
          locale: "agent-mode",
          inject: function () {
            return {
              mode: function () { return currentMode; },
              onSwitch: function () { setMode(currentMode === MODE_AGENT ? MODE_OFFICIAL : MODE_AGENT); }
            };
          }
        }, ModeToggle);
      });

      // 3) DOM 兜底：footer 孔位不可用时的开关入口（仿 task-board 注入）
      try {
        var footerLive = ctx.slots.entries("sidebar.footer.action").length > 0;
        if (!footerLive) {
          var disposeDom = mountDomToggle();
          ctx.effect(function () { return disposeDom; });
        }
      } catch (e) { /* slot 探测失败：跳过 DOM 兜底，孔位入口仍可用 */ }
    }

    // ---------- DOM 兜底开关（footer 孔位不可用时） ----------
    function mountDomToggle() {
      if (typeof document === "undefined") return function () {};
      var existing = document.querySelector("[" + ENTRY_ATTR + "]");
      if (existing) return function () {};

      var btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute(ENTRY_ATTR, "");
      btn.className = "dsh-agent-toggle";
      btn.textContent = "🤖 Agent 模式";
      btn.title = "切换左侧栏为 Agent 模式";
      btn.addEventListener("click", function () {
        var m = readMode();
        writeMode(m === MODE_AGENT ? MODE_OFFICIAL : MODE_AGENT);
        notify();
      });

      function tryPlace() {
        var col = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
        if (!col) return false;
        var logoRow = col.querySelector('[class*="logoRow"]');
        var root = logoRow ? logoRow.parentElement : col.firstElementChild;
        if (!root || btn.parentElement === root) return root !== null;
        var newBtn = root.querySelector('button[class*="newSession"]');
        var anchor = newBtn ? newBtn.nextElementSibling : root.firstElementChild;
        root.insertBefore(btn, anchor);
        return true;
      }
      var observer = new MutationObserver(function () { tryPlace(); });
      observer.observe(document.body, { childList: true, subtree: true });
      tryPlace();
      return function () {
        observer.disconnect();
        btn.remove();
      };
    }

    // ---------- CSS（内联，随 client 加载） ----------
    var css = [
      ".dsh-agent-browser,.dsh-off-browser{padding:8px;display:flex;flex-direction:column;gap:4px;overflow-y:auto}",
      ".dsh-agent-header{display:flex;align-items:center;justify-content:space-between;padding:4px 8px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px}",
      ".dsh-agent-header-title{font-weight:600;letter-spacing:.02em}",
      ".dsh-agent-header-count{color:var(--dsw-alias-label-tertiary)}",
      ".dsh-agent-row{display:flex;flex-direction:column;border-radius:8px}",
      ".dsh-agent-card{display:flex;align-items:center;gap:8px;padding:6px 8px;border:none;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:8px;text-align:left;width:100%}",
      ".dsh-agent-card:hover,.dsh-agent-row.active .dsh-agent-card{background:var(--dsw-alias-interactive-bg-hover)}",
      ".dsh-agent-avatar{width:30px;height:30px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:600;flex:none;text-shadow:0 1px 2px rgba(0,0,0,.25)}",
      ".dsh-agent-info{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}",
      ".dsh-agent-name{font-size:14px;line-height:20px;display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".dsh-agent-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary);flex:none}",
      ".dsh-agent-meta{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".dsh-agent-chevron{color:var(--dsw-alias-label-caption);font-size:11px;flex:none}",
      ".dsh-agent-sessions{display:flex;flex-direction:column;gap:1px;margin:2px 0 4px 38px}",
      ".dsh-agent-session{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 8px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:6px;font-size:13px;line-height:18px;width:100%;text-align:left}",
      ".dsh-agent-session:hover,.dsh-agent-session.current{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".dsh-agent-session-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".dsh-agent-session-time{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}",
      ".dsh-agent-new{display:block;margin:2px 8px 6px 38px;padding:3px 8px;border:none;background:transparent;color:var(--dsw-alias-brand-primary);cursor:pointer;font-size:12px;text-align:left;border-radius:6px}",
      ".dsh-agent-new:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".dsh-agent-empty{padding:16px 8px;color:var(--dsw-alias-label-tertiary);font-size:13px;text-align:center}",
      ".dsh-agent-placeholder{min-height:40px}",
      ".dsh-agent-toggle{display:flex;align-items:center;gap:6px;padding:6px 10px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:8px;font-size:13px;line-height:20px;width:100%;text-align:left}",
      ".dsh-agent-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".dsh-agent-toggle-icon{font-size:14px}",
      "@media (max-width:640px){.dsh-agent-toggle-label{display:none}}",
      ".dsh-off-group{display:flex;flex-direction:column}",
      ".dsh-off-group-header{display:flex;align-items:center;gap:6px;padding:5px 8px;border:none;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:6px;text-align:left;width:100%;font-size:13px;line-height:20px}",
      ".dsh-off-group-header:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".dsh-off-chevron{color:var(--dsw-alias-label-caption);font-size:10px;flex:none;transition:transform .15s}",
      ".dsh-off-group-header.open .dsh-off-chevron{transform:rotate(90deg)}",
      ".dsh-off-folder{font-size:13px;flex:none}",
      ".dsh-off-group-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".dsh-off-group-count{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}",
      ".dsh-off-sessions{display:flex;flex-direction:column;gap:1px;margin-left:24px}",
      ".dsh-off-session{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 8px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:6px;font-size:13px;line-height:18px;width:100%;text-align:left}",
      ".dsh-off-session:hover,.dsh-off-session.current{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".dsh-off-session-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".dsh-off-session-time{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}",
      ".dsh-off-new{display:block;margin:2px 8px 6px 24px;padding:3px 8px;border:none;background:transparent;color:var(--dsw-alias-brand-primary);cursor:pointer;font-size:12px;text-align:left;border-radius:6px}",
      ".dsh-off-new:hover{background:var(--dsw-alias-interactive-bg-hover)}"
    ].join("\n");

    module.exports = { name: "dev-agent-mode", apply: apply };
    return module.exports;
  }
});
