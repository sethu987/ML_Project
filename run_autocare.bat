@echo off
setlocal
cd /d "%~dp0"

set "NODE_MODEL=%CD%\models\production_v2\vehicle_service_cost.json"
set "APP_URL=http://127.0.0.1:8000/"
where.exe node.exe >nul 2>&1
if errorlevel 1 (
    echo Node.js 22.13 or newer was not found.
    echo Install Node.js and restart this launcher.
    pause
    exit /b 1
)
if not exist "%CD%\node_modules\bcryptjs\index.js" (
    echo JavaScript dependencies were not found.
    echo Run npm install in the project folder first.
    pause
    exit /b 1
)
if not exist "%NODE_MODEL%" (
    echo The JavaScript prediction model was not found.
    echo Follow the setup instructions in README.md.
    pause
    exit /b 1
)

set "SERVER_STATUS=1"
powershell -NoProfile -Command "try { $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 2; if ($health.runtime -eq 'node') { exit 0 }; exit 2 } catch { exit 1 }"
set "SERVER_STATUS=%ERRORLEVEL%"
if "%SERVER_STATUS%"=="2" (
    echo Port 8000 is serving a different AutoCare backend. Stop it and try again.
    pause
    exit /b 1
)
if "%SERVER_STATUS%"=="1" (
    powershell -NoProfile -Command "$client=New-Object Net.Sockets.TcpClient; try { $client.Connect('127.0.0.1',8000); exit 0 } catch { exit 1 } finally { $client.Dispose() }"
    if not errorlevel 1 (
        echo Port 8000 is occupied by another application. Close it and try again.
        pause
        exit /b 1
    )
    start "AutoCare" cmd /k node server.js
)

echo Waiting for AutoCare to start...
powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(30); do { try { $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 2; $ready=$health.runtime -eq 'node' -and $health.ready } catch { $ready=$false }; if(-not $ready) { Start-Sleep -Milliseconds 500 } } while(-not $ready -and (Get-Date) -lt $deadline); if(-not $ready) { exit 1 }"
if errorlevel 1 (
    echo AutoCare did not start on port 8000.
    echo Check the AutoCare server window for errors.
    pause
    exit /b 1
)

start "" "%APP_URL%"
endlocal
