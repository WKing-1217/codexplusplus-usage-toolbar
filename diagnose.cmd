@echo off
setlocal DisableDelayedExpansion
call "%~dp0scripts\launch.cmd" diagnose
exit /b %errorlevel%
