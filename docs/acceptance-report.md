# 首轮本地开发验收记录

以下保留首轮结果。**后续已生成 APK 并完成真实后端联调；当前状态以 [本地集成验收](local-integration-report.md) 为准。**

日期：2026-11-08（Asia/Shanghai）。**当前状态：本地代码与核心交易验证已交付，V1.0 发布未完成。** 用户确认暂不提供 Supabase 云项目/设备，先完成本地开发。

## 实际环境与结果

Windows x64；Node 24.22.1；pnpm 11.25.0；Expo 58.0.23；RN 0.88.1；React 19.3.0。没有发现 Docker、Android SDK/adb，未提供云项目、EAS/Apple凭据。真实多连接验证使用 embedded-postgres 18.6.0-beta.19 的 PostgreSQL 18二进制，项目 Supabase 配置为 PostgreSQL 17：跨版本完整 Supabase 验证仍需执行。

| 检查                                          | 状态    | 证据/限制                                                                      |
| --------------------------------------------- | ------- | ------------------------------------------------------------------------------ |
| 依赖安装/锁文件                               | PASS    | pnpm install；构建脚本已显式允许                                               |
| Expo 原生包兼容性                             | PASS    | expo install --check：Dependencies are up to date                              |
| TypeScript                                    | PASS    | tsc --noEmit，无错误                                                           |
| Expo ESLint                                   | PASS    | 运行 app/src/domain tests，无错误                                              |
| 单元测试                                      | PASS    | 3项：等级边界/周期跨年/安全整数与输入                                          |
| React Native组件                              | PASS    | Jest，3项：等待锁定+继续仅关闭、错误不假成功、余额不足禁止兑换                 |
| 业务SQL迁移执行                               | PASS    | PGlite、独立 PostgreSQL；Auth最小shim；不包括Storage迁移                       |
| 数据库场景                                    | PASS    | database.mjs 中22组检查，详见测试输出与下表                                    |
| 真并发                                        | PASS    | 20个独立TCP连接/实际提交；同周期仅1成功；同UUID同ID；150余额并发100兑换仅1成功 |
| 账本对账                                      | PASS    | 钱包余额/累计收入支出、XP、正负流水与库存归属                                  |
| Android/iOS资源打包                           | PASS    | Expo export：Android2002 / iOS2010 modules，各约5.8MB Hermes资源；不是安装包   |
| 完整Supabase db reset/pgTAP/Auth/Storage/Edge | BLOCKED | Docker和完整本地服务未安装；脚本与CI已提供                                     |
| Android可安装APK/真机/E2E                     | BLOCKED | 无SDK/adb/模拟器或真机；未产出APK                                              |
| iOS签名/真机/TestFlight                       | BLOCKED | Windows无Xcode，未提供Apple/EAS凭据，未运行                                    |
| 正式发布配置                                  | BLOCKED | 包标识、EAS项目、后端、发布主体、支持邮箱、政策URL待填                         |

最初 Android Hermes 导出因沙箱临时目录写权限失败；将 TEMP/TMP 指向工作区 `.tmp` 后通过。最初SQL发现内部helper执行权限与异常处理问题，修复后相关测试已重跑通过。测试发现组件异步回调阻塞事件等待，已改为同步触发并加ref防重复提交，组件测试通过。

## 规格测试矩阵映射

PASS 表示列出的实际子场景通过；PARTIAL 仍不等于整个编号验收通过。

| 编号 | 状态    | 实际覆盖与缺口                                                                       |
| ---- | ------- | ------------------------------------------------------------------------------------ |
| T01  | PASS    | 同UUID重试20次；真实20连接同ID                                                       |
| T02  | PASS    | 20不同UUID真实并发只1成功                                                            |
| T03  | PARTIAL | 同UUID换operation拒绝；换task参数需补独立断言                                        |
| T04  | PARTIAL | 陈旧确认日期拒绝；重放先于状态校验；实际23:59/00:01设备/时钟边界未跑                 |
| T05  | PARTIAL | SQL跨年周一/DST重叠时刻键相同；完整周日到周一业务写入未跑                            |
| T06  | PASS    | 暂停/恢复/编辑后不重领；归档后旧UUID重放；标题快照保留                               |
| T07  | PASS    | 只剩10额度时20奖励整笔拒绝                                                           |
| T08  | PASS    | 150余额并发两个100只1成功，余额50                                                    |
| T09  | PARTIAL | 兑换UUID串行重试仅1流水；同兑换UUID独立连接并发待补                                  |
| T10  | PASS    | 旧价格/版本拒绝且未扣款                                                              |
| T11  | PARTIAL | 虚拟重复购买拒绝、装备成功、DB槽位唯一；同槽位两个目录项切换未测                     |
| T12  | PASS    | 花光余额后XP/等级/建筑/成就保留                                                      |
| T13  | PASS    | XP300学习不足无研究中心，补齐300分钟后出现                                           |
| T14  | PARTIAL | 六组XP fixtures与20000XP五建筑三级通过；重复sync无重复事件；逐级事件计数还需扩展断言 |
| T15  | PARTIAL | 正/负流水插入故障注入，发奖/扣款回滚；未逐个SQL步骤注入                              |
| T16  | PARTIAL | 双用户RLS、外人对象RPC拒绝；所有表/跨用户FK完整矩阵待补                              |
| T17  | PARTIAL | 钱包直接UPDATE/private查询拒绝；anon函数/全表权限pgTAP需完整Supabase                 |
| T18  | PARTIAL | 同日去重、空日打断current streak；七日成就/最长段复杂历史待补                        |
| T19  | PASS    | 解除关联不改历史，手动完成目标无额外奖励                                             |
| T20  | PARTIAL | 重复引导单钱包/基地/新手任务0赠币；手机重启未跑                                      |
| T21  | PARTIAL | 注销锁后RPC拒绝；Storage清理/密码重验/失败恢复/全量删除未联调                        |
| T22  | PARTIAL | 全历史对账与JS安全整数边界；服务器9万亿边界故障需补                                  |

## 阶段与剩余工作

- P0–P4：主要源代码已实现，交易闭环有测试；认证深链/Skia/native导航还没有设备证据。
- P5：导出、注销、头像/图片、分类筛选、成功淡入、下一等级预览已有代码；六组世界fixtures通过。仍需完整Supabase生命周期联调、200%字体/屏幕阅读器/小屏/弱网/跨账号设备测试与性能实测。
- P6：未完成。Android APK、iOS构建、真机验收、正式品牌图标、发布配置与备份恢复演练均未完成。CI流程尚未在GitHub执行。

本记录不把代码、资源包、测试shim或静态场景当作可安装成品。后续先启动本地Supabase运行全部迁移/权限/集成测试，再连接开发构建执行规格的完整新账号旅程，最后生成签名预览包并逐项更新本报告。
