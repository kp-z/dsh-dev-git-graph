/**
 * dsh-feishu 的 **Client 半体**（构建入口，产物是 lib/client.iife.js）。
 *
 * 两件事：
 *   1. 右侧栏「飞书」页签 —— 既有实现，仍然是 iframe（panel.html 是上一代整页面板，本轮不动它）；
 *   2. 左侧栏「飞书任务集」—— **宿主页面里的 React 组件**，挂到 `sidebar.panellist` + `main`。
 *
 * 为什么总览是 React 而不是 iframe（DSH 官方插件实践）：
 *   「Render plugin pages as React components in a slot. Do not serve an HTML page from the Host and
 *    embed it in an iframe: an iframe document does not receive the host's theme tokens, light/dark
 *    switching, or ctx.locale.」
 * 之前的版本正是把整页 HTML 塞进 iframe，只好自己造一套调色板，宿主换主题就脱窗。
 *
 * 构建：`pnpm --filter dsh-feishu build:client`（tsdown → lib/client.iife.js）。
 * 本文件只搬「注册与装配」，视图全在 src/client/*.js，纯逻辑在 src/overview/*.js。
 */

import { createSidebarHalf } from './sidebar-tab.js';
import { createApi } from './api.js';
import { createOverviewPanel } from './OverviewPanel.js';
import { CSS as OVERVIEW_CSS, STYLE_ID as OVERVIEW_STYLE_ID, injectStyles } from './styles.js';
import * as model from '../overview/model.js';
import * as layout from '../overview/layout.js';

/* sidebar.panellist 的 id 同时就是 main 面板的 key（DSH 约定），两处必须同源。 */
const OVERVIEW_KEY = 'feishu-overview';
const OVERVIEW_LABEL = '飞书任务集';
const SCROLL_HOST_CSS = [
  '.dfe-wrap{display:flex;flex-direction:column;width:100%;height:100%;min-height:0}',
  '.dfe-frame{flex:1;min-height:0;width:100%;border:0;background:transparent;display:block}',
  /* 总览组件占满主面板：只做定高与裁剪，颜色一律交给宿主令牌与 fo- 样式表。 */
  '.dfe-overview{position:relative;display:flex;width:100%;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}',
].join('');

function installStyle(id, css) {
  if (typeof document === 'undefined') return;
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

/* 取可选服务：cordis 里访问未声明的服务会直接抛，两段分开 try。 */
function serviceOf(ctx, name) {
  if (!ctx) return undefined;
  try {
    if (ctx[name]) return ctx[name];
  } catch (error) {
    /* 没有 inject 权限，走 ctx.get */
  }
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : undefined;
  } catch (error) {
    return undefined;
  }
}

/* 总览图标：三个节点连成一条链（关系图的抽象），与页签纸飞机区分。宿主会给 {size, active}。 */
function overviewIcon(h, props) {
  const size = props && typeof props.size === 'number' ? props.size : 16
  return h('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.4,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
    style: { display: 'block', opacity: props && props.active === false ? 0.75 : 1 },
  },
    h('path', { d: 'M3.5 12.5 8 8l4.5-4.5' }),
    h('circle', { cx: 3.4, cy: 12.6, r: 1.7 }),
    h('circle', { cx: 8, cy: 8, r: 1.7 }),
    h('circle', { cx: 12.6, cy: 3.4, r: 1.7 }));
}

/* 视图偏好（选中项、折叠）只落本地，且必须走 store，方便测试替换。 */
function createStore() {
  const prefix = 'fo:';
  return {
    get(key, fallback) {
      try {
        const raw = window.localStorage.getItem(prefix + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (error) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(prefix + key, JSON.stringify(value));
      } catch (error) {
        /* 隐私模式等场景写不进去就算了，视图偏好不值得报错 */
      }
    },
  };
}

window.__ModuleLoader__.load({
  id: 'dsh-feishu',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;

    const sidebar = createSidebarHalf({ React, h });
    const api = createApi();
    const OverviewPanel = createOverviewPanel({ React, h, api, model, layout, store: createStore() });

    function installOverview(ctx) {
      const slots = serviceOf(ctx, 'slots');
      if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return false;
      /* 样式算 effect：卸载/禁用插件时把两个 style 标签带走（官方实践：资源在 apply 里用 ctx.effect 注册并清理）。 */
      const cleanupStyles = ctx.effect ? ctx.effect(() => {
        installStyle('dsh-feishu-style', SCROLL_HOST_CSS);
        if (typeof injectStyles === 'function') injectStyles(document);
        else installStyle(OVERVIEW_STYLE_ID, OVERVIEW_CSS);
        return () => {
          for (const id of ['dsh-feishu-style', OVERVIEW_STYLE_ID]) {
            try {
              const node = document.getElementById(id);
              if (node && node.parentNode) node.parentNode.removeChild(node);
            } catch (error) {
              /* 宿主页面已经没了就算了 */
            }
          }
        };
      }) : undefined;
      const disposers = [
        slots.inject('sidebar.panellist', () => slots.register(
          { name: 'sidebar.panellist', id: OVERVIEW_KEY, order: 24, label: () => OVERVIEW_LABEL },
          (props) => overviewIcon(h, props),
        )),
        slots.inject('main', () => slots.register({ name: 'main', key: OVERVIEW_KEY }, OverviewPanel)),
      ];
      if (ctx.effect) {
        ctx.effect(() => () => {
          for (const dispose of disposers) if (typeof dispose === 'function') dispose();
          if (typeof cleanupStyles === 'function') cleanupStyles();
        });
      }
      return true;
    }

    function apply(ctx) {
      try {
        sidebar.apply(ctx);
      } catch (error) {
        warn(error);
      }
      try {
        installOverview(ctx);
      } catch (error) {
        /* 总览是增量入口：注册失败不能连右侧栏页签一起丢掉 */
        warn(error);
      }
    }

    function warn(error) {
      try {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[dsh-feishu] 客户端半体初始化失败，已忽略（不影响宿主启动）：', error);
        }
      } catch (ignored) {
        /* 连 console 都没有就只能静默 */
      }
    }

    /* 只声明 slots：betterSidebar 是可选能力（右侧栏插件），它在时运行时探测注册页签，
       不在时总览照样可用——不要让它把整个客户端半体门控成 inactive。 */
    return { name: 'dsh-feishu', inject: ['slots'], apply };
  },
});
