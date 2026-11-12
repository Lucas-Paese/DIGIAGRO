@echo off
title DigiAgro
echo Iniciando o DigiAgro...
start "" http://localhost:8000
python server.py || py server.py
pause
