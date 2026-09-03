@echo off
setlocal DisableDelayedExpansion
call "%~dp0scripts\launch.cmd" uninstall
exit /b %errorlevel%
