$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$toolchainRoot=Join-Path (Split-Path $projectRoot -Parent) '.toolchains'
$adb=Join-Path $toolchainRoot 'android-sdk\platform-tools\adb.exe'
$env:ANDROID_USER_HOME=Join-Path $toolchainRoot 'android-user'
$apk=Join-Path $projectRoot 'outputs\energy-world-offline.apk'
if(-not(Test-Path -LiteralPath $apk)){throw '请先构建离线APK'}
& $adb -P 55337 start-server
& $adb -P 55337 -d install -r $apk
if($LASTEXITCODE -ne 0){throw '安装失败，请检查USB调试和手机安装确认。'}
& $adb -P 55337 -d shell am start -n dev.energyworld.local/.MainActivity
if($LASTEXITCODE -ne 0){throw '应用启动失败'}
Write-Output '完全离线版已安装。USB仅用于这次安装；应用不需要网络、服务器或端口映射，日常使用可拔线。'
