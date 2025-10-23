import os
from typing import Optional
from minio import Minio
from fastapi import HTTPException


class MinioStorage:
    """Thin wrapper around MinIO with strict, opinionated behavior for reports.

    - Bucket defaults to 'reports' (override with MINIO_BUCKET)
    - No local fallback; callers should surface errors to clients
    - Object keys are kept as simple filenames like 'IDFN.ext'
    """

    def __init__(self) -> None:
        endpoint = os.getenv("MINIO_ENDPOINT", "127.0.0.1:9000").replace("http://", "").replace("https://", "")
        access_key = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
        secret_key = os.getenv("MINIO_SECRET_KEY", "minioadmin")
        secure = (os.getenv("MINIO_SECURE", "false").lower() == "true")
        self.bucket = os.getenv("MINIO_BUCKET", "reports")
        self.client = Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=secure)

    def ensure_bucket(self) -> None:
        try:
            if not self.client.bucket_exists(self.bucket):
                self.client.make_bucket(self.bucket)
        except Exception as e:
            # If concurrent creation or permission issue, re-raise so caller returns a clear 502
            raise HTTPException(status_code=502, detail=f"Object store bucket error: {str(e)}")

    def put_report(self, idfn: str, data: bytes, content_type: Optional[str] = None) -> str:
        if not idfn:
            raise HTTPException(status_code=400, detail="Missing IDFN for report upload")
        self.ensure_bucket()
        # Keep object at the root for simplicity: 'IDFN.ext'
        key = idfn
        # If caller didn't append extension in key, content-type is still respected
        try:
            import io as _io
            stream = _io.BytesIO(data)
            self.client.put_object(
                self.bucket,
                key,
                data=stream,
                length=len(data),
                content_type=content_type or "application/octet-stream",
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to store report in object storage: {str(e)}")
        return key

    def stat(self, key: str):
        try:
            return self.client.stat_object(self.bucket, key)
        except Exception as e:
            raise HTTPException(status_code=404, detail=f"Report file not found: {str(e)}")

    def get_bytes(self, key: str) -> bytes:
        try:
            obj = self.client.get_object(self.bucket, key)
            try:
                return obj.read()
            finally:
                try:
                    obj.close()
                except Exception:
                    pass
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to fetch report: {str(e)}")