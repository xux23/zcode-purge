#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $root 'plugins\zcode-purge\scripts\purge.mjs'
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  & $node.Source $script install @args
  exit $LASTEXITCODE
}
if ($env:ZCODE_NODE_FALLBACK_EXEC_PATH) {
  $env:ELECTRON_RUN_AS_NODE = '1'
  & $env:ZCODE_NODE_FALLBACK_EXEC_PATH $script install @args
  exit $LASTEXITCODE
}
Write-Error 'Node.js (>=18) not found. Install Node or pass --cli after making node available.'
exit 1
