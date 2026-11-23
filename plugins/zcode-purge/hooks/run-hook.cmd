: << 'CMDBLOCK'
@echo off
REM Cross-platform launcher for zcode-purge hooks (same polyglot approach as the design plugin).
REM Windows cmd.exe runs the batch part; POSIX sh skips the heredoc and runs the shell part.
setlocal
set "HOOK_DIR=%~dp0"
set "HOOK_JS=%HOOK_DIR%hook.mjs"

if defined ZCODE_PURGE_NODE goto use_override
where node >nul 2>nul && goto use_node
if defined ZCODE_NODE_FALLBACK_EXEC_PATH goto use_electron
if exist "%ProgramFiles%\nodejs\node.exe" goto use_pf
if exist "%ProgramFiles(x86)%\nodejs\node.exe" goto use_pf86
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" goto use_local
if exist "%LOCALAPPDATA%\Programs\ZCode\ZCode.exe" goto use_zcode
if exist "%ProgramFiles%\ZCode\ZCode.exe" goto use_zcode_pf
exit /b 0

:use_override
"%ZCODE_PURGE_NODE%" "%HOOK_JS%"
exit /b 0

:use_node
node "%HOOK_JS%"
exit /b 0

:use_electron
set "ELECTRON_RUN_AS_NODE=1"
"%ZCODE_NODE_FALLBACK_EXEC_PATH%" "%HOOK_JS%"
exit /b 0

:use_pf
"%ProgramFiles%\nodejs\node.exe" "%HOOK_JS%"
exit /b 0

:use_pf86
"%ProgramFiles(x86)%\nodejs\node.exe" "%HOOK_JS%"
exit /b 0

:use_local
"%LOCALAPPDATA%\Programs\nodejs\node.exe" "%HOOK_JS%"
exit /b 0

:use_zcode
set "ELECTRON_RUN_AS_NODE=1"
"%LOCALAPPDATA%\Programs\ZCode\ZCode.exe" "%HOOK_JS%"
exit /b 0

:use_zcode_pf
set "ELECTRON_RUN_AS_NODE=1"
"%ProgramFiles%\ZCode\ZCode.exe" "%HOOK_JS%"
exit /b 0
CMDBLOCK

dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 0
js="$dir/hook.mjs"
[ -f "$js" ] || exit 0

if [ -n "${ZCODE_PURGE_NODE:-}" ] && [ -x "$ZCODE_PURGE_NODE" ]; then
  exec "$ZCODE_PURGE_NODE" "$js"
fi
if command -v node >/dev/null 2>&1; then
  exec node "$js"
fi
if [ -n "${ZCODE_NODE_FALLBACK_EXEC_PATH:-}" ]; then
  ELECTRON_RUN_AS_NODE=1 exec "$ZCODE_NODE_FALLBACK_EXEC_PATH" "$js"
fi
for n in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.nvm/current/bin/node"; do
  [ -x "$n" ] && exec "$n" "$js"
done
exit 0
