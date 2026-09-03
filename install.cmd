@echo off
setlocal DisableDelayedExpansion
call "%~dp0scripts\launch.cmd" install
exit /b %errorlevel%
