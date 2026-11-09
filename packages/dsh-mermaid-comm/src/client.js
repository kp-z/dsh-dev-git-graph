/**
 * dsh-mermaid-comm — client half: the "inject Mermaid guidance" checkbox in the
 * composer tool row.
 *
 * Why this half exists at all: the injection point is a host-side
 * `systemPrompt.section()`. The prompt is assembled on the host, so the host owns
 * the switch and this half is only its remote control — one small toggle in
 * `conversation.input.left`, reading and writing `/dsh-mermaid-comm/state`.
 *
 * Why the state is NOT component state: the official renderer remounts a
 * session-scoped slot component when the session changes (its own note: component
 * local state must not leak between sessions). Component state would therefore
 * reset — and worse, would never reach the host. The host is the single source of
 * truth; this half mirrors it.
 *
 * The control hides itself when the host reports `toggle: false` (i.e. the
 * deployment pinned `promptLevel` to global/off), so the GUI never shows a button
 * that does nothing.
 */
window.__ModuleLoader__.load({
  id: "dsh-mermaid-comm",
  factory: (require) => {
    var module = { exports: {} };
    var React = require("react");
    var h = React.createElement;
    // 官方 Tooltip（primitives 是平台 seed，第三方插件已先例直接 require，如
    // dsh-better-sidebar）。用它而不是原生 title：title 有约 1s 延迟、样式不可控，
    // 且会被 composer 卡片的 overflow 裁掉；官方 Tooltip 是 position:fixed 气泡，
    // 即时（delayMs 默认 0）、贴边自动翻上翻下，视觉与官方控件一致。
    //
    // require 本身若解析不到会抛——那会让整个客户端插件加载失败、按钮直接消失，
    // 所以兜住：拿不到就退回原生 title，按钮照常可用。
    var Tooltip = null;
    try {
      var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
      Tooltip = primitives && primitives.Tooltip ? primitives.Tooltip : null;
    } catch (error) {
      Tooltip = null;
    }

    var SLOT = "conversation.input.left";
    var ENTRY_ID = "mermaid-comm.gate";
    var STATE_URL = "/dsh-mermaid-comm/state";
    var STYLE_ID = "dsh-mermaid-comm-style";

    /* Styling follows the official composer tool-row buttons (the 28x28 round
       "add" control) so the toggle reads as part of the row rather than a
       visitor: same size, same radius, same hover token. The pressed state uses
       the "business" state pair — the same structure the official plan chip
       uses with the warn pair — so "on" is legible in both themes without
       inventing a colour. */
    var CSS = [
      ".dmc-gate{corner-shape:round;background:transparent;width:28px;height:28px;",
      "color:var(--dsw-alias-label-secondary);cursor:pointer;border:none;border-radius:999px;",
      "flex:none;place-items:center;display:grid;padding:0;",
      "transition:background-color .12s ease,color .12s ease}",
      ".dmc-gate:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid);",
      "color:var(--dsw-alias-label-primary)}",
      ".dmc-gate:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}",
      ".dmc-gate[aria-pressed='true']{background:var(--dsw-alias-state-business-tertiary);",
      "color:var(--dsw-alias-state-business-primary)}",
      ".dmc-gate[aria-pressed='true']:hover:not(:disabled){",
      "background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}",
      ".dmc-gate[data-pending='true']{opacity:.55;cursor:default}",
    ].join("");

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return;
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    /* A two-node flowchart glyph: the smallest picture of "a diagram". */
    function Icon() {
      return h("svg", {
        width: 16, height: 16, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: 1.3,
        strokeLinecap: "round", strokeLinejoin: "round",
        "aria-hidden": "true",
      },
        h("rect", { x: 1.6, y: 2.4, width: 5.8, height: 4, rx: 1.2 }),
        h("rect", { x: 8.6, y: 9.6, width: 5.8, height: 4, rx: 1.2 }),
        h("path", { d: "M7.4 4.4h2.6a1.5 1.5 0 0 1 1.5 1.5v3.7" }));
    }

    /* Reads the switch from the host once, then mirrors every write back.
       `null` = not answered yet; the control stays hidden until the host says
       whether it is the one in charge (no flash of a dead button). */
    function useInjectSwitch() {
      var pair = React.useState(null);
      var state = pair[0];
      var setState = pair[1];

      React.useEffect(function () {
        var alive = true;
        fetch(STATE_URL, { credentials: "same-origin" })
          .then(function (res) { return res.ok ? res.json() : null; })
          .then(function (value) { if (alive && value) setState(value); })
          .catch(function () { /* 宿主路由不可用（例如未重启）时静默隐藏 */ });
        return function () { alive = false; };
      }, []);

      var toggle = React.useCallback(function () {
        var next = !(state && state.inject === true);
        // 乐观更新：按钮立刻响应，随后以宿主回读的真值为准。
        setState(function (prev) {
          return prev ? Object.assign({}, prev, { inject: next, pending: true }) : prev;
        });
        fetch(STATE_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ inject: next }),
        })
          .then(function (res) { return res.ok ? res.json() : null; })
          .then(function (value) {
            setState(value ? Object.assign({}, value, { pending: false }) : null);
          })
          .catch(function () {
            setState(function (prev) {
              return prev ? Object.assign({}, prev, { inject: !next, pending: false }) : prev;
            });
          });
      }, [state]);

      return [state, toggle];
    }

    function InjectGate() {
      var pair = useInjectSwitch();
      var state = pair[0];
      var toggle = pair[1];

      // 宿主说这个部署不由按钮控制（promptLevel=global/off），或还没答上来 → 不占位。
      if (!state || state.toggle !== true) return null;

      var on = state.inject === true;
      // Tooltip 气泡的 CSS 是 white-space: pre-line，所以 \n 会真的换行：
      // 第一行说清这个按钮干什么，第二行说当前状态与点击后果。
      var label = on
        ? "Mermaid 图表达：让 AI 优先用图讲清架构、流程、时序\n当前已开启 — 点击关闭"
        : "Mermaid 图表达：让 AI 优先用图讲清架构、流程、时序\n当前已关闭 — 点击开启";

      // 单行版本给 aria-label / 原生 title（tooltip 气泡里用带换行的 label）。
      var flat = label.replace("\n", " ");
      var props = {
        type: "button",
        className: "dmc-gate",
        "aria-label": flat,
        "aria-pressed": on ? "true" : "false",
        "data-pending": state.pending === true ? "true" : "false",
        onClick: toggle,
      };
      // 原生 title 只当 Tooltip 不可用时的退路：它有约 1s 延迟、样式不可控，
      // 而且会被 composer 卡片的 overflow 裁掉。
      if (!Tooltip) props.title = flat;
      var button = h("button", props, h(Icon));

      // 官方 Tooltip：position:fixed 气泡，即时显示（delayMs 默认 0），贴边自动翻向，
      // 且不受 composer 卡片 overflow 影响；视觉与官方控件一致。
      return Tooltip ? h(Tooltip, { label: label, side: "top" }, button) : button;
    }

    function apply(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function") return;
      installStyles();
      // 必须 return 注入回调的 disposer：槽的声明被折叠时会 dispose 这个 effect，
      // 返回了才会连带注销本条目（否则重新声明时同 id 会撞 "already has an entry"）。
      return ctx.slots.inject(SLOT, function () {
        return ctx.slots.register(
          { name: SLOT, id: ENTRY_ID, order: 100 },
          InjectGate,
        );
      });
    }

    module.exports = { name: "mermaid-comm", inject: ["slots"], apply: apply };
    return module.exports;
  },
});
