window.__ModuleLoader__.load({
  id: "dsh-dev-agent-mode",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    // ============ dsh-dev-agent-mode client：左侧栏 Agent 模式（MVP 第一步） ============
    // 目标：左侧栏与官方完全一致 + 每个 workspace 可换头像。
    // 路线：DOM 增强（不遮蔽孔位、不重写官方组件）——
    //   官方 WorkspaceBrowser 原样渲染（功能 100% 一致），本插件用 MutationObserver
    //   在官方 workspace 行上注入头像元素，点头像弹选择器（色块/emoji），
    //   选择持久化到 localStorage，React 重渲染后自动重新注入（自愈）。
    // 数据：ctx.workspaces.list（title→workspaceId 匹配）；头像偏好 avatar-store。
    // 开关：官方头部「分组方式」按钮旁注入（headerActions 内）。

    var AVATARS_KEY = "dsh-dev-agent-mode.avatars";
    var MODE_KEY = "dsh-dev-agent-mode.mode";
    var MODE_AGENT = "agent";
    var MODE_OFFICIAL = "official";
    var AVATAR_ATTR = "data-dsh-agent-avatar";
    var PICKER_ATTR = "data-dsh-agent-picker";

    // ---------- 确定性身份派生（与 src/agent-identity.js 同构） ----------
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
    function gradientFor(hue) {
      return "linear-gradient(135deg, hsl(" + hue + " 62% 46%), hsl(" + ((hue + 40) % 360) + " 70% 60%))";
    }

    // ---------- 头像偏好（与 src/avatar-store.js 同构） ----------
    function normalizeAvatarSpec(value) {
      if (value === null || value === undefined || typeof value !== "object") return null;
      if (value.type === "color") {
        var hue = Number(value.hue);
        if (Number.isFinite(hue) && hue >= 0 && hue < 360) return { type: "color", hue: Math.round(hue) };
        return null;
      }
      if (value.type === "emoji") {
        var char = String(value.char || "");
        if (char.length > 0 && char.length <= 4) return { type: "emoji", char: char };
        return null;
      }
      return null;
    }
    function parseAvatarMap(raw) {
      var out = {};
      if (typeof raw !== "string" || raw.length === 0) return out;
      var parsed;
      try { parsed = JSON.parse(raw); } catch (e) { return out; }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return out;
      var count = 0;
      for (var id in parsed) {
        var norm = normalizeAvatarSpec(parsed[id]);
        if (norm !== null && typeof id === "string" && id.length > 0 && id.length <= 128) {
          out[id] = norm;
          count += 1;
          if (count >= 200) break;
        }
      }
      return out;
    }
    function readAvatarMap() {
      try {
        return parseAvatarMap(window.localStorage.getItem(AVATARS_KEY));
      } catch (e) {
        return {};
      }
    }
    function writeAvatar(workspaceId, spec) {
      var map = readAvatarMap();
      if (spec === null) delete map[workspaceId];
      else map[workspaceId] = spec;
      try {
        var keys = Object.keys(map);
        if (keys.length === 0) window.localStorage.removeItem(AVATARS_KEY);
        else window.localStorage.setItem(AVATARS_KEY, JSON.stringify(map));
        return true;
      } catch (e) {
        return false;
      }
    }

    // ---------- 模式 ----------
    function normalizeMode(v) { return v === MODE_AGENT ? MODE_AGENT : MODE_OFFICIAL; }
    function readMode() {
      try {
        var v = window.localStorage.getItem(MODE_KEY);
        // 未设置（null）默认 Agent 模式——头像显示是插件的核心价值
        if (v === null) return MODE_AGENT;
        return normalizeMode(v);
      } catch (e) {
        return MODE_AGENT;
      }
    }
    function writeMode(m) {
      try { window.localStorage.setItem(MODE_KEY, m); return true; }
      catch (e) { return false; }
    }

    // ---------- 头像元素 ----------
    // spec: null=默认派生 | {type:'color',hue} | {type:'emoji',char}
    function renderAvatarEl(workspaceId, title, spec) {
      var el = document.createElement("span");
      el.className = "dsh-agent-avatar";
      el.setAttribute(AVATAR_ATTR, workspaceId);
      el.title = "点击更换头像";
      if (spec === null) {
        var hue = hueFor(workspaceId);
        el.style.background = gradientFor(hue);
        el.textContent = initialFor(title, workspaceId);
        el.dataset.kind = "default";
        el.dataset.hue = String(hue);
      } else if (spec.type === "color") {
        el.style.background = gradientFor(spec.hue);
        el.textContent = initialFor(title, workspaceId);
        el.dataset.kind = "color";
        el.dataset.hue = String(spec.hue);
      } else {
        el.style.background = "transparent";
        el.textContent = spec.char;
        el.dataset.kind = "emoji";
      }
      return el;
    }

    // ---------- 头像选择器（portal，点外部/ESC 关闭） ----------
    var PRESET_HUES = [210, 262, 325, 14, 152, 90, 190, 45];
    var PRESET_EMOJIS = ["🤖", "👩‍💻", "🧑‍💻", "🦊", "🐱", "🐶", "👻", "🌟", "🚀", "🛠️", "📦", "🔮"];

    function openPicker(anchorEl, workspaceId, title, onChange) {
      closePicker(); // 先关旧的
      var overlay = document.createElement("div");
      overlay.className = "dsh-agent-picker-overlay";
      overlay.setAttribute(PICKER_ATTR, "");
      var box = document.createElement("div");
      box.className = "dsh-agent-picker";
      box.addEventListener("click", function (e) { e.stopPropagation(); });

      var header = document.createElement("div");
      header.className = "dsh-agent-picker-header";
      header.textContent = title || "(workspace)";

      var colorRow = document.createElement("div");
      colorRow.className = "dsh-agent-picker-row";
      colorRow.textContent = "颜色";
      var colorGrid = document.createElement("div");
      colorGrid.className = "dsh-agent-picker-grid";
      PRESET_HUES.forEach(function (hue) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "dsh-agent-picker-swatch";
        b.style.background = gradientFor(hue);
        b.title = "hsl " + hue;
        b.addEventListener("click", function () {
          onChange({ type: "color", hue: hue });
          closePicker();
        });
        colorGrid.appendChild(b);
      });
      colorRow.appendChild(colorGrid);

      var emojiRow = document.createElement("div");
      emojiRow.className = "dsh-agent-picker-row";
      emojiRow.textContent = "Emoji";
      var emojiGrid = document.createElement("div");
      emojiGrid.className = "dsh-agent-picker-grid";
      PRESET_EMOJIS.forEach(function (ch) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "dsh-agent-picker-emoji";
        b.textContent = ch;
        b.addEventListener("click", function () {
          onChange({ type: "emoji", char: ch });
          closePicker();
        });
        emojiGrid.appendChild(b);
      });
      emojiRow.appendChild(emojiGrid);

      var resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "dsh-agent-picker-reset";
      resetBtn.textContent = "重置默认";
      resetBtn.addEventListener("click", function () {
        onChange(null); // null = 默认派生
        closePicker();
      });

      box.appendChild(header);
      box.appendChild(colorRow);
      box.appendChild(emojiRow);
      box.appendChild(resetBtn);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      // 定位：锚到头像附近
      var rect = anchorEl.getBoundingClientRect();
      var vw = window.innerWidth, vh = window.innerHeight;
      var bw = 220, bh = 260;
      var left = Math.min(Math.max(8, rect.right + 4), vw - bw - 8);
      var top = Math.min(Math.max(8, rect.top), vh - bh - 8);
      box.style.left = left + "px";
      box.style.top = top + "px";

      function onDocClick(e) {
        if (e.target !== overlay && !overlay.contains(e.target)) closePicker();
      }
      function onKey(e) {
        if (e.key === "Escape") closePicker();
      }
      setTimeout(function () {
        document.addEventListener("click", onDocClick, true);
        document.addEventListener("keydown", onKey, true);
      }, 0);
      window.__pickerCleanup = function () {
        document.removeEventListener("click", onDocClick, true);
        document.removeEventListener("keydown", onKey, true);
        overlay.remove();
        window.__pickerCleanup = null;
      };
    }
    function closePicker() {
      if (window.__pickerCleanup) window.__pickerCleanup();
    }

    // ---------- DOM 注入核心 ----------
    function setupAvatarInjection(ctx, subscribeMode) {
      if (typeof document === "undefined" || typeof MutationObserver === "undefined") return function () {};

      var workspacesService = null;
      try { workspacesService = ctx.get("workspaces"); } catch (e) { workspacesService = null; }

      // title -> workspaceId 映射（workspaces.list 快照）
      function workspaceIndex() {
        var byTitle = {};
        try {
          var snap = workspacesService && workspacesService.list && workspacesService.list.getSnapshot();
          var items = (snap && snap.items) || [];
          for (var i = 0; i < items.length; i++) {
            var ws = items[i];
            if (ws && typeof ws.title === "string" && ws.title !== "" && !byTitle[ws.title]) {
              byTitle[ws.title] = ws.workspaceId;
            }
          }
        } catch (e) { /* 服务不可用：空索引 */ }
        return byTitle;
      }

      function injectIntoRow(row) {
        if (row.getAttribute("data-dsh-agent-avatar-injected") === "1") return; // 幂等
        // 找标题 + folder 图标（workspace 行特征）
        var folder = row.querySelector('[class*="folder"]');
        if (!folder) return; // 不是 workspace 行（session 行无 folder）
        var titleEl = row.querySelector('[class*="title"]');
        var title = titleEl ? titleEl.textContent.trim() : "";
        if (!title) return;

        var byTitle = workspaceIndex();
        var workspaceId = byTitle[title];
        if (!workspaceId) return; // 匹配不到（重命名竞态/未加载），下轮再试

        // 头像元素插到 folder 图标前（视觉上替换文件夹图标）
        var avatar = renderAvatarEl(workspaceId, title, readAvatarMap()[workspaceId] || null);
        function onAvatarClick(e) {
          e.stopPropagation(); // 不触发行展开
          e.preventDefault();
          // 选择器回调：写偏好 -> 在当前 DOM 中把头像换成新元素（不依赖闭包旧引用）
          openPicker(avatar, title, workspaceId, function (spec) {
            writeAvatar(workspaceId, spec);
            var cur = row.querySelector("[" + AVATAR_ATTR + '="' + workspaceId + '"]');
            var fresh = renderAvatarEl(workspaceId, title, readAvatarMap()[workspaceId] || null);
            fresh.addEventListener("click", onAvatarClick);
            if (cur && cur.parentNode) cur.replaceWith(fresh);
            else folder.parentNode.insertBefore(fresh, folder);
          });
        }
        avatar.addEventListener("click", onAvatarClick);
        folder.parentNode.insertBefore(avatar, folder);
        row.setAttribute("data-dsh-agent-avatar-injected", "1");
      }

      var isAgentMode = function () { return normalizeMode(readMode()) === MODE_AGENT; };

      // 主注入：遍历侧栏所有 workspace 行
      function injectAll() {
        if (!isAgentMode()) return;
        // 先清掉旧头像与行标记（自愈场景：React 重渲染后行可能是新 DOM，旧的还在树里）
        var olds = document.querySelectorAll("[" + AVATAR_ATTR + "]");
        for (var oi = 0; oi < olds.length; oi++) {
          var o = olds[oi];
          if (o.parentNode) o.parentNode.removeChild(o);
        }
        var marked = document.querySelectorAll("[data-dsh-agent-avatar-injected]");
        for (var mi = 0; mi < marked.length; mi++) {
          marked[mi].removeAttribute("data-dsh-agent-avatar-injected");
        }
        var rows = document.querySelectorAll('[data-pane="sidebar"] [role="treeitem"], [class*="sidebarCol"] [role="treeitem"]');
        for (var i = 0; i < rows.length; i++) {
          try { injectIntoRow(rows[i]); } catch (e) { /* 单行失败不影响其他 */ }
        }
      }
      // 反注入：清掉我们加的头像（切官方模式）
      function removeAll() {
        var avatars = document.querySelectorAll("[" + AVATAR_ATTR + "]");
        for (var i = 0; i < avatars.length; i++) {
          var a = avatars[i];
          if (a.parentNode) a.parentNode.removeChild(a);
        }
        var rows = document.querySelectorAll("[data-dsh-agent-avatar-injected]");
        for (var j = 0; j < rows.length; j++) rows[j].removeAttribute("data-dsh-agent-avatar-injected");
        closePicker();
      }

      // MutationObserver 自愈：行重渲染/新增时重新注入
      var observer = new MutationObserver(function () {
        // 防抖：React 连续重渲染时合并
        if (window.__avatarFlush) clearTimeout(window.__avatarFlush);
        window.__avatarFlush = setTimeout(function () {
          if (isAgentMode()) injectAll();
          else removeAll();
        }, 60);
      });
      var root = document.body;
      observer.observe(root, { childList: true, subtree: true });

      // 初始注入 + 模式联动
      setTimeout(injectAll, 300);
      var modeUnsub = subscribeMode(function () {
        if (isAgentMode()) injectAll();
        else removeAll();
      });

      return function () {
        if (window.__avatarFlush) clearTimeout(window.__avatarFlush);
        observer.disconnect();
        if (modeUnsub) modeUnsub();
        removeAll();
      };
    }

    // ---------- 模式开关：注入到官方头部「分组方式」按钮旁 ----------
    // 官方 sectionHeader 行：sectionLabel + searchSlot + headerActions；
    // headerActions 里第一个按钮是 ViewOptionsMenu（aria-label="视图选项"/"View options"）。
    // 我们把模式切换按钮插在它前面（视觉上同排），不占用 footer。
    function setupHeaderToggle(subscribeMode, notify) {
      if (typeof document === "undefined" || typeof MutationObserver === "undefined") return function () {};
      var TOGGLE_ATTR = "data-dsh-agent-mode-toggle";
      var btn = null;

      function makeBtn() {
        var b = document.createElement("button");
        b.type = "button";
        b.setAttribute(TOGGLE_ATTR, "");
        b.className = "dsh-agent-header-toggle";
        b.title = "切换 Agent 模式";
        b.addEventListener("click", function () {
          var m = normalizeMode(readMode());
          writeMode(m === MODE_AGENT ? MODE_OFFICIAL : MODE_AGENT);
          notify();
        });
        return b;
      }
      function syncLabel() {
        if (!btn) return;
        var agent = normalizeMode(readMode()) === MODE_AGENT;
        btn.textContent = agent ? "🤖" : "👁️";
        btn.setAttribute("aria-label", agent ? "Agent 模式（点击切回官方）" : "官方模式（点击切换 Agent）");
        btn.title = agent ? "切回官方模式（隐藏头像）" : "切换为 Agent 模式（显示头像）";
      }
      function tryPlace() {
        if (!btn) btn = makeBtn();
        // 已在 DOM 就绪
        if (btn.parentElement && document.contains(btn)) {
          syncLabel();
          return true;
        }
        // 找官方头部 actions 行：优先 aria-label 视图选项按钮的父容器
        var viewBtn = document.querySelector('button[aria-label="视图选项"], button[aria-label="View options"]');
        var anchor = viewBtn ? viewBtn.parentElement : null;
        if (!anchor) {
          // 兜底：找 sectionHeader 的 headerActions 容器
          var headers = document.querySelectorAll('[class*="sectionHeader"] [class*="headerActions"]');
          if (headers.length > 0) anchor = headers[headers.length - 1];
        }
        if (!anchor || btn.parentElement === anchor) return anchor !== null;
        anchor.insertBefore(btn, anchor.firstChild);
        syncLabel();
        return true;
      }
      var observer = new MutationObserver(function () {
        if (window.__headerToggleFlush) clearTimeout(window.__headerToggleFlush);
        window.__headerToggleFlush = setTimeout(tryPlace, 80);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      tryPlace();
      var unsub = subscribeMode(function () { syncLabel(); });
      return function () {
        if (window.__headerToggleFlush) clearTimeout(window.__headerToggleFlush);
        observer.disconnect();
        if (unsub) unsub();
        if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
        btn = null;
      };
    }

    // ---------- 注册 ----------
    function apply(ctx) {
      var listeners = new Set();

      function notify() {
        listeners.forEach(function (l) { try { l(); } catch (e) { /* ignore */ } });
      }
      function subscribeMode(l) {
        listeners.add(l);
        return function () { listeners.delete(l); };
      }

      // 注入 CSS
      var styleEl = document.createElement("style");
      styleEl.textContent = css;
      document.head.appendChild(styleEl);
      ctx.effect(function () { return function () { styleEl.remove(); }; });

      // 头像 DOM 注入（核心）
      var disposeInjection = setupAvatarInjection(ctx, subscribeMode);
      ctx.effect(function () { return disposeInjection; });

      // 头部「分组方式」旁的模式切换按钮（官方 headerActions 内注入）
      var disposeHeaderToggle = setupHeaderToggle(subscribeMode, notify);
      ctx.effect(function () { return disposeHeaderToggle; });
    }

    // ---------- CSS ----------
    var css = [
      // 头像：16px 圆块，替换文件夹图标位置
      ".dsh-agent-avatar{width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:700;flex:none;cursor:pointer;line-height:1;text-shadow:0 1px 2px rgba(0,0,0,.3);margin-right:-2px}",
      ".dsh-agent-avatar:hover{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}",
      // 官方文件夹图标在 hover 时隐藏，头像常驻
      ".dsh-agent-avatar + [class*='folder']{display:none !important}",
      // 选择器
      ".dsh-agent-picker-overlay{position:fixed;inset:0;z-index:9999;background:transparent}",
      ".dsh-agent-picker{position:fixed;width:220px;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:10px;box-shadow:var(--dsw-alias-shadow,0 4px 16px rgba(0,0,0,.15));padding:10px;z-index:10000;font-family:inherit}",
      ".dsh-agent-picker-header{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#0f172a);margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".dsh-agent-picker-row{font-size:11px;color:var(--dsw-alias-label-tertiary,#64748b);margin:6px 0 4px}",
      ".dsh-agent-picker-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}",
      ".dsh-agent-picker-swatch{width:20px;height:20px;border-radius:50%;border:1px solid rgba(0,0,0,.1);cursor:pointer;padding:0}",
      ".dsh-agent-picker-swatch:hover{transform:scale(1.15)}",
      ".dsh-agent-picker-emoji{width:26px;height:24px;font-size:15px;border:none;background:transparent;cursor:pointer;border-radius:6px;padding:0}",
      ".dsh-agent-picker-emoji:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f5f9)}",
      ".dsh-agent-picker-reset{display:block;width:100%;margin-top:10px;padding:5px 0;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);background:transparent;color:var(--dsw-alias-label-secondary,#334155);cursor:pointer;border-radius:6px;font-size:12px}",
      ".dsh-agent-picker-reset:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f5f9)}",
      // 头部模式切换按钮（官方 headerActions 同款 28px 图标按钮）
      ".dsh-agent-header-toggle{corner-shape:round;cursor:pointer;width:28px;height:28px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex;font-size:14px}",
      ".dsh-agent-header-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}"
    ].join("\n");

    module.exports = {
      name: "dev-agent-mode",
      inject: ["slots"],
      apply: apply
    };
    return module.exports;
  }
});
