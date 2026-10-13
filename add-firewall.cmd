@echo off
REM Buka port SessionHub di Windows Firewall agar HP / tamu bisa akses.
REM Jalankan dengan klik kanan -> Run as administrator.

netsh advfirewall firewall show rule name="SessionHub port 3800" >nul 2>nul
if not errorlevel 1 (
  echo Rule sudah ada.
) else (
  netsh advfirewall firewall add rule name="SessionHub port 3800" dir=in action=allow protocol=TCP localport=3800
)
echo.
pause
