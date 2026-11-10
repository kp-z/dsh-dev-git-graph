/**
 * 总览页的数据面（唯一网络出口）。
 *
 * 只碰三个接口，全部在插件自己的挂载点下：
 *   GET  /dsh-feishu/api/overview           瘦快照（任务 + 关系摘要 + 目录 + 工作区 + 统计 + revision）
 *   GET  /dsh-feishu/api/overview/revision  只有 revision，用来「变了才刷」
 *   POST /dsh-feishu/api/workspace-groups   自定义目录（唯一写操作）
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
    /** 自定义目录：唯一写操作。body 即 { action, ... }。 */
    groupAction(body) {
      return request('/api/workspace-groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body || {}),
      });
    },
  };
}
