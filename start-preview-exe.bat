@echo off
title تشغيل نسخة الديسكتوب التجريبية (Preview Build)
chcp 65001 >nul
cd /d "%~dp0"

echo ======================================================================
echo 🚀 جاري تشغيل نسخة الديسكتوب المجمعة المستقلة (Preview Executable)...
echo ======================================================================

start "" "dist\win-unpacked\WhatsApp-AI-Sales-Agent.exe"
exit
