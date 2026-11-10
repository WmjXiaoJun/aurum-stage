import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\start.ps1";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('Breeze')) {
  const marker = "Write-Host ''\nWrite-Host '等待服务就绪…'";
  const block = `# [可选] Breeze TTS 2：角色本地音色（7861）
$breezePy = 'D:\\BaiduSyncdisk\\wmj_work\\XJ\\AiJue\\local_models\\breeze-venv\\Scripts\\python.exe'
$breezeRoot = 'D:\\BaiduSyncdisk\\wmj_work\\XJ\\AiJue'
$breezeOn = $false
try { $null = Invoke-WebRequest -Uri 'http://127.0.0.1:7861/health' -TimeoutSec 3 -UseBasicParsing; $breezeOn = $true } catch { $breezeOn = $false }
if (-not $breezeOn -and (Test-Path $breezePy)) {
  Write-Host '[3/3] 启动本地音色服务（Breeze TTS 2，加载约 1–2 分钟）…'
  Start-Process -FilePath $breezePy -ArgumentList 'scripts\\tts_server.py','start','--wait','600' -WorkingDirectory $breezeRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'breeze.log') -RedirectStandardError (Join-Path $logs 'breeze.err.log')
  $breezeOn = 'starting'
} elseif ($breezeOn) { Write-Host '[3/3] 本地音色服务已在运行（7861）' } else { Write-Host '[3/3] 未找到 Breeze 环境，角色音色将回退云端 edge' }

Write-Host ''
Write-Host '等待服务就绪…'`;
  s = s.replace(marker, block);
  s = s.replace("Write-Host ('渲染   ' + $(if ($cfyOk) { 'http://127.0.0.1:8188  ✔' } else { '未起来，看日志 ' + $logs + '\\comfy.err.log' }))",
    "Write-Host ('渲染   ' + $(if ($cfyOk) { 'http://127.0.0.1:8188  ✔' } else { '未起来，看日志 ' + $logs + '\\comfy.err.log' }))\nWrite-Host ('音色   ' + $(if ($breezeOn -eq $true) { 'http://127.0.0.1:7861  ✔' } elseif ($breezeOn -eq 'starting') { '启动中，稍后自动可用' } else { '未启动，回退 edge-tts' }))");
  fs.writeFileSync(p, '\uFEFF' + s, 'utf8');
  console.log('start.ps1 patched with Breeze');
} else console.log('already');
