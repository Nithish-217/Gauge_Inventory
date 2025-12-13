from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from minio import Minio
from dotenv import load_dotenv
import os

from .database import get_db

router = APIRouter()


def ensure_reports_new_tables(db: Session):
    try:
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS public.reports (
              id SERIAL PRIMARY KEY,
              gauge_id INTEGER NOT NULL,
              title TEXT NOT NULL,
              notes TEXT,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        ))
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS public.report_files (
              id SERIAL PRIMARY KEY,
              report_id INTEGER NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
              bucket TEXT,
              object_key TEXT NOT NULL,
              etag TEXT,
              size_bytes BIGINT,
              content_type TEXT,
              original_name TEXT,
              uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        ))
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def _minio_client_from_env() -> Minio:
    try:
        load_dotenv(override=False)
    except Exception:
        pass
    endpoint = os.getenv("MINIO_ENDPOINT", "127.0.0.1:9000")
    access_key = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
    secret_key = os.getenv("MINIO_SECRET_KEY", "minioadmin")
    secure = str(os.getenv("MINIO_SECURE", "false")).lower() == "true"
    return Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=secure)


@router.get("/gauges/{gauge_id}/reports")
def list_reports_for_gauge(gauge_id: int, db: Session = Depends(get_db)):
    ensure_reports_new_tables(db)
    rows = db.execute(text(
        """
        SELECT id, title, notes, created_at
        FROM public.reports
        WHERE gauge_id = :gid
        ORDER BY created_at DESC, id DESC
        """
    ), {"gid": gauge_id}).mappings().all()
    return [{
        "id": r["id"],
        "title": r.get("title"),
        "notes": r.get("notes"),
        "created_at": str(r.get("created_at") or ""),
    } for r in rows]


@router.get("/gauges/{gauge_id}/reports/{report_id}/files/{file_id}/stream")
def stream_report_file(gauge_id: int, report_id: int, file_id: int, download: int = 0, db: Session = Depends(get_db)):
    ensure_reports_new_tables(db)
    row = db.execute(text(
        """
        SELECT rf.object_key, rf.original_name, rf.content_type
        FROM public.report_files rf
        JOIN public.reports r ON r.id = rf.report_id
        WHERE rf.id = :fid AND rf.report_id = :rid AND r.gauge_id = :gid
        LIMIT 1
        """
    ), {"fid": file_id, "rid": report_id, "gid": gauge_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    bucket = os.getenv("MINIO_BUCKET", "report-files")
    client = _minio_client_from_env()
    key = row["object_key"]
    # Probe object for metadata/size to help clients like PDF.js
    size = None
    try:
        stat = client.stat_object(bucket, key)
        try:
            size = int(getattr(stat, "size", None) or getattr(stat, "length", None) or 0)
        except Exception:
            size = None
    except Exception:
        pass
    try:
        obj = client.get_object(bucket, key)  # returns a stream
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Failed to fetch object: {str(e)}")
    fname = row.get("original_name") or "report-file"
    # Normalize content type to help inline preview
    ctype = (row.get("content_type") or "application/octet-stream").strip() or "application/octet-stream"
    if ctype == "application/octet-stream" and fname.lower().endswith(".pdf"):
        ctype = "application/pdf"
    # If download flag is set, force attachment; else allow inline preview
    disp = "attachment" if str(download) in ("1", "true", "True") else "inline"
    headers = {
        "Content-Disposition": f'{disp}; filename="{fname}"',
        # Advertise that we are not supporting ranges explicitly to PDF.js when streaming whole file
        "Accept-Ranges": "none",
    }
    if size and size > 0:
        headers["Content-Length"] = str(size)
    # Stream in chunks and ensure object is closed even on client disconnects
    def _iter_stream():
        try:
            while True:
                chunk = obj.read(1024 * 64)
                if not chunk:
                    break
                yield chunk
        finally:
            try:
                obj.close()
            except Exception:
                pass
            try:
                obj.release_conn()
            except Exception:
                pass

    return StreamingResponse(_iter_stream(), media_type=ctype, headers=headers)


@router.delete("/gauges/{gauge_id}/reports/{report_id}", status_code=204)
def delete_report(gauge_id: int, report_id: int, db: Session = Depends(get_db)):
    ensure_reports_new_tables(db)
    rpt = db.execute(text("SELECT id FROM public.reports WHERE id = :rid AND gauge_id = :gid"), {"rid": report_id, "gid": gauge_id}).mappings().first()
    if not rpt:
        raise HTTPException(status_code=404, detail="Report not found")
    bucket = os.getenv("MINIO_BUCKET", "report-files")
    prefix = f"gauges/{gauge_id}/reports/{report_id}/"
    try:
        client = _minio_client_from_env()
        for obj in client.list_objects(bucket, prefix=prefix, recursive=True):
            try:
                client.remove_object(bucket, obj.object_name)
            except Exception:
                # Ignore failures of individual objects to ensure DB stays consistent
                pass
    except Exception:
        # Ignore listing failures to avoid blocking DB cleanup
        pass
    # Delete DB rows; ON DELETE CASCADE in report_files will handle children
    db.execute(text("DELETE FROM public.reports WHERE id = :rid"), {"rid": report_id})
    db.commit()
    return None


@router.get("/gauges/{gauge_id}/reports/zip")
def download_reports_zip(gauge_id: int, db: Session = Depends(get_db)):
    ensure_reports_new_tables(db)
    rows = db.execute(text(
        """
        SELECT rf.object_key, rf.original_name, r.id AS report_id, r.title AS report_title
        FROM public.report_files rf
        JOIN public.reports r ON r.id = rf.report_id
        WHERE r.gauge_id = :gid
        ORDER BY r.id, rf.id
        """
    ), {"gid": gauge_id}).mappings().all()
    if not rows:
        raise HTTPException(status_code=404, detail="No files found for this gauge")
    import io as _io
    import zipfile
    client = _minio_client_from_env()
    bucket = os.getenv("MINIO_BUCKET", "report-files")
    mem = _io.BytesIO()
    with zipfile.ZipFile(mem, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for r in rows:
            key = r.get("object_key") or ""
            name = r.get("original_name") or os.path.basename(key or "file")
            # Use the original report title as folder name (exact as user created), with safe sanitization
            folder_raw = (r.get("report_title") or f"report_{r.get('report_id')}")
            folder = str(folder_raw).replace("\\", "/").strip().strip("/")
            # Prevent traversal and empty names
            while folder.startswith("../"):
                folder = folder[3:]
            if not folder:
                folder = f"report_{r.get('report_id')}"
            arcname = f"{folder}/{name}"
            # Security: prevent path traversal inside zip
            if arcname.startswith("/"):
                arcname = arcname.lstrip("/")

            data = b""
            try:
                obj = client.get_object(bucket, key)
                try:
                    data = obj.read()
                finally:
                    try:
                        obj.close()
                    except Exception:
                        pass
            except Exception:
                data = b""
            zf.writestr(arcname, data)
    mem.seek(0)
    headers = {"Content-Disposition": f"attachment; filename=gauge_{gauge_id}_reports.zip"}
    return StreamingResponse(mem, media_type="application/zip", headers=headers)
