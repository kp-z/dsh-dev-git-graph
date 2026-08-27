# 项目持久记忆 Project Memory

> 本文件由 dsh-memoir 插件维护：记录本项目历次会话的工作归纳、经验教训与行动指南，
> 作为未来 AGENTS 接手本项目时的行动指南；它是人类可读的投影，不是 system prompt 的完整注入内容。
> 新会话只注入有界的 Hot Memory，完整历史通过 memoir_read 按需检索。

## 经验教训 Lessons Learned

- [2026-08-27 14:02] [经验教训] Mermaid 三层 Web 架构图约定 — 绘制浏览器→Nginx→API→数据库三层架构图时：用 subgraph 分组表达层（客户端层/服务层/数据层）；用 [(数据库)] 双括号表示数据存储；请求链 A→B→C→D 与响应回传链 D→C→B→A 为同一对节点间的往返边，非新节点；输出前用 mermaid_validate 校验语法。
