@echo off
echo Starting MinIO Server...
echo Access Key: minioadmin
echo Secret Key: minioadmin
echo API: http://localhost:9000
echo Console: http://localhost:9001
echo.

REM Create data directory if it doesn't exist
if not exist "minio_data" mkdir minio_data

REM Try to start MinIO server
REM This assumes you have minio.exe in your PATH or in the current directory
minio.exe server minio_data --address :9000 --console-address :9001

pause