@echo off
"%~dp0_includes\python.exe" "%~dp0run_me.py"
if %errorlevel% neq 0 (
    echo.
    echo Application crashed or failed to start.
    pause
)
