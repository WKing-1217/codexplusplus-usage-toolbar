@echo off
setlocal DisableDelayedExpansion
call "%~dp0scripts\launch.cmd" update
exit /b %errorlevel%
