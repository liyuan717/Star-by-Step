# 本机原生构建环境

环境安装位于 `D:\Codex\.toolchains`，未更改系统 Java 8、全局 PATH 或安装 Docker Desktop。

- Microsoft OpenJDK 17.0.21.0.2，官方 ZIP + SHA256 校验。
- Google command-line tools 22.0，官方 ZIP SHA256 为 `90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a`。
- Android 平台包名为 `platforms;android-37.0`（不是 `android-37`）、build-tools 37.0.0、NDK 27.1.12297006、CMake 3.22.1、platform-tools。
- Gradle wrapper 9.4.1；缓存单独放在 `.toolchains/gradle`。
- CMake自带Ninja1.10.2不支持长路径，已按Expo官方方案将项目工具目录的Ninja升级至1.12.1，保留旧二进制备份。系统LongPathsEnabled原本为1，未改注册表。依赖布局改为hoisted，原依赖保留在`D:\Codex\.energy-deps-isolated-backup`。
- 系统代理为本机 HTTP 代理。Java 不自动使用 Windows 代理，因此构建脚本为该进程读取系统代理后设置 JVM 参数；不改全局代理。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/android-build.ps1 -Action apk
```

本地预览使用生成的 debug signing key 签署 release variant，并内嵌 JS，运行不依赖 Metro。正式发布仍需维护者的包标识与正式签名。只有 development 环境且后端明确为 HTTP URL 时，config plugin 才为原生清单启用明文流量。

## Supabase 3 与现有 Ubuntu WSL

已固定 CLI 3.0.0；配置使用 `[local_smtp]` 替代已删除的 `[inbucket]`，启用实验性 `[experimental] stack=true`。原生 runtime 在 Linux 可用，Windows 本体不支持；本机使用现有 Ubuntu 24.04 WSL。

CLI 路径：`/mnt/d/Codex/.toolchains/supabase-linux/supabase`。数据及缓存：`/home/lenovo/.local/share/energy-world-supabase`。启动/状态的原始 JSON 可能含本地凭据，仅保存在工作区外层 `.toolchains`，不加入源码归档、不输出到聊天。

```powershell
wsl -d Ubuntu --exec env SUPABASE_HOME=/home/lenovo/.local/share/energy-world-supabase /mnt/d/Codex/.toolchains/supabase-linux/supabase --workdir /mnt/d/Codex/energy-world start --runtime native --eager
```

本机 WSL 的 VirtioProxy 路由曾把 Linux 自己的 127.0.0.1 TCP 发往 Windows，连最小自连接测试都拒绝。此次仅增加临时内核规则，让本地流量留在 Linux，同时保留已存在 Windows 代理端口的转发；未修改 `.wslconfig`、`/etc/wsl.conf` 或外部路由。规则随 WSL 重启失效。撤销本次新增的精确规则：

```powershell
wsl -d Ubuntu -u root --exec ip rule del priority 0 to 127.0.0.0/8 lookup local
wsl -d Ubuntu -u root --exec ip rule del priority 0 to 127.0.0.1 ipproto tcp dport 7897 lookup 127
```

服务若需代理，启动时另传当前进程的 `HTTPS_PROXY`、`HTTP_PROXY`、`NO_PROXY=localhost,127.0.0.1,::1`。不应盲目复制端口到其他电脑。先运行最小 loopback 测试与代理连通性检查，再使用本机当前值。

参考：[Microsoft JDK 下载](https://learn.microsoft.com/en-us/java/openjdk/download-major-urls)、[Android 工具](https://developer.android.com/studio)、[Supabase 原生运行时](https://supabase.com/docs/guides/local-development/docker-and-native-runtimes)。实际构建与服务验收状态以验收报告为准。

## 最终使用的本机工作流

服务包最终通过`scripts/slim-release-mirror.py`（本机回环18555）传输固定官方GitHub发布资产，CLI仍按supabase.lock验证全部hash。它解决了CLI下载器未沿用系统代理的问题；没有改主机DNS文件。包已全部缓存，日常启动不再需要下载。Windows原有WSL转发不可用，因此`scripts/wsl-forward.mjs`仅监听Windows127.0.0.1的55321–55324，通过WSL stdio转发服务54321–54324，没有LAN监听或防火墙开放。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1
# 手机连接USB、开启USB调试并授权后
powershell -ExecutionPolicy Bypass -File scripts/install-android.ps1
```

安装脚本使用独立ADB端口55337，并执行`adb reverse tcp:55321 tcp:55321`。App仅包含本地栈的公开publishable key。随机服务端JWT/secret配置只存在被忽略的`supabase/.env.local`，CLI状态文件在`.toolchains/supabase-start.json`，二者均不进入App或源码归档。公开客户端key固定；管理员密钥已改为随机值并验证旧值无效。详见[最新验收](local-integration-report.md)。
