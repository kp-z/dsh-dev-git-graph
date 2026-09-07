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
    //
    // 机制（源码实锤，dsh-web-frontend bundle 的 SlotCore.register）：
    //   - sidebar.workspaces 是 single 孔位：同一 priority 只允许一个注册者，
    //     重复注册直接 throw（错误信息明示：register at a different priority to
    //     shadow it, lowest renders）。
    //   - 官方 client-ui-workspace 以 priority=0 注册。本插件用 priority=-1 注册
    //     即可遮蔽（shadow）官方：single 排序 (a,b)=>(a.priority??0)-(b.priority??0)
    //     升序，priority 最小排 [0]，渲染取 entriesOfSlot()[0]。
    //   - 动态注册/注销：agent 模式 register（-1，遮蔽官方）；official 模式
    //     dispose 自己（entries 移除自己），官方 priority=0 自动恢复 [0] ——
    //     切回官方 = 官方原版，无需自建精简等价物。
    //   - 模式开关：sidebar.footer.action list 孔位（id 键控），DOM 注入兜底。
    // 数据：apply 里 ctx.get("sessions")/ctx.get("uiWorkspace")（open/startSession），
    //   useWorkspaces/useSessions 由 slot 系统 standard props 注入。
    // 构建：无打包器，src/client.js 拷贝为 lib/client.js（仿 dsh-dev-git-graph）。

    var STORAGE_KEY = "dsh-dev-agent-mode.mode";
    var MODE_OFFICIAL = "official";
    var MODE_AGENT = "agent";
    var ENTRY_ATTR = "data-dsh-agent-mode-entry";
    var SHADOW_PRIORITY = -1; // 遮蔽官方（官方 priority=0，最低 priority 渲染）

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

    // ---------- 数据提取（standard props，含降级） ----------
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
      return {
        items: (ws && ws.items) || [],
        byId: (ses && ses.byId) || {},
        current: ses ? ses.current : undefined
      };
    }

    // 官方语义过滤：subagent 不算、archived 不算、blank 只留当前
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

    // ---------- 组件：Agent 模式浏览器 ----------
    function AgentModeBrowser(props) {
      var data = extractData(props);
      var byId = data.byId, current = data.current;
      var archivedSet = new Set(props.archivedSessionIds || []);
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

      // 拿 sessions / uiWorkspace 服务（open/startSession）
      var sessions = null, uiWorkspace = null;
      try {
        sessions = ctx.get("sessions");
        uiWorkspace = ctx.get("uiWorkspace");
      } catch (e) {
        sessions = null;
        uiWorkspace = null;
      }
      function startSession(workspaceId) {
        if (uiWorkspace && typeof uiWorkspace.startSession === "function") {
          return uiWorkspace.startSession(workspaceId);
        }
        if (sessions && typeof sessions.create === "function") {
          return sessions.create({ workspaceId: workspaceId });
        }
        throw new Error("sessions/uiWorkspace 服务不可用，无法新建会话");
      }
      function openSession(sessionId) {
        if (!sessions || typeof sessions.open !== "function") {
          throw new Error("sessions 服务不可用，无法打开会话");
        }
        return sessions.open(sessionId);
      }

      // 1) sidebar.workspaces：动态遮蔽官方（priority=-1）
      //    agent 模式 -> register 遮蔽官方；official 模式 -> dispose 自己，官方恢复。
      //    shadow 冲突（-1 被他人占）时 fail-open：不注册，官方浏览器保持，仅 console.warn。
      var workspacesEntry = null; // 当前 register 的 dispose（null = 未注册）
      var syncWorkspaces = function () {
        var want = currentMode === MODE_AGENT;
        if (want && !workspacesEntry) {
          try {
            workspacesEntry = ctx.slots.register({
              name: "sidebar.workspaces",
              priority: SHADOW_PRIORITY,
              locale: "agent-mode",
              inject: function () {
                return {
                  mode: function () { return currentMode; },
                  subscribeMode: subscribeMode,
                  onSwitchMode: function () { setMode(currentMode === MODE_AGENT ? MODE_OFFICIAL : MODE_AGENT); },
                  startSession: startSession,
                  open: openSession
                };
              }
            }, AgentModeBrowser);
          } catch (e) {
            // 遮蔽失败（-1 被他人占用 / 孔位未声明）：fail-open，官方保持
            console.warn("[dsh-dev-agent-mode] 无法遮蔽 sidebar.workspaces：", e && e.message ? e.message : e);
            workspacesEntry = null;
          }
        } else if (!want && workspacesEntry) {
          try {
            workspacesEntry();
          } catch (e) { /* dispose 异常忽略 */ }
          workspacesEntry = null;
        }
      };
      // 孔位声明就绪后执行一次，并跟随模式切换动态注册/注销
      ctx.slots.inject("sidebar.workspaces", function () {
        syncWorkspaces();
        var unsub = subscribeMode(syncWorkspaces);
        return function () {
          unsub();
          if (workspacesEntry) {
            try { workspacesEntry(); } catch (e) { /* ignore */ }
            workspacesEntry = null;
          }
        };
      });

      // 2) sidebar.footer.action：模式开关（list 孔位，id 冲突时 fallback DOM 注入）
      var footerRegistered = false;
      ctx.slots.inject("sidebar.footer.action", function () {
        try {
          var dispose = ctx.slots.register({
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
          footerRegistered = true;
          return dispose;
        } catch (e) {
          // id 已被他人占用（同一 id 冲突）：console.warn + 走 DOM 兜底
          console.warn("[dsh-dev-agent-mode] footer 开关注册失败，改用 DOM 注入：", e && e.message ? e.message : e);
          return function () {};
        }
      });

      // 3) DOM 兜底：footer 孔位注册失败时的开关入口（仿 task-board 注入）
      if (!footerRegistered) {
        try {
          var disposeDom = mountDomToggle();
          ctx.effect(function () { return disposeDom; });
        } catch (e) { /* DOM 注入失败：忽略，开关缺失但不影响主功能 */ }
      }
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
      ".dsh-agent-browser{padding:8px;display:flex;flex-direction:column;gap:4px;overflow-y:auto}",
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
      ".dsh-agent-toggle{display:flex;align-items:center;gap:6px;padding:6px 10px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:8px;font-size:13px;line-height:20px;width:100%;text-align:left}",
      ".dsh-agent-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".dsh-agent-toggle-icon{font-size:14px}",
      "@media (max-width:640px){.dsh-agent-toggle-label{display:none}}"
    ].join("\n");

    module.exports = { name: "dev-agent-mode", apply: apply };
    return module.exports;
  }
});
