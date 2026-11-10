﻿<#
  玄枢・AURUM 一键启动
  用法：右键「使用 PowerShell 运行」，或在终端执行  .\start.ps1
  启动后：中台 http://127.0.0.1:8787   本地渲染 http://127.0.0.1:8188
#>
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataDir = 'D:\BaiduSyncdisk\wmj_work\XJ\AIweizongyi\aurum-data'
$comfyDir = 'D:\BaiduSyncdisk\wmj_work\XJ\ComfyUI'
$logs = Join-Path $dataDir 'logs'
$comfyRun = 'D:\BaiduSyncdisk\wmj_work\XJ\AIweizongyi\comfy-runtime'
New-Item -ItemType Directory -Force -Path $logs, (Join-Path $comfyRun 'output'), (Join-Path $comfyRun 'temp'), (Join-Path $comfyRun 'input') | Out-Null

function Test-Port([int]$port) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

if (-not (Test-Port 8188)) {
  Write-Host '[1/2] 启动本地渲染服务（ComfyUI）…'
  Start-Process -FilePath (Join-Path $comfyDir '.venv\Scripts\python.exe') `
    -ArgumentList 'main.py','--listen','127.0.0.1','--port','8188','--preview-method','none','--output-directory',(Join-Path $comfyRun 'output'),'--temp-directory',(Join-Path $comfyRun 'temp'),'--input-directory',(Join-Path $comfyRun 'input') `
    -WorkingDirectory $comfyDir -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs 'comfy.log') -RedirectStandardError (Join-Path $logs 'comfy.err.log')
} else { Write-Host '[1/2] 本地渲染服务已在运行（8188）' }

if (-not (Test-Port 8787)) {
  Write-Host '[2/2] 启动中台（API + 前端）…'
  $env:AURUM_DATA_DIR = $dataDir
  Start-Process -FilePath 'node' `
    -ArgumentList '--experimental-sqlite','--import','tsx','src/index.ts' `
    -WorkingDirectory (Join-Path $root 'services\api') -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs 'api.log') -RedirectStandardError (Join-Path $logs 'api.err.log')
} else { Write-Host '[2/2] 中台已在运行（8787）' }

# [可选] Breeze TTS 2：角色本地音色（7861）
$breezePy = 'D:\BaiduSyncdisk\wmj_work\XJ\AiJue\local_models\breeze-venv\Scripts\python.exe'
$breezeRoot = 'D:\BaiduSyncdisk\wmj_work\XJ\AiJue'
$breezeOn = $false
try { $null = Invoke-WebRequest -Uri 'http://127.0.0.1:7861/health' -TimeoutSec 3 -UseBasicParsing; $breezeOn = $true } catch { $breezeOn = $false }
if (-not $breezeOn -and (Test-Path $breezePy)) {
  Write-Host '[3/3] 启动本地音色服务（Breeze TTS 2，加载约 1–2 分钟）…'
  Start-Process -FilePath $breezePy -ArgumentList 'scripts\tts_server.py','start','--wait','600' -WorkingDirectory $breezeRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'breeze.log') -RedirectStandardError (Join-Path $logs 'breeze.err.log')
  $breezeOn = 'starting'
} elseif ($breezeOn) { Write-Host '[3/3] 本地音色服务已在运行（7861）' } else { Write-Host '[3/3] 未找到 Breeze 环境，角色音色将回退云端 edge' }

Write-Host ''
Write-Host '等待服务就绪…'
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 1
  $api = (Test-Port 8787)
  $cfy = (Test-Port 8188)
  if ($api -and $cfy) { break }
}
$apiOk = Test-Port 8787
$cfyOk = Test-Port 8188
Write-Host ('中台   ' + $(if ($apiOk) { 'http://127.0.0.1:8787  ✔' } else { '未起来，看日志 ' + $logs + '\api.err.log' }))
Write-Host ('渲染   ' + $(if ($cfyOk) { 'http://127.0.0.1:8188  ✔' } else { '未起来，看日志 ' + $logs + '\comfy.err.log' }))
Write-Host ('音色   ' + $(if ($breezeOn -eq $true) { 'http://127.0.0.1:7861  ✔' } elseif ($breezeOn -eq 'starting') { '启动中，稍后自动可用' } else { '未启动，回退 edge-tts' }))
if ($apiOk) { Start-Process 'http://127.0.0.1:8787' }
