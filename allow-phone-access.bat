@echo off
rem Run this ONCE as administrator (right-click -> Run as administrator)
rem It allows the wife's phone to reach EZ JOBS on port 3796 over your home Wi-Fi.
netsh advfirewall firewall add rule name="EZ JOBS (port 3796)" dir=in action=allow protocol=TCP localport=3796 profile=private
echo.
echo Done! On her phone (same Wi-Fi) open:  http://192.168.0.19:3796
echo (If your PC's IP changes, run:  ipconfig  and use the IPv4 address shown)
pause
