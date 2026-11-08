$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$toolchainRoot=Join-Path (Split-Path $projectRoot -Parent) '.toolchains'
$logRoot=Join-Path $projectRoot '.tmp'
New-Item -ItemType Directory -Force $logRoot | Out-Null
# This helper is for the current Windows/Ubuntu workstation; see local-environment.md.
& wsl -d Ubuntu -u root --exec /bin/sh -c 'ip rule add priority 0 to 127.0.0.1 ipproto tcp dport 7897 lookup 127 2>/dev/null || true
ip rule add priority 0 to 127.0.0.0/8 lookup local 2>/dev/null || true'
$projectLinux='/mnt/'+$projectRoot.Substring(0,1).ToLower()+$projectRoot.Substring(2).Replace([char]92,[char]47)
$toolsLinux='/mnt/'+$toolchainRoot.Substring(0,1).ToLower()+$toolchainRoot.Substring(2).Replace([char]92,[char]47)
# All service archives are already cached. The mirror is needed only on cache misses.
$startupOutput = & wsl -d Ubuntu --exec env SUPABASE_HOME=/home/lenovo/.local/share/energy-world-supabase SUPABASE_INTERNAL_SLIM_RELEASES_URL=http://127.0.0.1:18555 "$toolsLinux/supabase-linux/supabase" --workdir $projectLinux start --runtime native --eager --output-format json
if($LASTEXITCODE -ne 0){throw '本地 Supabase 启动失败，先按文档检查镜像下载桥接与缓存。'}
[System.IO.File]::WriteAllText((Join-Path $toolchainRoot 'supabase-start.json'),($startupOutput -join [Environment]::NewLine),(New-Object System.Text.UTF8Encoding($false)))
$healthy=$false
try{$request=[System.Net.HttpWebRequest]::Create('http://127.0.0.1:55321/auth/v1/health');$request.Proxy=$null;$request.Timeout=3000;$response=$request.GetResponse();$healthy=[int]$response.StatusCode -eq 200;$response.Close()}catch{}
if(-not $healthy){
 $node=(Get-Command node).Source
 Start-Process -FilePath $node -ArgumentList @('"'+(Join-Path $PSScriptRoot 'wsl-forward.mjs')+'"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'backend-bridge.log') -RedirectStandardError (Join-Path $logRoot 'backend-bridge-error.log') | Out-Null
}
Write-Output '本地后端： http://127.0.0.1:55321'
Write-Output '本地邮箱： http://127.0.0.1:55324'
Write-Output '已将服务凭据留在 .toolchains 的本地文件中，不输出密钥。'
