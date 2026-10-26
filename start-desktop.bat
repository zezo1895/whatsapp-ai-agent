@echo off
title وكيل مبيعات واتساب الذكي - حكيم جروب
chcp 65001 >nul
cd /d "%~dp0"

echo =======================================================
echo 🚀 جاري تشغيل تطبيق وكيل مبيعات واتساب الذكي (Desktop)...
echo =======================================================

call npx electron .

if %errorlevel% neq 0 (
  echo.
  echo حدث خطأ أثناء تشغيل التطبيق. جاري التشغيل عبر المتصفح كبديل...
  start http://localhost:3050
  call npm start
)
pause
