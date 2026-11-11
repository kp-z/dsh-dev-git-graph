/**
 * 总览页的数据面（唯一网络出口）。
 *
 * 只碰插件自己挂载点下的接口：
 *   GET  /dsh-feishu/api/overview            瘦快照（任务 + 关系摘要 + 目录 + 工作区 + 统计 + revision）
 *   GET  /dsh-feishu/api/overview/revision   只有 revision，用来「变了才刷」
 *   POST /dsh-feishu/api/workspace-groups    自定义目录（写操作）
 *   GET  /dsh-feishu/api/overview/organize   某范围最近一批「一键整理」建议
 *   POST /dsh-feishu/api/overview/organize   跑一次整理（**零副作用**：只出建议）
 *   POST /dsh-feishu/api/overview/organize/accept|reject|undo  逐条接受 / 拒绝 / 撤销已接受
 *
 * `fetchImpl` 可注入，组件层因此可以在测试里跑而不碰网络。
 */

const BASE = '/dsh-feishu';

export function createApi({ fetchImpl } = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? (input, init) => fetch(input, init) : null);

  async function request(path, init) {
    if (!doFetch) throw new Error('当前环境没有 fetch');
    const response = await doFetch(BASE + path, init);
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
    if (!response.ok || !data || data.ok === false) {
      const message = (data && data.error) || `请求失败：${response.status}`;
      throw new Error(message);
    }
    return data;
  }

  const post = (path, body) => request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body || {}),
  });

  return {
    /** 瘦快照：任务 + 关系摘要 + 目录 + 工作区 + 统计 + revision。 */
    overview() {
      return request('/api/overview', { headers: { accept: 'application/json' } });
    },
    /** 只有 revision（字符串，当不透明值比较即可），用于「变了才刷」。 */
    async revision() {
      const data = await request('/api/overview/revision', { headers: { accept: 'application/json' } });
      return data.revision;
    },
    /** 自定义目录：写操作。body 即 { action, ... }。 */
    groupAction(body) {
      return post('/api/workspace-groups', body);
    },
    /**
     * 一键整理。scopeKind/scopeId 省略表示「全部任务」。
     * 返回 { batch, dropped, complete, candidates }：**只出建议**，不会写关系。
     */
    organize(scope) {
      return post('/api/overview/organize', { scope: scope || { kind: 'all', id: '' } });
    },
    /** 某范围最近一批建议（面板重开时取回；没有就是 batch:null）。 */
    async organizeView(scope) {
      const s = scope || { kind: 'all', id: '' };
      const query = `?kind=${encodeURIComponent(s.kind || 'all')}&id=${encodeURIComponent(s.id || '')}`;
      const data = await request(`/api/overview/organize${query}`, { headers: { accept: 'application/json' } });
      return data.batch || null;
    },
    /** 接受若干条建议（itemIds 省略/空 = 全部待处理）。writeBack=false 只写本地关系。 */
    organizeAccept(batchId, itemIds, options) {
      const o = options || {};
      return post('/api/overview/organize/accept', { batchId, itemIds: itemIds || [], writeBack: o.writeBack !== false });
    },
    /** 拒绝若干条建议（只改建议单状态）。 */
    organizeReject(batchId, itemIds) {
      return post('/api/overview/organize/reject', { batchId, itemIds: itemIds || [] });
    },
    /**
     * 撤销**已接受**的建议：把那条边从关系里拿掉（itemIds 省略 = 撤销本批全部已接受）。
     * 接受必须可回退——写错一条 depends_on 会让后继永远开不了工。
     */
    organizeUndo(batchId, itemIds) {
      return post('/api/overview/organize/undo', { batchId, itemIds: itemIds || [] });
    },
    /**
     * 设置某个项目的图标（纯本地展示配置）。
     * @param {string} workspaceKey 快照里 workspaces[].key
     * @param {string} icon 内置图标 id；空串 = 清除
     */
    setWorkspaceLogo(workspaceKey, icon) {
      return post('/api/workspace-logos', { workspaceKey, icon: icon || '' });
    },
    /**
     * 历史指标（洞察页要「更全面」时用）：宿主已有的 /api/insight/stats。
     * 返回 { stats: { series, distribution, board, fulfillment, quality, delayBuckets, datasets, ... } }。
     * 旧宿主没有这条路由 → 抛错，调用方自己降级（不要把整页打崩）。
     */
    insightStats(days) {
      const span = Number(days) > 0 ? Math.min(365, Math.floor(Number(days))) : 14;
      return request(`/api/insight/stats?days=${span}`, { headers: { accept: 'application/json' } });
    },
  };
}
