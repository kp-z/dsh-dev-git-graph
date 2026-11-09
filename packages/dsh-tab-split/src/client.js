window.__ModuleLoader__.load({
  id: "dsh-tab-split",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var h = React.createElement;

    // ============ dsh-tab-split v2：任意视图可分屏（对话 × Git 树并排） ============
    // 调研定论：SlotOutlet/入口 kit 为 renderer 私有、子 slot 声明全局唯一，插件无法对官方
    // conversation.view 做第二次 renderSlot；官方聊天/轨迹组件为包内私有闭包不可复用。
    // 因此本插件走「纯增量」路线：
    //   1) 新增 conversation.view 条目「分屏」（children 声明 tabsplit.pane list/session）；
    //   2) 内置「对话」窗格视图（pane-chat，自绘 compact 聊天，消费 useSession 官方同源快照，
    //      支持流式）；Git 树由 dsh-git-graph 经 slots.inject 入驻；第三方可按协议入驻；
    //   3) RightClickManager：DOM 代理捕获官方视图 tab 的 contextmenu，弹「向右拆分」菜单；
    //      已处于分屏视图时走 window 自定义事件直接加窗格，否则写待拆请求 + DOM 代理点分屏 tab；
    //   4) 退出分屏 = 用户点击任意官方视图 tab（官方 setView 自然切走），零接管。
    // 红线（用户拍板）：默认保持官方单视图；不替换官方任何 entry；
    // 审批/提问/计划评审走官方 composer 链，不受影响。

    var PANE_SLOT = "tabsplit.pane";
    var SPLIT_VIEW_ID = "split-tabs";
    var SPLIT_TAB_LABEL = "分屏";
    var REQUEST_EVENT = "dsh-tab-split:request";
    var MIN_RATIO = 0.15;
    var MAX_PANES = 4;

    // ---------- 每会话布局持久化 ----------
    function storageKey(sessionId) { return "dsh.tab-split.panes." + sessionId; }
    function loadState(sessionId) {
      try {
        var raw = window.localStorage.getItem(storageKey(sessionId));
        if (!raw) return null;
        var s = JSON.parse(raw);
        if (!s || !Array.isArray(s.panes)) return null;
        var panes = s.panes
          .filter(function (p) { return p && typeof p.ratio === "number" && p.ratio > 0; })
          .map(function (p) { return { viewId: p.viewId || null, ratio: p.ratio }; });
        return panes.length ? { panes: panes } : null;
      } catch (e) { return null; }
    }
    function saveState(sessionId, state) {
      try { window.localStorage.setItem(storageKey(sessionId), JSON.stringify(state)); } catch (e) {}
    }
    function normalize(panes) {
      var total = panes.reduce(function (sum, p) { return sum + p.ratio; }, 0) || 1;
      return panes.map(function (p) { return { viewId: p.viewId, ratio: p.ratio / total }; });
    }

    // ---------- tabsplit.pane 可用视图 ledger ----------
    function usePaneViews(ctx) {
      var slots = ctx.slots;
      var getVersion = React.useCallback(function () { return slots.getVersion(PANE_SLOT); }, [slots]);
      React.useSyncExternalStore(function (fn) { return slots.subscribe(PANE_SLOT, fn); }, getVersion);
      var entries = slots.entries(PANE_SLOT) || [];
      return entries.map(function (e) {
        var opts = e.options || {};
        var label = typeof opts.label === "function" ? opts.label() : opts.label || opts.id;
        return { id: opts.id, label: label };
      });
    }

    // ---------- 官方视图 tab 文本 -> 窗格视图映射（可随入驻扩展；未知 -> 空窗格待选） ----------
    function mapTabToPane(tabText) {
      var t = (tabText || "").trim();
      if (t.indexOf("对话") !== -1 || t.toLowerCase() === "chat") return "pane-chat";
      if (t.indexOf("Git") !== -1 || t.indexOf("git") !== -1) return "git-graph-pane";
      return null;
    }

    // ---------- 样式 ----------
    function ensureStyle() {
      var css = [
        // 分屏根：官方会话是「文档流滚动」(scrollBody 滚动自然高度的视图)，分屏需要
        // 「容器定高 + 各窗格独立滚动」。display:contents 包装层会破坏 > 子选择器，
        // 故用后代选择器 + 我们在 SplitTabsView 挂载时给 scrollBody 打 data-dts-active 标记：
        ".wSkVaW_scrollBody[data-dts-active]{overflow:hidden}",
        ".wSkVaW_scrollBody[data-dts-active] .wSkVaW_viewArea{flex:1;min-height:0}",
        ".dts-root{display:flex;width:100%;flex:1;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base)}",
        ".dts-pane{position:relative;display:flex;flex-direction:column;min-width:0;height:100%;overflow:hidden;border-right:1px solid var(--dsw-alias-border-l2)}",
        ".dts-pane:last-child{border-right:none}",
        ".dts-pane-head{flex:none;display:flex;align-items:center;gap:6px;padding:4px 8px;height:32px;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l2)}",
        ".dts-pane-title{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        ".dts-pane select{flex:none;max-width:150px;font-size:12px;padding:2px 4px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}",
        ".dts-icon-btn{flex:none;min-width:22px;height:22px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:13px;line-height:1;display:grid;place-items:center;padding:0 3px}",
        ".dts-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
        ".dts-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}",
        // 窗格内容必须限高可滚：renderSlot 走 [data-slot] 包装层，pane-chat 走内联直绘——两条路都要约束
        ".dts-body>[data-slot]{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}",
        ".dts-divider{flex:none;width:5px;cursor:col-resize;background:transparent;transition:background .12s}",
        ".dts-divider:hover,.dts-divider[data-drag=true]{background:var(--dsw-alias-brand-primary)}",
        ".dts-empty{flex:1;display:grid;place-items:center;color:var(--dsw-alias-label-tertiary);font-size:13px;padding:24px;text-align:center;line-height:1.7}",
        ".dts-hint-btn{padding:6px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:13px}",
        ".dts-hint-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
        ".dts-ctx-menu{position:fixed;z-index:9999;min-width:150px;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 6px 20px var(--dsw-alias-shadow, rgba(0,0,0,.2))}",
        ".dts-ctx-item{display:block;width:100%;padding:6px 10px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;text-align:left;cursor:pointer}",
        ".dts-ctx-item:hover{background:var(--dsw-alias-interactive-bg-hover)}",
        ".dts-chat{flex:1;min-height:0;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}",
        ".dts-chat-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;padding:16px 0}",
        ".dts-chat-user{align-self:flex-end;max-width:86%;padding:8px 12px;border-radius:12px;background:var(--dsw-alias-fill-l2);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word}",
        ".dts-chat-assist{align-self:flex-start;max-width:92%;padding:8px 12px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word}",
        ".dts-chat-assist[data-partial]{border-color:var(--dsw-alias-brand-primary)}",
        ".dts-chat-tool{align-self:flex-start;max-width:92%;padding:5px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px;font-family:var(--ds-font-family-code, monospace);display:flex;gap:6px;align-items:center}",
        ".dts-chat-tool-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary)}",
        ".dts-chat-tool-dot[data-running]{background:var(--dsw-alias-state-warn-primary);animation:dts-pulse 1s ease-in-out infinite}",
        ".dts-chat-sys{align-self:center;color:var(--dsw-alias-label-tertiary);font-size:12px;padding:2px 0}",
        ".dts-chat-error{align-self:center;color:var(--dsw-alias-state-error-primary);font-size:12px}",
        "@keyframes dts-pulse{0%,100%{opacity:1}50%{opacity:.35}}"
      ].join("\n");
      // 幂等升级：旧表存在但内容不同则替换（HMR/重载时拿到最新样式）
      var existing = document.getElementById("dsh-tab-split-style");
      if (existing) { if (existing.textContent !== css) existing.textContent = css; return; }
      var st = document.createElement("style");
      st.id = "dsh-tab-split-style";
      st.textContent = css;
      document.head.appendChild(st);
    }

    // ---------- pane-chat：自绘 compact 聊天（官方同源快照，支持流式） ----------
    // 数据源：框架标准 useSession（ConversationSnapshot）。渲染 nodes（user/assistant/
    // tool-result/turn-error/command/compaction）+ partial 流式增量 + runningCalls + queue。
    // 明确不含：富卡片注册表、消息操作条、详情联动——完整交互仍在官方主视图。
    function textOfContent(content) {
      var parts = [];
      if (!content) return "";
      for (var i = 0; i < content.length; i++) {
        var b = content[i];
        if (b && typeof b === "object" && typeof b.text === "string") parts.push(b.text);
      }
      return parts.join("\n").trim();
    }

    function ChatPane(props) {
      var useSession = props.useSession;

      var nodes = useSession(function (s) { return s.nodes; });
      var partial = useSession(function (s) { return s.partial; });
      var runningCalls = useSession(function (s) { return s.runningCalls; });
      var queue = useSession(function (s) { return s.queue; });
      var running = useSession(function (s) { return s.running; });
      var blank = useSession(function (s) { return s.blank; });

      var scrollRef = React.useRef(null);
      var pinnedRef = React.useRef(true); // 流式时是否跟随底部；用户上滚即暂停

      var onScroll = React.useCallback(function () {
        var el = scrollRef.current;
        if (!el) return;
        pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }, []);

      React.useLayoutEffect(function () {
        var el = scrollRef.current;
        if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
      });

      function renderBlocks(blocks, keyPrefix, isPartial) {
        var out = [];
        if (!blocks) return out;
        for (var i = 0; i < blocks.length; i++) {
          var b = blocks[i];
          if (!b) continue;
          var k = keyPrefix + "-" + i;
          if (b.kind === "text" && b.text && b.text.trim()) {
            out.push(h("div", { key: k, className: "dts-chat-assist", "data-partial": isPartial || undefined }, b.text));
          } else if (b.kind === "reasoning" && b.text) {
            out.push(h("div", { key: k, className: "dts-chat-sys" }, "（推理）" + (b.text.length > 60 ? b.text.slice(0, 60) + "…" : b.text)));
          } else if (b.kind === "tool-call") {
            out.push(h("div", { key: k, className: "dts-chat-tool" },
              h("span", { className: "dts-chat-tool-dot", "data-running": isPartial || undefined }), b.name || "tool"));
          } else if (b.kind === "image") {
            out.push(h("div", { key: k, className: "dts-chat-sys" }, "[图片]"));
          }
        }
        return out;
      }

      var items = [];
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n || !n.kind) continue;
        if (n.kind === "user" || n.kind === "steering") {
          var txt = textOfContent(n.content);
          if (txt) items.push(h("div", { key: "u" + n.seq, className: "dts-chat-user" }, txt));
        } else if (n.kind === "assistant") {
          var parts = renderBlocks(n.blocks, "a" + n.seq, false);
          for (var p = 0; p < parts.length; p++) items.push(parts[p]);
        } else if (n.kind === "tool-result") {
          items.push(h("div", { key: "t" + n.seq, className: "dts-chat-tool" },
            h("span", { className: "dts-chat-tool-dot" }), n.toolName || "tool"));
        } else if (n.kind === "turn-error" || n.kind === "turn-max-tokens") {
          var msg = (n.error && n.error.message) || (n.kind === "turn-max-tokens" ? "达到最大 token" : "轮次出错");
          items.push(h("div", { key: "e" + n.seq, className: "dts-chat-error" }, msg));
        } else if (n.kind === "command") {
          items.push(h("div", { key: "c" + n.seq, className: "dts-chat-sys" }, "/" + (n.name || "command")));
        } else if (n.kind === "compaction") {
          items.push(h("div", { key: "cp" + n.seq, className: "dts-chat-sys" }, "—— 上下文压缩 ——"));
        }
      }
      for (var r = 0; r < runningCalls.length; r++) {
        var rc = runningCalls[r];
        items.push(h("div", { key: "rc" + rc.callId, className: "dts-chat-tool" },
          h("span", { className: "dts-chat-tool-dot", "data-running": true }), rc.name || "tool"));
      }
      if (partial && partial.blocks && partial.blocks.length) {
        var pp = renderBlocks(partial.blocks, "p" + partial.turn + "." + partial.step, true);
        for (var q = 0; q < pp.length; q++) items.push(pp[q]);
      }
      for (var m = 0; m < queue.length; m++) {
        var qm = queue[m];
        var qtxt = textOfContent(qm.content) || "(排队消息)";
        items.push(h("div", { key: "q" + (qm.messageId || m), className: "dts-chat-user", style: { opacity: 0.6 } }, "⏳ " + qtxt));
      }

      if (blank && items.length === 0) {
        return h("div", { className: "dts-chat" }, h("div", { className: "dts-chat-empty" }, "空白会话，在下方输入框发送第一条消息。"));
      }
      return h("div", { className: "dts-chat", ref: scrollRef, onScroll: onScroll },
        items.length === 0
          ? h("div", { className: "dts-chat-empty" }, "暂无消息" + (running ? "，等待响应…" : ""))
          : items
      );
    }

    // ---------- 拖拽分隔条 ----------
    function Divider(props) {
      var onDrag = props.onDrag;
      var ref = React.useRef(null);
      var stateRef = React.useRef(null);
      var onPointerDown = React.useCallback(function (ev) {
        ev.preventDefault();
        var el = ref.current && ref.current.parentElement;
        if (!el) return;
        stateRef.current = { startX: ev.clientX, width: el.getBoundingClientRect().width };
        el.setAttribute("data-drag", "true");
        function move(e) {
          var s = stateRef.current;
          if (!s) return;
          onDrag((e.clientX - s.startX) / s.width);
        }
        function up() {
          stateRef.current = null;
          el.removeAttribute("data-drag");
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        }
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }, [onDrag]);
      return h("div", { className: "dts-divider", ref: ref, onPointerDown: onPointerDown, role: "separator", "aria-orientation": "vertical" });
    }

    // ---------- 单个窗格 ----------
    function Pane(props) {
      var view = props.view;
      var views = props.views;
      return h("div", { className: "dts-pane", style: { flexGrow: props.ratio, flexBasis: 0 } },
        h("div", { className: "dts-pane-head" },
          h("span", { className: "dts-pane-title" }, view ? view.label : "选择视图"),
          h("select", {
            value: view ? view.id : "",
            onChange: function (e) { if (e.target.value) props.onSelect(e.target.value); },
            title: "切换该窗格显示的视图"
          },
            !view && h("option", { value: "" }, "选择视图…"),
            views.map(function (v) { return h("option", { key: v.id, value: v.id }, v.label); })
          ),
          h("button", { className: "dts-icon-btn", onClick: props.onSplit, title: "向右拆分新窗格" }, "⧉"),
          props.canClose && h("button", { className: "dts-icon-btn", onClick: props.onClose, title: "关闭窗格" }, "×")
        ),
        h("div", { className: "dts-body" },
          view
            ? props.renderPane(view.id)
            : h("div", { className: "dts-empty" },
                h("div", null,
                  "该窗格尚未选择视图。",
                  views.length === 0
                    ? h("div", { style: { marginTop: 6 } }, "暂无已注册的窗格视图。")
                    : h("div", { style: { marginTop: 6 } }, "从上方下拉选择一个。")
                )
              )
        )
      );
    }

    // ---------- 分屏主视图 ----------
    function SplitTabsView(props) {
      var ctxRef = props.ctxRef;
      var ctx = ctxRef.current;
      var sessionId = props.sessionId;
      var renderSlot = props.renderSlot;
      var views = usePaneViews(ctx);

      // 分屏激活时给官方滚动容器打标记，切「容器定高 + 各窗格独立滚动」布局
      React.useEffect(function () {
        var body = document.querySelector(".wSkVaW_scrollBody");
        if (body) body.setAttribute("data-dts-active", "");
        return function () { if (body) body.removeAttribute("data-dts-active"); };
      }, [sessionId]);

      var _s = React.useState(function () { return loadState(sessionId); });
      var state = _s[0];
      var setStateRaw = _s[1];
      var setState = React.useCallback(function (updater) {
        setStateRaw(function (prev) {
          var next = typeof updater === "function" ? updater(prev) : updater;
          if (next) saveState(sessionId, next);
          return next;
        });
      }, [sessionId]);

      // 会话切换：重载布局
      React.useEffect(function () { setStateRaw(loadState(sessionId)); }, [sessionId]);

      // 接收拆分请求（右键菜单；本视图已挂载时直达）
      React.useEffect(function () {
        var onReq = function (ev) {
          var req = ev.detail || {};
          setState(function (prev) {
            var panes = prev ? prev.panes.slice() : [];
            if (panes.length >= MAX_PANES) return prev;
            if (panes.length === 0) {
              var left = mapTabToPane(req.fromTab) || (views.length ? views[0].id : null);
              panes = [{ viewId: left, ratio: 1 }, { viewId: req.viewId || null, ratio: 1 }];
            } else {
              panes.push({ viewId: req.viewId || null, ratio: 1 });
            }
            return { panes: panes };
          });
        };
        window.addEventListener(REQUEST_EVENT, onReq);
        return function () { window.removeEventListener(REQUEST_EVENT, onReq); };
      }, [setState, views]);

      // 已入驻视图被卸载时置空（保留布局）
      React.useEffect(function () {
        if (!state) return;
        var ids = {};
        views.forEach(function (v) { ids[v.id] = true; });
        var dirty = state.panes.some(function (p) { return p.viewId && !ids[p.viewId]; });
        if (dirty) {
          setState(function (prev) {
            return { panes: prev.panes.map(function (p) { return p.viewId && !ids[p.viewId] ? { viewId: null, ratio: p.ratio } : p; }) };
          });
        }
      }, [views]);

      if (!state || state.panes.length === 0) {
        return h("div", { className: "dts-root" },
          h("div", { className: "dts-empty" },
            h("div", null,
              h("div", { style: { marginBottom: 12 } },
                "分屏视图：把任意视图（对话 / Git 树 / 已入驻视图）拆成并排窗格。"),
              h("div", { style: { marginBottom: 12, fontSize: 12 } },
                "提示：右键上方任意视图 tab 选择「向右拆分」，或直接点按钮开始。"),
              views.length === 0
                ? h("div", null, "暂无可分屏的视图。插件可通过 slots.inject('" + PANE_SLOT + "', …) 入驻。")
                : h("button", {
                    className: "dts-hint-btn",
                    onClick: function () {
                      var chat = views.find(function (v) { return v.id === "pane-chat"; }) || views[0];
                      var other = views.find(function (v) { return v.id === "git-graph-pane" && v.id !== chat.id; })
                        || views.find(function (v) { return v.id !== chat.id; }) || chat;
                      setState({ panes: [{ viewId: chat.id, ratio: 1 }, { viewId: other.id, ratio: 1 }] });
                    }
                  }, "开始分屏（对话 × Git 树）")
            )
          )
        );
      }

      var panes = normalize(state.panes);

      function selectAt(i, viewId) {
        setState(function (prev) {
          var next = prev.panes.slice();
          next[i] = { viewId: viewId, ratio: next[i].ratio };
          return { panes: next };
        });
      }
      function splitAt(i) {
        setState(function (prev) {
          if (prev.panes.length >= MAX_PANES) return prev;
          var next = prev.panes.slice();
          var src = next[i];
          next.splice(i + 1, 0, { viewId: src.viewId, ratio: src.ratio / 2 });
          next[i] = { viewId: src.viewId, ratio: src.ratio / 2 };
          return { panes: next };
        });
      }
      function closeAt(i) {
        setState(function (prev) {
          if (prev.panes.length <= 1) return null;
          var next = prev.panes.slice();
          next.splice(i, 1);
          return { panes: next };
        });
      }
      function dragAt(i, deltaRatio) {
        setState(function (prev) {
          var next = normalize(prev.panes.slice());
          var a = next[i], b = next[i + 1];
          if (!a || !b) return prev;
          var sum = a.ratio + b.ratio;
          var na = Math.min(Math.max(a.ratio + deltaRatio * sum, MIN_RATIO * sum), sum - MIN_RATIO * sum);
          next[i] = { viewId: a.viewId, ratio: na };
          next[i + 1] = { viewId: b.viewId, ratio: sum - na };
          return { panes: next };
        });
      }

      function renderPane(viewId) {
        if (viewId === "pane-chat") {
          // 内置对话窗格：直接自绘（复用本视图的标准 session kit）
          return h(ChatPane, { useSession: props.useSession, sessionId: sessionId });
        }
        try {
          return renderSlot(PANE_SLOT, {}, { only: viewId });
        } catch (e) {
          return h("div", { className: "dts-empty" }, "视图「" + viewId + "」渲染失败：" + (e && e.message ? e.message : String(e)));
        }
      }

      var children = [];
      panes.forEach(function (p, i) {
        if (i > 0) children.push(h(Divider, { key: "div-" + i, onDrag: function (d) { dragAt(i - 1, d); } }));
        var view = views.find(function (v) { return v.id === p.viewId; }) || null;
        children.push(h(Pane, {
          key: "pane-" + i,
          ratio: p.ratio,
          view: view,
          views: views,
          canClose: panes.length > 1,
          renderPane: renderPane,
          onSelect: function (id) { selectAt(i, id); },
          onSplit: function () { splitAt(i); },
          onClose: function () { closeAt(i); }
        }));
      });
      return h("div", { className: "dts-root" }, children);
    }

    // ---------- 右键菜单 ----------
    function RightClickMenu(props) {
      var state = props.state;
      if (!state) return null;
      var x = Math.min(state.x, window.innerWidth - 170);
      var y = Math.min(state.y, window.innerHeight - 70);
      return h("div", { className: "dts-ctx-menu", style: { left: x, top: y } },
        h("button", { className: "dts-ctx-item", onClick: props.onSplit }, "⧉ 向右拆分到分屏"),
        h("button", { className: "dts-ctx-item", onClick: props.onClose }, "取消")
      );
    }

    // ---------- 会话头「分屏」按钮 ----------
    function SplitAction(props) {
      return h("button", {
        className: "dts-icon-btn dts-split-action",
        title: "分屏：并排查看任意视图（右键视图 tab 也可拆分）",
        onClick: props.onActivate,
        style: { width: "auto", padding: "0 8px", height: "24px", fontSize: "12px" }
      }, "⧉ " + SPLIT_TAB_LABEL);
    }

    function findSplitTab() {
      var tabs = document.querySelectorAll('[role="tablist"] [role="tab"]');
      for (var i = 0; i < tabs.length; i++) {
        if ((tabs[i].textContent || "").indexOf(SPLIT_TAB_LABEL) !== -1) return tabs[i];
      }
      return null;
    }

    // ---------- apply ----------
    function apply(ctx) {
      // 已停用（用户决定走 Git 树右侧栏叠加列方案，自绘对话分屏线整体废弃）。
      // 不注册任何 slot：无「分屏」tab、无会话头「分屏」按钮、无右键菜单。
      // 保留包文件以便日后恢复；恢复即删除下面这行 return。
      return;
      ensureStyle();
      var ctxRef = { current: ctx };
      var slots = ctx.slots || (ctx.get ? ctx.get("slots") : undefined);
      if (!slots || !slots.inject) return;

      // 右键菜单状态（模块级单例）
      var menuState = { value: null, listeners: new Set() };
      function setMenu(next) {
        menuState.value = next;
        menuState.listeners.forEach(function (fn) { fn(next); });
      }

      function doSplitFromMenu() {
        var st = menuState.value;
        if (!st) return;
        var tabText = st.tabText || "";
        var viewId = mapTabToPane(tabText);
        setMenu(null);
        var splitTab = findSplitTab();
        var isActive = splitTab && splitTab.getAttribute("aria-selected") === "true";
        // 已在分屏视图：事件直达；否则先激活分屏 tab（SplitTabsView 挂载后由菜单宿主补发事件）
        if (isActive) {
          window.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: { fromTab: tabText, viewId: viewId } }));
        } else {
          pendingRequest = { fromTab: tabText, viewId: viewId };
          if (splitTab) splitTab.click(); else window.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: { fromTab: tabText, viewId: viewId } }));
        }
      }

      // 待拆请求（跨 tab 激活的桥）
      var pendingRequest = null;
      function flushPending() {
        if (!pendingRequest) return;
        var req = pendingRequest;
        pendingRequest = null;
        window.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: req }));
      }

      // 全局 contextmenu 捕获（仅命中官方视图 tab 时接管）
      function onContextMenu(ev) {
        var el = ev.target;
        while (el && el !== document.body) {
          if (el.nodeType === 1 && el.getAttribute && el.getAttribute("role") === "tab") break;
          el = el.parentNode;
        }
        if (!el || el === document.body) return;
        var tablist = el.closest ? el.closest('[role="tablist"]') : null;
        if (!tablist) return;
        ev.preventDefault();
        ev.stopPropagation();
        setMenu({ x: ev.clientX, y: ev.clientY, tabText: el.textContent || "" });
      }
      function onDocMouseDown(ev) {
        if (menuState.value && (!ev.target || !ev.target.closest || !ev.target.closest(".dts-ctx-menu"))) setMenu(null);
      }
      function onKeyDown(ev) { if (ev.key === "Escape" && menuState.value) setMenu(null); }

      document.addEventListener("contextmenu", onContextMenu, true);
      document.addEventListener("mousedown", onDocMouseDown, true);
      document.addEventListener("keydown", onKeyDown, true);
      ctx.effect(function () {
        return function () {
          document.removeEventListener("contextmenu", onContextMenu, true);
          document.removeEventListener("mousedown", onDocMouseDown, true);
          document.removeEventListener("keydown", onKeyDown, true);
          setMenu(null);
        };
      });

      // 菜单宿主：挂在官方会话容器上（position:relative 的祖先），菜单本身 position:fixed。
      // 用 portal 到 document.body 最稳（官方无专属浮层 slot 约束）。
      var MenuHost = function () {
        var _ms = React.useState(menuState.value);
        var st = _ms[0], setSt = _ms[1];
        React.useEffect(function () {
          var fn = function (next) { setSt(next); };
          menuState.listeners.add(fn);
          return function () { menuState.listeners.delete(fn); };
        }, []);
        if (!st) return null;
        return require("react-dom").createPortal(
          h(RightClickMenu, { state: st, onSplit: doSplitFromMenu, onClose: function () { setMenu(null); } }),
          document.body
        );
      };

      // 1) 分屏视图 tab + tabsplit.pane 子 slot
      slots.inject("conversation.view", function () {
        return slots.register(
          {
            name: "conversation.view",
            id: SPLIT_VIEW_ID,
            order: 40,
            label: function () { return SPLIT_TAB_LABEL; },
            children: (function () { var c = {}; c[PANE_SLOT] = { kind: "list", scope: "session" }; return c; })()
          },
          function (props) {
            // 挂载后补发待拆请求（右键触发时本视图尚未激活的路径）
            React.useEffect(function () { flushPending(); }, []);
            return h(SplitTabsView, Object.assign({}, props, { ctxRef: ctxRef }));
          }
        );
      });

      // 2) 内置对话窗格视图注册（提供下拉选项与映射目标；渲染走 SplitTabsView 内联直绘）
      slots.inject(PANE_SLOT, function () {
        return slots.register(
          { name: PANE_SLOT, id: "pane-chat", order: 10, label: function () { return "对话"; } },
          function (props) { return h(ChatPane, props); }
        );
      });

      // 3) 会话头「分屏」按钮
      slots.inject("conversation.session.header.actions", function () {
        return slots.register(
          { name: "conversation.session.header.actions", id: "tab-split-activate", order: 40 },
          function (props) { return h(SplitAction, Object.assign({}, props, { onActivate: function () {
            var splitTab = findSplitTab();
            if (splitTab && splitTab.getAttribute("aria-selected") !== "true") splitTab.click();
          } })); }
        );
      });

      // 4) 菜单宿主入口（shell.overlay 为帧级浮层；若不可用则退化为 body portal 自挂载）
      var overlayOk = false;
      try {
        slots.inject("shell.overlay", function () {
          overlayOk = true;
          return slots.register(
            { name: "shell.overlay", id: "tab-split-menu", order: 100 },
            function () { return h(MenuHost); }
          );
        });
      } catch (e) { overlayOk = false; }
      if (!overlayOk) {
        // 兜底：直接挂一个 React root 到 body（不依赖官方浮层）
        ctx.effect(function () {
          var div = document.createElement("div");
          div.id = "dsh-tab-split-menu-root";
          document.body.appendChild(div);
          var ReactDOM = require("react-dom");
          var root = ReactDOM.createRoot ? ReactDOM.createRoot(div) : null;
          if (root) root.render(h(MenuHost));
          return function () { if (root) root.unmount(); div.remove(); };
        });
      }
    }

    exports.apply = apply;
    exports.inject = ["slots", "sessions"];
    return module.exports;
  }
});
