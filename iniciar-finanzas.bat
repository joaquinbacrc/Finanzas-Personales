@echo off
title Finanzas
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"

if not exist "node_modules\" (
  echo Instalando dependencias por primera vez...
  call npm install
)

echo.
echo ==========================================
echo   Finanzas corriendo en localhost:3000
echo   Cerrar esta ventana para apagar el server
echo ==========================================
echo.

start "" http://localhost:3000
call npx tsx src/server.ts
