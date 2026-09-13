window.__ModuleLoader__.load({
  id: "dsh-ios-skin",
  factory: () => {
    var module = { exports: {} };
    var STYLE_ID = "dsh-ios-skin-style";
    function installStyle() {
      var css = [
        ":root{--dsh-ios-blue:#007aff;--dsh-ios-font:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text',system-ui,sans-serif;--dsh-ios-radius-sm:10px;--dsh-ios-radius-md:14px;--dsh-ios-radius-lg:18px;--dsh-ios-glass-blur:20px}",
        "body.dsh-ios-skin,body.dsh-ios-skin *{font-family:var(--dsh-ios-font)}",
        "body.dsh-ios-skin{color-scheme:light;--dsh-ios-bg:#f2f2f7;--dsh-ios-surface:rgba(255,255,255,.72);--dsh-ios-surface-strong:rgba(255,255,255,.86);--dsh-ios-fill:rgba(118,118,128,.12);--dsh-ios-fill-strong:rgba(118,118,128,.2);--dsh-ios-label:#1c1c1e;--dsh-ios-label-secondary:rgba(60,60,67,.72);--dsh-ios-label-tertiary:rgba(60,60,67,.48);--dsh-ios-border:rgba(60,60,67,.18);--dsh-ios-border-soft:rgba(60,60,67,.1);--dsh-ios-shadow:0 12px 32px rgba(0,0,0,.1);--dsw-alias-font-family:var(--dsh-ios-font);--dsw-alias-bg-base:var(--dsh-ios-bg);--dsw-alias-bg-layer-1:var(--dsh-ios-surface);--dsw-alias-bg-layer-2:var(--dsh-ios-surface-strong);--dsw-alias-label-primary:var(--dsh-ios-label);--dsw-alias-label-secondary:var(--dsh-ios-label-secondary);--dsw-alias-label-tertiary:var(--dsh-ios-label-tertiary);--dsw-alias-fill-l1:var(--dsh-ios-fill);--dsw-alias-fill-l2:var(--dsh-ios-fill-strong);--dsw-alias-border-l1:var(--dsh-ios-border);--dsw-alias-border-l2:var(--dsh-ios-border-soft);--dsw-alias-brand-primary:var(--dsh-ios-blue);--dsw-alias-state-business-primary:var(--dsh-ios-blue);--dsw-alias-interactive-bg-hover:rgba(0,122,255,.09);--dsw-alias-interactive-bg-active:rgba(0,122,255,.16);--dsw-alias-shadow:var(--dsh-ios-shadow);background:var(--dsh-ios-bg);color:var(--dsh-ios-label);letter-spacing:-.01em}",
        "body.dsh-ios-skin[data-dsh-ios-appearance='dark']{color-scheme:dark;--dsh-ios-bg:#000;--dsh-ios-surface:rgba(44,44,46,.76);--dsh-ios-surface-strong:rgba(58,58,60,.88);--dsh-ios-fill:rgba(118,118,128,.24);--dsh-ios-fill-strong:rgba(118,118,128,.34);--dsh-ios-label:#f5f5f7;--dsh-ios-label-secondary:rgba(235,235,245,.72);--dsh-ios-label-tertiary:rgba(235,235,245,.46);--dsh-ios-border:rgba(235,235,245,.18);--dsh-ios-border-soft:rgba(235,235,245,.1);--dsh-ios-shadow:0 16px 40px rgba(0,0,0,.34)}",
        "body.dsh-ios-skin[data-dsh-ios-appearance='light']{color-scheme:light}",
        "body.dsh-ios-skin input,body.dsh-ios-skin textarea,body.dsh-ios-skin select{border-radius:var(--dsh-ios-radius-sm);outline:none;background:var(--dsh-ios-fill);border:1px solid var(--dsh-ios-border-soft);color:var(--dsh-ios-label);transition:border-color .16s,box-shadow .16s,background-color .16s}",
        "body.dsh-ios-skin input:focus,body.dsh-ios-skin textarea:focus,body.dsh-ios-skin select:focus{border-color:var(--dsh-ios-blue);box-shadow:0 0 0 3px rgba(0,122,255,.2);background:var(--dsh-ios-surface-strong)}",
        "body.dsh-ios-skin button,body.dsh-ios-skin [role='button']{border-radius:var(--dsh-ios-radius-sm);transition:background-color .16s,border-color .16s,box-shadow .16s}",
        "body.dsh-ios-skin [data-dsh-ios-surface],body.dsh-ios-skin [role='dialog'],body.dsh-ios-skin [role='menu'],body.dsh-ios-skin [role='listbox']{border:1px solid var(--dsh-ios-border);border-radius:var(--dsh-ios-radius-md);background:var(--dsh-ios-surface-strong);box-shadow:var(--dsh-ios-shadow);background-clip:padding-box}",
        "@supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){body.dsh-ios-skin [data-dsh-ios-surface],body.dsh-ios-skin [role='dialog'],body.dsh-ios-skin [role='menu'],body.dsh-ios-skin [role='listbox']{backdrop-filter:blur(var(--dsh-ios-glass-blur)) saturate(1.2);-webkit-backdrop-filter:blur(var(--dsh-ios-glass-blur)) saturate(1.2)}}",
        "body.dsh-ios-skin :where(button,[role='button']):hover{background-color:var(--dsh-ios-fill)}body.dsh-ios-skin :where(button,[role='button']):focus-visible{outline:none;box-shadow:0 0 0 3px rgba(0,122,255,.2)}",
        "body.dsh-ios-skin :where(pre,code,textarea,[contenteditable='true']){background:var(--dsh-ios-surface-strong)}",
        "@media (prefers-reduced-transparency:reduce){body.dsh-ios-skin [data-dsh-ios-surface],body.dsh-ios-skin [role='dialog'],body.dsh-ios-skin [role='menu'],body.dsh-ios-skin [role='listbox']{background:var(--dsh-ios-surface-strong);backdrop-filter:none;-webkit-backdrop-filter:none}}",
        "@media (prefers-reduced-motion:reduce){body.dsh-ios-skin *,body.dsh-ios-skin *::before,body.dsh-ios-skin *::after{transition-duration:0s!important;animation-duration:0s!important}}"
      ].join("");
      var existing = document.getElementById(STYLE_ID);
      if (existing) { existing.textContent = css; return; }
      var style = document.createElement("style"); style.id = STYLE_ID; style.textContent = css; document.head.appendChild(style);
    }
    function apply(ctx) {
      installStyle();
      ctx.effect(function () { return function () { var style = document.getElementById(STYLE_ID); if (style) style.remove(); if (document.body) document.body.classList.remove("dsh-ios-skin"); }; });
    }
    module.exports = { name: "ios-skin", inject: [], apply: apply };
    return module.exports;
  }
});
