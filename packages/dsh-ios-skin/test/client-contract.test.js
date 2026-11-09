import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const source = read('../src/client.js');

/**
 * Runs the client module against a minimal DOM stub and returns what it
 * actually injected, so the contract is checked against the real stylesheet
 * rather than against the source text.
 *
 * `theme` is passed through as the theme service the plugin may find: pass
 * `null` to model an app without it, or a stub to capture the token handover.
 */
function loadPlugin({ theme = null, matchedProbe = true, strictCtx = false } = {}) {
  const appended = [];
  const classesAdded = [];
  const classesRemoved = [];
  const warnings = [];
  let disposed = null;

  const document = {
    getElementById: (id) => appended.find((el) => el.id === id) ?? null,
    createElement: () => ({ id: '', textContent: '', removed: false, remove() { this.removed = true; } }),
    head: { appendChild: (el) => appended.push(el) },
    querySelector: () => (matchedProbe ? {} : null),
    body: {
      classList: {
        add: (name) => classesAdded.push(name),
        remove: (name) => classesRemoved.push(name),
      },
    },
  };

  const window = { __ModuleLoader__: { load: (def) => { loaded = def.factory(); } } };
  let loaded;
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'console', source)(window, document, {
    warn: (message) => warnings.push(message),
  });

  const baseCtx = {
    effect: (fn) => { disposed = fn(); },
    // cordis 4.x: ctx.get exists, but throws for a service this context does not inject.
    get: (name) => {
      if (name === 'theme' && theme) return theme;
      throw new Error(`cannot get service "${name}" without inject`);
    },
  };
  if (theme) baseCtx.theme = theme;
  // Models the real cordis strict accessor: reading a property this context does
  // not inject throws instead of yielding undefined.
  const ctx = strictCtx
    ? new Proxy(baseCtx, {
        get(target, prop) {
          if (prop in target) return target[prop];
          throw new Error(`cannot get property "${String(prop)}" without inject`);
        },
      })
    : baseCtx;
  loaded.apply(ctx);

  return {
    exports: loaded,
    style: appended[0],
    css: appended[0]?.textContent ?? '',
    classesAdded,
    classesRemoved,
    warnings,
    dispose: () => disposed?.(),
  };
}

/** A theme service stub that records what the plugin hands it. */
function themeStub() {
  const calls = [];
  let released = false;
  return {
    calls,
    get released() { return released; },
    overrideTokens(source, tokens) {
      calls.push({ source, tokens });
      return () => { released = true; };
    },
  };
}

/** All selectors in a stylesheet, at any nesting depth, excluding at-rules and
 *  the percentage steps inside @keyframes (which are not scoped selectors). */
function selectorsOf(css) {
  const out = [];
  let depth = 0;
  let kfDepth = -1;
  let buf = '';
  for (const ch of css) {
    if (ch === '{') {
      const selector = buf.trim();
      if (selector) {
        if (selector.startsWith('@keyframes')) kfDepth = depth;
        else if (!selector.startsWith('@') && !(kfDepth >= 0 && depth > kfDepth)) out.push(selector);
        depth += 1;
      }
      buf = '';
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
      if (kfDepth >= 0 && depth <= kfDepth) kfDepth = -1;
      buf = '';
    } else {
      buf += ch;
    }
  }
  return out;
}

/** Class-keyed material rules, grouped by the treatment their body applies.
 *  Used to prove the groups are disjoint against the real class inventory. */
function materialClassRules(css) {
  const out = [];
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selector.includes('[class')) continue;
    const group = body.includes('var(--dsh-ios-shadow-float)') ? 'overlays'
      : body.includes('var(--dsh-ios-shadow-card)') || body.includes('var(--dsh-ios-shadow-soft)') ? 'inflow'
        : body.includes('background-color:var(--dsh-ios-glass-thin)') ? 'thin'
          : null;
    if (!group) continue;
    for (const part of selector.split(',')) {
      if (part.includes('[class')) out.push({ group, selector: part.trim() });
    }
  }
  return out;
}

/** True when one of the plugin's `[class*=…]` selectors matches a class attr.
 *  `underThirdParty` models an element inside the better-sidebar host: the
 *  selectors that opt that tree out must then not match, even though the
 *  class pattern itself does. */
function classSelectorMatches(selector, attr, { underThirdParty = false } = {}) {
  if (underThirdParty && (selector.includes('[data-dsh-better-sidebar]') || selector.includes('[data-dsh-panel-host]'))) return false;
  const patterns = (text) => [...text.matchAll(/\[class([*$^]?)=['"]([^'"]+)['"]\]/g)];
  const test = ([, op, value]) =>
    op === '*' ? attr.includes(value)
      : op === '^' ? attr.startsWith(value)
        : op === '$' ? attr.endsWith(value)
          : false;
  const positive = patterns(selector);
  if (!positive.length) return false;
  const negatives = [...selector.matchAll(/:not\(([^)]*)\)/g)].flatMap(([, inner]) => patterns(inner));
  return positive.some(test) && !negatives.some(test);
}

/* ── contrast arithmetic (WCAG 2.1), enough for the palette values used here ── */

