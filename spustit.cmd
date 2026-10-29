@echo off
chcp 65001 >nul
title Sitko
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js neni nainstalovany. Nainstalujte ho prikazem:
  echo    winget install OpenJS.NodeJS.LTS
  echo nebo z https://nodejs.org a pak tento soubor spustte znovu.
  echo.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo.
  echo Sitko potrebuje Node.js 22.13 nebo novejsi. Nainstalovana verze:
  node -v
  echo Aktualizujte prikazem:   winget upgrade OpenJS.NodeJS.LTS
  echo nebo stahnete LTS z https://nodejs.org a tento soubor spustte znovu.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instaluji zavislosti, poprve to trva par minut...
  call npm install --no-package-lock
  if errorlevel 1 (
    echo Instalace selhala, podivejte se na chybu vyse.
    pause
    exit /b 1
  )
)

if not exist data\sitko.db (
  echo Pripravuji ukazkova data...
  call npm run seed:demo
)

echo.
echo ============================================================
echo  Sitko bezi na http://localhost:3000
echo  Prihlaseni: demo@sitko.local / ukazka-sitko-2026
echo  Ukoncite zavrenim tohoto okna nebo Ctrl+C.
echo ============================================================
echo.
start "" cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:3000"
call npm run dev
pause
