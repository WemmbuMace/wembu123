@echo off
REM Start the local Minecraft server (Paper 1.21.11) for ClaudeBot to join.
REM Uses the Java 21 runtime bundled with PyCharm (JBR) so nothing extra needs installing.
REM If you move/uninstall PyCharm, install Temurin 21 (https://adoptium.net) and update JAVA below.

set JAVA="C:\Program Files\JetBrains\PyCharm 2025.3\jbr\bin\java.exe"
set JAR=paper-1.21.11-132.jar

cd /d "%~dp0"
%JAVA% -Xmx2G -jar %JAR% --nogui
pause
