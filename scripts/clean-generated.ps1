param([switch]$Apply)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\','/')
$taskRelease=Join-Path $taskRoot 'release'
$taskQa=Join-Path $taskRoot '.qa'
$taskVersion=(Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
$taskPointer=Join-Path $taskRelease 'InvoiceAssistant.private.json'
$taskData=(Get-Content -LiteralPath $taskPointer -Raw | ConvertFrom-Json).dataRoot
$taskProtected=@($taskRoot,(Join-Path $taskRoot '.git'),(Join-Path $taskRoot '.private-backups'),$taskPointer,(Join-Path $taskRelease ("InvoiceAssistant-"+$taskVersion+"-x64-Portable.exe")))
if($taskData){$taskProtected+=[IO.Path]::GetFullPath($taskData)}
function Test-TaskInside([string]$candidate,[string]$parent){$c=[IO.Path]::GetFullPath($candidate).TrimEnd('\','/');$p=[IO.Path]::GetFullPath($parent).TrimEnd('\','/');return $c.Equals($p,[StringComparison]::OrdinalIgnoreCase) -or $c.StartsWith($p+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)}
function Assert-TaskSafe([string]$candidate){
 $full=[IO.Path]::GetFullPath($candidate)
 if(-not (Test-TaskInside $full $taskRoot)){throw '清理目标越过项目目录'}
 foreach($p in $taskProtected){if($full.Equals($p,[StringComparison]::OrdinalIgnoreCase) -or (Test-TaskInside $p $full)){throw ('目标包含受保护文件或资料：'+$full)}}
 $item=Get-Item -LiteralPath $full -Force
 if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw ('拒绝清理链接目录：'+$full)}
 return $full
}
$taskTargets=@()
$taskKeepQa=@('latest-build.json','release-audit.json','packaged-smoke-result.json','desktop-smoke-result.json','real-validation.json','cleanup-report.json')
foreach($e in Get-ChildItem -LiteralPath $taskQa -Force){if($e.Name -eq 'builder-cache'){continue};if(-not $e.PSIsContainer -and $e.Name -in $taskKeepQa){continue};$taskTargets+=$e.FullName}
foreach($e in Get-ChildItem -LiteralPath $taskRelease -Force){if(-not $e.PSIsContainer -and ($e.Name -match '^InvoiceAssistant-.*\.(exe|blockmap)$') -and ($e.Name -notlike ('InvoiceAssistant-'+$taskVersion+'-*'))){$taskTargets+=$e.FullName};if($e.Name -eq 'builder-debug.yml'){$taskTargets+=$e.FullName}}
$taskUnpacked=Join-Path $taskRelease 'win-unpacked';if(Test-Path -LiteralPath $taskUnpacked){$taskTargets+=$taskUnpacked}
$taskOldProfile=Join-Path $taskRelease '报销资料';if(Test-Path -LiteralPath $taskOldProfile){$entries=@(Get-ChildItem -LiteralPath $taskOldProfile -Force);if(@($entries | Where-Object {$_.Name -ne 'temp'}).Count -eq 0){$taskTargets+=$taskOldProfile}}
$taskDist=Join-Path $taskRoot 'dist';if(Test-Path -LiteralPath $taskDist){$taskTargets+=$taskDist}
$taskBytes=0L;$taskDeleted=@();$taskFailed=@()
foreach($target in @($taskTargets | Select-Object -Unique)){
 $full=Assert-TaskSafe $target
 $item=Get-Item -LiteralPath $full -Force
 $bytes=if($item.PSIsContainer){[long]((Get-ChildItem -LiteralPath $full -File -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum)}else{[long]$item.Length}
 if(-not $Apply){$taskBytes+=$bytes;continue}
 try{if($item.PSIsContainer){Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction Stop}else{Remove-Item -LiteralPath $full -Force -ErrorAction Stop};$taskBytes+=$bytes;$taskDeleted+=$full}
 catch{$taskFailed+=[pscustomobject]@{Path=$full;Reason=$_.Exception.Message}}
}
$taskReport=[pscustomobject]@{Applied=[bool]$Apply;Targets=$taskTargets.Count;Deleted=$taskDeleted.Count;Bytes=$taskBytes;Failed=$taskFailed;DataRootPreserved=$taskData;PointerPreserved=(Test-Path -LiteralPath $taskPointer)}
if($Apply){$taskManifest=Get-Content -LiteralPath (Join-Path $taskQa 'latest-build.json') -Raw | ConvertFrom-Json;$taskManifest.executable=Join-Path $taskRelease ("InvoiceAssistant-"+$taskVersion+"-x64-Portable.exe");$taskManifest | Add-Member -NotePropertyName cleaned -NotePropertyValue $true -Force;$taskManifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskQa 'latest-build.json') -Encoding UTF8;$taskReport | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskQa 'cleanup-report.json') -Encoding UTF8}
$taskReport | ConvertTo-Json -Depth 6
