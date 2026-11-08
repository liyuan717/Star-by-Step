# Star-by-Step
Star by Step is a task management app that turns everyday accomplishments into growth for your space base. Set a goal and break it into small tasks you can do today. Complete them to earn energy, redeem rewards you’ve set for yourself, and watch your base grow from a small outpost.

---

# ENERGY WORLD 1.1 — 完全离线版

安装后首次启动、日常使用、图片、积分和世界成长均在手机本地完成，不需要账号、网络、电脑、USB、Docker、Supabase或本地服务器。用户于2026-11-08明确调整规格，**本离线要求覆盖旧在线规格**。

Android 安装包位于 `outputs/energy-world-offline.apk`。1.1.3（versionCode 5）使用同一包名 `dev.energyworld.local` 和本机签名，支持覆盖升级并保留本机数据。

1.1.3 移除任务页顶部的分类筛选，直接显示今日任务、目标和历史记录。已有任务的分类信息随任务保留。

1.1.2 将首页的基地、余额和经验合并为一张主卡。任务操作集中在卡片底部，任务和奖励页采用统一的分段切换样式。

1.1.1 将历史列表的筛选和分页交给 SQLite。首页读取当前周期所需的完成记录，图片按需读取，7 天和 30 天统计只查询相应日期范围。今日任务按截止日期排序，分类为空时可一键查看全部，奖励中心显示兑换差额和装饰持有状态。

1.1.0 真机结果见[离线验收报告](docs/offline-acceptance-report.md)。实现、备份和迁移见[离线架构](docs/offline-architecture.md)。[在线联调报告](docs/local-integration-report.md)和 `supabase/` 保留作历史参考。

## 使用

1. 在Android手机安装APK，首次启动直接设置昵称、固定IANA时区并创建世界。
2. 添加目标/任务，确认实际完成后获得ENERGY与等量永久WORLD XP；可兑换现实奖励、购买/装备装饰，建筑和成就自动成长。
3. 关闭或强制停止App、重启手机后，SQLite数据仍保留。飞行模式下所有核心功能可用。
4. 在“我的 → 设置与备份”导出完整备份。选择**App以外的手机文件夹**保存；文件包含所有记录、UUID回执和奖励图片。
5. 恢复时选择`.energyworld.json`文件，校验通过后预览世界、余额和图片数量，再明确确认整体覆盖。只替换、不合并；重复恢复不会叠加积分。恢复较早备份会回到当时进度。

**卸载App或清除应用数据会删除本机世界。必须事先备份。** 没有自动云同步、系统自动备份或在线找回功能。请自行保管备份中的个人记录和图片。

## 实现

- Expo58/React Native手机应用，SQLite是唯一数据源；图片内容也在SQLite中保存。无Web产品，无云端运行时。
- 昵称和固定时区本地初始化；没有注册、邮箱验证、登录、找回密码或在线账户。
- 目标、once/daily/weekly任务、暂停/恢复/归档、快照进度、手动完成目标。
- `BEGIN IMMEDIATE`事务、UUID重放、周期与流水唯一索引、提交结果恢复、整数奖励与每日限额、全流水对账。
- 永久XP/10级世界、5类建筑15档AND解锁、3件装饰、5项成就、7/30天统计和时间线。
- 奖励图片/头像保存在本机，完整备份包含图片内容和SHA-256校验；恢复在同一SQLite事务中整体替换数据及图片。
- Android合并清单禁止INTERNET等网络权限，并禁用系统自动备份。手机无法通过本App上传数据。
- 使用固定时区及手机时间计算周期；离线环境无法提供可信服务器时间或阻止用户修改系统时钟。时间明显倒退会提示校准，历史周期仍不可重复发奖。

本地图片每张最多2MB、总量32MB；完整备份最多96MB、总记录50000条。达到限制会明确拒绝，不会静默截断备份。

## 开发与构建

当前电脑已配好项目内JDK17、Android SDK及Node24；不修改系统Java。依赖安装和构建工具首次下载需要开发电脑联网，**生成的手机App运行不需要联网**。

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test --runInBand --testTimeout=30000
pnpm test:unit
pnpm test:offline
pnpm check:release
powershell -ExecutionPolicy Bypass -File scripts/android-build.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-android.ps1
```

没有环境变量、云项目、管理员密钥或后端启动步骤。`pnpm start`仅用于开发；安装的release APK内嵌Hermes bundle，不依赖Metro。iOS源代码保留，但本机Windows环境未执行iOS签名或真机验收。

`tests/offline.test.ts`通过Node24内置真实SQLite执行与手机共用的业务引擎，覆盖经济闭环、并发与重放、日期/周界、约束、故障注入回滚、图片备份、重复导入、进程中断和旧数据转换。它不替代手机原生SQLite、文件选择器和飞行模式验收；报告分别标注。

## 旧版数据

本次只读检查旧本地服务：profiles/tasks/rewards/wallets均为0，没有遗留世界需要迁移。旧APK保留在`outputs/legacy/energy-world-online-1.0.apk`，旧服务未删除或改写。升级后不会访问旧账户或自动丢弃远端数据。

如有自己的旧世界，使用一次性电脑迁移工具生成完整离线备份（含全部图片），随后在手机确认导入：

```powershell
node --import tsx scripts/migrate-legacy.ts --user-id 旧用户UUID --output outputs/旧世界.energyworld.json
```

工具只读旧服务，不进入APK，不要求迁移后的日常使用继续连接旧环境。必须先确保旧服务仍可访问，凭据仅在电脑本地读取；详见[迁移说明](docs/offline-architecture.md)。
