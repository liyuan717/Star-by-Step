param(
  [ValidateSet('apk','dependencies')][string]$Action='apk',
  [ValidateSet('arm64-v8a','x86_64','arm64-v8a,x86_64')][string]$Architectures='arm64-v8a'
)
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$toolchainRoot=Join-Path (Split-Path $projectRoot -Parent) '.toolchains'
$jdk=Get-ChildItem -LiteralPath (Join-Path $toolchainRoot 'java') -Directory | Where-Object {Test-Path -LiteralPath (Join-Path $_.FullName 'bin\javac.exe')} | Select-Object -First 1
if(-not $jdk){throw '请先安装项目内 JDK 17：见 docs/local-environment.md'}
$env:JAVA_HOME=$jdk.FullName
$env:ANDROID_HOME=Join-Path $toolchainRoot 'android-sdk'
if(-not (Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'))){throw 'Android SDK 尚未安装'}
$env:ANDROID_USER_HOME=Join-Path $toolchainRoot 'android-user'
$env:GRADLE_USER_HOME=Join-Path $toolchainRoot 'gradle'
$env:TEMP=Join-Path $projectRoot '.tmp'
$env:TMP=$env:TEMP
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
$env:PATH=$env:JAVA_HOME+'\bin;'+(Join-Path (Split-Path $projectRoot -Parent) '.tools\node_modules\.bin')+';'+$env:PATH
$env:CI='1'
$probe=[Uri]'https://dl.google.com'
$proxy=[System.Net.WebRequest]::DefaultWebProxy.GetProxy($probe)
if($proxy.Host -ne $probe.Host){
 $env:JAVA_TOOL_OPTIONS="-Dhttps.proxyHost=$($proxy.Host) -Dhttps.proxyPort=$($proxy.Port) -Dhttp.proxyHost=$($proxy.Host) -Dhttp.proxyPort=$($proxy.Port) -Dhttp.nonProxyHosts=localhost|127.*"
}
Push-Location $projectRoot
try{
 & node node_modules/expo/bin/cli prebuild --platform android --no-install
 if($LASTEXITCODE -ne 0){throw 'Expo prebuild failed'}
 Push-Location (Join-Path $projectRoot 'android')
 try{
  if($Action -eq 'dependencies'){
   & .\gradlew.bat :app:dependencies --configuration releaseRuntimeClasspath --no-daemon --max-workers=2
  }else{
   & .\gradlew.bat :app:assembleRelease "-PreactNativeArchitectures=$Architectures" --no-daemon --max-workers=2
  }
  if($LASTEXITCODE -ne 0){throw 'Android Gradle build failed'}
 }finally{Pop-Location}
 if($Action -eq 'apk'){
  $output=Join-Path $projectRoot 'outputs'
  New-Item -ItemType Directory -Force $output | Out-Null
  Copy-Item -LiteralPath 'android\app\build\outputs\apk\release\app-release.apk' -Destination (Join-Path $output 'energy-world-offline.apk')
  Write-Output ('Offline standalone APK: '+(Join-Path $output 'energy-world-offline.apk'))
  Write-Output 'Uses the generated local debug signing key. Not a production/store package.'
 }
}finally{Pop-Location}
