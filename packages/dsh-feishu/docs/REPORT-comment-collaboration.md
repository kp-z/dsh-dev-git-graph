# 评论协作实现与验证报告

## 实现

版本 0.20.0。按阶段先计划后实现和测试，实施计划见 PLAN-comment-collaboration.md。

结构只增加 comments.js 协调器及现有 Python 桥评论操作，不创建新的问答会话。完整有界分页 → 原子收件箱 → 原绑定会话 queue → 显式 feishu_comment_reply → 原生评论回复 → 稳定远端 ID 出站账本。

负责人模式允许在原会话判断工作指令；其他人模式只回答当前任务问题，通过 Host guard 限定任务详情和关联回复工具。首次历史基线不执行；忙碌/冷会话不自动唤醒；关闭、暂停、完成、绑定变化和权限下降阻止/降级处理。

AI 正文显示 🤖:，绝不用于识别自身。自身识别按 task ID + 出站远端 comment ID；同账号真人新评论与相同正文仍可处理。

## 验证结果

- comments.mjs：25 组 fake 状态机验证，包括重启、未知结果、ID 防循环、dispose 等待在途副作用。
- commentsBridge.mjs：13 组真实 Host apply + fake 子进程/API 集成，覆盖路由/工具、baseline、新评论投递、关联回复回执、全轮只读 guard、重启迟到/重复未知拒绝、关闭后重启拒绝与 GUID 错配。
- comments_api.py：15 项 fake Python API，覆盖分页完整性、游标循环、上限、权限错误、大 ID、创建回执、原生回复资源归属、未知 POST、防伪 mention。
- commentsPanel.mjs / configurationPanel.mjs：配置折叠、旧能力门控、草稿保护、收件箱懒加载、安全操作、布局/语法。
- 所有既有离线 JavaScript suites 与 relations_api.py 通过；新增 test:offline 排除会读同步真实飞书的旧 smoke。
- syntax 与 scoped git diff --check 通过。
- 浏览器当前面板右上配置与评论组可打开，但当前 Host 的 GET comments 路由仍是旧代码，界面显示具体缺接口原因。未重启正在工作的 DSH。

发现并修复：未知投递首次拒绝后 active map 提前赋值导致第二次 admission 绕过；未等待 durable running 的放行；卸载未等待队列；绑定 GUID 未校验；关闭配置后重启可能漏恢复权限。对应专项回归保留。

## 明确限制

真实 @ mention 协议未从官方 Task v2 契约确认。本版本只用已证实的 reply_to_comment_id 原生关联，不保证 @ 通知，也不写假 @姓名。不是“真实@已支持”。

飞书没有创建评论 uid 幂等参数。POST 超时/缺 ID 时停止该任务自动处理，需要管理员根据远端证据对账，不能安全地盲重试。收件箱忽略输入不会清除未知出站锁。实现保证有界进程故障处理，不宣称断电或跨系统 exactly-once。

完整扫描默认最多20页，超过上限时明确不完整、不推进基线。开启的任务较多时会增加API耗时；未加独立实时轮询或事件订阅，沿用现有同步周期。

非负责人仍在同一绑定会话中，Host 可限制工具副作用，但模型已有会话上下文不能彻底隔离；不适用于需要强机密隔离的外部访客自动回复，开启前应评估资料分享范围。

无真人任务写入/执行用于测试；端到端为 fake API + 真 Host 接线，不冒充真实飞书云端写回联调。既有全量npm test曾被并行检查运行，包含旧smoke读取真实CLI；主最终验证使用offline，未再调用真实写API。

插件已经 link 安装，新模块在本地源目录。重复 install_bundle 返回 already-installed，未删除/重装正在使用的插件。Host 需正常重载/重启后获得新路由和工具；本轮不擅自重启。
