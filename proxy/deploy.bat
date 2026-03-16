@echo off
REM Деплой proxy на gemini-proxy.mooo.com
REM Использование: deploy.bat SERVER_IP
REM Пример: deploy.bat 123.45.67.89

set SERVER_IP=%1
if "%SERVER_IP%"=="" (
  echo Укажите IP сервера: deploy.bat 123.45.67.89
  echo.
  echo Или выполните вручную:
  echo   scp server.js mcp-server.js package.json root@ВАШ_IP:/opt/gemini-proxy/
  echo   ssh root@ВАШ_IP
  echo   cd /opt/gemini-proxy ^&^& npm install ^&^& pm2 restart gemini-proxy
  exit /b 1
)

echo === Копирование файлов на root@%SERVER_IP% ===
scp server.js mcp-server.js package.json package-lock.json root@%SERVER_IP%:/opt/gemini-proxy/

if %ERRORLEVEL% neq 0 (
  echo Ошибка scp. Установите OpenSSH или используйте PuTTY/pscp.
  echo Подробнее: DEPLOY.md
  exit /b 1
)

echo.
echo Файлы скопированы. Подключитесь и обновите:
echo   ssh root@%SERVER_IP%
echo   cd /opt/gemini-proxy
echo   npm install
echo   pm2 restart gemini-proxy
echo.
