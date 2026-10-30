# 重启后隔离云端评论 API 验证

## 阶段计划

用户确认已重启，并通过确认工具明确允许新建「评论协作联调，可删除」的隔离任务。只在此任务添加/回复/读取测试评论，不修改已有任务、不切换会话绑定、不启用全局评论处理。先确认重启能力，再测试真实 API、review 结果和补安全回归。

## 实际结果

- 当前 GUI http://127.0.0.1:58469，GET /dsh-feishu/api/comments 返回 ok=true、entries=[]。宿主版本0.20.1。
- 配置仍为 enabled=false / ownerMode=off / otherMode=off。没有开启其他任务自动处理。
- 新建隔离任务 e40a8854-7db1-4c57-8c7d-8895e4ebddf6，没有绑定会话，没有前置/后置/来源关系。
- 通过正常插件工具创建测试输入，远端原评论ID 7702499914109947170。
- 通过现有授权 Python bridge 创建原生回复，回复ID 7702500347436109099，ok=true、unknownDelivery=false。
- 再次完整读取，commentCount=2、incomplete=false；回复资源task GUID与 reply_to_comment_id 均一致。正文以 🤖: 开头。
- 隔离任务已写入结果并标完成。没有执行代码、没有修改其他任务或会话绑定。

该结果证明真实 comment list/create/reply/get 回执链路，不能代替负责人/非负责人真人双身份触发验证。原生回复关联不等于真实 @ 通知。

## 安全补充

测试发现授权依赖在get_access_token期间先输出认证诊断；load_token原先在lookup之后才logger.remove。本轮将日志静默提前到lookup前，并以 fake-tokenLogging_api 测试断言先静默、后读取，不接触真实凭据。后续真实bridge使用静默级别并仅输出脱敏结果。

## 仍待验收

真实 Task v2 mention 格式尚未确认，持续独立研究。Task v1 rich_content支持at标签不代表v2 content同样支持，不能直接挪用。绑定会话权限/排队/防循环已由fake Host测试覆盖，真人双角色云端端到端还需专用联调环境。
