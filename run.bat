@echo off
echo ===================================================
echo     Iniciando Portal de Solicitudes PQR
echo     Localhost: http://localhost:8000
echo ===================================================
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
pause
