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
      if (value.type === "image") {
        var dataUrl = String(value.dataUrl || "");
        if (dataUrl.indexOf("data:image/") === 0 && dataUrl.length > 0 && dataUrl.length <= 200000) {
          return { type: "image", dataUrl: dataUrl };
        }
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
    // spec: null=默认派生 | {type:'color',hue} | {type:'emoji',char} | {type:'image',dataUrl}
    // opts.marker=false：不标记 AVATAR_ATTR（picker 内部预览用——否则会被 injectAll 当旧头像清掉）
    function renderAvatarEl(workspaceId, title, spec, opts) {
      var marker = !(opts && opts.marker === false);
      var el = document.createElement("span");
      el.className = "dsh-agent-avatar";
      if (marker) el.setAttribute(AVATAR_ATTR, workspaceId);
      el.title = "点击配置头像";
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
      } else if (spec.type === "image") {
        // 图片头像：background-image + cover（16px 圆）
        el.style.background = "transparent";
        el.style.backgroundImage = "url(\"" + spec.dataUrl + "\")";
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
        el.textContent = "";
        el.dataset.kind = "image";
      } else {
        el.style.background = "transparent";
        el.textContent = spec.char;
        el.dataset.kind = "emoji";
      }
      return el;
    }

    // ---------- 头像配置窗口（portal，点外部/ESC 关闭；支持预选头像/AI 生成/上传图片/色块/emoji/重置） ----------
    var PRESET_HUES = [210, 262, 325, 14, 152, 90, 190, 45];
    var PRESET_EMOJIS = ["🤖", "👩‍💻", "🧑‍💻", "🦊", "🐱", "🐶", "👻", "🌟", "🚀", "🛠️", "📦", "🔮"];
    var MAX_IMAGE_DATA_URL = 200000; // 200KB，与 avatar-store 一致
    var BITMAP_COMPRESS_THRESHOLD = 150000; // 位图 dataURL 超 150KB 即 Canvas 压缩
    var AI_API = "/dsh-dev-agent-mode/api/avatar-suggest";

    // ---------- 预选头像：DiceBear 9.x（CORS 开放，单图 ~1.5KB SVG，客户端直连） ----------
    var DICEBEAR_STYLES = ["bottts-neutral", "adventurer-neutral", "thumbs", "shapes"];
    var DICEBEAR_PER_STYLE = 6;
    function dicebearUrl(style, seed) {
      return "https://api.dicebear.com/9.x/" + style + "/svg?seed=" + encodeURIComponent(seed);
    }
    // 每个 workspace 看到不同的预选（seed 混入 workspaceId 首字符 fnv）
    function presetSeeds(workspaceId) {
      var base = fnv1a(String(workspaceId || "ws")) % 89;
      var out = [];
      for (var i = 0; i < DICEBEAR_PER_STYLE; i++) {
        out.push("agent-" + (base + i * 7));
      }
      return out;
    }
    // 拉一个 DiceBear SVG 转 dataURL（utf8 编码），失败回 null
    function fetchDicebear(style, seed, signal) {
      return fetch(dicebearUrl(style, seed), { signal: signal })
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (svg) {
          if (!svg || svg.indexOf("<svg") < 0) return null;
          return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
        })
        .catch(function () { return null; });
    }

    // ---------- 位图压缩：dataURL 超阈值就 Canvas 压 128px PNG ----------
    function compressBitmapDataUrl(dataUrl) {
      return new Promise(function (resolve) {
        try {
          var img = new Image();
          img.onload = function () {
            try {
              var size = 128;
              var canvas = document.createElement("canvas");
              canvas.width = size;
              canvas.height = size;
              var ctx2 = canvas.getContext("2d");
              // 居中裁剪成正方形
              var w = img.naturalWidth, h = img.naturalHeight;
              var side = Math.min(w, h);
              var sx = (w - side) / 2, sy = (h - side) / 2;
              ctx2.drawImage(img, sx, sy, side, side, 0, 0, size, size);
              resolve(canvas.toDataURL("image/png"));
            } catch (e) { resolve(dataUrl); } // 失败原样返回
          };
          img.onerror = function () { resolve(dataUrl); };
          img.src = dataUrl;
        } catch (e) { resolve(dataUrl); }
      });
    }

    // ---------- 统一图片入口：SVG 直过；位图超阈值压缩；最终仍超 200KB 报错 ----------
    // cb 约定：成功 cb({type:'image',dataUrl})，失败 cb(null) 并 showError
    function acceptImageDataUrl(dataUrl, showError, cb) {
      if (typeof dataUrl !== "string" || dataUrl.indexOf("data:image/") !== 0) {
        showError("不是有效图片");
        cb(null);
        return;
      }
      if (dataUrl.indexOf("data:image/svg+xml") === 0) {
        // SVG 不压缩（已是矢量小文本），直接校验大小
        if (dataUrl.length > MAX_IMAGE_DATA_URL) {
          showError("图片超过 200KB，请换小图");
          cb(null);
          return;
        }
        cb({ type: "image", dataUrl: dataUrl });
        return;
      }
      // 位图：超阈值压缩
      var finish = function (finalUrl) {
        if (finalUrl.length > MAX_IMAGE_DATA_URL) {
          showError("压缩后仍超 200KB，请换小图");
          cb(null);
          return;
        }
        cb({ type: "image", dataUrl: finalUrl });
      };
      if (dataUrl.length > BITMAP_COMPRESS_THRESHOLD) {
        compressBitmapDataUrl(dataUrl).then(finish);
      } else {
        finish(dataUrl);
      }
    }

    function openAvatarConfig(anchorEl, workspaceId, title, onChange) {
      closePicker(); // 先关旧的
      var overlay = document.createElement("div");
      overlay.className = "dsh-agent-picker-overlay";
      overlay.setAttribute(PICKER_ATTR, "");
      var box = document.createElement("div");
      box.className = "dsh-agent-picker";
      box.addEventListener("click", function (e) { e.stopPropagation(); });

      // 头部：标题 + 当前头像预览（放大）
      var header = document.createElement("div");
      header.className = "dsh-agent-picker-header";
      var headerText = document.createElement("span");
      headerText.className = "dsh-agent-picker-header-text";
      headerText.textContent = title || "(workspace)";
      header.appendChild(headerText);

      var previewWrap = document.createElement("div");
      previewWrap.className = "dsh-agent-picker-preview-wrap";
      var currentSpec = readAvatarMap()[workspaceId] || null;
      var preview = renderAvatarEl(workspaceId, title, currentSpec, { marker: false });
      preview.className = "dsh-agent-picker-preview";
      preview.title = "";
      previewWrap.appendChild(preview);

      // 错误提示行（上传失败/超限）
      var errorEl = document.createElement("div");
      errorEl.className = "dsh-agent-picker-error";
      errorEl.style.display = "none";
      function showError(msg) {
        errorEl.textContent = msg;
        errorEl.style.display = "block";
      }
      function hideError() {
        errorEl.style.display = "none";
      }

      // ---------- 预选头像区（DiceBear，客户端直连；离线/失败自动降级隐藏） ----------
      var presetRow = document.createElement("div");
      presetRow.className = "dsh-agent-picker-row";
      presetRow.textContent = "推荐";
      var presetGrid = document.createElement("div");
      presetGrid.className = "dsh-agent-picker-grid dsh-agent-picker-preset-grid";
      presetRow.appendChild(presetGrid);
      var presetStatus = document.createElement("div");
      presetStatus.className = "dsh-agent-picker-preset-status";
      presetStatus.textContent = "加载推荐中…";
      presetRow.appendChild(presetStatus);
      var presetAbort = new AbortController();
      (function loadPresets() {
        var seeds = presetSeeds(workspaceId);
        var total = DICEBEAR_STYLES.length * DICEBEAR_PER_STYLE;
        var done = 0, ok = 0;
        var tasks = [];
        DICEBEAR_STYLES.forEach(function (style) {
          seeds.forEach(function (seed) {
            tasks.push({ style: style, seed: seed });
          });
        });
        // 并发 6 个，全回后更新状态
        var idx = 0;
        function step() {
          while (idx < tasks.length && (idx - done) < 6) {
            (function (t) {
              idx++;
              fetchDicebear(t.style, t.seed, presetAbort.signal).then(function (dataUrl) {
                done++;
                if (dataUrl) {
                  ok++;
                  var b = document.createElement("button");
                  b.type = "button";
                  b.className = "dsh-agent-picker-preset";
                  b.title = t.style + " / " + t.seed;
                  var im = document.createElement("img");
                  im.src = dataUrl;
                  im.alt = "";
                  b.appendChild(im);
                  b.addEventListener("click", function () {
                    hideError();
                    acceptImageDataUrl(dataUrl, showError, function (spec) {
                      if (spec) {
                        onChange(spec);
                        closePicker();
                      }
                    });
                  });
                  presetGrid.appendChild(b);
                }
                if (done === total) {
                  presetStatus.textContent = ok === 0 ? "推荐不可用（需外网）" : "";
                  if (ok === 0) presetRow.classList.add("dsh-agent-picker-preset-offline");
                }
                step();
              });
            })(tasks[idx]);
          }
        }
        step();
      })();

      // ---------- AI 生成区（POST host 路由，文生 SVG；服务降级时禁用） ----------
      var aiRow = document.createElement("div");
      aiRow.className = "dsh-agent-picker-row";
      aiRow.textContent = "AI 生成";
      var aiInputRow = document.createElement("div");
      aiInputRow.className = "dsh-agent-picker-ai-inputrow";
      var aiInput = document.createElement("input");
      aiInput.type = "text";
      aiInput.className = "dsh-agent-picker-ai-input";
      aiInput.placeholder = "描述头像，如：赛博朋克猫";
      aiInput.maxLength = 200;
      var aiBtn = document.createElement("button");
      aiBtn.type = "button";
      aiBtn.className = "dsh-agent-picker-ai-btn";
      aiBtn.textContent = "生成";
      aiInputRow.appendChild(aiInput);
      aiInputRow.appendChild(aiBtn);
      aiRow.appendChild(aiInputRow);
      // AI 预览（生成后显示：采用/重试）
      var aiPreview = document.createElement("div");
      aiPreview.className = "dsh-agent-picker-ai-preview";
      aiPreview.style.display = "none";
      aiRow.appendChild(aiPreview);
      var aiAbort = null;
      function aiBusy(b) {
        aiBtn.disabled = b;
        aiInput.disabled = b;
        aiBtn.textContent = b ? "生成中…" : "生成";
      }
      function runGenerate() {
        var prompt = aiInput.value.trim();
        if (!prompt) {
          showError("先描述一下头像");
          return;
        }
        hideError();
        aiPreview.style.display = "none";
        aiBusy(true);
        aiAbort = new AbortController();
        fetch(AI_API, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: prompt }),
          signal: aiAbort.signal
        })
          .then(function (r) {
            return r.json().then(function (body) { return { status: r.status, body: body }; });
          })
          .then(function (res) {
            aiBusy(false);
            var body = res.body || {};
            if (res.status === 200 && body.dataUrl) {
              acceptImageDataUrl(body.dataUrl, showError, function (spec) {
                if (!spec) return;
                // 内联预览（采用/重试）
                aiPreview.textContent = "";
                var pv = renderAvatarEl(workspaceId, title, spec, { marker: false });
                pv.className = "dsh-agent-picker-preview dsh-agent-picker-ai-avatar";
                pv.title = "";
                var acceptBtn = document.createElement("button");
                acceptBtn.type = "button";
                acceptBtn.className = "dsh-agent-picker-ai-accept";
                acceptBtn.textContent = "采用";
                acceptBtn.addEventListener("click", function () {
                  onChange(spec);
                  closePicker();
                });
                aiPreview.appendChild(pv);
                aiPreview.appendChild(acceptBtn);
                aiPreview.style.display = "flex";
              });
              return;
            }
            var errMap = {
              "no-model": "请先在设置里配置默认模型",
              "rate-limited": "模型限流中，稍后再试",
              "llm-failed": "生成失败，再试一次",
              "too-large": "生成过大，换个简单描述",
              "no-svg": "模型没画出来，换个描述",
              "bad-prompt": "描述无效"
            };
            showError(errMap[body.error] || "生成失败（" + (body.error || res.status) + "）");
          })
          .catch(function (e) {
            aiBusy(false);
            if (e && e.name === "AbortError") return;
            showError("网络错误，稍后再试");
          });
      }
      aiBtn.addEventListener("click", runGenerate);
      aiInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") runGenerate();
      });

      // 上传图片区块（走统一入口：位图超限自动压缩）
      var uploadRow = document.createElement("div");
      uploadRow.className = "dsh-agent-picker-row";
      uploadRow.textContent = "上传";
      var uploadLabel = document.createElement("label");
      uploadLabel.className = "dsh-agent-picker-upload";
      uploadLabel.textContent = "选择图片（大图自动压缩）";
      var fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/*";
      fileInput.style.display = "none";
      fileInput.addEventListener("change", function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        hideError();
        var reader = new FileReader();
        reader.onload = function () {
          acceptImageDataUrl(String(reader.result || ""), showError, function (spec) {
            fileInput.value = "";
            if (spec) {
              onChange(spec);
              closePicker();
            }
          });
        };
        reader.onerror = function () {
          showError("读取图片失败");
          fileInput.value = "";
        };
        reader.readAsDataURL(file);
      });
      uploadLabel.appendChild(fileInput);
      uploadRow.appendChild(uploadLabel);

      // 颜色区块
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

      // emoji 区块
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

      // 重置按钮
      var resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "dsh-agent-picker-reset";
      resetBtn.textContent = "重置默认";
      resetBtn.addEventListener("click", function () {
        onChange(null); // null = 默认派生
        closePicker();
      });

      box.appendChild(header);
      box.appendChild(previewWrap);
      box.appendChild(presetRow);
      box.appendChild(aiRow);
      box.appendChild(uploadRow);
      box.appendChild(colorRow);
      box.appendChild(emojiRow);
      box.appendChild(errorEl);
      box.appendChild(resetBtn);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      // 定位：锚到头像附近（窗口更高，向上展开优先）
      var rect = anchorEl.getBoundingClientRect();
      var vw = window.innerWidth, vh = window.innerHeight;
      var bw = 240, bh = 620;
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
        if (presetAbort) presetAbort.abort();
        if (aiAbort) aiAbort.abort();
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
          // 配置窗口回调：写偏好 -> 在当前 DOM 中把头像换成新元素（不依赖闭包旧引用）
          openAvatarConfig(avatar, workspaceId, title, function (spec) {
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
    // 按钮样式：纯图标（官方 iconButton 同款视觉），不用 emoji、不用文字。
    function setupHeaderToggle(subscribeMode, notify) {
      if (typeof document === "undefined" || typeof MutationObserver === "undefined") return function () {};
      var TOGGLE_ATTR = "data-dsh-agent-mode-toggle";
      var btn = null;

      // 通用图标（内联 SVG，16x16 描边，对齐官方视觉；不用 emoji）
      // agent 模式 = 机器人头（增强/拟人），官方模式 = 文件夹（左侧栏默认视图）
      function iconEl(kind) {
        var ns = "http://www.w3.org/2000/svg";
        var svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 16 16");
        svg.setAttribute("width", "16");
        svg.setAttribute("height", "16");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "1.3");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        svg.setAttribute("aria-hidden", "true");
        if (kind === "agent") {
          // 机器人头：圆角头 + 天线 + 双眼
          var ant = document.createElementNS(ns, "line");
          ant.setAttribute("x1", "8");
          ant.setAttribute("y1", "1.5");
          ant.setAttribute("x2", "8");
          ant.setAttribute("y2", "3.2");
          svg.appendChild(ant);
          var ball = document.createElementNS(ns, "circle");
          ball.setAttribute("cx", "8");
          ball.setAttribute("cy", "1.3");
          ball.setAttribute("r", "0.9");
          ball.setAttribute("fill", "currentColor");
          ball.setAttribute("stroke", "none");
          svg.appendChild(ball);
          var head = document.createElementNS(ns, "rect");
          head.setAttribute("x", "2.6");
          head.setAttribute("y", "3.4");
          head.setAttribute("width", "10.8");
          head.setAttribute("height", "9.2");
          head.setAttribute("rx", "2.6");
          svg.appendChild(head);
          var e1 = document.createElementNS(ns, "circle");
          e1.setAttribute("cx", "6");
          e1.setAttribute("cy", "7.6");
          e1.setAttribute("r", "1.1");
          e1.setAttribute("fill", "currentColor");
          e1.setAttribute("stroke", "none");
          svg.appendChild(e1);
          var e2 = document.createElementNS(ns, "circle");
          e2.setAttribute("cx", "10");
          e2.setAttribute("cy", "7.6");
          e2.setAttribute("r", "1.1");
          e2.setAttribute("fill", "currentColor");
          e2.setAttribute("stroke", "none");
          svg.appendChild(e2);
          var mouth = document.createElementNS(ns, "path");
          mouth.setAttribute("d", "M5 11.4c1 .7 2 .7 3 .7s2 0 3-.7");
          svg.appendChild(mouth);
        } else {
          // 文件夹（官方左侧栏视图）
          var flap = document.createElementNS(ns, "path");
          flap.setAttribute("d", "M2 4.6h3.6l1.2 1.4H14v6.6a1.6 1.6 0 01-1.6 1.6H3.6A1.6 1.6 0 012 12.6V4.6z");
          svg.appendChild(flap);
          var fold = document.createElementNS(ns, "path");
          fold.setAttribute("d", "M2 7.4h12");
          svg.appendChild(fold);
        }
        return svg;
      }

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
      function syncIcon() {
        if (!btn) return;
        var agent = normalizeMode(readMode()) === MODE_AGENT;
        // 纯图标，不加文字（避免与官方文字按钮争宽度）
        btn.textContent = "";
        btn.appendChild(iconEl(agent ? "agent" : "official"));
        btn.setAttribute("aria-label", agent ? "Agent 模式（点击切回官方）" : "官方模式（点击切换 Agent）");
        btn.title = agent ? "切回官方模式（隐藏头像）" : "切换为 Agent 模式（显示头像）";
      }
      function tryPlace() {
        if (!btn) btn = makeBtn();
        // 已在 DOM 就绪
        if (btn.parentElement && document.contains(btn)) {
          syncIcon();
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
        syncIcon();
        return true;
      }
      var observer = new MutationObserver(function () {
        if (window.__headerToggleFlush) clearTimeout(window.__headerToggleFlush);
        window.__headerToggleFlush = setTimeout(tryPlace, 80);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      tryPlace();
      var unsub = subscribeMode(function () { syncIcon(); });
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
      ".dsh-agent-avatar{background-size:cover;background-position:center}",
      // 官方文件夹图标在 hover 时隐藏，头像常驻
      ".dsh-agent-avatar + [class*='folder']{display:none !important}",
      // 头像配置窗口
      ".dsh-agent-picker-overlay{position:fixed;inset:0;z-index:9999;background:transparent}",
      ".dsh-agent-picker{position:fixed;width:240px;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:10px;box-shadow:var(--dsw-alias-shadow,0 4px 16px rgba(0,0,0,.15));padding:10px;z-index:10000;font-family:inherit;max-height:calc(100vh - 24px);overflow-y:auto}",
      ".dsh-agent-picker-header{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#0f172a);margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".dsh-agent-picker-header-text{min-width:0;overflow:hidden;text-overflow:ellipsis}",
      ".dsh-agent-picker-preview-wrap{display:flex;align-items:center;justify-content:center;margin-bottom:8px}",
      ".dsh-agent-picker-preview{width:48px;height:48px;border-radius:50%;font-size:20px;font-weight:700;color:#fff;display:inline-flex;align-items:center;justify-content:center;background-size:cover;background-position:center;cursor:default}",
      ".dsh-agent-picker-row{font-size:11px;color:var(--dsw-alias-label-tertiary,#64748b);margin:6px 0 4px}",
      ".dsh-agent-picker-upload{display:block;padding:6px 0;border:1px dashed var(--dsw-alias-border-l2,#cbd5e1);border-radius:6px;text-align:center;color:var(--dsw-alias-brand-primary,#2563eb);cursor:pointer;font-size:12px}",
      ".dsh-agent-picker-upload:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f5f9)}",
      ".dsh-agent-picker-error{font-size:11px;color:var(--dsw-alias-state-error-primary,#dc2626);margin:6px 0 0;line-height:16px}",
      ".dsh-agent-picker-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}",
      // 预选头像（DiceBear）
      ".dsh-agent-picker-preset-grid{max-height:120px;overflow-y:auto}",
      ".dsh-agent-picker-preset{width:24px;height:24px;border-radius:50%;border:1px solid rgba(0,0,0,.08);cursor:pointer;padding:0;overflow:hidden;background:var(--dsw-alias-bg-layer-3,#f1f5f9)}",
      ".dsh-agent-picker-preset img{width:100%;height:100%;display:block;object-fit:cover}",
      ".dsh-agent-picker-preset:hover{transform:scale(1.12);border-color:var(--dsw-alias-state-business-primary,#2563eb)}",
      ".dsh-agent-picker-preset-status{font-size:10px;color:var(--dsw-alias-label-quaternary,#94a3b8);margin-top:4px}",
      ".dsh-agent-picker-preset-offline{border:none;padding:0}",
      // AI 生成
      ".dsh-agent-picker-ai-inputrow{display:flex;gap:6px;align-items:center}",
      ".dsh-agent-picker-ai-input{flex:1;min-width:0;height:26px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:6px;font-size:12px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f172a);outline:none}",
      ".dsh-agent-picker-ai-input:focus{border-color:var(--dsw-alias-state-business-primary,#2563eb)}",
      ".dsh-agent-picker-ai-btn{flex:none;height:26px;padding:0 10px;border:none;border-radius:6px;background:var(--dsw-alias-state-business-primary,#2563eb);color:#fff;font-size:12px;cursor:pointer}",
      ".dsh-agent-picker-ai-btn:disabled{opacity:.6;cursor:default}",
      ".dsh-agent-picker-ai-preview{display:flex;align-items:center;gap:10px;margin-top:8px;padding:8px;border:1px dashed var(--dsw-alias-border-l2,#cbd5e1);border-radius:8px}",
      ".dsh-agent-picker-ai-avatar{width:40px;height:40px;border-radius:50%;flex:none}",
      ".dsh-agent-picker-ai-accept{flex:none;height:26px;padding:0 12px;border:none;border-radius:6px;background:var(--dsw-alias-state-business-primary,#2563eb);color:#fff;font-size:12px;cursor:pointer}",
      ".dsh-agent-picker-swatch{width:20px;height:20px;border-radius:50%;border:1px solid rgba(0,0,0,.1);cursor:pointer;padding:0}",
      ".dsh-agent-picker-swatch:hover{transform:scale(1.15)}",
      ".dsh-agent-picker-emoji{width:26px;height:24px;font-size:15px;border:none;background:transparent;cursor:pointer;border-radius:6px;padding:0}",
      ".dsh-agent-picker-emoji:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f5f9)}",
      ".dsh-agent-picker-reset{display:block;width:100%;margin-top:10px;padding:5px 0;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);background:transparent;color:var(--dsw-alias-label-secondary,#334155);cursor:pointer;border-radius:6px;font-size:12px}",
      ".dsh-agent-picker-reset:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f5f9)}",
      // 头部模式切换按钮（纯图标，官方 headerActions 同款 28px）
      ".dsh-agent-header-toggle{corner-shape:round;cursor:pointer;height:28px;width:28px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:14px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}",
      ".dsh-agent-header-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".dsh-agent-header-toggle svg{flex:none}",
    ].join("\n");

    module.exports = {
      name: "dev-agent-mode",
      inject: ["slots"],
      apply: apply
    };
    return module.exports;
  }
});
