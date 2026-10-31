# 新版截图拍摄记录

使用已有 `awteam-preview` 测试 profile、DSH 0.2.1-rc.5、better-sidebar 0.28.0、本工作区 dsh-feishu 0.20.1。飞书通过工作区临时 overlay 挂载，不修改主 desktop profile。旧 Agent Teams 不兼容，保持禁用且未授予版本豁免。

实际完成完整 DSH 浏览器登录、打开右侧栏、从右侧指南加入「飞书」、确认 iframe 与当前会话上下文使绑定入口可用。前七张功能细节来自同一 profile 的真实面板路由，其余十一张保留 DSH shell 与右侧栏。不使用独立 HTML 或模拟 shell。

数据为明确标注的本地演示任务和同步历史，不能作为真实飞书 API 回执。没有为截图提交绑定、启动模型/任务、写评论、完成或修改真实任务。

| 图片 | 实际截取内容与边界 |
| --- | --- |
| 01-sidebar.png | 完整 DSH 与右侧飞书；配置、同步和会话入口 |
| 02-auth.png | 授权入口与检查，未真实授权 |
| 03-sync-settings.png | 同步规则、关闭自动同步、采集关键词与保存 |
| 04-binding.png | 当前会话转任务、开工与绑定入口；只展示不提交 |
| 05-task-actions.png | 未绑定演示任务优先级、完成和更多菜单，不冒充已绑定状态 |
| 06-workspace.png | 打开工作区选择，不提交换绑 |
| 07-relations.png | 打开演示任务关系编辑器，不增删关系 |
| 08-filters.png | 展开条件组筛选 |
| 09-presets.png | 命名、另存、覆盖、清空筛选入口，不提交新模板 |
| 10-schedule.png | 定时设置、时区、容量、触发 Prompt；非真实提醒保存/投递 |
| 11-eta-suspension.png | 预期编辑入口；未保存改期，挂起的语义由文字说明 |
| 12-insight.png | 本地摘要和图表与操作入口；未生成新的 AI 诊断 |
| 13-insight-settings.png | 按钮、忽略关键词与独立 Prompt |
| 14-task-documents.png | 常驻文档 Tag、修改、解绑和菜单，不写回 |
| 15-document-watch.png | 监听 URL、添加、移除入口，不实际抓远端文档 |
| 16-collaboration-settings.png | 档案、变化推送、自动评论开关与间隔；未保存 |
| 17-comments.png | 评论安全设置；不是远端评论历史或账本回执 |
| 18-history.png | 演示同步历史、阶段与错误，非真实成功同步回执 |

编号圈中心来自可访问性树或 DOM 的 CSS 坐标，转换为 screenshot 像素；原图 2800×1608、CSS viewport 1400×804。图片均可解码。当前截图模型不支持图像输入，**尚无像素级视觉复核**，不宣称排版视觉验收。

首次挂载默认设置曾触发 CLI，本地缓存初始化失败且未取得任务数据；随后停止、备份失败记录、写入禁用自动同步/开工/评论的演示设置，再启动。未验证真实飞书授权、写回、评论通知、已绑定任务运行和真实提醒投递。`npm run test:offline` 已通过 35 JS 文件与 5 Python 套件，fake 回归与真实 UI 展示分别记录。
