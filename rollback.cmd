@echo off
setlocal DisableDelayedExpansion
call "%~dp0scripts\launch.cmd" rollback
exit /b %errorlevel%