function parseColor(value) {
  const v = value.trim();
  if (v.startsWith('#')) {
    let hex = v.slice(1);
    if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1);
  }
  const m = v.match(/rgba?\(([^)]+)\)/);
  const [r, g, b, a = 1] = m[1].split(',').map((n) => parseFloat(n));
  return [r, g, b, a];
}

/** Flatten a possibly-translucent colour onto an opaque backdrop. */
function composite(fg, bg) {
  const [r, g, b, a] = fg;
  return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/** The private --dsh-ios-* scale as declared for each palette. */
function privateScale(css) {
  const darkAt = css.indexOf('body.dsh-ios-skin[data-ds-dark-theme]{');
  const read = (text) => Object.fromEntries(
    [...text.matchAll(/(--dsh-ios-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
  return { light: read(css.slice(0, darkAt)), dark: read(css.slice(darkAt)) };
}

test('injects one stylesheet and one body class', () => {
  const p = loadPlugin();
  assert.equal(p.exports.name, 'ios-skin');
  assert.deepEqual(p.exports.inject, ['theme']);
  assert.equal(p.style.id, 'dsh-ios-skin-style');
  assert.deepEqual(p.classesAdded, ['dsh-ios-skin']);
  assert.ok(p.css.length > 4000, `suspiciously small stylesheet: ${p.css.length} chars`);
});

/**
 * Regression: on dsh 0.2.0-rc.2 the plugin never activated ("dsh-ios-skin:
 * failed"). cordis 4.x throws "cannot get property … without inject" on a bare
 * read of a service the context does not inject — the old probe guarded
 * ctx.get but read ctx.theme raw, so the throw escaped apply() and killed the
 * whole theme. The probe now guards both.
 */
test('loads against a cordis strict context instead of failing activation', () => {
  const p = loadPlugin({ theme: null, strictCtx: true });
  assert.deepEqual(p.classesAdded, ['dsh-ios-skin']);
  assert.equal(p.style?.id, 'dsh-ios-skin-style');
  assert.ok(p.css.length > 4000, 'stylesheet must still be injected');
});

test('retunes real official design tokens instead of inventing its own', () => {
  const { css } = loadPlugin();
  // Verified against @deepseek-ai/dsh-client-ui-theme.
  for (const token of [
    '--dsw-alias-bg-base',
    '--dsw-alias-bg-layer-1',
    '--dsw-alias-bg-layer-3',
    '--dsw-alias-label-primary',
    '--dsw-alias-border-l4',
    '--dsw-elevation-stroke-color',
    '--dsw-mask-blur',
    '--dsw-font-family',
    '--dsw-specific-sidebar-fill',
    // Added by the 0.2.1-rc.2 token audit (see .tmp-ios-teams/token-coverage.md).
    '--dsw-alias-toast-label',
    '--dsw-alias-menu-icon',
    '--dsw-alias-switch-thumb',
    '--dsw-menu-surface-fill',
    '--dsw-alias-menu-group-header-fill',
    '--dsw-menu-backdrop-filter',
  ]) {
    assert.ok(css.includes(token), `missing token ${token}`);
  }
  // Tokens that do not exist officially: setting them silently does nothing.
  for (const bogus of ['--dsw-alias-font-family', '--dsw-alias-fill-l1', '--dsw-alias-fill-l2', '--dsw-alias-shadow:']) {
    assert.ok(!css.includes(bogus), `bogus token ${bogus}`);
  }
});

test('is a glass theme: blur, specular rim and a flat canvas', () => {
  const { css } = loadPlugin();
  assert.match(css, /backdrop-filter:blur\(/);
  assert.match(css, /-webkit-backdrop-filter:blur\(/);
  assert.match(css, /--dsw-mask-blur:blur\(/);
  assert.match(css, /--dsh-ios-rim/);
  // The canvas is one plain colour: the contrast floor never moves.
  assert.match(css, /body\.dsh-ios-skin\{[^}]*background-color:#F0F2F7/);
});

test('keeps the canvas plain and still', () => {
  const { css } = loadPlugin();
  // The canvas is one colour and nothing else. Two decorative backgrounds were
  // built and dropped here; this test is what stops one drifting back in.
  assert.match(css, /body\.dsh-ios-skin\{[^}]*background-color:#F0F2F7/);
  assert.doesNotMatch(css, /body\.dsh-ios-skin\{[^}]*background-image/, 'the canvas must not carry a decorative background');
  assert.doesNotMatch(css, /@keyframes/, 'nothing decorative should animate');
  assert.doesNotMatch(css, /::before|::after/, 'the canvas must not add layers of its own');
  assert.doesNotMatch(css, /--dsh-ios-flow/, 'the old ribbon palette should be gone');
  // Motion is still reduced for interaction feedback, which is the only motion left.
  assert.match(css, /prefers-reduced-motion:reduce\)\{\s*body\.dsh-ios-skin :is\(button,\[role='button'\]\)\{transition:none\}/);
});

test('uses one corner radius everywhere', () => {
  const { css } = loadPlugin();
  const radii = new Set(css.match(/border-radius:[^;}]+/g) ?? []);
  // Every rectangular surface resolves to the single --dsh-ios-radius token.
  const declarations = [...radii].map((d) => d.replace(/^border-radius:/, ''));
  const unexpected = declarations.filter((d) => d !== 'var(--dsh-ios-radius)');
  assert.deepEqual(unexpected, [], `surfaces must all share one radius, found: ${unexpected.join(', ')}`);
  assert.match(css, /--dsh-ios-radius:14px/);
});

test('scopes every rule to the plugin body class', () => {
  const { css } = loadPlugin();
  const selectors = selectorsOf(css);
  assert.ok(selectors.length > 25, `expected many selectors, saw ${selectors.length}`);
  for (const selector of selectors) {
    assert.match(selector, /body\.dsh-ios-skin/, `unscoped selector: ${selector}`);
  }
});

test('dark mode overrides outrank the official dark theme', () => {
  const { css } = loadPlugin();
  // The host defines its dark aliases on body[data-ds-dark-theme] (0,1,1); the
  // theme must add the plugin class so its own dark values win.
  assert.match(css, /body\.dsh-ios-skin\[data-ds-dark-theme\]\{/);
  assert.ok(!/(^|\})body\[data-ds-dark-theme\]/.test(css), 'dark rule not scoped to the plugin class');
});

test('degrades for accessibility preferences', () => {
  const { css } = loadPlugin();
  assert.match(css, /prefers-reduced-transparency/);
  assert.match(css, /prefers-contrast:more/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@supports not \(\(backdrop-filter/);
});

test('keeps readable and editable text off the glass', () => {
  const { css } = loadPlugin();
  // Find the rule that opts readable/editable surfaces out of the glass, rather
  // than assuming it is the first `backdrop-filter:none` in the sheet.
  const rule = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .find(([, sel, body]) => body.includes('backdrop-filter:none') && /textarea/.test(sel) && /code/.test(sel));
  assert.ok(rule, 'no rule takes readable and editable text off the glass');
});

test('leaves the header flat on the page plane, never a card', () => {
  const { css } = loadPlugin();
  const rules = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)];
  // The header must be declared flat...
  const flat = rules.find(([, sel, body]) =>
    /_header/.test(sel) && body.includes('background-color:transparent') && body.includes('backdrop-filter:none'));
  assert.ok(flat, 'the header must be declared flat (transparent, no glass)');
  // ...and must never be given the glass/radius treatment anywhere else.
  // Exclusions (`:not(header *)`, `:not([role='banner'] *)`) mention the header
  // without applying to it, so strip them before looking for a paint rule.
  const applied = (sel) => sel.replace(/:not\([^)]*\)/g, '');
  const carded = rules.filter(([, sel, body]) =>
    /_header|:is\(header|role='banner'/.test(applied(sel)) && /backdrop-filter:blur/.test(body));
  assert.deepEqual(carded.map((r) => r[1].trim()), [], 'the header must not get glass from another rule');
});

test('hands the official tokens to the theme service when it is there', () => {
  const theme = themeStub();
  const p = loadPlugin({ theme });

  assert.equal(theme.calls.length, 1, 'expected exactly one override layer');
  const [{ source: origin, tokens }] = theme.calls;
  assert.equal(origin, 'dsh-ios-skin');

  const names = Object.keys(tokens);
  assert.ok(names.length > 90, `only ${names.length} tokens handed over`);
  // The theme API validates the shape and throws on anything else, so every
  // entry must be a { light, dark } pair of strings.
  for (const [name, pair] of Object.entries(tokens)) {
    assert.ok(name.startsWith('--dsw-'), `${name} is not an official token`);
    assert.equal(typeof pair, 'object', `${name} must be a pair, not a bare value`);
    assert.equal(typeof pair.light, 'string', `${name}.light must be a string`);
    assert.equal(typeof pair.dark, 'string', `${name}.dark must be a string`);
  }

  // With the service carrying colour, the sheet must not repeat the tokens.
  assert.doesNotMatch(p.css, /--dsw-alias-bg-base\s*:/, 'tokens were handed over and must not also be in the sheet');
  // ...but the private scale and every material rule must survive.
  assert.match(p.css, /--dsh-ios-radius\s*:/);
  assert.match(p.css, /backdrop-filter:blur\(/);
  assert.match(p.css, /body\.dsh-ios-skin/);
});

test('pairs every token across palettes, repeating a value when only one declares it', () => {
  const theme = themeStub();
  loadPlugin({ theme });
  const { tokens } = theme.calls[0];

  // The light block declares more tokens than the dark block; a token that only
  // one palette declares still needs a value for the other, or the switch goes
  // illegible — and the validator rejects an unpaired entry outright.
  const lightOnly = ['--dsw-font-family', '--dsw-elevation-stroke-color',
    '--dsw-hovercard-bg', '--dsw-menu-surface-fill',
    '--dsw-alias-menu-group-header-fill', '--dsw-alias-markdown-code-segment-unselected'];
  for (const name of lightOnly) {
    assert.ok(tokens[name], `${name} was not handed over at all`);
    assert.equal(tokens[name].dark, tokens[name].light, `${name} should repeat its value for dark`);
  }
  // A genuinely palette-dependent token must differ.
  assert.notEqual(tokens['--dsw-alias-bg-base'].light, tokens['--dsw-alias-bg-base'].dark);
});

test('falls back to the whole sheet when the theme service is missing', () => {
  const p = loadPlugin({ theme: null });
  // No service, no handover: the colour must still be there, or the app is unstyled.
  assert.match(p.css, /--dsw-alias-bg-base\s*:/, 'the sheet must carry the tokens when nobody else does');
  assert.deepEqual(p.classesAdded, ['dsh-ios-skin']);
});

test('survives a theme service that rejects the layer', () => {
  const theme = { overrideTokens() { throw new TypeError('bad token shape'); } };
  const p = loadPlugin({ theme });
  // A rejected layer must not cost the user the theme.
  assert.match(p.css, /--dsw-alias-bg-base\s*:/, 'must fall back to the sheet when the handover throws');
  assert.deepEqual(p.classesAdded, ['dsh-ios-skin']);
});

test('releases the token layer on dispose', () => {
  const theme = themeStub();
  const p = loadPlugin({ theme });
  assert.equal(theme.released, false);
  p.dispose();
  assert.equal(theme.released, true, 'the override layer must be released, not leaked');
});

test('warns loudly when the component class names no longer match', () => {
  const matched = loadPlugin({ theme: null, matchedProbe: true });
  assert.deepEqual(matched.warnings, [], 'must stay quiet while the layer works');
  const missed = loadPlugin({ theme: null, matchedProbe: false });
  assert.equal(missed.warnings.length, 1);
  assert.match(missed.warnings[0], /material layer is inert/);
  // The probe covers both naming worlds, so a new-UI composition that only
  // exposes the workbench hooks does not produce a false "inert" warning.
  assert.ok(source.includes('[data-dsh-bottom-panel]'));
  assert.ok(source.includes('[data-dockkit-strip]'));
  assert.ok(source.includes('[data-dockkit-float]'));
});

test('never takes over official DOM structure or interaction', () => {
  assert.doesNotMatch(source, /MutationObserver/);
  assert.doesNotMatch(source, /localStorage/);
  assert.doesNotMatch(source, /React/);
  assert.doesNotMatch(source, /display\s*:\s*none/);
  // A single read-only probe at load is allowed, and only to report an inert
  // material layer. Querying must never mutate anything, so nothing here may
  // touch another element's attributes or children.
  assert.doesNotMatch(source, /setAttribute|removeAttribute|innerHTML|outerHTML/);
  assert.doesNotMatch(source, /\.appendChild\((?!style)/, 'only the plugin style tag may be appended');
  // `pointer-events:none` only ever removes interactivity. Anything else would
  // redirect clicks away from the app.
  const pointerValues = [...source.matchAll(/pointer-events\s*:\s*([a-z-]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(pointerValues)].filter((v) => v !== 'none'), [],
    'pointer-events may only ever be set to none');
  assert.doesNotMatch(source, /setInterval|setTimeout/);
});

test('leaves the official circular controls round', () => {
  const { css } = loadPlugin();
  // Official circular controls are `border-radius:50%` paired with
  // `corner-shape:round`; a radius of ours on buttons would win on specificity
  // and square them off, so no rule may set one.
  const radiusRules = [...css.matchAll(/([^{}]*)\{([^{}]*border-radius[^{}]*)\}/g)];
  for (const [, selector] of radiusRules) {
    assert.doesNotMatch(selector, /button|role='tab'|role='menuitem'|\[role='button'\]/,
      `a radius on ${selector.trim()} would square the official circles`);
  }
  // And the one radius we do apply is the shared token, never a literal.
  for (const [, , body] of radiusRules) {
    assert.match(body, /border-radius:var\(--dsh-ios-radius\)/);
    assert.doesNotMatch(body, /border-radius:50%/);
  }
});

test('disposes exactly what it added', () => {
  const p = loadPlugin();
  p.dispose();
  assert.equal(p.style.removed, true);
  assert.deepEqual(p.classesRemoved, ['dsh-ios-skin']);
});

test('matches component local names in both hashed formats', () => {
  const { css } = loadPlugin();
  // The static bundle emits `_name_hash_seq`; runtime-injected plugin CSS emits
  // `hash_name`. `[class*='_name_']` (trailing underscore) only matches the
  // first, so it would silently miss every runtime-injected component.
  const offenders = css.match(/\[class\*='_[a-z-]+_'\]/g) ?? [];
  assert.deepEqual(offenders, [], `patterns miss runtime-injected classes: ${offenders.join(', ')}`);
});

test('retunes the official scrollbar tokens instead of fighting the platform', () => {
  const { css } = loadPlugin();
  assert.match(css, /--dsh-scrollbar-thumb:/);
  assert.match(css, /--dsh-scrollbar-thumb-hover:/);
  // Styling ::-webkit-scrollbar would only cover one of the two rendering
  // paths and risks disturbing the containers' scrollbar gutter.
  assert.doesNotMatch(css, /::-webkit-scrollbar/);
});

test('ships no host behaviour', () => {
  const host = read('../src/index.ts');
  assert.match(host, /export const inject: string\[\] = \[\]/);
  assert.doesNotMatch(host, /registerTool|defineTool|ctx\.(on|provide|plugin)/);
});

test('re-declares the elevation recipes per element instead of handing them over', () => {
  const theme = themeStub();
  const p = loadPlugin({ theme });
  const { tokens } = theme.calls[0];

  // The theme service writes its tokens as inline styles on body. Official
  // gradient-shadow-text.css declares the derived elevation recipes on
  // `body,body *`, so a descendant's own declaration beats the inherited
  // body-only value — handing them over would look covered but paint nothing.
  assert.equal(tokens['--dsw-elevation-panel'], undefined,
    'per-element recipes must not be handed over as body-scoped tokens');
  assert.ok(tokens['--dsw-elevation-stroke-color'], 'the stroke colour stays a palette token');

  const rule = [...p.css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .find(([, sel, body]) => sel.includes('body.dsh-ios-skin *') && body.includes('--dsw-elevation-panel'));
  assert.ok(rule, 'no per-element elevation rule');
  assert.match(rule[2], /var\(--dsh-ios-shadow-float\)/);
  assert.match(rule[2], /var\(--dsh-ios-shadow-soft\)/);
  assert.match(rule[2], /var\(--dsw-elevation-stroke-color\)/);
  for (const token of ['--dsw-elevation-stroke:', '--dsw-elevation-panel:',
    '--dsw-elevation-prominent:', '--dsw-elevation-soft:']) {
    assert.equal(p.css.split(token).length - 1, 1, `${token} must be declared exactly once`);
  }
});

test('keeps the user font choices in front of the iOS stacks', () => {
  const { css } = loadPlugin();
  // Official base.css chains --dsh-font-family-text / --dsh-font-family-code in
  // front of the built-in stacks so the Settings choice keeps working. The theme
  // must not swallow that choice; SF is only the fallback.
  assert.ok(css.includes('--dsw-font-family:var(--dsh-font-family-text,var(--dsh-ios-font)),var(--dsh-ios-font)'));
  assert.ok(css.includes('--ds-font-family-code:var(--dsh-font-family-code,var(--dsh-ios-mono)),var(--dsh-ios-mono)'));
});

test('material groups stay disjoint on the real 0.2.x class inventories', () => {
  const { css } = loadPlugin();
  const rules = materialClassRules(css);
  const groupsOf = (cls, opts) =>
    [...new Set(rules.filter((r) => classSelectorMatches(r.selector, cls, opts)).map((r) => r.group))].sort();

  // DSH native chrome: the sidebar rail host is thin and carries no elevation...
  assert.deepEqual(groupsOf('_3WPZCG_panelList'), ['thin']);
  assert.deepEqual(groupsOf('ST7X_W_composerSeat'), ['thin']);
  assert.deepEqual(groupsOf('ST7X_W_composerStack ST7X_W_composerHero'), ['thin']);
  // ...and every sidebar row/title/icon is flat: `_pane` must not swallow `_panel*`.
  assert.deepEqual(groupsOf('_3WPZCG_panelRow'), []);
  assert.deepEqual(groupsOf('_3WPZCG_panelTitle _3WPZCG_wide'), []);
  assert.deepEqual(groupsOf('_3WPZCG_panelGlyph'), []);
  assert.deepEqual(groupsOf('_3WPZCG_panelIcon'), []);
  // A bare menu anchor is not a menu surface; real menus are reached by role.
  assert.deepEqual(groupsOf('m0vb0q_menuAnchor'), []);
  // Settings panels are dialogs (role wins), not an in-flow glass card.
  assert.deepEqual(groupsOf('Dws9Sa_panel'), []);
  // Real in-flow and rail surfaces still get their treatment.
  assert.deepEqual(groupsOf('yhfFVG_card yhfFVG_cardWorkspaceTrigger'), ['inflow']);
  assert.deepEqual(groupsOf('abc123_floatHost'), ['thin']);

  // New dockkit tab-split UI: the tab strip is the only class-keyed surface.
  assert.deepEqual(groupsOf('_tabStrip_6nhg2_237'), ['thin']);
  // These are layout wrappers / icon slots / drop hints, not cards: the old
  // `_pane`/`_surface`/`_slot`/`_float`/`_dockHintCard` patterns are gone.
  assert.deepEqual(groupsOf('_slot_6nhg2_327'), []);
  assert.deepEqual(groupsOf('jJkEga_slot'), []);
  assert.deepEqual(groupsOf('_surface_6nhg2_125'), []);
  assert.deepEqual(groupsOf('_paneBody_6nhg2_318'), []);
  assert.deepEqual(groupsOf('_float_6nhg2_156'), []);
  assert.deepEqual(groupsOf('_floatingCell_6nhg2_156'), []);
  assert.deepEqual(groupsOf('_floatBody_6nhg2_795'), []);
  assert.deepEqual(groupsOf('_dockHintCard_6nhg2_606'), []);

  // better-sidebar's own tree opts out of the DSH class assumptions...
  const under = { underThirdParty: true };
  assert.deepEqual(groupsOf('nArs4W_panelBody', under), []);
  assert.deepEqual(groupsOf('SyUHSa_cardBar', under), []);
  assert.deepEqual(groupsOf('SyUHSa_cardName', under), []);
  assert.deepEqual(groupsOf('SyUHSa_editorHeader', under), []);
  assert.deepEqual(groupsOf('nArs4W_toolbar', under), []);
  // The dockkit right-rail body and better-sidebar's own panel body are plain
  // layout containers over opaque panes: no class-keyed surface at all.
  assert.deepEqual(groupsOf('irMxjq_panelBody'), []);
  assert.deepEqual(groupsOf('_panelBody_irMxjq'), []);
  // better-sidebar's own text-bearing surfaces stay on their token fills: the
  // tab bar and pane cards composite over opaque pane/canvas bases there, so
  // adding glass or a thick fill here would only fight the plugin's contract.
  for (const cls of ['nArs4W_tabBar', 'nArs4W_tabList', 'nArs4W_paneCard',
    'nArs4W_editor', 'nArs4W_diffPane', 'nArs4W_teamBoard']) {
    assert.deepEqual(groupsOf(cls, under), [], `must not paint better-sidebar ${cls}`);
  }
  // ...and nothing in the DSH class-keyed groups targets `_panelBody` any more.
  assert.deepEqual(groupsOf('nArs4W_panelBody'), []);
  assert.ok(!css.includes("[class*='_panelBody']"), 'the rail must not double-paint panel bodies');

  // No naked prefix patterns that swallow their neighbours.
  assert.ok(!css.includes("[class*='_menu']"), 'a bare _menu substring also hits _menuAnchor');
  assert.ok(!css.includes("[class*='_strip']"), 'a bare _strip substring also hits _stripTabs/_stripChrome');
  assert.ok(!css.includes("[class*='_pane']"), 'a bare _pane substring also hits _paneBody/_panelBody');
  assert.match(css, /\[role='menu'\]/);
});

test('uses the new workbench stable hooks instead of guessing its hashes', () => {
  const { css } = loadPlugin();
  for (const hook of [
    '[data-dockkit-strip]', '[data-dockkit-float]', '[data-team-panel]',
    '[data-dsh-md-toc-panel]', '[data-dsh-bottom-panel]', '[data-dsh-better-sidebar]',
    '[data-dsh-panel-host]',
    "[role='tablist']",
  ]) {
    assert.ok(css.includes(hook), `missing stable hook ${hook}`);
  }
  const rules = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)];
  // The docked workbench gets the blur its translucent fill needs, but keeps
  // its own border/radius: only paint properties may be added here.
  const workbench = rules.find(([, sel]) => sel.includes('[data-dsh-bottom-panel]'));
  assert.ok(workbench, 'no rule for the docked workbench');
  assert.match(workbench[2], /backdrop-filter:blur\(var\(--dsh-ios-blur\)\)/);
  assert.match(workbench[2], /background-color:var\(--dsh-ios-glass\)/);
  assert.doesNotMatch(workbench[2], /border|box-shadow/,
    'the workbench rule must not rewrite the plugin chrome geometry');
  // Floating plugin surfaces are matched by hook, not by their `_float` hash.
  const floating = rules.find(([, sel]) => sel.includes('[data-dockkit-float]'));
  assert.ok(floating, 'no rule for the dockkit floating tab window');
  assert.match(floating[2], /var\(--dsh-ios-shadow-float\)/);
  assert.match(floating[2], /box-shadow:0 0 0 1px var\(--dsh-ios-rim\),inset 0 0 0 1px var\(--dsh-ios-rim-inner\)/);
  // `[role='tablist']` carries the strip treatment with no material group clash.
  const tablist = rules.find(([, sel]) => sel.includes("[role='tablist']") && sel.includes('_tabStrip'));
  assert.ok(tablist, 'the tab strip must be matched by both its class and its role');
  assert.match(tablist[2], /background-color:var\(--dsh-ios-glass-thin\)/);
});

test('never paints bars or rails nested inside a flat header', () => {
  const { css } = loadPlugin();
  // The session header hosts the breadcrumb rail and the conversation tab list.
  // They are part of the page plane, not cards: the thin/rail groups opt out of
  // header descendants, exactly like the flat header rule itself.
  assert.ok(css.includes(":is(nav,[role='navigation']):not(header *):not([role='banner'] *)"),
    'the nav rail rule must not paint inside a header');
  assert.ok(css.includes("[role='tablist']:not(header *):not([role='banner'] *)"),
    'the tablist strip rule must not paint inside a header');
  assert.ok(css.includes("[class*='_tabStrip']:not([data-dsh-panel-host] *):not(header *)"),
    'the tab strip rule must not paint inside a header');
  assert.ok(css.includes("[class*='_toolbar']:not([data-dsh-panel-host] *):not(header *)"));
  // The header itself stays flat.
  assert.match(css, /\[class\*='_header'\][^{]*\{[^}]*background-color:transparent[^}]*backdrop-filter:none/);
});

test('accessibility fallbacks outrank the material rules and the inline handover', () => {
  const { css } = loadPlugin();
  // reduced transparency: `body.C *` (0,1,1) loses to `body.C [class*=…]`
  // (0,2,1), so the blur reset needs !important.
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-transparency'));
  assert.match(reduced, /backdrop-filter:none!important/);
  assert.match(reduced, /-webkit-backdrop-filter:none!important/);
  // contrast:more: the theme service writes normal inline styles on body, so
  // only author !important can win.
  const contrastMore = css.slice(css.indexOf('@media (prefers-contrast:more)'));
  assert.match(contrastMore, /--dsw-alias-border-l1:rgba\(23,26,33,\.28\)!important/);
  assert.match(contrastMore, /--dsw-alias-label-secondary:#171A21!important/);
  assert.match(contrastMore, /--dsw-alias-border-l1:rgba\(235,235,245,\.28\)!important/);
});

test('keeps theme text above the contrast floors on its own materials', () => {
  const theme = themeStub();
  const p = loadPlugin({ theme });
  const tokens = theme.calls[0].tokens;
  const scale = privateScale(p.css);
  const canvas = { light: parseColor('#F0F2F7'), dark: parseColor('#12141A') };
  const resolve = (value, mode) => {
    const m = value.match(/^var\((--dsh-ios-[a-z0-9-]+)\)$/);
    return m ? scale[mode][m[1]] : value;
  };
  const surface = (mode, name) => composite(parseColor(scale[mode][name]), canvas[mode]);
  const reg = { light: surface('light', '--dsh-ios-glass'), dark: surface('dark', '--dsh-ios-glass') };
  const ratioOn = (token, mode, bg) => {
    const pair = tokens[token];
    assert.ok(pair, `missing token ${token}`);
    const fg = composite(parseColor(resolve(pair[mode], mode)), bg);
    return contrast(fg, bg);
  };

  // The official toast label is white in BOTH palettes; on the light frosted
  // toast that was 1.03:1 before the audit supplied a palette-aware label.
  const toast = {
    light: composite(parseColor(resolve(tokens['--dsw-alias-toast-bg'].light, 'light')), reg.light),
    dark: composite(parseColor(resolve(tokens['--dsw-alias-toast-bg'].dark, 'dark')), reg.dark),
  };
  assert.ok(ratioOn('--dsw-alias-toast-label', 'light', toast.light) >= 4.5, 'light toast label');
  assert.ok(ratioOn('--dsw-alias-toast-label', 'dark', toast.dark) >= 4.5, 'dark toast label');

  // label-primary-foreground paints glyphs on label-primary fills (checkboxes):
  // white-on-near-white in dark was 1.09:1 before the audit.
  for (const mode of ['light', 'dark']) {
    const fill = parseColor(resolve(tokens['--dsw-alias-label-primary'][mode], mode));
    const glyph = composite(parseColor(resolve(tokens['--dsw-alias-label-primary-foreground'][mode], mode)), fill);
    assert.ok(contrast(glyph, fill) >= 4.5, `${mode} label-primary-foreground on label-primary`);
  }

  // Dark body text on the regular glass: 4.5:1 for primary/secondary,
  // 3:1 for the tertiary/caption steps.
  assert.ok(ratioOn('--dsw-alias-label-secondary', 'dark', reg.dark) >= 4.5);
  assert.ok(ratioOn('--dsw-alias-label-tertiary', 'dark', reg.dark) >= 3);
  assert.ok(ratioOn('--dsw-alias-label-caption', 'dark', reg.dark) >= 3);
  assert.ok(ratioOn('--dsw-alias-label-secondary', 'light', reg.light) >= 4.5);
});


/* ── v0.3.0 "Deep Fusion" ──────────────────────────────────────────────── */

test('ships the Deep Fusion palette as the new baseline, without losing handover coverage', () => {
  const theme = themeStub();
  const p = loadPlugin({ theme });
  const tokens = theme.calls[0].tokens;
  // v0.2.2 handed over 103 audited semantic tokens; 0.3.0 must not regress.
  assert.equal(Object.keys(tokens).length, 103, 'the audited 103-token handover must not regress');
  assert.equal(tokens['--dsw-alias-bg-base'].light, '#F0F2F7');
  assert.equal(tokens['--dsw-alias-bg-base'].dark, '#12141A');
  assert.equal(tokens['--dsw-alias-brand-primary'].light, '#4D6BFE');
  assert.equal(tokens['--dsw-alias-brand-primary'].dark, '#6E87FF');

  const scale = privateScale(p.css);
  assert.equal(scale.light['--dsh-ios-brand'], '#4D6BFE');
  assert.equal(scale.dark['--dsh-ios-brand'], '#6E87FF');
  assert.equal(scale.light['--dsh-ios-blur'], '30px');
  assert.equal(scale.dark['--dsh-ios-blur'], '28px');
  assert.equal(scale.light['--dsh-ios-rim-inner'], 'rgba(77,107,254,.12)');
  assert.equal(scale.dark['--dsh-ios-rim-inner'], 'rgba(0,0,0,.35)');
  assert.match(p.css, /--dsh-ios-glass-thin:rgba\(240,244,255,\.58\)/);
  assert.match(p.css, /--dsh-ios-glass:rgba\(240,244,255,\.62\)/);
  assert.match(p.css, /--dsh-ios-glass-thick:rgba\(244,247,255,\.70\)/);

  // With no service, the sheet itself must still carry a full palette.
  const fallback = loadPlugin({ theme: null });
  const declared = new Set([...fallback.css.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  assert.ok(declared.size >= 103, `fallback sheet declares only ${declared.size} official tokens`);
});

test('wears the brand gradient light band only on the active dock surfaces', () => {
  const { css } = loadPlugin();
  const rules = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)];
  const band = rules.find(([, sel, body]) => sel.includes('[data-dockkit-pane-active]')
    && body.includes('background-image:linear-gradient(90deg,var(--dsh-ios-brand)'));
  assert.ok(band, 'no signature band on the active dock pane');
  assert.match(band[1], /\[data-dockkit-float-active\]/);
  assert.match(band[2], /background-size:100% 1px/);
  assert.match(band[2], /background-repeat:no-repeat/);
  assert.match(band[2], /background-position:top left/);
  // Paint only: no geometry, and the inactive pane hook must never get a band.
  assert.doesNotMatch(band[2], /(^|;)\s*(width|height|top|left|right|bottom|inset|position)\s*:/,
    'the light band must not take over layout');
  assert.ok(!css.includes('[data-dockkit-pane]'), 'inactive dock panes must stay plain');
});

test('keeps brand fill and a 1px brand edge on selected rows', () => {
  const theme = themeStub();
  const p = loadPlugin({ theme });
  const tokens = theme.calls[0].tokens;
  assert.match(tokens['--dsw-specific-sidebar-nav-item-active'].light,
    /color-mix\(in srgb,#4D6BFE 12%,transparent\)/);
  assert.match(tokens['--dsw-specific-sidebar-nav-item-active'].dark,
    /color-mix\(in srgb,#6E87FF 22%,transparent\)/);
  const edge = [...p.css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .find(([, sel, body]) => sel.includes("[aria-selected='true']")
      && body.includes('box-shadow:inset 0 0 0 1px var(--dsh-ios-brand-border)'));
  assert.ok(edge, 'selected rows must keep the 1px brand edge');
});

test('keeps active tab text on the darker brand step so it clears AA', () => {
  const { css } = loadPlugin();
  const scale = privateScale(css);
  const rule = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .find(([, sel, body]) => sel.includes("[class*='_tabActive']")
      && body.includes('color:var(--dsh-ios-brand-strong)'));
  assert.ok(rule, 'active tab text must use --dsh-ios-brand-strong');
  const onCanvas = (mode) => contrast(
    parseColor(scale[mode]['--dsh-ios-brand-strong']),
    parseColor(mode === 'light' ? '#F0F2F7' : '#12141A'),
  );
  assert.ok(onCanvas('light') >= 4.5, `light active-tab text is ${onCanvas('light')}:1`);
  assert.ok(onCanvas('dark') >= 4.5, `dark active-tab text is ${onCanvas('dark')}:1`);
});

test('paints the specular rims with box-shadow, never with borders', () => {
  const { css } = loadPlugin();
  assert.ok(!css.includes('border:0.5px solid var(--dsh-ios-rim)'),
    'a 0.5px border would change layout at the box model');
  assert.match(css, /box-shadow:0 0 0 1px var\(--dsh-ios-rim\),inset 0 0 0 1px var\(--dsh-ios-rim-inner\)/);
});

test('keeps CodeMirror and terminal text surfaces opaque', () => {
  const { css } = loadPlugin();
  const rules = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)];
  const opaque = rules.find(([, sel, body]) => /\.cm-editor/.test(sel) && /\.xterm/.test(sel)
    && body.includes('background-color:var(--dsh-ios-surface)'));
  assert.ok(opaque, 'CodeMirror/xterm surfaces must be painted opaque');
  const noBlur = rules.find(([, sel, body]) => /\.cm-editor/.test(sel) && /\.xterm/.test(sel)
    && body.includes('backdrop-filter:none'));
  assert.ok(noBlur, 'editor/terminal text surfaces must not sit on glass');
});

test('keeps the Agent Teams currentTag label above AA on its brand-tinted fill', () => {
  const { css } = loadPlugin();
  const rule = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .find(([, sel, body]) => sel.includes('[data-team-panel]') && sel.includes("currentTag")
      && body.includes('color:var(--dsh-ios-brand-strong)'));
  assert.ok(rule, 'the roster currentTag must use the AA-safe brand step');

  const scale = privateScale(css);
  const canvas = { light: parseColor('#F0F2F7'), dark: parseColor('#12141A') };
  for (const mode of ['light', 'dark']) {
    const glass = composite(parseColor(scale[mode]['--dsh-ios-glass']), canvas[mode]);
    const tagFill = composite(parseColor(scale[mode]['--dsh-ios-brand-soft']), glass);
    const text = composite(parseColor(scale[mode]['--dsh-ios-brand-strong']), tagFill);
    assert.ok(contrast(text, tagFill) >= 4.5,
      `${mode} currentTag is ${contrast(text, tagFill)}:1 on its brand fill`);
  }
});
