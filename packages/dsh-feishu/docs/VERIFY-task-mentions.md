# 任务评论真实提及兼容验证

## 阶段计划

先只读确认v1/v2同任务GUID、评论ID与父评论关联；然后仅在用户明确许可的隔离任务中创建一次官方Task v1富文本提及，读取核验；最后实现显式transport并fake测试。默认v2普通评论不改变，不能因v1失败自动重发到v2。

## 官方依据

https://open.feishu.cn/document/server-docs/task-v1/markdown-module 明确任务评论支持 `<at id=open_id></at>`。
https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/task-v1/task-comment/create 明确POST路径与rich_content、parent_id。
v2 content没有同格式声明，绝不把旧版标签写进v2请求。

## 真实隔离验证

任务 e40a8854-7db1-4c57-8c7d-8895e4ebddf6 由用户明确许可联调。
- v1 GET list成功读取全部v2创建的3条评论，相同稳定ID及parent_id。
- v1 POST rich_content使用官方at标签并reply parent=7702499914109947170，成功ID=7702502215277104367。
- v2 GET同ID成功，task与reply_to_comment_id一致。
- v1 GET评论详情显示服务器把at标签解析为实际用户名，证实不是拼接的假@文本。未保留被提及人的ID到仓库。
- 不凭API回执断言通知实际送达，notificationVerified=false。

## 实现与测试

Python task_comment新增explicit mentionMode=task-v1：仅非空有效open_id触发富文本路径，正文先转义以防注入额外at标签；失败不换接口重发；成功后v2再次对账稳定ID和回复归属，失败进入unknown。

mentions_api.py四项fake测试：正确transport与回执、旧scope拒绝无fallback、成功后对账失败unknown、无效ID不发请求。现有15项comment API及稳定ID回声回归通过。

本阶段只完成Python兼容通道，后续接入显式配置与Host writer，不默认悄悄切换旧scope。
