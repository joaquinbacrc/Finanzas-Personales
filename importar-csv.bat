@echo off
title Importar CSV
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"

echo Buscando archivos CSV en esta carpeta...
echo.
dir /b *.csv 2>nul
if errorlevel 1 (
  echo.
  echo No hay archivos .csv en esta carpeta.
  echo Pone el archivo aca y volve a correr.
  pause
  exit /b
)

echo.
set /p archivo=Pegá el nombre exacto del CSV a importar (con ".csv" al final):

if not exist "%archivo%" (
  echo.
  echo No encontre ese archivo.
  pause
  exit /b
)

echo.
echo OJO: esto borra los gastos actuales de la app y los reemplaza con los del CSV.
set /p confirma=¿Seguir? (s/n):
if /i not "%confirma%"=="s" (
  echo Cancelado.
  pause
  exit /b
)

call npx tsx src/scripts/import-csv.ts "%archivo%"
echo.
echo Listo. Refresca el navegador (F5) para ver los datos.
pause
