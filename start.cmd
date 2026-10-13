@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title SessionHub - Pantau Server

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js belum terpasang.
  echo Silakan install Node.js LTS dari https://nodejs.org lalu jalankan lagi.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Menjalankan npm install ^(pertama kali saja^)...
  call npm install
)

set /a WAIT=0

:ensure
REM --- jika server sudah merespon, langsung ke mode pantau ---
curl -s -m 2 -o nul http://127.0.0.1:3800/login >nul 2>nul
if not errorlevel 1 goto monitor

REM --- port dipakai proses lama yang menggantung? tutup paksa ---
for /f "tokens=5" %%p in ('netstat -ano ^| findstr LISTENING ^| findstr ":3800"') do (
  echo [%time%] Port 3800 dipakai proses yang tidak merespon ^(PID %%p^) - ditutup.
  taskkill /f /pid %%p >nul 2>nul
  ping -n 3 127.0.0.1 >nul
)

REM --- masih ada proses node? berarti sedang boot / atau macet ---
tasklist /fi "imagename eq node.exe" | findstr /i node.exe >nul
if not errorlevel 1 (
  set /a WAIT+=1
  if !WAIT! GEQ 8 (
    echo [%time%] Proses node gagal memulai juga - semua node.exe ditutup.
    taskkill /f /im node.exe >nul 2>nul
    set /a WAIT=0
    ping -n 3 127.0.0.1 >nul
  ) else (
    echo [%time%] Menunggu server memulai... ^(!WAIT!/8^)
  )
  ping -n 6 127.0.0.1 >nul
  goto ensure
)

set /a WAIT=0
echo [%time%] Menjalankan server SessionHub...
start /b "" node server.js
ping -n 6 127.0.0.1 >nul
goto ensure

:monitor
set /a WAIT=0
echo.
echo ============================================
echo  Server berjalan.
echo  Operator : http://localhost:3800/login
echo  HP/tamu  : http://192.168.200.20:3800/login
echo  Memantau tiap 10 detik - tutup jendela ini untuk berhenti.
echo ============================================

:loop
ping -n 11 127.0.0.1 >nul
curl -s -m 3 -o nul http://127.0.0.1:3800/login >nul 2>nul
if errorlevel 1 (
  echo [%time%] Server tidak merespon! Restart otomatis...
  for /f "tokens=5" %%p in ('netstat -ano ^| findstr LISTENING ^| findstr ":3800"') do taskkill /f /pid %%p >nul 2>nul
  goto ensure
)
goto loop
