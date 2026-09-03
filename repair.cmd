@echo off
setlocal DisableDelayedExpansion
call "%~dp0scripts\launch.cmd" repair
exit /b %errorlevel%
