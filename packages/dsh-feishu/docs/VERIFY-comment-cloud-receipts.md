# 评论远端回执只读核验

## 本阶段计划

仅核验已经发生的评论写回与公开接口契约，不发送试验评论，不改真人任务或会话绑定。把脱敏回执做成独立离线 fixture，先 review 后运行测试。

## 观察与证据

2026-10-30，通过 feishu_task_detail(refresh=true) 读取本开发任务，发现两条 AI 进度评论，对应已提交版本 b643376 和 9e91798。仅检查本地 comments.json 的出站元数据，均为 sent，稳定远端 ID 分别为 7702454376148765968、7702456502585429259。未复制作者用户 ID、正文或其他任务资料到仓库。

这证明真实进度写回曾获得稳定远端 ID 并记录到账本；不能替代评论驱动的真实负责人执行/其他人问答端到端测试。

新增 commentsReceipt.mjs 将这些大 ID 用于假任务 fixture：修改正文且去掉机器人前缀仍按出站 ID 排除；同账号使用机器人前缀的新评论不被过滤。该测试只注入 fake IO，不写远端。

公开官方依据：
- https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/task-v2/comment/create
- https://open.feishu.cn/document/task-v2/comment/overview
- https://open.feishu.cn/document/task-v2/faq

创建评论契约明确 content、reply_to_comment_id、resource_type、resource_id；概述明确回复同任务评论和按创建时间分页。未取得 Task v2 评论真实 mention 的可执行格式，不从 IM 消息语法推断评论语法。

## 运行中实例

当前 URL 的 GET /dsh-feishu/api/comments 仍返回没有该接口，说明 HTTP 路由仍是旧 Host 代际。已有进度回执不意味着新的收件箱路由/会话分流已加载。未删除重装插件、未重启用户的 DSH。

## 未完成验收

真实 @ 通知仍需官方契约或受控测试任务确认。新增云端评论触发、绑定会话处理与关联回评需要可控联调环境；目前只获得既有远端写回回执及 fake API 全链路结果。整体目标保持 active。
