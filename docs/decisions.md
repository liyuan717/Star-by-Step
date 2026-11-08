# 实施决策

产品基线来自提供的 `ENERGY_WORLD_V1.0_Codex开发规格.md`。它作为功能参考；实际执行授权来自本次“开发软件”请求，用户后续明确选择“还没有，先完成本地开发”。未使用云账户、未部署、未发送消息、未发布。

1. 项目新建于 `D:\Codex\energy-world`；未覆盖既有工程。主栈为 Expo 58 + RN + TypeScript、Supabase、Skia。
2. RPC 对外统一采用 `(p_request_id uuid, p_payload jsonb)`，每个具体 RPC 有独立入口，业务字段按白名单取出。相较规格的逐字段签名，这是接口封装差异，不扩大写权限。内部函数不向客户端授权。数据库行类型从迁移后的 PostgreSQL catalog 生成。
3. 金额服务器维护；全部写入先锁 profile，然后检查 UUID 结果。成功请求永久保留；失败在 PL/pgSQL 子事务回滚；未知 SQL 错误只向外暴露 SERVER_ERROR。
4. 用户确认任务时携带读取上下文的日期；服务器发现日期变化会拒绝并要求刷新，防止静默跨日完成。旧成功 UUID 仍先重放。
5. 缺 Docker 时先用 PGlite 执行 PostgreSQL schema/RLS/事务，再下载项目内独立 PostgreSQL 做真实 TCP 多连接并发。两者均使用最小 auth.uid/users 测试 shim，不能代替 Supabase Auth/Storage/Edge 联调。
6. 场景为静态程序矢量，所有15种形态随建筑类型与等级变化，无持续渲染动画。详情提供下一等级外观预览；成功提示500ms淡入并遵循系统减少动态效果。头像与奖励图片走私有Storage签名URL。完整性能测量仍需设备环境。
7. 页面详情与编辑路由共用 catch-all 实现，保持约定 URL；5个 tabs 独立。真实多页列表使用30条 `(created_at,id)` 游标，目录最多15条；导出用 UUID 升序游标、白名单、每页30条分别分享，避免全历史堆积。导出每个分页文件远小于10MB。
8. 交付锁文件为 pnpm-lock.yaml，推荐 pnpm 11 frozen install。为了与 Expo ESLint 插件兼容固定 ESLint 9、Babel 7。
9. 未注册/验证账号前不向客户端返回任何演示业务记录。初始0余额；引导仅创建可选新手任务，必须确认完成才能获得10积分。

阶段状态与未验收项以 acceptance-report.md 为准，不因源码存在而标记设备验收通过。
