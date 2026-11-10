# 停止玄枢・AURUM（中台 + 本地渲染）
foreach ($port in @(8787, 8188)) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host ("停止端口 $port → pid " + $_.OwningProcess)
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}
Write-Host '已停止'
