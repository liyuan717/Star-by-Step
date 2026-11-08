> 历史报告：以下是1.0在线测试结果。当前1.1完全离线版见[离线验收报告](offline-acceptance-report.md)。旧APK已归档到outputs/legacy，不是当前交付包。

# 本地集成验收（最新）

日期：2026-11-08，Asia/Shanghai。已安装项目内构建工具、启动完整Supabase、验证真实账户/数据/Storage/Edge并生成Android APK。已在华为P60执行真机核心流程验收；未发布。

## 交付物

- APK：`D:\Codex\energy-world\outputs\legacy\energy-world-online-1.0.apk`，46,829,995字节（约47MB），arm64-v8a，`dev.energyworld.local`，1.0.0，compileSDK37/targetSDK36。
- SHA256：`b729d91bd752042d5b46a4bee0b70e908ce8f9ed9abb512e1e4afa7c639081d4`。
- 本地Android Debug证书签署release variant，APK v2签名验证通过。不是正式商店签名包。
- 内嵌Hermes bundle 4,767,308字节，含实际55321后端地址，无需Metro；已确认含明确login/register路由且无旧`(auth)/[mode]`路由。
- 最终构建：`scripts/android-build.ps1 -Action apk`；`BUILD SUCCESSFUL in 11m 3s`，830 tasks；覆盖安装成功，APK v2签名复验通过。

## 真实后端验证

Supabase CLI3.0.0，Ubuntu24.04 WSL原生runtime，PostgreSQL17.11。服务包使用官方锁文件校验。没有安装Docker Desktop或云项目；没有修改系统Java、全局代理、注册表或WSL配置文件。

| 项目                                           | 结果                           |
| ---------------------------------------------- | ------------------------------ |
| 完整db reset：8份迁移与目录种子                | PASS                           |
| pgTAP：钱包直写/完成直写/匿名RPC/private隔离   | PASS，4 assertions             |
| 真实Auth密码登录、JWT、引导                    | PASS                           |
| 公开注册→本地邮箱确认→PKCE换会话               | PASS                           |
| 重置邮件→PKCE→新密码登录、旧密码拒绝           | PASS                           |
| 两项50任务→兑换80→daily30                      | PASS，50 ENERGY / 130 XP / Lv2 |
| REST跨用户隔离、外人对象RPC和钱包直写拒绝      | PASS                           |
| 私有Storage上传、签名读取、他人签名请求拒绝    | PASS                           |
| 本人分页JSON导出                               | PASS                           |
| Edge错误密码拒绝且不锁账户                     | PASS                           |
| 正确密码重验、清理图片、删除Auth及级联业务数据 | PASS                           |
| 20独立连接同周期只发1次奖励                    | PASS，真实Supabase数据库       |
| 同UUID20连接返回同完成ID                       | PASS                           |
| 150余额并发兑换100只成功1次                    | PASS                           |
| 钱包/累计收支/XP/流水/库存对账                 | PASS                           |
| 类型/lint/组件测试/嵌入式SQL测试               | PASS                           |

实际运行`test:backend`、`test:auth-email`、`test:integration`、`test:concurrency`、`test:reconcile`；本机API55321、邮箱55324、数据库55322。管理员测试凭据从工作区外层CLI本地状态文件读取，不进入EXPO_PUBLIC或聊天输出。测试账户和图片在finally清理，邮件仅发往本机Mailpit，没有使用用户真实邮箱。

## 本轮修复

1. 真实迁移角色不是超级用户；补齐函数owner移交所需角色与schema权限。
2. native Auth schema不授予自定义角色USAGE；Security Definer通过私有helper读取PostgREST已验证的JWT会话设置取得同等uid，不扩大Auth数据权限。普通用户RLS仍使用auth.uid()。
3. Windows长路径：保留旧依赖后改hoisted布局，升级项目内Ninja1.12.1，完整原生编译通过。
4. Edge依赖改为固定版本SDK本地bundle并附许可证，避免运行时npm下载，真实注销验证通过。
5. WSL回环策略路由临时修复、保留代理转发；服务包下载桥接保留官方hash校验。Windows访问WSL使用仅回环监听的stdio桥接。
6. PowerShell5.1的UTF-16重定向导致状态JSON解析错误，工具日志曾出现默认本地开发凭据。已修正为显式UTF-8、脱敏解析异常；确认空开发库后重建，并配置仅服务端随机JWT与secret key。验证旧管理员密钥被拒绝，新凭据下闭环重新通过。公开客户端key保持稳定，APK已确认不含服务端JWT或opaque secret。两个.env.local均被git与源码归档排除。

