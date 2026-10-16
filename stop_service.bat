@echo off
echo Encerrando OpenDots...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :4310 ^| findstr LISTENING') do (
    taskkill /F /PID %%a
)
echo OpenDots finalizado com sucesso.
