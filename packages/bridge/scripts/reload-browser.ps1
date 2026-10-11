#requires -Version 5.1
<#
.SYNOPSIS
  用「MV3 扩展 + 专用 profile」方式启动一个可见的 Chromium/Chrome 窗口。

.DESCRIPTION
  Boss 直聘（zhipin.com）内置加固版 disable-devtool：一旦检测到 DevTools / CDP
  远程调试端口，会执行惩罚逻辑（window.open('','_self') + window.close()）并清空
  页面，同时上报风控。因此本工具链**刻意不使用 CDP**，而是：

    可见窗口 + --load-extension=<扩展目录> + 专用 --user-data-dir（保留登录态）

  同时必须避免无头模式（--headless 会被跳转或弹安全验证）。

.PARAMETER Url
  启动后打开的地址。默认打开 Boss 直聘沟通页。

.PARAMETER ProfileDir
  专用浏览器 profile 目录（保留登录态、扩展状态）。默认 %USERPROFILE%\.boss-kit\profile

.PARAMETER ExtensionPath
  已解压的扩展目录（含 manifest.json）。默认取本脚本上一级的 extension 目录。

.PARAMETER BrowserPath
  指定浏览器可执行文件；留空则自动探测 Edge / Chrome / Chromium。

.PARAMETER ClearCache
  启动前清理扩展的 Service Worker / Code Cache（改了扩展代码后建议加这个开关）。

.PARAMETER NoProxy
  加 --no-proxy-server，强制直连（避免代理把境内站点绕到境外出口）。

.EXAMPLE
  pwsh -File scripts/reload-browser.ps1 -ClearCache
#>
[CmdletBinding()]
param(
  [string]$Url = 'https://www.zhipin.com/web/chat/index',
  [string]$ProfileDir = "$env:USERPROFILE\.boss-kit\profile",
  [string]$ExtensionPath,
  [string]$BrowserPath,
  [switch]$ClearCache,
  [switch]$NoProxy
)

$ErrorActionPreference = 'Stop'

if (-not $ExtensionPath) {
  $ExtensionPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'extension'
}
if (-not (Test-Path (Join-Path $ExtensionPath 'manifest.json'))) {
  throw "扩展目录无效（缺少 manifest.json）：$ExtensionPath"
}

function Resolve-Browser {
  param([string]$Explicit)
  if ($Explicit) {
    if (-not (Test-Path $Explicit)) { throw "指定的浏览器不存在：$Explicit" }
    return $Explicit
  }
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Chromium\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  )
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  throw '未找到浏览器，请用 -BrowserPath 指定 chrome.exe / msedge.exe'
}

$browser = Resolve-Browser -Explicit $BrowserPath
New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

# 关闭使用同一 profile 的旧实例（只杀该 profile，避免影响日常浏览器）
Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*$ProfileDir*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 1200

if ($ClearCache) {
  foreach ($sub in @('Service Worker', 'Code Cache', 'GPUCache')) {
    $p = Join-Path $ProfileDir "Default\$sub"
    if (Test-Path $p) { Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

$args = @(
  "--user-data-dir=$ProfileDir",
  "--load-extension=$ExtensionPath",
  "--disable-extensions-except=$ExtensionPath",
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=DialMediaRouteProvider'
)
if ($NoProxy) { $args += '--no-proxy-server' }
$args += $Url

Write-Host "浏览器 : $browser"
Write-Host "扩展   : $ExtensionPath"
Write-Host "Profile: $ProfileDir"
if ($ClearCache) { Write-Host '已清理 Service Worker / Code Cache' }
Start-Process -FilePath $browser -ArgumentList $args | Out-Null
Write-Host '已启动。若扩展未连上桥，请在 chrome://extensions 里确认扩展已启用。'
