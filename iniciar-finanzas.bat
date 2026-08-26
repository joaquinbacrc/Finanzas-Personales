@echo off
title Finanzas
cd /d "%~dp0"

echo ============================================================
echo   OJO: esto corre en TU PC contra una base LOCAL de prueba.
echo   NO es la app de verdad. La app real vive en:
echo   https://finanzas-personales.omnia-ar.workers.dev
echo   Tus gastos reales NO se ven aca.
echo ============================================================
echo.

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