## 使用与剩余验收

1. 运行`scripts/start-local.ps1`：API55321、邮箱55324、Studio55323。
2. Android手机连接USB、启用调试并授权电脑，运行`scripts/install-android.ps1`安装、映射端口并启动。
3. App注册后在同一手机浏览器打开`http://127.0.0.1:55324`读取验证邮件并点击链接，以保留PKCE上下文。安装脚本额外映射了手机54321到主机55321，供邮件中的原始Auth地址使用。

真机验收使用华为P60（LNA_AL00，Android12/API31，arm64），通过ADB55337、USB反向端口映射访问本机Supabase。已安装并验证核心流程及Skia实际渲染，详见下文。200%字体、屏幕阅读器、弱网未知结果恢复、完整Maestro、手机PKCE邮件深链仍NOT RUN。iOS签名/真机仍BLOCKED。正式包标识、品牌图标、隐私/支持配置、正式签名、云部署与备份恢复演练未完成。

## 华为P60真机验证

用户授权使用随机临时测试账号；不使用用户真实邮箱。通过ADB实际输入、点击和滚动应用界面，后端只读查询核对到账与记录，不通过后台代替手机完成任务或兑换。

- 密码登录、新手引导：PASS；昵称PhoneTester，固定Asia/Shanghai，初始0 ENERGY / 0 XP。
- 手机创建并确认两项50积分一次性任务：PASS；100 ENERGY / 100 XP / Lv.2，完成记录各一条。
- Skia世界场景：PASS；太空基地Lv.1、能源中心Lv.1实际渲染，五个导航可操作。
- 手机创建80积分现实奖励并兑换：PASS；余额20，XP100、Lv.2与建筑不变。
- 强制停止进程后冷启动：PASS；自动恢复登录及20 ENERGY / 100 XP / Lv.2。
- 本轮发现并修复：`(auth)/[mode]`动态单段路由会抢先匹配`/redemptions`、`/settings`等业务地址。改为login/register/forgot-password三个明确路由，共用`src/auth.tsx`；已登录用户访问登录页自动返回首页。
- 新版APK真机路由回归：兑换记录、ENERGY流水、个人统计、成就图鉴、我的装饰、设置均PASS；已登录访问login回到首页。奖励在手机标记为已享用，后端记录同步。
- 新版APK手机创建并完成30积分每日任务：PASS；最终50 ENERGY / 130 XP / Lv.2，共3条任务完成、1条已享用兑换记录；已完成的每日任务不再出现在今日待办中。
- 新版APK的注册、找回密码入口与返回登录：PASS（本轮仅检验页面导航，真实注册邮件/PKCE已在后端测试通过，手机邮件链路仍待验收）。退出登录后重新输入临时账号密码，成功恢复50 ENERGY / 130 XP / Lv.2；再次退出并强制停止、冷启动保持未登录。
- 最终进程的AndroidRuntime致命异常与ReactNativeJS错误日志均为0。自动输入期间临时切换到手机自带输入法，结束后已恢复原微信输入法。临时Auth账号、级联业务数据和本机临时凭据文件已清理，手机保留新版应用并停在登录页。
- 修复后类型和lint检查通过。3项组件测试全部通过；与原生构建并行时默认5秒超时的一次运行失败，使用30秒测试上限重新运行全部通过（14.566秒），未修改测试断言。

完整设备截图保留在本机`outputs/phone-verification/`。本地预览依赖这台电脑运行后端并保持USB映射，断线后不具备云端服务能力。
