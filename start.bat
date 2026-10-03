@echo off
chcp 65001 >nul
rem Bass Build: builds the web app, starts the local C# server on 127.0.0.1:5178 and opens it.
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo ต้องติดตั้ง Node.js ก่อน & pause & exit /b 1)
where dotnet >nul 2>nul || (echo ต้องติดตั้ง .NET SDK 10 ก่อน & pause & exit /b 1)
if not exist node_modules (call npm install || (pause & exit /b 1))
call npm run build || (pause & exit /b 1)
rem open the browser once the server has had a few seconds to start
start "" cmd /c "timeout /t 6 >nul & start http://127.0.0.1:5178/"
dotnet run --project server\BassBuild.Server --no-launch-profile
