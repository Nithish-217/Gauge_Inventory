#!/usr/bin/env python3
"""
Simple script to start MinIO server for local development
"""
import os
import sys
import subprocess
from pathlib import Path

def start_minio():
    # Set up MinIO environment
    minio_dir = Path("minio_data")
    minio_dir.mkdir(exist_ok=True)
    
    # MinIO server settings from .env
    access_key = "minioadmin"
    secret_key = "minioadmin"
    port = "9000"
    
    print("Starting MinIO server...")
    print(f"Access Key: {access_key}")
    print(f"Secret Key: {secret_key}")
    print(f"Port: {port}")
    print(f"Data directory: {minio_dir.absolute()}")
    print("Press Ctrl+C to stop the server")
    
    # Try to start MinIO server
    try:
        # First, try to use minio server command if available
        result = subprocess.run(
            ["minio", "server", str(minio_dir), "--address", f":{port}"],
            env={
                **os.environ,
                "MINIO_ROOT_USER": access_key,
                "MINIO_ROOT_PASSWORD": secret_key
            }
        )
        return result.returncode
    except FileNotFoundError:
        print("MinIO server executable not found.")
        print("Please install MinIO server:")
        print("1. Download from: https://min.io/download")
        print("2. Or use Docker: docker run -p 9000:9000 -p 9001:9001 minio/minio server /data --console-address ':9001'")
        print("3. Or use Windows Subsystem for Linux (WSL)")
        return 1

if __name__ == "__main__":
    start_minio()