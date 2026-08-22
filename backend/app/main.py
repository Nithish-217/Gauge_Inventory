from fastapi import FastAPI, Depends, HTTPException, status
from fastapi import Request, Response, Header
from fastapi.responses import HTMLResponse

from fastapi import UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import datetime
from sqlalchemy import text, or_
from fastapi.responses import StreamingResponse
import io
from barcode import Code128
from barcode.writer import ImageWriter
import qrcode

from .database import get_db
from .database import SessionLocal
from . import models, schemas
from .security import verify_password, get_password_hash
import os
from minio import Minio
from datetime import datetime as dt
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import threading
import time
import smtplib
import ssl
from email.message import EmailMessage
from dotenv import load_dotenv
from fastapi.responses import StreamingResponse, RedirectResponse
from .storage import MinioStorage
from .report_ext import router as report_ext_router
from scripts import due_reminder as due_reminder_script
import json
import urllib.request
import urllib.error
import uuid
import csv
import io as _io
import re
import calendar

app = FastAPI(title="CMTI Backend", version="0.1.0")

# Load environment variables from .env (if present) once at startup.
try:
    load_dotenv(override=False)
except Exception:
    pass

# CORS: allow local dev from any origin or restrict to your frontend port later
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount additional report extensions (streaming and delete-report)
app.include_router(report_ext_router)



def ensure_employee_id_column(db: Session):
    """Ensure employee_id column exists in users table"""
    try:
        # Check if column exists using information_schema
        result = db.execute(text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'users' 
            AND column_name = 'employee_id'
        """))
        exists = result.first() is not None
        if not exists:
            # Column doesn't exist, create it
            db.execute(text("ALTER TABLE public.users ADD COLUMN employee_id VARCHAR(50)"))
            db.commit()
            # Create indexes
            try:
                db.execute(text("CREATE INDEX IF NOT EXISTS idx_users_employee_id ON public.users(employee_id)"))
                db.commit()
            except Exception:
                db.rollback()
            try:
                db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_id_unique ON public.users(employee_id) WHERE employee_id IS NOT NULL"))
                db.commit()
            except Exception:
                db.rollback()
    except Exception as e:
        try:
            db.rollback()
        except:
            pass
        # Column might already exist, or there's another issue - continue anyway


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/auth/login", response_model=schemas.LoginResponse)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    # Ensure employee_id column exists (for backward compatibility)
    ensure_employee_id_column(db)
    
    # Normalize provided username/employee_id (trim spaces)
    provided_identifier = (payload.username or "").strip()
    
    # Find user by username or employee_id (case-insensitive match)
    # Use raw SQL query to handle employee_id safely - check if column exists first
    try:
        # Try with employee_id first
        user_result = db.execute(text("""
            SELECT id, username, password_hash, role, email, employee_id, created_at
            FROM public.users
            WHERE LOWER(username) = LOWER(:identifier)
               OR (employee_id IS NOT NULL AND LOWER(employee_id) = LOWER(:identifier))
            LIMIT 1
        """), {"identifier": provided_identifier}).mappings().first()
    except Exception:
        # If employee_id column doesn't exist yet, query without it
        user_result = db.execute(text("""
            SELECT id, username, password_hash, role, email, created_at
            FROM public.users
            WHERE LOWER(username) = LOWER(:identifier)
            LIMIT 1
        """), {"identifier": provided_identifier}).mappings().first()
    
    if not user_result:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    
    # Create a User object from the result
    employee_id_val = user_result.get("employee_id") if "employee_id" in user_result else None
    user = models.User(
        id=user_result["id"],
        username=user_result["username"],
        password_hash=user_result["password_hash"],
        role=user_result["role"],
        email=user_result["email"],
        employee_id=employee_id_val,
        created_at=user_result["created_at"]
    )

    # Verify password using bcrypt hash stored in password_hash
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    return schemas.LoginResponse(
        success=True,
        message="Login successful",
        user=user,
    )


@app.post("/users", response_model=schemas.UserPublic, status_code=status.HTTP_201_CREATED)
def create_user(payload: schemas.CreateUserRequest, db: Session = Depends(get_db)):
    # Ensure employee_id column exists
    ensure_employee_id_column(db)
    
    # Normalize role
    role = payload.role.lower()
    if role not in ("admin", "operator"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'operator'")

    employee_id = payload.employee_id.strip() if payload.employee_id else None
    if employee_id and len(employee_id) == 0:
        employee_id = None

    user = models.User(
        username=payload.username,
        email=payload.email,
        role=role,
        password_hash=get_password_hash(payload.password),
        employee_id=employee_id,
    )
    try:
        db.add(user)
        db.commit()
        # Refresh user - need to handle employee_id column
        try:
            db.refresh(user)
        except Exception:
            # If refresh fails due to employee_id, manually reload
            db.execute(text("SELECT 1"))  # Reconnect if needed
            user = db.query(models.User).filter(models.User.id == user.id).first()
    except IntegrityError as e:
        db.rollback()
        error_msg = str(e.orig) if hasattr(e, 'orig') else "Unknown error"
        if 'username' in error_msg.lower():
            raise HTTPException(status_code=400, detail="Username already exists")
        elif 'email' in error_msg.lower():
            raise HTTPException(status_code=400, detail="Email already exists")
        elif 'employee_id' in error_msg.lower():
            raise HTTPException(status_code=400, detail="Employee ID already exists")
        else:
            raise HTTPException(status_code=400, detail="Username, email, or employee ID already exists")

    return user


@app.get("/users", response_model=list[schemas.UserPublic])
def list_users(db: Session = Depends(get_db)):
    # Ensure employee_id column exists
    ensure_employee_id_column(db)
    # Use raw SQL to handle employee_id column safely
    try:
        users_result = db.execute(text("""
            SELECT id, username, password_hash, role, email, employee_id, created_at
            FROM public.users
            ORDER BY id DESC
        """)).mappings().all()
        users = []
        for u in users_result:
            user = models.User(
                id=u["id"],
                username=u["username"],
                password_hash=u["password_hash"],
                role=u["role"],
                email=u["email"],
                employee_id=u.get("employee_id"),
                created_at=u["created_at"]
            )
            users.append(user)
        return users
    except Exception:
        # Fallback to ORM if raw SQL fails
        users = db.query(models.User).order_by(models.User.id.desc()).all()
        return users


@app.get("/users/{user_id}", response_model=schemas.UserPublic)
def get_user(user_id: int, db: Session = Depends(get_db)):
    # Ensure employee_id column exists
    ensure_employee_id_column(db)
    # Use raw SQL to avoid ORM issues if column was just created
    try:
        user_result = db.execute(text("""
            SELECT id, username, password_hash, role, email, employee_id, created_at
            FROM public.users
            WHERE id = :user_id
            LIMIT 1
        """), {"user_id": user_id}).mappings().first()
        if not user_result:
            raise HTTPException(status_code=404, detail="User not found")
        # Convert to User object
        user = models.User(
            id=user_result["id"],
            username=user_result["username"],
            password_hash=user_result["password_hash"],
            role=user_result["role"],
            email=user_result["email"],
            employee_id=user_result.get("employee_id"),
            created_at=user_result["created_at"]
        )
        return user
    except Exception:
        # Fallback to ORM query
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user


@app.put("/users/{user_id}", response_model=schemas.UserPublic)
def update_user(user_id: int, payload: schemas.UpdateUserRequest, db: Session = Depends(get_db)):
    # Ensure employee_id column exists
    ensure_employee_id_column(db)
    
    # Get existing user
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Build update fields
    update_fields = []
    params = {"user_id": user_id}
    
    # Username is immutable: reject attempts to change it
    if payload.username is not None:
        new_un = payload.username.strip()
        if new_un and new_un != (user.username or ""):
            raise HTTPException(status_code=400, detail="Username cannot be changed")
    
    if payload.email is not None:
        update_fields.append("email = :email")
        params["email"] = payload.email.strip()
    
    if payload.role is not None:
        role = payload.role.lower()
        if role not in ("admin", "operator"):
            raise HTTPException(status_code=400, detail="Role must be 'admin' or 'operator'")
        update_fields.append("role = :role")
        params["role"] = role
    
    if payload.employee_id is not None:
        employee_id_val = payload.employee_id.strip() if payload.employee_id else None
        if employee_id_val and len(employee_id_val) == 0:
            employee_id_val = None
        update_fields.append("employee_id = :employee_id")
        params["employee_id"] = employee_id_val
    
    if not update_fields:
        # No fields to update
        return user
    
    # Build SQL update query
    sql_update = "UPDATE public.users SET " + ", ".join(update_fields) + " WHERE id = :user_id RETURNING id, username, email, role, employee_id, created_at"
    
    try:
        result = db.execute(text(sql_update), params).mappings().first()
        db.commit()
        
        # Reload user to get updated data
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found after update")
        
        return user
    except IntegrityError as e:
        db.rollback()
        error_msg = str(e.orig) if hasattr(e, 'orig') else "Unknown error"
        if 'username' in error_msg.lower():
            raise HTTPException(status_code=400, detail="Username already exists")
        elif 'email' in error_msg.lower():
            raise HTTPException(status_code=400, detail="Email already exists")
        elif 'employee_id' in error_msg.lower():
            raise HTTPException(status_code=400, detail="Employee ID already exists")
        else:
            raise HTTPException(status_code=400, detail="Update failed: duplicate value")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update user: {str(e)}")


@app.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Transaction-safe: restore gauges, then delete user, and commit once
    try:
        # Ensure columns exist for return metadata
        try:
            db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS returned_by VARCHAR(100)"))
            db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ"))
        except Exception:
            pass

        # Mark gauges held by this operator as returned (restore to available)
        # Match either by requested_by (operator username) or accepted_by (edge cases)
        db.execute(text(
            """
            UPDATE public.gauge_requests
            SET status = 'returned', returned_by = :actor, returned_at = NOW()
            WHERE (requested_by ILIKE :uname OR accepted_by ILIKE :uname)
              AND status = 'accepted' AND returned_at IS NULL
            """
        ), {"actor": f"system:{user.username}", "uname": user.username})

        # Close any open legacy tracker rows issued to this user id
        try:
            db.execute(text(
                """
                UPDATE public.gauge_tracker
                SET returned_at = NOW()
                WHERE issued_to = :uid AND returned_at IS NULL
                """
            ), {"uid": user.id})
        except Exception:
            pass

        # Finally delete the user
        db.delete(user)
        db.commit()
        return None
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete user safely: {str(e)}")


@app.post("/users/{user_id}/password")
def change_password(user_id: int, payload: schemas.ChangePasswordRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = get_password_hash(payload.new_password)
    db.add(user)
    db.commit()
    return {"success": True}


@app.post("/admin/free-all-tools")
def free_all_tools(db: Session = Depends(get_db)):
    """Marks all currently issued tools as returned across the system.
    - gauge_requests: status 'accepted' and returned_at IS NULL -> set returned
    - gauge_tracker: any open rows (returned_at IS NULL) -> close with returned_at
    Returns the number of rows updated in each table.
    """
    # Ensure tables exist (be tolerant if never used yet)
    try:
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS public.gauge_requests (
              id SERIAL PRIMARY KEY,
              gauge_id INTEGER NOT NULL,
              requested_by VARCHAR(100),
              requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              status VARCHAR(20) NOT NULL DEFAULT 'requested',
              accepted_by VARCHAR(100),
              accepted_at TIMESTAMPTZ
            )
            """
        ))
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS returned_by VARCHAR(100)"))
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ"))
    except Exception:
        pass

    try:
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS public.gauge_tracker (
              id SERIAL PRIMARY KEY,
              gauge_id INTEGER NOT NULL,
              name_of_the_equipment TEXT NOT NULL,
              idfn_no TEXT NOT NULL,
              location TEXT,
              make_model TEXT,
              quantity INTEGER NOT NULL DEFAULT 1,
              requested_by VARCHAR(100),
              requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              status VARCHAR(20) NOT NULL DEFAULT 'requested',
              accepted_by VARCHAR(100),
              accepted_at TIMESTAMPTZ,
              issued_to INTEGER,
              issued_at TIMESTAMPTZ,
              returned_at TIMESTAMPTZ
            )
            """
        ))
    except Exception:
        pass
    # Ensure ranges table exists for subselects
    try:
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS public.gauge_ranges (
              id SERIAL PRIMARY KEY,
              gauge_id INTEGER NOT NULL,
              label TEXT NOT NULL
            )
            """
        ))
    except Exception:
        pass
    # Ensure equipment table exists for joins
    try:
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS public.equipment_used_for_calibration (
              gauge_id SERIAL PRIMARY KEY,
              name_of_the_equipment TEXT NOT NULL,
              location TEXT,
              receipt_date DATE,
              make_model TEXT,
              idfn_no TEXT NOT NULL,
              overall_measurement_uncertainty TEXT,
              calibration_freq_months INTEGER,
              date_of_last_calibration DATE,
              calibration_due DATE,
              pcr_number BIGINT
            )
            """
        ))
    except Exception:
        pass
    # Ensure users table exists for joins
    try:
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS public.users (
              id SERIAL PRIMARY KEY,
              username VARCHAR(50) UNIQUE NOT NULL,
              email VARCHAR(255),
              password_hash TEXT,
              role VARCHAR(20) DEFAULT 'operator',
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        ))
    except Exception:
        pass

    # Update gauge_requests
    res1 = None
    try:
        res1 = db.execute(text(
            """
            UPDATE public.gauge_requests
            SET status = 'returned', returned_by = 'system:bulk', returned_at = NOW()
            WHERE status = 'accepted' AND returned_at IS NULL
            """
        ))
    except Exception:
        res1 = None

    # Update gauge_tracker
    res2 = None
    try:
        res2 = db.execute(text(
            """
            UPDATE public.gauge_tracker
            SET returned_at = NOW()
            WHERE returned_at IS NULL
            """
        ))
    except Exception:
        res2 = None
    db.commit()
    return {
        "success": True,
        "gauge_requests_updated": int(getattr(res1, 'rowcount', 0) or 0),
        "gauge_tracker_updated": int(getattr(res2, 'rowcount', 0) or 0),
    }


# =========================
# Email Reminders
# =========================

def _send_operator_email_for_gauge(db: Session, gid: int, admin_name: str) -> tuple[bool, str]:
    """Internal: send reminder email for a gauge to its current operator holder.
    Returns (success, message)."""
    # Find active holder from primary gauge_requests
    row = db.execute(text(
        """
        SELECT gr.requested_by, gr.accepted_by, e.name_of_the_equipment, e.calibration_due
        FROM public.gauge_requests gr
        LEFT JOIN public.equipment_used_for_calibration e ON e.gauge_id = gr.gauge_id
        WHERE gr.gauge_id = :gid AND gr.status = 'accepted' AND gr.returned_at IS NULL
        ORDER BY gr.accepted_at DESC NULLS LAST
        LIMIT 1
        """
    ), {"gid": gid}).mappings().first()
    operator_username = ""
    if row:
        # Prefer the requester (operator) as the responsible person, not the admin who accepted
        operator_username = (row.get("requested_by") or "").strip() or (row.get("accepted_by") or "").strip()

    # If no active holder in gauge_requests, fallback to legacy gauge_tracker current holder
    user = None
    if operator_username:
        user = db.execute(text(
            """
            SELECT email, username FROM public.users
            WHERE TRIM(LOWER(username)) = TRIM(LOWER(:u))
            LIMIT 1
            """
        ), {"u": operator_username}).mappings().first()

    if not user:
        gt_holder = db.execute(text(
            """
            SELECT u.email, u.username, e.name_of_the_equipment, e.calibration_due
            FROM public.gauge_tracker gt
            LEFT JOIN public.users u ON u.id = gt.issued_to
            LEFT JOIN public.equipment_used_for_calibration e ON e.gauge_id = gt.gauge_id
            WHERE gt.gauge_id = :gid AND gt.returned_at IS NULL
            ORDER BY gt.issued_at DESC NULLS LAST
            LIMIT 1
            """
        ), {"gid": gid}).mappings().first()
        if gt_holder and gt_holder.get("email"):
            user = {"email": gt_holder.get("email"), "username": gt_holder.get("username")}
            if not row:
                row = {"name_of_the_equipment": gt_holder.get("name_of_the_equipment"), "calibration_due": gt_holder.get("calibration_due")}

    if not user or not user.get("email"):
        return False, "Operator email not found"

    try:
        load_dotenv(override=False)
    except Exception:
        pass
    smtp_host = os.getenv("EMAIL_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("EMAIL_PORT", "587"))
    smtp_user = os.getenv("EMAIL_USER")
    smtp_pass = os.getenv("EMAIL_PASS")
    email_from = os.getenv("EMAIL_FROM", smtp_user or "")
    if not smtp_user or not smtp_pass or not email_from:
        return False, "Email credentials are not configured"

    operator_email = user["email"]
    if not operator_username:
        try:
            operator_username = (user.get("username") or "").strip()
        except Exception:
            operator_username = ""
    gauge_name = row.get("name_of_the_equipment") or f"Gauge {gid}"
    due_date = row.get("calibration_due")
    try:
        if due_date is not None:
            try:
                due_str = due_date.strftime("%Y-%m-%d")
            except Exception:
                due_str = str(due_date)
        else:
            due_str = "—"
    except Exception:
        due_str = str(due_date)

    subject = "Gauge Calibration Reminder"
    body = (
        f"Dear {operator_username},\n\n"
        f"This is a reminder to return the gauge {gauge_name} (ID: {gid}) before its due date: {due_str}.\n\n"
        f"Regards,\n"
        f"{admin_name}"
    )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = email_from
    msg["To"] = operator_email
    msg.set_content(body)

    # Ensure email_logs table exists and define logger
    def _ensure_email_logs_table(_db: Session):
        try:
            _db.execute(text(
                """
                CREATE TABLE IF NOT EXISTS public.email_logs (
                  id SERIAL PRIMARY KEY,
                  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  to_email TEXT,
                  subject TEXT,
                  body TEXT,
                  status TEXT,
                  error TEXT,
                  context JSONB
                )
                """
            ))
        except Exception:
            pass

    def _log_email(_db: Session, to_email: str, subject: str, body: str, status: str, error: str | None, context_dict: dict | None = None):
        try:
            _ensure_email_logs_table(_db)
            _db.execute(text(
                """
                INSERT INTO public.email_logs (to_email, subject, body, status, error, context)
                VALUES (:to_email, :subject, :body, :status, :error, CAST(:context AS JSONB))
                """
            ), {
                "to_email": to_email,
                "subject": subject,
                "body": body,
                "status": status,
                "error": (error or None),
                "context": json.dumps(context_dict) if context_dict is not None else None,
            })
            _db.commit()
        except Exception:
            try:
                _db.rollback()
            except Exception:
                pass

    try:
        context = ssl.create_default_context()
        with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
            server.ehlo()
            server.starttls(context=context)
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)
        _log_email(db, operator_email, subject, body, "sent", None, {"source": "_send_operator_email_for_gauge", "gauge_id": gid})
        return True, "Reminder email sent"
    except Exception as e:
        _log_email(db, operator_email, subject, body, "failed", str(e), {"source": "_send_operator_email_for_gauge", "gauge_id": gid})
        return False, f"Failed to send email: {str(e)}"


@app.post("/reminders/email", response_model=schemas.ReminderResponse)
def send_gauge_reminder(payload: schemas.ReminderRequest, db: Session = Depends(get_db)):
    """Send an email reminder to the operator currently holding the gauge."""
    gid = int(payload.gauge_id)
    ok, msg = _send_operator_email_for_gauge(db, gid, payload.admin_name)
    if not ok:
        raise HTTPException(status_code=500, detail=msg)
    return {"success": True, "message": msg}
    # Find active holder from primary gauge_requests
    row = db.execute(text(
        """
        SELECT gr.requested_by, gr.accepted_by, e.name_of_the_equipment, e.calibration_due
        FROM public.gauge_requests gr
        LEFT JOIN public.equipment_used_for_calibration e ON e.gauge_id = gr.gauge_id
        WHERE gr.gauge_id = :gid AND gr.status = 'accepted' AND gr.returned_at IS NULL
        ORDER BY gr.accepted_at DESC NULLS LAST
        LIMIT 1
        """
    ), {"gid": gid}).mappings().first()
    operator_username = ""
    if row:
        # Prefer the requester (operator) as the responsible person, not the admin who accepted
        operator_username = (row.get("requested_by") or "").strip() or (row.get("accepted_by") or "").strip()

    # If no active holder in gauge_requests, fallback to legacy gauge_tracker current holder
    user = None
    if operator_username:
        user = db.execute(text(
            """
            SELECT email, username FROM public.users
            WHERE TRIM(LOWER(username)) = TRIM(LOWER(:u))
            LIMIT 1
            """
        ), {"u": operator_username}).mappings().first()

    if not user:
        gt_holder = db.execute(text(
            """
            SELECT u.email, u.username, e.name_of_the_equipment, e.calibration_due
            FROM public.gauge_tracker gt
            LEFT JOIN public.users u ON u.id = gt.issued_to
            LEFT JOIN public.equipment_used_for_calibration e ON e.gauge_id = gt.gauge_id
            WHERE gt.gauge_id = :gid AND gt.returned_at IS NULL
            ORDER BY gt.issued_at DESC NULLS LAST
            LIMIT 1
            """
        ), {"gid": gid}).mappings().first()
        if gt_holder and gt_holder.get("email"):
            user = {"email": gt_holder.get("email"), "username": gt_holder.get("username")}
            # If no row from requests, use equipment fields from gt join
            if not row:
                row = {"name_of_the_equipment": gt_holder.get("name_of_the_equipment"), "calibration_due": gt_holder.get("calibration_due")}

    if not user or not user.get("email"):
        raise HTTPException(status_code=404, detail="Operator email not found")

    # Reload env from .env (if present) to pick up latest credentials without restart
    try:
        load_dotenv(override=False)
    except Exception:
        pass
    # Email config from env
    smtp_host = os.getenv("EMAIL_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("EMAIL_PORT", "587"))
    smtp_user = os.getenv("EMAIL_USER")
    smtp_pass = os.getenv("EMAIL_PASS")
    email_from = os.getenv("EMAIL_FROM", smtp_user or "")
    if not smtp_user or not smtp_pass or not email_from:
        raise HTTPException(status_code=500, detail="Email credentials are not configured")

    operator_email = user["email"]
    if not operator_username:
        try:
            operator_username = (user.get("username") or "").strip()
        except Exception:
            operator_username = ""
    gauge_name = row.get("name_of_the_equipment") or f"Gauge {gid}"
    due_date = row.get("calibration_due")
    try:
        if due_date is not None:
            try:
                due_str = due_date.strftime("%Y-%m-%d")
            except Exception:
                due_str = str(due_date)
        else:
            due_str = "—"
    except Exception:
        due_str = str(due_date)

    subject = "Gauge Calibration Reminder"
    body = (
        f"Dear {operator_username},\n\n"
        f"This is a reminder to return the gauge {gauge_name} (ID: {gid}) before its due date: {due_str}.\n\n"
        f"Regards,\n"
        f"{payload.admin_name}"
    )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = email_from
    msg["To"] = operator_email
    msg.set_content(body)

    try:
        # Use STARTTLS
        context = ssl.create_default_context()
        with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
            server.ehlo()
            server.starttls(context=context)
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)
        return {"success": True, "message": "Reminder email sent"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send email: {str(e)}")


# =========================
# Analytics Endpoints
# =========================

@app.get("/analytics/returns-rejects")
def analytics_returns_rejects(db: Session = Depends(get_db)):
    """Return summary totals and monthly trends for returns and rejects."""
    # Ensure required columns exist
    try:
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ"))
    except Exception:
        pass

    # Totals summary
    summary = {
        "total_requested": 0,
        "total_accepted": 0,
        "total_returns": 0,
        "total_rejects": 0,
        # Optional breakdown placeholders if available elsewhere
        "returns_good": 0,
        "returns_bad": 0,
        "returns_needs_repair": 0,
        "returns_custom": 0,
    }
    try:
        rows = db.execute(text(
            """
            SELECT status, COUNT(*) AS c
            FROM public.gauge_requests
            GROUP BY status
            """
        )).mappings().all()
        for r in rows:
            s = (r.get("status") or "").lower()
            c = int(r.get("c") or 0)
            if s == "requested":
                summary["total_requested"] += c
            elif s == "accepted":
                summary["total_accepted"] += c
            elif s == "returned":
                summary["total_returns"] += c
            elif s == "rejected":
                summary["total_rejects"] += c
    except Exception:
        pass

    # Monthly trends for last 12 months
    monthly_trends: list[dict] = []
    try:
        trend_rows = db.execute(text(
            """
            WITH months AS (
              SELECT date_trunc('month', (NOW() - (interval '1 month' * g.i))) AS m
              FROM generate_series(0, 11) AS g(i)
            )
            SELECT to_char(m.m, 'YYYY-MM-01') AS month,
                   COALESCE(rtn.c, 0) AS returns,
                   COALESCE(rj.c, 0) AS rejects
            FROM months m
            LEFT JOIN (
              SELECT date_trunc('month', returned_at) AS mm, COUNT(*) AS c
              FROM public.gauge_requests
              WHERE status = 'returned' AND returned_at IS NOT NULL
              GROUP BY mm
            ) rtn ON rtn.mm = m.m
            LEFT JOIN (
              -- We don't have rejected_at; approximate by requested_at month
              SELECT date_trunc('month', requested_at) AS mm, COUNT(*) AS c
              FROM public.gauge_requests
              WHERE status = 'rejected'
              GROUP BY mm
            ) rj ON rj.mm = m.m
            ORDER BY m.m
            """
        )).mappings().all()
        for t in trend_rows:
            monthly_trends.append({
                "month": t.get("month"),
                "returns": int(t.get("returns") or 0),
                "rejects": int(t.get("rejects") or 0),
            })
    except Exception:
        pass

    return {"summary": summary, "monthly_trends": monthly_trends}


@app.get("/analytics/most-used-tools")
def analytics_most_used_tools(limit: int = 10, db: Session = Depends(get_db)):
    """Return top tools by request volume with accepted/returned counts."""
    limit = max(1, min(int(limit or 10), 50))
    try:
        rows = db.execute(text(
            """
            SELECT e.name_of_the_equipment,
                   COUNT(gr.id) AS request_count,
                   SUM(CASE WHEN gr.status = 'accepted' THEN 1 ELSE 0 END) AS accepted_count,
                   SUM(CASE WHEN gr.status = 'returned' THEN 1 ELSE 0 END) AS returned_count
            FROM public.gauge_requests gr
            LEFT JOIN public.equipment_used_for_calibration e ON e.gauge_id = gr.gauge_id
            GROUP BY e.name_of_the_equipment
            ORDER BY request_count DESC NULLS LAST
            LIMIT :lim
            """
        ), {"lim": limit}).mappings().all()
        data = []
        for r in rows:
            data.append({
                "name_of_the_equipment": r.get("name_of_the_equipment") or "Unknown",
                "request_count": int(r.get("request_count") or 0),
                "accepted_count": int(r.get("accepted_count") or 0),
                "returned_count": int(r.get("returned_count") or 0),
            })
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compute most used tools: {str(e)}")


@app.get("/analytics/operator-analytics")
def analytics_operator(db: Session = Depends(get_db)):
    """Return simple per-operator request/accept/reject counts."""
    try:
        rows = db.execute(text(
            """
            SELECT COALESCE(NULLIF(TRIM(requested_by), ''), 'Unknown') AS operator,
                   COUNT(*) AS total_requests,
                   SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted_requests,
                   SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_requests
            FROM public.gauge_requests
            GROUP BY operator
            ORDER BY total_requests DESC
            LIMIT 50
            """
        )).mappings().all()
        return {"operator_stats": [
            {
                "operator": r.get("operator") or "Unknown",
                "total_requests": int(r.get("total_requests") or 0),
                "accepted_requests": int(r.get("accepted_requests") or 0),
                "rejected_requests": int(r.get("rejected_requests") or 0),
            }
            for r in rows
        ]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compute operator analytics: {str(e)}")


@app.get("/equipment")
def list_equipment(
    limit: int = 50,
    offset: int = 0,
    q: str | None = None,
    location: str | None = None,
    sort_by: str | None = None,
    sort_dir: str | None = None,
    db: Session = Depends(get_db),
):
    # Ensure ranges table exists
    try:
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS public.gauge_ranges (
              id SERIAL PRIMARY KEY,
              gauge_id INTEGER NOT NULL,
              label TEXT NOT NULL
            )
            """
        ))
    except Exception:
        pass
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    where = ""
    params = {"limit": limit, "offset": offset}
    if q:
        where = "WHERE name_of_the_equipment ILIKE :qs OR idfn_no ILIKE :qs OR location ILIKE :qs"
        params["qs"] = f"%{q}%"
    if location:
        # Case-insensitive exact match for chosen location
        clause = "LOWER(location) = LOWER(:loc)"
        if where:
            where += f" AND {clause}"
        else:
            where = f"WHERE {clause}"
        params["loc"] = location
    # Ensure returned_at column exists for availability checks
    try:
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ"))
    except Exception:
        pass
    # Sorting
    allowed_cols = {
        "gauge_id": "gauge_id",
        "name": "name_of_the_equipment",
        "name_of_the_equipment": "name_of_the_equipment",
        "location": "location",
        "make_model": "make_model",
        "idfn_no": "idfn_no",
        "receipt_date": "receipt_date",
        "date_of_last_calibration": "date_of_last_calibration",
        "calibration_due": "calibration_due",
        "calibration_freq_months": "calibration_freq_months",
        "pcr_number": "pcr_number",
    }
    col = allowed_cols.get((sort_by or "").lower(), "gauge_id")
    direction = "DESC" if (sort_dir or "").lower() == "desc" else "ASC"
    order_clause = f"{col} {direction}"

    sql = text(
        f"""
        SELECT 
          gauge_id,
          name_of_the_equipment,
          location,
          make_model,
          idfn_no,
          receipt_date,
          date_of_last_calibration,
          calibration_due,
          calibration_freq_months,
          overall_measurement_uncertainty,
          pcr_number,
          (
            SELECT ARRAY(
              SELECT gr.label FROM public.gauge_ranges gr
              WHERE gr.gauge_id = equipment_used_for_calibration.gauge_id
              ORDER BY gr.label ASC
            )
          ) AS ranges,
          EXISTS (
            SELECT 1 FROM public.gauge_requests gr
            WHERE gr.gauge_id = equipment_used_for_calibration.gauge_id
              AND gr.status = 'accepted'
              AND gr.returned_at IS NULL
          ) AS is_unavailable
        FROM public.equipment_used_for_calibration
        {where}
        ORDER BY {order_clause}
        LIMIT :limit OFFSET :offset
        """
    )
    try:
        rows = db.execute(sql, params).mappings().all()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"gauge-tracker primary query failed: {str(e)}")
    # Compute total with same filter
    try:
        count_sql = text(
            f"""
            SELECT COUNT(1) AS total
            FROM public.equipment_used_for_calibration
            {where}
            """
        )
        count_params = {}
        if "qs" in params:
            count_params["qs"] = params["qs"]
        if "loc" in params:
            count_params["loc"] = params["loc"]
        total_row = db.execute(count_sql, count_params).mappings().first()
        total = int(total_row["total"]) if total_row and total_row.get("total") is not None else len(rows)
    except Exception:
        total = len(rows)
    return {
        "items": list(rows),
        "limit": limit,
        "offset": offset,
        "count": len(rows),
        "total": total,
    }


@app.get("/equipment/suggest")
def suggest_equipment(q: str, limit: int = 10, db: Session = Depends(get_db)):
    """Return up to `limit` suggestions matching q across name_of_the_equipment and idfn_no.
    The response is a list of objects: { type: 'name'|'idfn', value: string }.
    """
    try:
        limit = max(1, min(int(limit), 25))
    except Exception:
        limit = 10
    qpat = f"%{q}%" if q is not None else "%"
    suggestions: list[dict[str, str]] = []
    # Names
    try:
        sql_names = text(
            """
            SELECT DISTINCT name_of_the_equipment AS v
            FROM public.equipment_used_for_calibration
            WHERE name_of_the_equipment IS NOT NULL AND name_of_the_equipment ILIKE :q
            ORDER BY name_of_the_equipment ASC
            LIMIT :lim
            """
        )
        for row in db.execute(sql_names, {"q": qpat, "lim": limit}).mappings().all():
            val = row.get("v")
            if val:
                suggestions.append({"type": "name", "value": str(val)})
    except Exception:
        pass
    # IDFN
    try:
        sql_idfn = text(
            """
            SELECT DISTINCT idfn_no AS v
            FROM public.equipment_used_for_calibration
            WHERE idfn_no IS NOT NULL AND idfn_no ILIKE :q
            ORDER BY idfn_no ASC
            LIMIT :lim
            """
        )
        for row in db.execute(sql_idfn, {"q": qpat, "lim": limit}).mappings().all():
            val = row.get("v")
            if val:
                suggestions.append({"type": "idfn", "value": str(val)})
    except Exception:
        pass
    # Trim to limit while preserving ordering: prioritize names then idfn; remove duplicates
    seen = set()
    out = []
    for s in suggestions:
        key = (s.get("type"), s.get("value"))
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
        if len(out) >= limit:
            break
    return out


@app.get("/equipment/location-suggest")
def suggest_locations(q: str | None = None, limit: int = 20, db: Session = Depends(get_db)):
    """Return a list of distinct locations matching optional q (case-insensitive)."""
    try:
        limit = max(1, min(int(limit), 50))
    except Exception:
        limit = 20
    params: dict[str, object] = {"lim": limit}
    where = "WHERE location IS NOT NULL AND TRIM(location) <> ''"
    if q:
        where += " AND location ILIKE :q"
        params["q"] = f"%{q}%"
    sql = text(
        f"""
        SELECT DISTINCT location AS v
        FROM public.equipment_used_for_calibration
        {where}
        ORDER BY location ASC
        LIMIT :lim
        """
    )
    try:
        rows = db.execute(sql, params).mappings().all()
        return [str(r.get("v")) for r in rows if r.get("v")]
    except Exception:
        return []


@app.get("/equipment/position-by-name")
def equipment_position_by_name(
    name: str,
    gauge_id: int | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
):
    """Return zero-based index position of an equipment in name ASC order.
    Tie-break by gauge_id when names are equal.
    Supports same optional q filter as list_equipment.
    """
    where = ""
    params: dict[str, object] = {"nm": name}
    if q:
        where = "WHERE (name_of_the_equipment ILIKE :qs OR idfn_no ILIKE :qs OR location ILIKE :qs)"
        params["qs"] = f"%{q}%"
    # Count rows that come strictly before in lex order, or equal name with smaller gauge_id (if provided)
    cond_equal_tiebreak = "0=1"
    if gauge_id is not None:
        params["gid"] = int(gauge_id)
        cond_equal_tiebreak = "(LOWER(name_of_the_equipment) = LOWER(:nm) AND gauge_id < :gid)"
    sql = text(
        f"""
        SELECT COUNT(1) AS idx
        FROM public.equipment_used_for_calibration
        {where}
        AND (
          LOWER(name_of_the_equipment) < LOWER(:nm)
          OR {cond_equal_tiebreak}
        )
        """
        if where
        else
        """
        SELECT COUNT(1) AS idx
        FROM public.equipment_used_for_calibration
        WHERE LOWER(name_of_the_equipment) < LOWER(:nm)
        OR (LOWER(name_of_the_equipment) = LOWER(:nm) AND gauge_id < :gid)
        """
    )
    try:
        row = db.execute(sql, params).mappings().first()
        idx = int(row["idx"]) if row and row.get("idx") is not None else 0
        return {"index": idx}
    except Exception:
        return {"index": 0}


# =========================
# Daily 9:00 AM IST Email Scheduler
# =========================

def _seconds_until_next_9am_ist() -> float:
    tz = ZoneInfo("Asia/Kolkata")
    now_utc = datetime.now(timezone.utc)
    now_ist = now_utc.astimezone(tz)
    target = now_ist.replace(hour=8, minute=14, second=00, microsecond=0)
    if now_ist >= target:
        target = target + timedelta(days=1)
    delta = target - now_ist
    return max(1.0, delta.total_seconds())


def _daily_email_job():
    # Open a fresh DB session
    db = SessionLocal()
    try:
        # Pick an admin display name from env or fallback
        admin_name = os.getenv("ADMIN_DISPLAY_NAME", "Admin")
        # Find all currently accepted and not returned gauges (primary table)
        rows = db.execute(text(
            """
            SELECT DISTINCT gr.gauge_id
            FROM public.gauge_requests gr
            WHERE gr.status = 'accepted' AND gr.returned_at IS NULL
            """
        )).mappings().all()
        gids = [int(r["gauge_id"]) for r in rows if r.get("gauge_id") is not None]
        sent = 0
        for gid in gids:
            ok, _ = _send_operator_email_for_gauge(db, gid, admin_name)
            if ok:
                sent += 1
        print(f"[scheduler] Daily email job completed. Sent: {sent}, Checked: {len(gids)}")
    except Exception as e:
        print(f"[scheduler] Daily email job failed: {e}")
    finally:
        try:
            db.close()
        except Exception:
            pass


def _scheduler_loop():
    # Run forever while process is alive
    while True:
        try:
            wait_s = _seconds_until_next_9am_ist()
            time.sleep(wait_s)
            _daily_email_job()
        except Exception as e:
            # Never crash the loop
            print(f"[scheduler] Loop error: {e}")
            time.sleep(5)


@app.on_event("startup")
def _start_scheduler():
    try:
        t = threading.Thread(target=_scheduler_loop, name="email-scheduler", daemon=True)
        t.start()
        print("[scheduler] Daily 9:00 AM IST email scheduler started")
    except Exception as e:
        print(f"[scheduler] Failed to start: {e}")


_due_reminder_time_str = os.getenv("DUE_REMINDER_TIME", "09:11")
_due_reminder_event = threading.Event()
try:
    _due_reminder_offset_days = int(os.getenv("DAYS_BEFORE_DUE", "0"))
except Exception:
    _due_reminder_offset_days = 0

# Support multiple reminder intervals (e.g., "1,3,10" for 1, 3, and 10 days before due)
try:
    _reminder_intervals_str = os.getenv("REMINDER_INTERVALS", "1,3,10")
    _reminder_intervals = [int(x.strip()) for x in _reminder_intervals_str.split(",") if x.strip().isdigit()]
except Exception:
    _reminder_intervals = [1, 3, 10]  # Default intervals


def _parse_hhmm(s: str) -> tuple[int, int]:
    p = (s or "").strip()
    if ":" not in p or len(p) < 4:
        raise ValueError("Invalid time")
    hh, mm = p.split(":", 1)
    h = int(hh)
    m = int(mm)
    if not (0 <= h <= 23 and 0 <= m <= 59):
        raise ValueError("Invalid time")
    return h, m


def _seconds_until_next_time_ist(h: int, m: int) -> float:
    tz = ZoneInfo("Asia/Kolkata")
    now_utc = datetime.now(timezone.utc)
    now_ist = now_utc.astimezone(tz)
    target = now_ist.replace(hour=h, minute=m, second=0, microsecond=0)
    if now_ist >= target:
        target = target + timedelta(days=1)
    delta = target - now_ist
    return max(1.0, delta.total_seconds())


def _trigger_due_reminder():
    url = os.getenv("DUE_REMINDER_TRIGGER_URL", "").strip()
    if url:
        try:
            data = b"{}"
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=20) as resp:
                print(f"[due-reminder] HTTP trigger {url} -> {resp.status}")
        except Exception as e:
            print(f"[due-reminder] HTTP trigger failed: {e}")
    else:
        # Direct in-process run with multiple intervals
        total_results = {"checked": 0, "sent_operator": 0, "sent_admin": 0, "failed": 0}
        for interval in _reminder_intervals:
            print(f"[due-reminder] Running for interval: {interval} days before due")
            os.environ["DAYS_BEFORE_DUE"] = str(interval)
            try:
                result = due_reminder_script.main()
                if isinstance(result, dict):
                    total_results["checked"] += result.get("checked", 0)
                    total_results["sent_operator"] += result.get("sent_operator", 0)
                    total_results["sent_admin"] += result.get("sent_admin", 0)
                    total_results["failed"] += result.get("failed", 0)
            except Exception as e:
                print(f"[due-reminder] Failed for interval {interval}: {e}")
                total_results["failed"] += 1
        print(f"[due-reminder] Total results: {total_results}")


def _run_due_reminder_job_safely():
    try:
        _trigger_due_reminder()
    except Exception as e:
        print(f"[due-reminder] job failed: {e}")


def _due_reminder_scheduler_loop():
    global _due_reminder_time_str
    while True:
        try:
            try:
                h, m = _parse_hhmm(_due_reminder_time_str)
            except Exception:
                h, m = (8, 30)
            wait_s = _seconds_until_next_time_ist(h, m)
            signaled = _due_reminder_event.wait(wait_s)
            if signaled:
                # Reschedule requested; clear event and recompute
                _due_reminder_event.clear()
                try:
                    h, m = _parse_hhmm(_due_reminder_time_str)
                except Exception:
                    h, m = (8, 30)
                wait2 = _seconds_until_next_time_ist(h, m)
                # If new time has already passed today (wait close to 24h), run immediately
                if wait2 > 23 * 3600:
                    print(f"[due-reminder] time updated to past today ({h:02d}:{m:02d}), running now")
                    _run_due_reminder_job_safely()
                    continue
                # If the next run is very soon, sleep briefly then run
                if wait2 <= 5:
                    if wait2 > 0:
                        time.sleep(wait2)
                    print(f"[due-reminder] time updated; running now at {h:02d}:{m:02d}")
                    _run_due_reminder_job_safely()
                    continue
                # Otherwise loop back to wait for the next schedule
                continue
            print(f"[due-reminder] scheduled run at {h:02d}:{m:02d} IST")
            _run_due_reminder_job_safely()
        except Exception as e:
            print(f"[due-reminder] loop error: {e}")
            time.sleep(5)


@app.on_event("startup")
def _start_due_reminder_scheduler():
    try:
        t = threading.Thread(target=_due_reminder_scheduler_loop, name="due-reminder-scheduler", daemon=True)
        t.start()
        print(f"[due-reminder] scheduler started with time {_due_reminder_time_str} IST")
    except Exception as e:
        print(f"[due-reminder] failed to start: {e}")


@app.get("/admin/due-reminder/time")
def get_due_reminder_time():
    return {"time": _due_reminder_time_str, "timezone": "Asia/Kolkata"}


@app.get("/admin/due-reminder/offset")
def get_due_reminder_offset():
    return {"days": _due_reminder_offset_days, "intervals": _reminder_intervals}


@app.get("/admin/due-reminder/intervals")
def get_due_reminder_intervals():
    return {"intervals": _reminder_intervals}


@app.put("/admin/due-reminder/intervals")
async def set_due_reminder_intervals(request: Request, intervals: str | None = None):
    global _reminder_intervals
    ival = None
    # Try JSON
    try:
        data = await request.json()
        if isinstance(data, dict) and "intervals" in data:
            ival = data.get("intervals")
    except Exception:
        pass
    # Try form
    if ival is None:
        try:
            form_data = await request.form()
            if "intervals" in form_data:
                ival = form_data["intervals"]
        except Exception:
            pass
    # Try query param
    if ival is None and intervals:
        ival = intervals

    if not ival:
        raise HTTPException(status_code=400, detail="Missing 'intervals' parameter")

    try:
        # Parse comma-separated intervals
        if isinstance(ival, str):
            new_intervals = [int(x.strip()) for x in ival.split(",") if x.strip().isdigit()]
        elif isinstance(ival, list):
            new_intervals = [int(x) for x in ival]
        else:
            raise HTTPException(status_code=400, detail="Invalid intervals format")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid intervals; must be comma-separated integers")

    if not new_intervals:
        raise HTTPException(status_code=400, detail="At least one interval required")

    _reminder_intervals = new_intervals
    # Also update the single offset for backward compatibility
    _due_reminder_offset_days = new_intervals[0] if new_intervals else 0

    return {"intervals": _reminder_intervals, "days": _due_reminder_offset_days}


@app.get("/admin/email-logs")
def list_email_logs(
    limit: int = 50,
    status: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    db: Session = Depends(get_db),
):
    try:
        limit = max(1, min(int(limit), 500))
    except Exception:
        limit = 50
    # Ensure table exists
    try:
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS public.email_logs (
              id SERIAL PRIMARY KEY,
              sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              to_email TEXT,
              subject TEXT,
              body TEXT,
              status TEXT,
              error TEXT,
              context JSONB
            )
            """
        ))
    except Exception:
        pass
    where = []
    params: dict[str, object] = {"lim": limit}
    if status:
        where.append("status = :st")
        params["st"] = status
    if from_date:
        where.append("sent_at::date >= CAST(:from_date AS DATE)")
        params["from_date"] = from_date
    if to_date:
        where.append("sent_at::date <= CAST(:to_date AS DATE)")
        params["to_date"] = to_date
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    rows = db.execute(text(
        f"""
        SELECT id, sent_at, to_email, subject, body, status, error, context
        FROM public.email_logs
        {where_sql}
        ORDER BY sent_at DESC, id DESC
        LIMIT :lim
        """
    ), params).mappings().all()
    # Serialize JSONB context if needed
    out = []
    # derive from_email from env
    try:
        load_dotenv(override=False)
    except Exception:
        pass
    from_email = os.getenv("EMAIL_FROM", os.getenv("EMAIL_USER", ""))
    for r in rows:
        d = dict(r)
        try:
            if isinstance(d.get("context"), (dict, list)):
                pass
            elif d.get("context") is not None:
                d["context"] = json.loads(d["context"])  # type: ignore
        except Exception:
            pass
        # add convenience fields
        try:
            sent = d.get("sent_at")
            if sent is not None:
                # Format date/time strings (local naive ISO)
                d["date_str"] = sent.strftime("%Y-%m-%d")
                d["time_str"] = sent.strftime("%H:%M:%S")
        except Exception:
            pass
        d["from_email"] = from_email
        out.append(d)
    return out


@app.put("/admin/due-reminder/time")
async def set_due_reminder_time(request: Request, time: str | None = None):
    global _due_reminder_time_str
    # Accept time from (priority): JSON body, form body, query param
    tval = None
    # Try JSON
    try:
        data = await request.json()
        if isinstance(data, dict):
            v = data.get("time")
            if isinstance(v, str) and v.strip():
                tval = v.strip()
    except Exception:
        pass
    # Try form
    if not tval:
        try:
            form = await request.form()
            v = form.get("time") if form is not None else None
            if v:
                tval = str(v).strip()
        except Exception:
            pass
    # Try query param
    if not tval and time:
        tval = str(time).strip()

    if not tval:
        raise HTTPException(status_code=400, detail="Missing 'time' in body or query")
    try:
        h, m = _parse_hhmm(tval)
    except Exception:
        raise HTTPException(status_code=400, detail="Time must be in HH:MM 24h format")
    _due_reminder_time_str = f"{h:02d}:{m:02d}"
    _due_reminder_event.set()
    return {"time": _due_reminder_time_str, "timezone": "Asia/Kolkata"}


@app.post("/admin/due-reminder/run")
def run_due_reminder_now():
    try:
        total_results = {"checked": 0, "sent_operator": 0, "sent_admin": 0, "failed": 0, "intervals_run": []}
        for interval in _reminder_intervals:
            print(f"[due-reminder] Manual run for interval: {interval} days before due")
            os.environ["DAYS_BEFORE_DUE"] = str(interval)
            try:
                result = due_reminder_script.main()
                if isinstance(result, dict):
                    total_results["checked"] += result.get("checked", 0)
                    total_results["sent_operator"] += result.get("sent_operator", 0)
                    total_results["sent_admin"] += result.get("sent_admin", 0)
                    total_results["failed"] += result.get("failed", 0)
                    total_results["intervals_run"].append({
                        "interval": interval,
                        "result": result
                    })
            except Exception as e:
                print(f"[due-reminder] Manual run failed for interval {interval}: {e}")
                total_results["failed"] += 1
                total_results["intervals_run"].append({
                    "interval": interval,
                    "error": str(e)
                })
        print(f"[due-reminder] Manual run total results: {total_results}")
        return {"success": True, "results": total_results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"due_reminder failed: {e}")


@app.put("/admin/due-reminder/offset")
async def set_due_reminder_offset(request: Request, days: int | None = None):
    global _due_reminder_offset_days
    dval = None
    # JSON
    try:
        data = await request.json()
        if isinstance(data, dict) and "days" in data:
            dval = data.get("days")
    except Exception:
        pass
    # Form
    if dval is None:
        try:
            form = await request.form()
            if "days" in form:
                dval = form.get("days")
        except Exception:
            pass
    # Query
    if dval is None and days is not None:
        dval = days

    try:
        new_days = int(dval)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid days; must be integer >= 0")
    if new_days < 0:
        raise HTTPException(status_code=400, detail="Invalid days; must be >= 0")

    _due_reminder_offset_days = new_days
    os.environ["DAYS_BEFORE_DUE"] = str(_due_reminder_offset_days)
    return {"days": _due_reminder_offset_days}


@app.post("/equipment", response_model=schemas.EquipmentPublic, status_code=status.HTTP_201_CREATED)
def create_equipment(payload: schemas.EquipmentCreate, db: Session = Depends(get_db)):
    # Ensure table exists (first-run/dev safety). In production, prefer migrations.
    db.execute(text(
        """
        CREATE TABLE IF NOT EXISTS public.equipment_used_for_calibration (
          gauge_id SERIAL PRIMARY KEY,
          name_of_the_equipment TEXT NOT NULL,
          location TEXT,
          receipt_date DATE,
          make_model TEXT,
          idfn_no TEXT NOT NULL,
          overall_measurement_uncertainty TEXT,
          calibration_freq_months INTEGER,
          date_of_last_calibration DATE,
          calibration_due DATE,
          pcr_number BIGINT
        )
        """
    ))
    # Ensure legacy gauge_tracker exists for joins/fallback
    try:
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS public.gauge_tracker (
              id SERIAL PRIMARY KEY,
              gauge_id INTEGER NOT NULL,
              name_of_the_equipment TEXT,
              idfn_no TEXT,
              location TEXT,
              make_model TEXT,
              quantity INTEGER DEFAULT 1,
              requested_by VARCHAR(100),
              requested_at TIMESTAMPTZ DEFAULT NOW(),
              status VARCHAR(20) DEFAULT 'requested',
              accepted_by VARCHAR(100),
              accepted_at TIMESTAMPTZ,
              issued_to INTEGER,
              issued_at TIMESTAMPTZ,
              returned_at TIMESTAMPTZ
            )
            """
        ))
    except Exception:
        pass

    # Try to widen existing pcr_number column to BIGINT in case an earlier run created it as INTEGER
    try:
        db.execute(text("ALTER TABLE public.equipment_used_for_calibration ALTER COLUMN pcr_number TYPE BIGINT USING pcr_number::bigint"))
    except Exception:
        # ignore if already BIGINT or cannot alter
        pass

    # Normalize/validate payload
    def to_iso_date(value: str | None) -> str | None:
        if not value:
            return None
        value = value.strip()
        # Accept common formats
        fmts = ["%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%m-%d-%Y"]
        for fmt in fmts:
            try:
                return datetime.strptime(value, fmt).date().isoformat()
            except ValueError:
                continue
        # As a final attempt, try letting Postgres parse via ISO-compatible string
        raise HTTPException(status_code=400, detail=f"Invalid date format: '{value}'. Use YYYY-MM-DD or DD-MM-YYYY.")

    data = payload.model_dump()
    # Coerce/clean fields
    for k in ("receipt_date", "date_of_last_calibration", "calibration_due"):
        data[k] = to_iso_date(data.get(k)) if data.get(k) else None
    # Shift Sunday due date to Monday
    try:
        cd = data.get("calibration_due")
        if cd:
            d = datetime.strptime(cd, "%Y-%m-%d").date()
            if d.weekday() == 6:
                d = d.fromordinal(d.toordinal() + 1)
                data["calibration_due"] = d.isoformat()
    except Exception:
        pass
    # calibration_freq_months should be int or null
    if data.get("calibration_freq_months") in ("", None):
        data["calibration_freq_months"] = None
    else:
        try:
            data["calibration_freq_months"] = int(data["calibration_freq_months"])  # type: ignore
        except Exception:
            raise HTTPException(status_code=400, detail="calibration_freq_months must be a number")
    # pcr_number may be large; allow None
    if data.get("pcr_number") in ("", None):
        data["pcr_number"] = None
    else:
        try:
            data["pcr_number"] = int(data["pcr_number"])  # type: ignore
        except Exception:
            raise HTTPException(status_code=400, detail="pcr_number must be a whole number")

    # Insert record
    cols = [
        "name_of_the_equipment",
        "location",
        "receipt_date",
        "make_model",
        "idfn_no",
        "overall_measurement_uncertainty",
        "calibration_freq_months",
        "date_of_last_calibration",
        "calibration_due",
        "pcr_number",
    ]
    # Build INSERT with explicit casts for date/int/bigint columns
    sql = text(
        """
        INSERT INTO public.equipment_used_for_calibration (
          name_of_the_equipment,
          location,
          receipt_date,
          make_model,
          idfn_no,
          overall_measurement_uncertainty,
          calibration_freq_months,
          date_of_last_calibration,
          calibration_due,
          pcr_number
        ) VALUES (
          :name_of_the_equipment,
          :location,
          CAST(:receipt_date AS DATE),
          :make_model,
          :idfn_no,
          :overall_measurement_uncertainty,
          CAST(:calibration_freq_months AS INTEGER),
          CAST(:date_of_last_calibration AS DATE),
          CAST(:calibration_due AS DATE),
          CAST(:pcr_number AS BIGINT)
        )
        RETURNING gauge_id, name_of_the_equipment, location, make_model, idfn_no, date_of_last_calibration, calibration_due
        """
    )
    try:
        row = db.execute(sql, data).mappings().first()
        if not row:
            db.rollback()
            raise HTTPException(status_code=500, detail="Insert failed")
        # Insert ranges if provided
        try:
            db.execute(text(
                """
                CREATE TABLE IF NOT EXISTS public.gauge_ranges (
                  id SERIAL PRIMARY KEY,
                  gauge_id INTEGER NOT NULL,
                  label TEXT NOT NULL
                )
                """
            ))
            ranges = payload.ranges or []
            if isinstance(ranges, list) and len(ranges):
                for lab in ranges:
                    lab_s = (str(lab or "").strip())
                    if not lab_s:
                        continue
                    db.execute(text("INSERT INTO public.gauge_ranges (gauge_id, label) VALUES (:gid, :label)"), {"gid": row["gauge_id"], "label": lab_s})
        except Exception:
            pass
        db.commit()
    except IntegrityError as ie:
        db.rollback()
        raise HTTPException(status_code=400, detail="Duplicate or integrity error while saving equipment")
    except Exception as e:
        db.rollback()
        # Return a readable message for common PG errors
        raise HTTPException(status_code=400, detail=f"Insert error: {str(e)}")
    # Attach ranges to response
    try:
        rrows = db.execute(text("SELECT label FROM public.gauge_ranges WHERE gauge_id = :gid ORDER BY label ASC"), {"gid": row["gauge_id"]}).mappings().all()
        rng = [str(r["label"]) for r in rrows]
        row = { **row, "ranges": rng }
    except Exception:
        pass
    return row


@app.put("/equipment/{gauge_id}", response_model=schemas.EquipmentPublic)
def update_equipment(gauge_id: int, payload: schemas.EquipmentUpdate, db: Session = Depends(get_db)):
    # Ensure table exists (be tolerant)
    db.execute(text(
        """
        CREATE TABLE IF NOT EXISTS public.equipment_used_for_calibration (
          gauge_id SERIAL PRIMARY KEY,
          name_of_the_equipment TEXT NOT NULL,
          location TEXT,
          receipt_date DATE,
          make_model TEXT,
          idfn_no TEXT NOT NULL,
          overall_measurement_uncertainty TEXT,
          calibration_freq_months INTEGER,
          date_of_last_calibration DATE,
          calibration_due DATE,
          pcr_number BIGINT
        )
        """
    ))

    data = payload.model_dump(exclude_unset=True)

    def to_iso_date(value: str | None) -> str | None:
        if not value:
            return None
        value = value.strip()
        fmts = ["%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%m-%d-%Y"]
        for fmt in fmts:
            try:
                return datetime.strptime(value, fmt).date().isoformat()
            except ValueError:
                continue
        raise HTTPException(status_code=400, detail=f"Invalid date format: '{value}'. Use YYYY-MM-DD or DD-MM-YYYY.")

    # Normalize fields as strings and cast at SQL layer
    fields_sql = []
    params: dict[str, object] = {"gid": gauge_id}
    if "name_of_the_equipment" in data:
        fields_sql.append("name_of_the_equipment = :name_of_the_equipment")
        params["name_of_the_equipment"] = data.get("name_of_the_equipment")
    if "location" in data:
        fields_sql.append("location = :location")
        params["location"] = data.get("location")
    if "make_model" in data:
        fields_sql.append("make_model = :make_model")
        params["make_model"] = data.get("make_model")
    if "idfn_no" in data:
        fields_sql.append("idfn_no = :idfn_no")
        params["idfn_no"] = data.get("idfn_no")
    if "overall_measurement_uncertainty" in data:
        fields_sql.append("overall_measurement_uncertainty = :overall_measurement_uncertainty")
        params["overall_measurement_uncertainty"] = data.get("overall_measurement_uncertainty")
    if "receipt_date" in data:
        fields_sql.append("receipt_date = CAST(:receipt_date AS DATE)")
        params["receipt_date"] = to_iso_date(data.get("receipt_date")) if data.get("receipt_date") else None
    if "date_of_last_calibration" in data:
        fields_sql.append("date_of_last_calibration = CAST(:date_of_last_calibration AS DATE)")
        params["date_of_last_calibration"] = to_iso_date(data.get("date_of_last_calibration")) if data.get("date_of_last_calibration") else None
    if "calibration_due" in data:
        fields_sql.append("calibration_due = CAST(:calibration_due AS DATE)")
        cd = to_iso_date(data.get("calibration_due")) if data.get("calibration_due") else None
        if cd:
            try:
                d = datetime.strptime(cd, "%Y-%m-%d").date()
                if d.weekday() == 6:
                    d = d.fromordinal(d.toordinal() + 1)
                    cd = d.isoformat()
            except Exception:
                pass
        params["calibration_due"] = cd
    if "calibration_freq_months" in data:
        cfm = data.get("calibration_freq_months")
        try:
            cfm_val = None if cfm in (None, "") else int(cfm)
        except Exception:
            raise HTTPException(status_code=400, detail="calibration_freq_months must be a number")
        fields_sql.append("calibration_freq_months = CAST(:calibration_freq_months AS INTEGER)")
        params["calibration_freq_months"] = cfm_val
    if "pcr_number" in data:
        pn = data.get("pcr_number")
        try:
            pn_val = None if pn in (None, "") else int(pn)
        except Exception:
            raise HTTPException(status_code=400, detail="pcr_number must be a whole number")
        fields_sql.append("pcr_number = CAST(:pcr_number AS BIGINT)")
        params["pcr_number"] = pn_val

    if not fields_sql:
        # Nothing to update; return current row
        row = db.execute(text(
            """
            SELECT gauge_id, name_of_the_equipment, location, make_model, idfn_no,
                   date_of_last_calibration, calibration_due
            FROM public.equipment_used_for_calibration
            WHERE gauge_id = :gid
            """
        ), {"gid": gauge_id}).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="Gauge not found")
        # Attach ranges
        try:
            rrows = db.execute(text("SELECT label FROM public.gauge_ranges WHERE gauge_id = :gid ORDER BY label ASC"), {"gid": gauge_id}).mappings().all()
            rng = [str(r["label"]) for r in rrows]
            row = { **row, "ranges": rng }
        except Exception:
            pass
        return row

    sql = text(
        f"""
        UPDATE public.equipment_used_for_calibration
        SET {', '.join(fields_sql)}
        WHERE gauge_id = :gid
        RETURNING gauge_id, name_of_the_equipment, location, make_model, idfn_no, date_of_last_calibration, calibration_due
        """
    )
    try:
        row = db.execute(sql, params).mappings().first()
        if not row:
            db.rollback()
            raise HTTPException(status_code=404, detail="Gauge not found")
        # Update ranges if provided
        try:
            db.execute(text(
                """
                CREATE TABLE IF NOT EXISTS public.gauge_ranges (
                  id SERIAL PRIMARY KEY,
                  gauge_id INTEGER NOT NULL,
                  label TEXT NOT NULL
                )
                """
            ))
            if "ranges" in data:
                # Replace ranges set
                db.execute(text("DELETE FROM public.gauge_ranges WHERE gauge_id = :gid"), {"gid": gauge_id})
                rngs = data.get("ranges") or []
                if isinstance(rngs, list):
                    for lab in rngs:
                        lab_s = (str(lab or "").strip())
                        if not lab_s:
                            continue
                        db.execute(text("INSERT INTO public.gauge_ranges (gauge_id, label) VALUES (:gid, :label)"), {"gid": gauge_id, "label": lab_s})
        except Exception:
            pass
        db.commit()
        # Attach ranges
        try:
            rrows = db.execute(text("SELECT label FROM public.gauge_ranges WHERE gauge_id = :gid ORDER BY label ASC"), {"gid": gauge_id}).mappings().all()
            rng = [str(r["label"]) for r in rrows]
            row = { **row, "ranges": rng }
        except Exception:
            pass
        return row
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Duplicate or integrity error while updating equipment")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Update error: {str(e)}")

@app.delete("/equipment/{gauge_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_equipment(gauge_id: int, db: Session = Depends(get_db)):
    sql = text("DELETE FROM public.equipment_used_for_calibration WHERE gauge_id = :gid")
    res = db.execute(sql, {"gid": gauge_id})
    db.commit()
    # Optionally check rowcount
    return None


@app.post("/equipment/adjust-due-sundays")
def adjust_due_sundays(db: Session = Depends(get_db)):
    """Shift all equipment calibration_due that fall on Sunday to Monday.
    Returns the number of rows updated.
    """
    # Ensure table exists (tolerant)
    db.execute(text(
        """
        CREATE TABLE IF NOT EXISTS public.equipment_used_for_calibration (
          gauge_id SERIAL PRIMARY KEY,
          name_of_the_equipment TEXT NOT NULL,
          location TEXT,
          receipt_date DATE,
          make_model TEXT,
          idfn_no TEXT NOT NULL,
          overall_measurement_uncertainty TEXT,
          calibration_freq_months INTEGER,
          date_of_last_calibration DATE,
          calibration_due DATE,
          pcr_number BIGINT
        )
        """
    ))
    # In Postgres, DOW: 0=Sunday .. 6=Saturday
    res = db.execute(text(
        """
        UPDATE public.equipment_used_for_calibration
        SET calibration_due = calibration_due + INTERVAL '1 day'
        WHERE calibration_due IS NOT NULL
          AND EXTRACT(DOW FROM calibration_due) = 0
        """
    ))
    db.commit()
    return {"updated": int(getattr(res, 'rowcount', 0) or 0)}


@app.post("/requests", response_model=schemas.RequestResponse, status_code=status.HTTP_201_CREATED)
def create_request(payload: schemas.RequestCreate, db: Session = Depends(get_db)):
    # Ensure a requests table exists (id serial, gauge_id int, quantity int, requested_by text, requested_at timestamptz, status text)
    db.execute(text(
        """
        CREATE TABLE IF NOT EXISTS public.tool_requests (
          id SERIAL PRIMARY KEY,
          gauge_id INTEGER NOT NULL,
          quantity INTEGER NOT NULL,
          requested_by VARCHAR(100),
          requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          status VARCHAR(20) NOT NULL DEFAULT 'pending'
        )
        """
    ))

    # Ensure returned_at column exists for availability checks
    try:
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ"))
    except Exception:
        pass
    # Block if an accepted request exists and not returned
    active = db.execute(text(
        """
        SELECT 1 FROM public.gauge_requests
        WHERE gauge_id = :gid AND status = 'accepted' AND returned_at IS NULL
        LIMIT 1
        """
    ), {"gid": payload.gauge_id}).first()
    if active:
        raise HTTPException(status_code=400, detail="Tool currently issued and not yet returned")

    result = db.execute(
        text(
            """
            INSERT INTO public.tool_requests (gauge_id, quantity, requested_by)
            VALUES (:gauge_id, :quantity, :requested_by)
            RETURNING id
            """
        ),
        {
            "gauge_id": payload.gauge_id,
            "quantity": payload.quantity,
            "requested_by": payload.requested_by,
        }
    )
    new_request_id = result.scalar()
    db.commit()

    # Mirror into gauge_tracker for admin visibility
    try:
        # Ensure tracker table exists
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS public.gauge_tracker (
              id SERIAL PRIMARY KEY,
              gauge_id INTEGER NOT NULL,
              name_of_the_equipment TEXT NOT NULL,
              idfn_no TEXT NOT NULL,
              location TEXT,
              make_model TEXT,
              quantity INTEGER NOT NULL DEFAULT 1,
              requested_by VARCHAR(100),
              requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              status VARCHAR(20) NOT NULL DEFAULT 'requested',
              accepted_by VARCHAR(100),
              accepted_at TIMESTAMPTZ
            )
            """
        ))
        # Make sure columns exist if table was created earlier without them
        try:
            db.execute(text("ALTER TABLE public.gauge_tracker ADD COLUMN IF NOT EXISTS name_of_the_equipment TEXT"))
            db.execute(text("ALTER TABLE public.gauge_tracker ADD COLUMN IF NOT EXISTS idfn_no TEXT"))
            db.execute(text("ALTER TABLE public.gauge_tracker ADD COLUMN IF NOT EXISTS location TEXT"))
            db.execute(text("ALTER TABLE public.gauge_tracker ADD COLUMN IF NOT EXISTS make_model TEXT"))
            db.execute(text("ALTER TABLE public.gauge_tracker ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1"))
            db.execute(text("ALTER TABLE public.gauge_tracker ADD COLUMN IF NOT EXISTS requested_by VARCHAR(100)"))
            db.execute(text("ALTER TABLE public.gauge_tracker ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ DEFAULT NOW()"))
            db.execute(text("ALTER TABLE public.gauge_tracker ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'requested'"))
            db.execute(text("ALTER TABLE public.gauge_tracker ADD COLUMN IF NOT EXISTS accepted_by VARCHAR(100)"))
            db.execute(text("ALTER TABLE public.gauge_tracker ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ"))
        except Exception:
            pass

        # Fetch equipment details
        eq = db.execute(text(
            """
            SELECT gauge_id, name_of_the_equipment, idfn_no, location, make_model
            FROM public.equipment_used_for_calibration
            WHERE gauge_id = :gid
            """
        ), {"gid": payload.gauge_id}).mappings().first()
        if eq:
            db.execute(text(
                """
                INSERT INTO public.gauge_tracker (
                  gauge_id, name_of_the_equipment, idfn_no, location, make_model, quantity, requested_by
                ) VALUES (
                  :gauge_id, :name_of_the_equipment, :idfn_no, :location, :make_model, :quantity, :requested_by
                )
                """
            ), {
                "gauge_id": eq["gauge_id"],
                "name_of_the_equipment": eq["name_of_the_equipment"],
                "idfn_no": eq["idfn_no"],
                "location": eq.get("location"),
                "make_model": eq.get("make_model"),
                "quantity": max(1, int(payload.quantity or 1)),
                "requested_by": payload.requested_by,
            })
            db.commit()
    except Exception:
        # Do not fail the original request if mirroring fails
        db.rollback()

    return {"success": True, "id": int(new_request_id) if new_request_id is not None else 0}


# Gauge Tracker
@app.get("/gauge-tracker", response_model=list[schemas.GaugeTrackPublic])
def list_gauge_tracks(
    limit: int = 100,
    offset: int = 0,
    requested_by: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    name: str | None = None,
    sort_by: str | None = None,
    sort_dir: str | None = None,
    db: Session = Depends(get_db),
    response: Response = None,
):
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    # Requests table to persist operator requests
    db.execute(text(
        """
        CREATE TABLE IF NOT EXISTS public.gauge_requests (
          id SERIAL PRIMARY KEY,
          gauge_id INTEGER NOT NULL,
          requested_by VARCHAR(100),
          requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          status VARCHAR(20) NOT NULL DEFAULT 'requested',
          accepted_by VARCHAR(100),
          accepted_at TIMESTAMPTZ,
          returned_by VARCHAR(100),
          returned_at TIMESTAMPTZ,
          purpose TEXT,
          return_status VARCHAR(50),
          return_remarks TEXT
        )
        """
    ))
    # Build rows by joining equipment for display and current holder from existing gauge_tracker
    # Ensure return columns exist for consistent SELECT
    try:
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS purpose TEXT"))
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS returned_by VARCHAR(100)"))
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ"))
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS return_status VARCHAR(50)"))
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS return_remarks TEXT"))
    except Exception:
        pass
    where_clauses = []
    params = {"limit": limit, "offset": offset}
    if requested_by:
        where_clauses.append("gr.requested_by ILIKE :rb")
        params["rb"] = requested_by
    # Date range on requested_at (inclusive)
    if from_date:
        where_clauses.append("gr.requested_at::date >= :from_date")
        params["from_date"] = from_date
    if to_date:
        where_clauses.append("gr.requested_at::date <= :to_date")
        params["to_date"] = to_date
    # Equipment name contains filter
    if name:
        where_clauses.append("e.name_of_the_equipment ILIKE :ename")
        params["ename"] = f"%{name}%"
    where = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    # Sorting (map to selected fields or COALESCE)
    gt_allowed = {
        "id": "gr.id",
        "gauge_id": "gr.gauge_id",
        "requested_at": "gr.requested_at",
        "status": "gr.status",
        "accepted_at": "COALESCE(gt.issued_at, gr.accepted_at)",
        "returned_at": "gr.returned_at",
        "name": "e.name_of_the_equipment",
        "idfn_no": "e.idfn_no",
    }
    if sort_by:
        gt_col = gt_allowed.get((sort_by or "").lower(), "gr.id")
        gt_dir = "DESC" if (sort_dir or "").lower() == "desc" else "ASC"
        gt_order = f"{gt_col} {gt_dir}"
    else:
        # Default: most recent first
        gt_order = "gr.requested_at DESC"

    sql = text(
        f"""
        SELECT 
          gr.id,
          gr.gauge_id,
          e.name_of_the_equipment,
          e.idfn_no,
          e.location,
          e.make_model,
          1 AS quantity,
          gr.requested_by,
          gr.requested_at,
          gr.status,
          CASE WHEN gt.issued_to IS NOT NULL AND gt.returned_at IS NULL THEN u.username ELSE gr.accepted_by END AS accepted_by,
          CASE WHEN gt.issued_to IS NOT NULL AND gt.returned_at IS NULL THEN gt.issued_at ELSE gr.accepted_at END AS accepted_at,
          gr.returned_by,
          gr.returned_at,
          gr.purpose,
          gr.return_status,
          gr.return_remarks,
          (
            SELECT ARRAY(
              SELECT gr2.label FROM public.gauge_ranges gr2
              WHERE gr2.gauge_id = e.gauge_id
              ORDER BY gr2.label ASC
            )
          ) AS ranges
        FROM public.gauge_requests gr
        LEFT JOIN public.equipment_used_for_calibration e ON e.gauge_id = gr.gauge_id
        LEFT JOIN public.gauge_tracker gt ON gt.gauge_id = gr.gauge_id AND gt.returned_at IS NULL
        LEFT JOIN public.users u ON u.id = gt.issued_to
        {where}
        ORDER BY {gt_order}
        LIMIT :limit OFFSET :offset
        """
    )
    rows = db.execute(sql, params).mappings().all()
    total = None
    # Expose total via header for client-side pagination (primary source: gauge_requests)
    try:
        total_params = {}
        total_clauses = []
        join_e = False
        if requested_by:
            total_clauses.append("gr.requested_by ILIKE :rb")
            total_params["rb"] = requested_by
        if from_date:
            total_clauses.append("gr.requested_at::date >= :from_date")
            total_params["from_date"] = from_date
        if to_date:
            total_clauses.append("gr.requested_at::date <= :to_date")
            total_params["to_date"] = to_date
        if name:
            total_clauses.append("e.name_of_the_equipment ILIKE :ename")
            total_params["ename"] = f"%{name}%"
            join_e = True
        where_total = ("WHERE " + " AND ".join(total_clauses)) if total_clauses else ""
        if join_e:
            total_sql = text(
                f"""
                SELECT COUNT(1) AS total
                FROM public.gauge_requests gr
                LEFT JOIN public.equipment_used_for_calibration e ON e.gauge_id = gr.gauge_id
                {where_total}
                """
            )
        else:
            total_sql = text(
                f"""
                SELECT COUNT(1) AS total
                FROM public.gauge_requests gr
                {where_total}
                """
            )
        total_row = db.execute(total_sql, total_params).mappings().first()
        total = int(total_row["total"]) if total_row and total_row.get("total") is not None else len(rows)
    except Exception:
        total = len(rows)

    # Fallback: if no rows found in gauge_requests, read from legacy gauge_tracker for visibility
    if not rows:
        fb_clauses = []
        fb_params = {"limit": limit, "offset": offset}
        if requested_by:
            fb_clauses.append("gt.requested_by ILIKE :rb")
            fb_params["rb"] = requested_by
        if from_date:
            fb_clauses.append("gt.requested_at::date >= :from_date")
            fb_params["from_date"] = from_date
        if to_date:
            fb_clauses.append("gt.requested_at::date <= :to_date")
            fb_params["to_date"] = to_date
        if name:
            fb_clauses.append("e.name_of_the_equipment ILIKE :ename")
            fb_params["ename"] = f"%{name}%"
        fb_where = ("WHERE " + " AND ".join(fb_clauses)) if fb_clauses else ""
        # Build fallback order by using gt/e columns
        if sort_by:
            fb_allowed = {
                "id": "gt.transaction_id",
                "gauge_id": "gt.gauge_id",
                "requested_at": "gt.requested_at",
                "status": "gt.status",
                "accepted_at": "gt.issued_at",
                "returned_at": "gt.returned_at",
                "name": "e.name_of_the_equipment",
                "idfn_no": "e.idfn_no",
            }
            fb_col = fb_allowed.get((sort_by or "").lower(), "gt.requested_at")
            fb_dir = "DESC" if (sort_dir or "").lower() == "desc" else "ASC"
            fb_order = f"{fb_col} {fb_dir}"
        else:
            fb_order = "gt.requested_at DESC"
        # Fixed: gt.id -> gt.transaction_id AS id to match schema
        fb_sql = text(
            f"""
            SELECT
              gt.transaction_id AS id,
              gt.gauge_id,
              e.name_of_the_equipment,
              e.idfn_no,
              e.location,
              e.make_model,
              COALESCE(gt.quantity, 1) AS quantity,
              gt.requested_by,
              gt.requested_at,
              CASE WHEN gt.returned_at IS NOT NULL THEN 'returned' ELSE 'accepted' END AS status,
              u.username AS accepted_by,
              gt.issued_at AS accepted_at,
              NULL::varchar as returned_by,
              gt.returned_at,
              NULL::text as purpose,
              NULL::varchar as return_status,
              NULL::text as return_remarks,
              (
                SELECT ARRAY(
                  SELECT gr2.label FROM public.gauge_ranges gr2
                  WHERE gr2.gauge_id = e.gauge_id
                  ORDER BY gr2.label ASC
                )
              ) AS ranges
            FROM public.gauge_tracker gt
            LEFT JOIN public.equipment_used_for_calibration e ON e.gauge_id = gt.gauge_id
            LEFT JOIN public.users u ON u.id = gt.issued_to
            {fb_where}
            ORDER BY {fb_order}
            LIMIT :limit OFFSET :offset
            """
        )
        try:
            rows = db.execute(fb_sql, fb_params).mappings().all()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"gauge-tracker fallback query failed: {str(e)}")
        # Fallback total
        try:
            total_params2 = {}
            if requested_by:
                total_params2["rb"] = requested_by
            if from_date:
                total_params2["from_date"] = from_date
            if to_date:
                total_params2["to_date"] = to_date
            if name:
                total_params2["ename"] = f"%{name}%"
            fb_total_sql = text(
                f"""
                SELECT COUNT(1) AS total
                FROM public.gauge_tracker gt
                LEFT JOIN public.equipment_used_for_calibration e ON e.gauge_id = gt.gauge_id
                {fb_where}
                """
            )
            total_row2 = db.execute(fb_total_sql, total_params2).mappings().first()
            total = int(total_row2["total"]) if total_row2 and total_row2.get("total") is not None else len(rows)
        except Exception:
            total = len(rows)

    try:
        if response is not None:
            response.headers["X-Total-Count"] = str(total if total is not None else len(rows))
    except Exception:
        pass
    return list(rows)


@app.post("/gauge-tracker", response_model=schemas.GaugeTrackPublic, status_code=status.HTTP_201_CREATED)
def create_gauge_track(payload: schemas.GaugeTrackCreate, db: Session = Depends(get_db)):
    # Ensure persistence table exists
    db.execute(text(
        """
        CREATE TABLE IF NOT EXISTS public.gauge_requests (
          id SERIAL PRIMARY KEY,
          gauge_id INTEGER NOT NULL,
          requested_by VARCHAR(100),
          requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          status VARCHAR(20) NOT NULL DEFAULT 'requested',
          accepted_by VARCHAR(100),
          accepted_at TIMESTAMPTZ,
          returned_by VARCHAR(100),
          returned_at TIMESTAMPTZ,
          purpose TEXT,
          return_status VARCHAR(50),
          return_remarks TEXT
        )
        """
    ))
    # Ensure purpose and returned_at columns exist before we query on it
    try:
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS purpose TEXT"))
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ"))
    except Exception:
        pass
    data = payload.model_dump()
    # Block if an accepted request exists and not returned
    active = db.execute(text(
        """
        SELECT 1 FROM public.gauge_requests
        WHERE gauge_id = :gid AND status = 'accepted' AND returned_at IS NULL
        LIMIT 1
        """
    ), {"gid": payload.gauge_id}).first()
    if active:
        raise HTTPException(status_code=400, detail="Tool currently issued and not yet returned")

    rec = db.execute(
        text(
            """
            INSERT INTO public.gauge_requests (gauge_id, requested_by, requested_at, status, purpose)
            VALUES (:gauge_id, :requested_by, NOW(), 'requested', :purpose)
            RETURNING id
        """
        ), data).mappings().first()
    if not rec:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to create request")
    db.commit()
    # Return a row-shaped payload by reusing list query for that id
    row = db.execute(text(
        """
        SELECT 
          gr.id,
          gr.gauge_id,
          e.name_of_the_equipment,
          e.idfn_no,
          e.location,
          e.make_model,
          1 AS quantity,
          gr.requested_by,
          gr.requested_at,
          gr.status,
          NULL::varchar as accepted_by,
          NULL::timestamptz as accepted_at,
          gr.purpose,
          (
            SELECT ARRAY(
              SELECT gr2.label FROM public.gauge_ranges gr2
              WHERE gr2.gauge_id = e.gauge_id
              ORDER BY gr2.label ASC
            )
          ) AS ranges
        FROM public.gauge_requests gr
        LEFT JOIN public.equipment_used_for_calibration e ON e.gauge_id = gr.gauge_id
        WHERE gr.id = :id
        """
    ), {"id": rec["id"]}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Created request not found")
    return row


@app.post("/gauge-tracker/{track_id}/accept", response_model=schemas.GaugeTrackPublic)
def accept_gauge_track(track_id: int, payload: schemas.GaugeTrackAction, db: Session = Depends(get_db)):
    req = db.execute(text("SELECT * FROM public.gauge_requests WHERE id = :id"), {"id": track_id}).mappings().first()
    if not req:
        raise HTTPException(status_code=404, detail="Tracker record not found")
    # Block if gauge already issued to someone (holder in legacy table)
    holder = db.execute(text(
        """
        SELECT u.username AS holder, gt.issued_at
        FROM public.gauge_tracker gt
        LEFT JOIN public.users u ON u.id = gt.issued_to
        WHERE gt.gauge_id = :gid AND gt.returned_at IS NULL
        LIMIT 1
        """
    ), {"gid": req["gauge_id"]}).mappings().first()
    if holder and holder.get("holder"):
        raise HTTPException(status_code=400, detail=f"Already taken by {holder.get('holder')}")
    accepted_by = (payload.accepted_by or "").strip() or "operator"
    # Do not accept if already rejected or accepted
    if (req.get("status") or "").lower() in ("accepted", "rejected", "returned"):
        raise HTTPException(status_code=400, detail="Action not allowed for this status")
    # Accept the selected request
    db.execute(text(
        """
        UPDATE public.gauge_requests
        SET status = 'accepted', accepted_by = :accepted_by, accepted_at = NOW()
        WHERE id = :id
        """
    ), {"id": track_id, "accepted_by": accepted_by})
    # Auto-reject all other pending requests for the same tool
    try:
        db.execute(text(
            """
            UPDATE public.gauge_requests
            SET status = 'rejected', accepted_by = :accepted_by, accepted_at = NOW()
            WHERE gauge_id = :gid AND id <> :id AND status = 'requested'
            """
        ), {"gid": req["gauge_id"], "id": track_id, "accepted_by": accepted_by})
    except Exception:
        pass
    db.commit()
    return list_gauge_tracks(limit=1, offset=0, db=db)[0]


# QR Code by IDFN -> payload includes details and a report download URL
@app.get("/qrcode/by-idfn/{idfn}.png")
def qrcode_by_idfn_png(idfn: str, request: Request, db: Session = Depends(get_db)):
    row = db.execute(text(
        """
        SELECT e.gauge_id, e.idfn_no, e.date_of_last_calibration, e.calibration_due, cr.object_key
        FROM public.equipment_used_for_calibration e
        LEFT JOIN public.calibration_reports cr ON cr.gauge_id = e.gauge_id
        WHERE TRIM(LOWER(e.idfn_no)) = TRIM(LOWER(:idfn))
        LIMIT 1
        """
    ), {"idfn": idfn}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="IDFN not found")

    def fmt(d):
        if not d:
            return ""
        try:
            from datetime import date, datetime as _dt
            if isinstance(d, (date, _dt)):
                return d.strftime("%Y-%m-%d")
        except Exception:
            pass
        return str(d)

    base = os.getenv("APP_BASE_URL") or str(request.base_url).rstrip("/")
    preview_url = f"{base}/label-preview/{idfn}"
    # Encode the preview URL so scanners show the label preview page
    payload = preview_url

    # Build QR
    qr = qrcode.QRCode(version=1, box_size=10, border=2)
    qr.add_data(payload)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGB")

    # Compose final label with bottom texts (IDFN, Last, Due)
    from PIL import Image, ImageDraw, ImageFont
    qr_w, qr_h = qr_img.size  # typically box_size * modules
    # Reserve only bottom area for three rows of text
    side_w = 0
    bottom_h = int(qr_h * 0.42)  # larger bottom to fit 3 lines
    canvas_w = qr_w
    canvas_h = qr_h + bottom_h
    canvas = Image.new("RGB", (canvas_w, canvas_h), color="white")

    # Paste QR at top
    canvas.paste(qr_img, (0, 0))

    # Prepare text strings in dd/mm/YYYY
    def fmt_dmy(d):
        try:
            from datetime import datetime as _dt, date as _date
            if isinstance(d, str):
                # Try common formats
                for f in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d", "%m/%d/%Y"):
                    try:
                        return _dt.strptime(d[:10], f).strftime("%d/%m/%Y")
                    except ValueError:
                        pass
                return d
            if hasattr(d, 'strftime'):
                return d.strftime("%d/%m/%Y")
        except Exception:
            pass
        return str(d) if d else "—"

    last_txt = f"Last: {fmt_dmy(row.get('date_of_last_calibration'))}" if row.get('date_of_last_calibration') else "Last: —"
    due_txt = f"Due: {fmt_dmy(row.get('calibration_due'))}" if row.get('calibration_due') else "Due: —"
    idfn_txt = f"IDFN: {str(row.get('idfn_no') or '')}"

    try:
        draw = ImageDraw.Draw(canvas)
        try:
            font_small = ImageFont.truetype("arial.ttf", size=max(12, qr_w // 24))
            font_text = ImageFont.truetype("arial.ttf", size=max(13, qr_w // 18))
        except Exception:
            font_small = ImageFont.load_default()
            font_text = ImageFont.load_default()

        # Helper for text size
        def text_size(drw, text, font):
            try:
                l, t, r, b = drw.textbbox((0, 0), text, font=font)
                return (r - l), (b - t)
            except Exception:
                return drw.textsize(text, font=font)

        # Bottom texts stacked under QR: IDFN, Last, Due (center-aligned)
        line_gap = max(6, qr_w // 32)
        y = qr_h + max(6, qr_w // 28)

        def draw_line(t):
            nonlocal y
            tw, th = text_size(draw, t, font_text)
            x = (canvas_w - tw) // 2
            draw.text((x, y), t, fill=(0, 0, 0), font=font_text)
            y += th + line_gap

        draw_line(idfn_txt)
        draw_line(last_txt)
        draw_line(due_txt)

        # Ensure final image is square by padding with white background as needed
        if canvas_w != canvas_h:
            side = max(canvas_w, canvas_h)
            square = Image.new("RGB", (side, side), color="white")
            offset = ((side - canvas_w) // 2, (side - canvas_h) // 2)
            square.paste(canvas, offset)
            out_img = square
        else:
            out_img = canvas

        buf = io.BytesIO()
        out_img.save(buf, format="PNG")
        buf.seek(0)
        return StreamingResponse(buf, media_type="image/png")
    except Exception:
        # Fallback to plain QR if composition fails
        fb = io.BytesIO()
        qr_img.save(fb, format="PNG")
        fb.seek(0)
        return StreamingResponse(fb, media_type="image/png")


# Label Preview Page - shows when QR code is scanned
@app.get("/label-preview/{idfn}")
def label_preview(idfn: str, request: Request, db: Session = Depends(get_db)):
    """HTML preview page that shows when QR code is scanned with Google Lens/scanner"""
    row = db.execute(text(
        """
        SELECT e.gauge_id, e.idfn_no, e.name_of_the_equipment, e.location, e.make_model,
               e.date_of_last_calibration, e.calibration_due, e.overall_measurement_uncertainty,
               e.calibration_freq_months, e.pcr_number,
               (
                 SELECT ARRAY(
                   SELECT gr.label FROM public.gauge_ranges gr
                   WHERE gr.gauge_id = e.gauge_id
                   ORDER BY gr.label ASC
                 )
               ) AS ranges
        FROM public.equipment_used_for_calibration e
        WHERE TRIM(LOWER(e.idfn_no)) = TRIM(LOWER(:idfn))
        LIMIT 1
        """
    ), {"idfn": idfn}).mappings().first()
    
    if not row:
        html = f"""
        <!DOCTYPE html>
        <html>
        <head><title>Label Not Found</title></head>
        <body>
            <h1>Label Not Found</h1>
            <p>IDFN: {idfn} not found in the system.</p>
        </body>
        </html>
        """
        return HTMLResponse(content=html)
    
    def fmt_date(d):
        if not d:
            return "N/A"
        try:
            from datetime import datetime
            if isinstance(d, datetime):
                return d.strftime("%d/%m/%Y")
        except Exception:
            pass
        return str(d)
    
    ranges_list = row.get('ranges') or []
    ranges_html = ", ".join([str(r) for r in ranges_list]) if ranges_list else "N/A"
    
    base = os.getenv("APP_BASE_URL") or str(request.base_url).rstrip("/")
    report_url = f"{base}/reports/{row['gauge_id']}/download"
    
    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Label Preview - {}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {{
                font-family: Arial, sans-serif;
                max-width: 600px;
                margin: 20px auto;
                padding: 20px;
                background-color: #f5f5f5;
            }}
            .label-container {{
                background: white;
                border-radius: 10px;
                padding: 20px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }}
            .header {{
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 15px;
                border-radius: 8px;
                margin-bottom: 20px;
            }}
            .header h1 {{
                margin: 0;
                font-size: 24px;
            }}
            .field {{
                margin-bottom: 15px;
            }}
            .field-label {{
                font-weight: bold;
                color: #333;
                margin-bottom: 5px;
            }}
            .field-value {{
                color: #555;
                font-size: 16px;
            }}
            .status {{
                display: inline-block;
                padding: 5px 10px;
                border-radius: 5px;
                font-weight: bold;
            }}
            .status-due {{
                background-color: #fff3cd;
                color: #856404;
            }}
            .status-ok {{
                background-color: #d4edda;
                color: #155724;
            }}
            .download-btn {{
                display: inline-block;
                background: #28a745;
                color: white;
                padding: 12px 24px;
                text-decoration: none;
                border-radius: 5px;
                margin-top: 20px;
                font-weight: bold;
            }}
            .download-btn:hover {{
                background: #218838;
            }}
        </style>
    </head>
    <body>
        <div class="label-container">
            <div class="header">
                <h1>Label Preview</h1>
            </div>
            
            <div class="field">
                <div class="field-label">IDFN Number:</div>
                <div class="field-value">{}</div>
            </div>
            
            <div class="field">
                <div class="field-label">Equipment Name:</div>
                <div class="field-value">{}</div>
            </div>
            
            <div class="field">
                <div class="field-label">Make/Model:</div>
                <div class="field-value">{}</div>
            </div>
            
            <div class="field">
                <div class="field-label">Location:</div>
                <div class="field-value">{}</div>
            </div>
            
            <div class="field">
                <div class="field-label">Ranges:</div>
                <div class="field-value">{}</div>
            </div>
            
            <div class="field">
                <div class="field-label">Last Calibration:</div>
                <div class="field-value">{}</div>
            </div>
            
            <div class="field">
                <div class="field-label">Next Due:</div>
                <div class="field-value">{}</div>
            </div>
            
            <div class="field">
                <div class="field-label">Measurement Uncertainty:</div>
                <div class="field-value">{}</div>
            </div>
            
            <div class="field">
                <div class="field-label">Calibration Frequency:</div>
                <div class="field-value">{} months</div>
            </div>
            
            <div class="field">
                <div class="field-label">PCR Number:</div>
                <div class="field-value">{}</div>
            </div>
            
            <a href="{}" class="download-btn">Download Calibration Report</a>
        </div>
    </body>
    </html>
    """.format(
        idfn,
        row.get('idfn_no', 'N/A'),
        row.get('name_of_the_equipment', 'N/A'),
        row.get('make_model', 'N/A'),
        row.get('location', 'N/A'),
        ranges_html,
        fmt_date(row.get('date_of_last_calibration')),
        fmt_date(row.get('calibration_due')),
        row.get('overall_measurement_uncertainty', 'N/A'),
        row.get('calibration_freq_months', 'N/A'),
        row.get('pcr_number', 'N/A'),
        report_url
    )
    
    return HTMLResponse(content=html)


# =========================
# Calibration Reports (MinIO)
# =========================

from minio import Minio  # already imported at top; this line is safe if optimizer removes dup
import os  # already imported at top; safe
from datetime import datetime as dt  # already imported at top; safe


def get_minio_client():
    endpoint = os.getenv("MINIO_ENDPOINT", "10.207.163.138:9000").replace("http://", "").replace("https://", "")
    access_key = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
    secret_key = os.getenv("MINIO_SECRET_KEY", "minioadmin")
    secure = os.getenv("MINIO_SECURE", "false").lower() == "true"
    return Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=secure)


def get_minio_bucket():
    # Default to 'reports' bucket unless overridden
    return os.getenv("MINIO_BUCKET", "reports")


def _build_minio_url(key: str) -> str:
    """Construct a public URL to the object in MinIO using path-style.
    If MINIO_PUBLIC_ENDPOINT is set, prefer it; else use MINIO_ENDPOINT.
    Scheme is decided from MINIO_SECURE.
    """
    endpoint = os.getenv("MINIO_PUBLIC_ENDPOINT") or os.getenv("MINIO_ENDPOINT", "127.0.0.1:9000")
    endpoint = endpoint.replace("http://", "").replace("https://", "")
    scheme = "https" if (os.getenv("MINIO_SECURE", "false").lower() == "true") else "http"
    bucket = get_minio_bucket()
    return f"{scheme}://{endpoint}/{bucket}/{key}"


def ensure_reports_table(db: Session):
    db.execute(text(
        """
        CREATE TABLE IF NOT EXISTS public.calibration_reports (
          gauge_id INTEGER PRIMARY KEY,
          idfn_no TEXT,
          object_key TEXT NOT NULL,
          updated_by TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    ))


# --------------
# Report storage
# --------------

def get_report_storage_mode() -> str:
    # 'minio' or 'local'
    return (os.getenv("REPORT_STORAGE", "minio") or "minio").strip().lower()


def get_report_storage_dir() -> str:
    # Base directory for local storage
    base = os.getenv("REPORT_STORAGE_DIR", "storage")
    return os.path.abspath(base)


@app.get("/reports")
def list_reports(
    limit: int = 200,
    offset: int = 0,
    q: str | None = None,
    sort_by: str | None = None,
    sort_dir: str | None = None,
    db: Session = Depends(get_db),
):
    ensure_reports_table(db)
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    where = ""
    params = {"limit": limit, "offset": offset}
    if q:
        where = "WHERE e.name_of_the_equipment ILIKE :qs OR e.idfn_no ILIKE :qs OR e.location ILIKE :qs"
        params["qs"] = f"%{q}%"
    # Sorting
    rep_allowed = {
        "gauge_id": "e.gauge_id",
        "name": "e.name_of_the_equipment",
        "name_of_the_equipment": "e.name_of_the_equipment",
        "idfn_no": "e.idfn_no",
        "location": "e.location",
        "date_of_last_calibration": "e.date_of_last_calibration",
        "calibration_due": "e.calibration_due",
        "calibration_freq_months": "e.calibration_freq_months",
        "updated_at": "r.updated_at",
    }
    rep_col = rep_allowed.get((sort_by or "").lower(), "e.gauge_id")
    rep_dir = "DESC" if (sort_dir or "").lower() == "desc" else "ASC"
    rep_order = f"{rep_col} {rep_dir}"

    sql = text(
        f"""
        SELECT 
          e.gauge_id,
          e.name_of_the_equipment,
          e.idfn_no,
          e.location,
          e.make_model,
          e.date_of_last_calibration,
          e.calibration_due,
          e.calibration_freq_months,
          r.object_key,
          r.updated_by,
          r.updated_at
        FROM public.equipment_used_for_calibration e
        LEFT JOIN public.calibration_reports r ON r.gauge_id = e.gauge_id
        {where}
        ORDER BY {rep_order}
        LIMIT :limit OFFSET :offset
        """
    )
    rows = db.execute(sql, params).mappings().all()
    # Compute total with same filter (based on equipment table)
    try:
        count_sql = text(
            f"""
            SELECT COUNT(1) AS total
            FROM public.equipment_used_for_calibration e
            {where}
            """
        )
        count_params = {}
        if "qs" in params:
            count_params["qs"] = params["qs"]
        total_row = db.execute(count_sql, count_params).mappings().first()
        total = int(total_row["total"]) if total_row and total_row.get("total") is not None else len(rows)
    except Exception:
        total = len(rows)
    return {"items": list(rows), "limit": limit, "offset": offset, "count": len(rows), "total": total}


def _allowed_ext(filename: str) -> str:
    name = (filename or "").lower()
    for ext in (".pdf", ".doc", ".docx", ".csv"):
        if name.endswith(ext):
            return ext.lstrip('.')
    raise HTTPException(status_code=400, detail="Unsupported file type. Allowed: pdf, doc, docx, csv")


@app.post("/reports/{gauge_id}")
async def upload_report(
    gauge_id: int,
    report: UploadFile = File(...),
    last_calibration_date: str = Form(...),
    calibration_freq_months: int = Form(...),
    updated_by: str | None = Form(None),
    db: Session = Depends(get_db),
):
    ensure_reports_table(db)
    eq = db.execute(text("SELECT idfn_no FROM public.equipment_used_for_calibration WHERE gauge_id = :gid"), {"gid": gauge_id}).mappings().first()
    if not eq:
        raise HTTPException(status_code=404, detail="Gauge not found")
    idfn = eq["idfn_no"]
    ext = _allowed_ext(report.filename or "")
    storage_mode = get_report_storage_mode()
    data = await report.read()

    object_key: str
    if storage_mode == "local":
        # Save to local filesystem
        base_dir = get_report_storage_dir()
        reports_dir = os.path.join(base_dir, "reports")
        try:
            os.makedirs(reports_dir, exist_ok=True)
        except Exception:
            pass
        fname = f"{idfn}.{ext}"
        fpath = os.path.join(reports_dir, fname)
        with open(fpath, "wb") as f:
            f.write(data)
        # Persist key with 'local/' prefix so readers know to use filesystem
        db_object_key = f"local/reports/{fname}"
    else:
        # Strict MinIO storage via MinioStorage helper
        storage = MinioStorage()
        object_key = f"{idfn}.{ext}"
        storage.put_report(object_key, data, report.content_type or "application/octet-stream")
        # Store a fully-qualified URL in DB so the frontend can use it directly
        db_object_key = _build_minio_url(object_key)

    # compute due
    due = None
    try:
        if last_calibration_date and calibration_freq_months is not None:
            d = dt.strptime(last_calibration_date, "%Y-%m-%d").date()
            months = int(calibration_freq_months)
            y = d.year + (d.month - 1 + months) // 12
            m = (d.month - 1 + months) % 12 + 1
            import calendar
            last_day = calendar.monthrange(y, m)[1]
            day = min(d.day, last_day)
            due = dt(year=y, month=m, day=day).date().isoformat()
    except Exception:
        pass

    db.execute(text(
        """
        UPDATE public.equipment_used_for_calibration
        SET date_of_last_calibration = CAST(:last AS DATE),
            calibration_freq_months = CAST(:freq AS INTEGER),
            calibration_due = CAST(:due AS DATE)
        WHERE gauge_id = :gid
        """
    ), {"last": last_calibration_date, "freq": calibration_freq_months, "due": due, "gid": gauge_id})

    db.execute(text(
        """
        INSERT INTO public.calibration_reports (gauge_id, idfn_no, object_key, updated_by)
        VALUES (:gid, :idfn, :okey, :user)
        ON CONFLICT (gauge_id) DO UPDATE
          SET idfn_no = EXCLUDED.idfn_no,
              object_key = EXCLUDED.object_key,
              updated_by = EXCLUDED.updated_by,
              updated_at = NOW()
        """
    ), {"gid": gauge_id, "idfn": idfn, "okey": db_object_key, "user": updated_by})
    db.commit()
    return {"success": True, "object_key": object_key}


def _object_response(bucket: str, object_key: str, inline: bool):
    # If DB stored a full URL, try to fetch bytes from MinIO so we can control Content-Disposition
    if object_key.startswith("http://") or object_key.startswith("https://"):
        try:
            from urllib.parse import urlparse
            parsed = urlparse(object_key)
            path = (parsed.path or "/").lstrip("/")
            # Path is typically '<bucket>/<key>'
            parts = path.split("/", 1)
            key_from_url = parts[1] if len(parts) == 2 else (parts[0] if parts else object_key)
            storage = MinioStorage()
            storage.stat(key_from_url)
            data = storage.get_bytes(key_from_url)
            object_key = key_from_url  # use for content-type and filename detection below
        except Exception:
            # Fall back to redirect if parsing/fetching fails
            return RedirectResponse(object_key, status_code=302)
    # Serve from local storage if the key indicates local or storage mode is local
    if object_key.startswith("local/") or get_report_storage_mode() == "local":
        base_dir = get_report_storage_dir()
        # If key is prefixed with 'local/', drop it; otherwise use the key as-is (e.g., 'reports/IDFN.pdf')
        rel = object_key[len("local/"):] if object_key.startswith("local/") else object_key
        fpath = os.path.join(base_dir, rel)
        if not os.path.isfile(fpath):
            raise HTTPException(status_code=404, detail="Report file not found")
        try:
            with open(fpath, "rb") as f:
                data = f.read()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to read report: {str(e)}")
    else:
        storage = MinioStorage()
        # Ensure the object exists and fetch bytes
        storage.stat(object_key)
        data = storage.get_bytes(object_key)

    ctype = "application/octet-stream"
    if object_key.endswith(".pdf"): ctype = "application/pdf"
    elif object_key.endswith(".csv"): ctype = "text/csv"
    elif object_key.endswith(".doc"): ctype = "application/msword"
    elif object_key.endswith(".docx"): ctype = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    headers = {"Content-Type": ctype}
    if inline:
        headers["Content-Disposition"] = f"inline; filename={os.path.basename(object_key)}"
    else:
        headers["Content-Disposition"] = f"attachment; filename={os.path.basename(object_key)}"
    return StreamingResponse(io.BytesIO(data), headers=headers, media_type=ctype)


@app.get("/reports/{gauge_id}/view")
def view_report(gauge_id: int, db: Session = Depends(get_db)):
    ensure_reports_table(db)
    row = db.execute(text("SELECT object_key FROM public.calibration_reports WHERE gauge_id = :gid"), {"gid": gauge_id}).mappings().first()
    if not row or not row.get("object_key"):
        raise HTTPException(status_code=404, detail="Report not found")
    return _object_response(get_minio_bucket(), row["object_key"], inline=True)


@app.get("/reports/{gauge_id}/download")
def download_report(gauge_id: int, db: Session = Depends(get_db)):
    ensure_reports_table(db)
    row = db.execute(text("SELECT object_key FROM public.calibration_reports WHERE gauge_id = :gid"), {"gid": gauge_id}).mappings().first()
    if not row or not row.get("object_key"):
        raise HTTPException(status_code=404, detail="Report not found")
    return _object_response(get_minio_bucket(), row["object_key"], inline=False)


# Barcode: Code128 by IDFN -> payload "IDFN_LASTCAL_DUE"
@app.get("/barcode/code128/by-idfn/{idfn}.png")
def barcode_by_idfn_png(idfn: str, db: Session = Depends(get_db)):
    # Case-insensitive, trimmed match for IDFN
    row = db.execute(text(
        """
        SELECT idfn_no, date_of_last_calibration, calibration_due
        FROM public.equipment_used_for_calibration
        WHERE TRIM(LOWER(idfn_no)) = TRIM(LOWER(:idfn))
        LIMIT 1
        """
    ), {"idfn": idfn}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="IDFN not found")

    # Format dates as YYYY-MM-DD if present
    def fmt(d):
        if not d:
            return ""
        try:
            from datetime import date, datetime as _dt
            if isinstance(d, (date, _dt)):
                return d.strftime("%Y-%m-%d")
        except Exception:
            pass
        return str(d)

    payload = f"{row['idfn_no']}_{fmt(row.get('date_of_last_calibration'))}_{fmt(row.get('calibration_due'))}"
    buf = io.BytesIO()
    Code128(payload, writer=ImageWriter()).write(buf, options={"write_text": False})
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png")



# =========================
# Equipment Import (CSV/XLSX)
# =========================

EQUIPMENT_IMPORT_HEADERS = [
    "name_of_the_equipment",
    "location",
    "receipt_date",
    "make_model",
    "idfn_no",
    "overall_measurement_uncertainty",
    "calibration_freq_months",
    "date_of_last_calibration",
    "calibration_due",
    "pcr_number",
    "ranges",
]


def ensure_import_cache_table(db: Session):
    try:
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS public.import_payload_cache (
              id UUID PRIMARY KEY,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              kind TEXT NOT NULL,
              payload JSONB NOT NULL
            )
            """
        ))
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def ensure_equipment_pcr_unique_index(db: Session):
    try:
        db.execute(text(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind = 'i'
                  AND c.relname = 'uniq_equipment_pcr_nonnull'
                  AND n.nspname = 'public'
              ) THEN
                CREATE UNIQUE INDEX uniq_equipment_pcr_nonnull
                  ON public.equipment_used_for_calibration (pcr_number)
                  WHERE pcr_number IS NOT NULL;
              END IF;
            END$$;
            """
        ))
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def _is_sample_row(row: dict) -> bool:
    try:
        idfn = (row.get("idfn_no") or "").strip()
        name = (row.get("name_of_the_equipment") or "").strip()
        pcr_raw = row.get("pcr_number")
        pcr = None
        if pcr_raw is not None and str(pcr_raw).strip() != "":
            try:
                pcr = int(str(pcr_raw).strip())
            except Exception:
                pcr = None
        if idfn == "SAMPLE-DO-NOT-UPLOAD" or name == "EXAMPLE_ROW" or (pcr in {0, -1}):
            return True
    except Exception:
        pass
    return False


def _parse_ranges_cell(val: str | None) -> list[str] | None:
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    parts = [p.strip() for p in s.split(";")]
    parts = [p for p in parts if p]
    return parts or None


def _parse_date_flexible(v) -> str | None:
    # Accept: None/empty -> None, datetime/date objects, and common string formats
    if v is None:
        return None
    try:
        from datetime import date as _date, datetime as _dt
        if isinstance(v, _dt):
            return v.date().strftime("%Y-%m-%d")
        if isinstance(v, _date):
            return v.strftime("%Y-%m-%d")
    except Exception:
        pass
    s = str(v).strip()
    if not s:
        return None
    # If already YYYY-MM-DD
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return s
    # Try common alternatives
    from datetime import datetime as _dt2
    for fmt in ("%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%m-%d-%Y", "%Y/%m/%d"):
        try:
            return _dt2.strptime(s, fmt).strftime("%Y-%m-%d")
        except Exception:
            continue
    # As a last resort, try pandas-like parse if available (optional)
    try:
        import dateutil.parser as _du  # type: ignore
        dt = _du.parse(s, dayfirst=False, yearfirst=False)
        return dt.date().strftime("%Y-%m-%d")
    except Exception:
        pass
    raise ValueError("must be a valid date (YYYY-MM-DD or common formats like 1/1/2025)")


def _add_months(iso_date: str, months: int) -> str:
    y, m, d = [int(x) for x in iso_date.split("-")]
    y2 = y + (m - 1 + months) // 12
    m2 = (m - 1 + months) % 12 + 1
    last_day = calendar.monthrange(y2, m2)[1]
    d2 = min(d, last_day)
    return f"{y2:04d}-{m2:02d}-{d2:02d}"


def _normalize_and_validate_row(idx: int, row: dict) -> tuple[dict | None, list[str]]:
    errors: list[str] = []
    # required fields
    name = (row.get("name_of_the_equipment") or "").strip()
    if not name:
        errors.append("name_of_the_equipment is required")
    idfn = (row.get("idfn_no") or "").strip()
    if not idfn:
        errors.append("idfn_no is required")

    # optional strings
    loc = (row.get("location") or None)
    if isinstance(loc, str):
        loc = loc.strip() or None
    make_model = (row.get("make_model") or None)
    if isinstance(make_model, str):
        make_model = make_model.strip() or None
    omu = (row.get("overall_measurement_uncertainty") or None)
    if isinstance(omu, str):
        omu = omu.strip() or None

    # dates
    receipt_date = None
    try:
        receipt_date = _parse_date_flexible(row.get("receipt_date"))
    except Exception as e:
        errors.append(f"receipt_date {str(e)}")
    last_cal = None
    try:
        last_cal = _parse_date_flexible(row.get("date_of_last_calibration"))
    except Exception as e:
        errors.append(f"date_of_last_calibration {str(e)}")
    due = None
    if row.get("calibration_due") not in (None, ""):
        try:
            due = _parse_date_flexible(row.get("calibration_due"))
        except Exception as e:
            errors.append(f"calibration_due {str(e)}")

    # calibration_freq_months
    freq = None
    if row.get("calibration_freq_months") not in (None, ""):
        try:
            freq = int(str(row.get("calibration_freq_months")).strip())
            if freq < 1:
                raise ValueError()
        except Exception:
            errors.append("calibration_freq_months must be integer >= 1")

    # pcr_number
    pcr = None
    if row.get("pcr_number") not in (None, ""):
        try:
            pcr = int(str(row.get("pcr_number")).strip())
        except Exception:
            errors.append("pcr_number must be an integer")

    # ranges
    ranges = _parse_ranges_cell(row.get("ranges"))

    # compute due if not provided
    if due is None:
        if last_cal and (freq is not None):
            try:
                due = _add_months(last_cal, freq)
            except Exception:
                pass
        elif freq is not None:
            try:
                from datetime import date as _date
                today = _date.today().strftime("%Y-%m-%d")
                due = _add_months(today, freq)
            except Exception:
                pass

    normalized = {
        "name_of_the_equipment": name,
        "location": loc,
        "receipt_date": receipt_date,
        "make_model": make_model,
        "idfn_no": idfn,
        "overall_measurement_uncertainty": omu,
        "calibration_freq_months": freq,
        "date_of_last_calibration": last_cal,
        "calibration_due": due,
        "pcr_number": pcr,
        "ranges": ranges,
        "_row_index": idx,
    }
    return (normalized if not errors else None), errors


def _read_csv_bytes(data: bytes) -> list[dict]:
    text = data.decode("utf-8-sig")
    reader = csv.DictReader(_io.StringIO(text))
    return list(reader)


@app.get("/api/equipment/import/template.csv")
def equipment_template_csv():
    output = _io.StringIO()
    writer = csv.writer(output)
    writer.writerow(EQUIPMENT_IMPORT_HEADERS)
    writer.writerow([
        "Pressure Gauge",
        "Workshop A",
        "2024-01-15",
        "Model-X",
        "SAMPLE-DO-NOT-UPLOAD",
        "±0.5%",
        "12",
        "2024-01-15",
        "2025-01-15",
        "0",
        "0–100 PSI;0–10 bar",
    ])
    buf = output.getvalue().encode("utf-8")
    headers = {
        "Content-Disposition": "attachment; filename=equipment_template.csv",
        "Content-Type": "text/csv; charset=utf-8",
    }
    return StreamingResponse(_io.BytesIO(buf), headers=headers, media_type="text/csv")


@app.get("/api/equipment/import/template.xlsx")
def equipment_template_xlsx():
    # Optional: generate Excel if openpyxl is available; otherwise instruct to use CSV
    try:
        import openpyxl  # type: ignore
        from openpyxl import Workbook  # type: ignore
    except Exception:
        raise HTTPException(status_code=501, detail="Excel generation not available. Please use the CSV template endpoint.")
    wb = Workbook()
    ws = wb.active
    ws.title = "EquipmentTemplate"
    ws.append(EQUIPMENT_IMPORT_HEADERS)
    ws.append([
        "Pressure Gauge",
        "Workshop A",
        "2024-01-15",
        "Model-X",
        "SAMPLE-DO-NOT-UPLOAD",
        "±0.5%",
        12,
        "2024-01-15",
        "2025-01-15",
        0,
        "0–100 PSI;0–10 bar",
    ])
    # Optional instructions sheet
    ins = wb.create_sheet("Instructions")
    ins.append(["Instructions"])
    ins.append(["Required: name_of_the_equipment, idfn_no."])
    ins.append(["Dates must be YYYY-MM-DD."])
    ins.append(["Example row is skipped automatically on upload."])
    ins.append(["ranges is semicolon-separated values."])
    tmp = _io.BytesIO()
    wb.save(tmp)
    tmp.seek(0)
    headers = {"Content-Disposition": "attachment; filename=equipment_template.xlsx"}
    return StreamingResponse(tmp, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)


@app.post("/api/equipment/import/validate")
async def equipment_import_validate(file: UploadFile = File(...), db: Session = Depends(get_db)):
    ensure_equipment_pcr_unique_index(db)
    ensure_import_cache_table(db)
    name = (file.filename or "").lower()
    ext = None
    for e in (".xlsx", ".csv"):
        if name.endswith(e):
            ext = e
            break
    if not ext:
        raise HTTPException(status_code=400, detail="Unsupported file type. Allowed: .xlsx, .csv")

    raw = await file.read()
    rows: list[dict]
    if ext == ".csv":
        try:
            rows = _read_csv_bytes(raw)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse CSV: {str(e)}")
    else:
        # Excel optional
        try:
            import openpyxl  # type: ignore
        except Exception:
            raise HTTPException(status_code=400, detail="Excel parsing not available. Please upload CSV.")
        try:
            from openpyxl import load_workbook  # type: ignore
            wb = load_workbook(_io.BytesIO(raw))
            ws = wb.active
            headers = [str(c.value).strip() if c.value is not None else "" for c in next(ws.iter_rows(min_row=1, max_row=1))[0:len(EQUIPMENT_IMPORT_HEADERS)]]
            # Fallback: read entire first row
            if not headers:
                headers = [str(c.value or "").strip() for c in ws[1]]
            data_rows = []
            for r in ws.iter_rows(min_row=2, values_only=True):
                data_rows.append({headers[i]: (r[i] if i < len(r) else None) for i in range(len(headers))})
            rows = data_rows
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse Excel: {str(e)}")

    # Header validation (order-insensitive)
    input_headers = set([h.strip() for h in (rows[0].keys() if rows else [])])
    expected_headers = set(EQUIPMENT_IMPORT_HEADERS)
    if rows and input_headers != expected_headers:
        return {
            "total_rows": 0,
            "valid_rows": 0,
            "invalid_rows": 0,
            "conflicts_count": 0,
            "errors": ["Headers do not match expected fields"],
            "row_errors": [],
            "conflicts": [],
            "parsed_payload_id": None,
        }

    # Iterate and validate
    valid: list[dict] = []
    row_errors: list[dict] = []
    skipped_sample = 0
    for i, r in enumerate(rows, start=2):  # 1-based header; so row index starts at 2
        if _is_sample_row(r):
            skipped_sample += 1
            continue
        normalized, errs = _normalize_and_validate_row(i, r)
        if errs:
            row_errors.append({"row_index": i, "message": "; ".join(errs)})
        elif normalized:
            valid.append(normalized)

    # Detect conflicts by pcr_number
    pcrs = [v["pcr_number"] for v in valid if v.get("pcr_number") is not None]
    conflicts: list[dict] = []
    if pcrs:
        placeholders = ",".join([f":p{i}" for i in range(len(pcrs))])
        params = {f"p{i}": p for i, p in enumerate(pcrs)}
        sql = text(f"SELECT gauge_id, name_of_the_equipment, idfn_no, calibration_freq_months, date_of_last_calibration, calibration_due, pcr_number FROM public.equipment_used_for_calibration WHERE pcr_number IN ({placeholders})")
        existing = {int(r["pcr_number"]): r for r in db.execute(sql, params).mappings().all()}
        for v in valid:
            p = v.get("pcr_number")
            if p is not None and int(p) in existing:
                conflicts.append({
                    "row_index": v["_row_index"],
                    "pcr_number": int(p),
                    "existingPreview": {
                        "name_of_the_equipment": existing[int(p)].get("name_of_the_equipment"),
                        "idfn_no": existing[int(p)].get("idfn_no"),
                        "calibration_freq_months": existing[int(p)].get("calibration_freq_months"),
                        "date_of_last_calibration": str(existing[int(p)].get("date_of_last_calibration") or ""),
                        "calibration_due": str(existing[int(p)].get("calibration_due") or ""),
                    },
                    "incomingPreview": {
                        "name_of_the_equipment": v.get("name_of_the_equipment"),
                        "idfn_no": v.get("idfn_no"),
                        "calibration_freq_months": v.get("calibration_freq_months"),
                        "date_of_last_calibration": v.get("date_of_last_calibration"),
                        "calibration_due": v.get("calibration_due"),
                    }
                })

    # Cache payload
    payload_id = str(uuid.uuid4())
    try:
        ensure_import_cache_table(db)
        db.execute(text("INSERT INTO public.import_payload_cache (id, kind, payload) VALUES (:id, :kind, CAST(:payload AS JSONB))"), {
            "id": payload_id,
            "kind": "equipment_import_validate",
            "payload": json.dumps({"valid": valid, "row_errors": row_errors})
        })
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass

    return {
        "total_rows": len(rows) - skipped_sample,
        "valid_rows": len(valid),
        "invalid_rows": len(row_errors),
        "conflicts_count": len(conflicts),
        "errors": [],
        "row_errors": row_errors,
        "conflicts": conflicts,
        "parsed_payload_id": payload_id,
    }



def ensure_audit_tables(db: Session):
    try:
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS public.audit_imports (
              id UUID PRIMARY KEY,
              user_name TEXT,
              file_name TEXT,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              created_count INTEGER NOT NULL DEFAULT 0,
              updated_count INTEGER NOT NULL DEFAULT 0,
              skipped_count INTEGER NOT NULL DEFAULT 0,
              error_count INTEGER NOT NULL DEFAULT 0
            )
            """
        ))
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS public.audit_import_rows (
              import_id UUID NOT NULL,
              row_index INTEGER NOT NULL,
              pcr_number BIGINT,
              action TEXT,
              message TEXT,
              previous_snapshot JSONB,
              new_snapshot JSONB
            )
            """
        ))
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def _sync_ranges(db: Session, gauge_id: int, ranges: list[str] | None):
    try:
        db.execute(text("CREATE TABLE IF NOT EXISTS public.gauge_ranges (id SERIAL PRIMARY KEY, gauge_id INTEGER NOT NULL, label TEXT NOT NULL)"))
    except Exception:
        pass
    db.execute(text("DELETE FROM public.gauge_ranges WHERE gauge_id = :gid"), {"gid": gauge_id})
    if ranges:
        for lbl in ranges:
            db.execute(text("INSERT INTO public.gauge_ranges (gauge_id, label) VALUES (:gid, :lbl)"), {"gid": gauge_id, "lbl": lbl})


@app.post("/api/equipment/import/commit")
def equipment_import_commit(
    payload: dict,
    db: Session = Depends(get_db),
    x_actor: str | None = Header(default=None, alias="X-Actor"),
):
    ensure_equipment_pcr_unique_index(db)
    ensure_import_cache_table(db)
    ensure_audit_tables(db)

    parsed_id = (payload.get("parsed_payload_id") or "").strip()
    if not parsed_id:
        raise HTTPException(status_code=400, detail="parsed_payload_id is required")
    decisions = payload.get("decisions") or []
    bulk = (payload.get("bulk") or {}).copy()  # { action: 'discard'|'override' }
    file_name = payload.get("file_name") or None
    actor = payload.get("actor") or x_actor or "admin"

    # TODO RBAC: validate actor has admin role when auth is available.

    row = db.execute(text("SELECT payload FROM public.import_payload_cache WHERE id = :id"), {"id": parsed_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Parsed payload not found or expired")
    cached = row["payload"] if isinstance(row["payload"], dict) else json.loads(row["payload"])
    valid_rows: list[dict] = cached.get("valid") or []

    # Build decision map
    decision_map: dict[int, str] = {}
    for d in decisions:
        try:
            idx = int(d.get("row_index"))
            act = (d.get("action") or "").lower()
            if act in ("discard", "override"):
                decision_map[idx] = act
        except Exception:
            continue
    bulk_action = (bulk.get("action") or "").lower()
    if bulk_action not in ("", "discard", "override"):
        bulk_action = ""

    # Prepare audit
    import_id = str(uuid.uuid4())
    created = updated = skipped = err_count = 0

    # Upsert loop in small batches
    for v in valid_rows:
        idx = int(v.get("_row_index"))
        act = decision_map.get(idx) or bulk_action or ""  # default: create if no conflict

        # Detect conflict by pcr_number
        p = v.get("pcr_number")
        existing = None
        if p is not None:
            existing = db.execute(text("SELECT * FROM public.equipment_used_for_calibration WHERE pcr_number = :p LIMIT 1"), {"p": int(p)}).mappings().first()

        # Treat 'discard' as cancel: no DB changes, no audit, no counters
        if act == "discard":
            continue

        try:
            # Compute final due if needed
            due = v.get("calibration_due")
            freq = v.get("calibration_freq_months")
            last = v.get("date_of_last_calibration")
            if not due:
                if last and (freq is not None):
                    due = _add_months(last, int(freq))
                elif freq is not None:
                    from datetime import date as _date
                    due = _add_months(_date.today().strftime("%Y-%m-%d"), int(freq))

            if existing is None:
                # INSERT new equipment
                res = db.execute(text(
                    """
                    INSERT INTO public.equipment_used_for_calibration (
                      name_of_the_equipment, location, receipt_date, make_model, idfn_no,
                      overall_measurement_uncertainty, calibration_freq_months, date_of_last_calibration,
                      calibration_due, pcr_number
                    ) VALUES (
                      :name, :loc, CAST(:receipt AS DATE), :mmodel, :idfn,
                      :omu, :freq, CAST(:last AS DATE), CAST(:due AS DATE), :pcr
                    ) RETURNING gauge_id
                    """
                ), {
                    "name": v.get("name_of_the_equipment"),
                    "loc": v.get("location"),
                    "receipt": v.get("receipt_date"),
                    "mmodel": v.get("make_model"),
                    "idfn": v.get("idfn_no"),
                    "omu": v.get("overall_measurement_uncertainty"),
                    "freq": v.get("calibration_freq_months"),
                    "last": v.get("date_of_last_calibration"),
                    "due": due,
                    "pcr": v.get("pcr_number"),
                })
                gid = int(res.fetchone()[0])
                _sync_ranges(db, gid, v.get("ranges"))
                created += 1
                db.execute(text(
                    "INSERT INTO public.audit_import_rows (import_id, row_index, pcr_number, action, message, previous_snapshot, new_snapshot) VALUES (:iid, :idx, :pcr, 'created', NULL, NULL, CAST(:new AS JSONB))"
                ), {"iid": import_id, "idx": idx, "pcr": v.get("pcr_number"), "new": json.dumps({k: v.get(k) for k in v if not k.startswith("_")})})
            else:
                if act != "override":
                    # treat as skip when conflict and no override
                    skipped += 1
                    db.execute(text(
                        "INSERT INTO public.audit_import_rows (import_id, row_index, pcr_number, action, message, previous_snapshot, new_snapshot) VALUES (:iid, :idx, :pcr, 'skipped', 'conflict without override', CAST(:prev AS JSONB), CAST(:new AS JSONB))"
                    ), {"iid": import_id, "idx": idx, "pcr": int(p), "prev": json.dumps(dict(existing), default=str), "new": json.dumps({k: v.get(k) for k in v if not k.startswith("_")})})
                else:
                    # UPDATE existing by pcr_number
                    db.execute(text(
                        """
                        UPDATE public.equipment_used_for_calibration
                        SET name_of_the_equipment = :name,
                            location = :loc,
                            receipt_date = CAST(:receipt AS DATE),
                            make_model = :mmodel,
                            idfn_no = :idfn,
                            overall_measurement_uncertainty = :omu,
                            calibration_freq_months = :freq,
                            date_of_last_calibration = CAST(:last AS DATE),
                            calibration_due = CAST(:due AS DATE)
                        WHERE pcr_number = :pcr
                        """
                    ), {
                        "name": v.get("name_of_the_equipment"),
                        "loc": v.get("location"),
                        "receipt": v.get("receipt_date"),
                        "mmodel": v.get("make_model"),
                        "idfn": v.get("idfn_no"),
                        "omu": v.get("overall_measurement_uncertainty"),
                        "freq": v.get("calibration_freq_months"),
                        "last": v.get("date_of_last_calibration"),
                        "due": due,
                        "pcr": int(p),
                    })
                    gid = int(existing.get("gauge_id"))
                    _sync_ranges(db, gid, v.get("ranges"))
                    updated += 1
                    db.execute(text(
                        "INSERT INTO public.audit_import_rows (import_id, row_index, pcr_number, action, message, previous_snapshot, new_snapshot) VALUES (:iid, :idx, :pcr, 'updated', NULL, CAST(:prev AS JSONB), CAST(:new AS JSONB))"
                    ), {"iid": import_id, "idx": idx, "pcr": int(p), "prev": json.dumps(dict(existing), default=str), "new": json.dumps({k: v.get(k) for k in v if not k.startswith("_")})})
        except IntegrityError as e:
            err_count += 1
            db.rollback()
            db.execute(text(
                "INSERT INTO public.audit_import_rows (import_id, row_index, pcr_number, action, message, previous_snapshot, new_snapshot) VALUES (:iid, :idx, :pcr, 'error', :msg, NULL, CAST(:new AS JSONB))"
            ), {"iid": import_id, "idx": idx, "pcr": v.get("pcr_number"), "msg": str(e), "new": json.dumps({k: v.get(k) for k in v if not k.startswith("_")})})
        except Exception as e:
            err_count += 1
            db.rollback()
            db.execute(text(
                "INSERT INTO public.audit_import_rows (import_id, row_index, pcr_number, action, message, previous_snapshot, new_snapshot) VALUES (:iid, :idx, :pcr, 'error', :msg, NULL, CAST(:new AS JSONB))"
            ), {"iid": import_id, "idx": idx, "pcr": v.get("pcr_number"), "msg": str(e), "new": json.dumps({k: v.get(k) for k in v if not k.startswith("_")})})

    # finalize audit summary
    db.execute(text(
        "INSERT INTO public.audit_imports (id, user_name, file_name, created_count, updated_count, skipped_count, error_count) VALUES (:id, :user, :file, :c, :u, :s, :e)"
    ), {"id": import_id, "user": actor, "file": file_name, "c": created, "u": updated, "s": skipped, "e": err_count})
    db.commit()

    return {"created": created, "updated": updated, "skipped": skipped, "errors": err_count, "audit_id": import_id}



@app.post("/gauge-tracker/{track_id}/reject", response_model=schemas.GaugeTrackPublic)
def reject_gauge_track(track_id: int, payload: schemas.GaugeTrackAction, db: Session = Depends(get_db)):
    req = db.execute(text("SELECT * FROM public.gauge_requests WHERE id = :id"), {"id": track_id}).mappings().first()
    if not req:
        raise HTTPException(status_code=404, detail="Tracker record not found")
    # Block if already accepted or rejected or returned
    if (req.get("status") or "").lower() in ("accepted", "rejected", "returned"):
        raise HTTPException(status_code=400, detail="Action not allowed for this status")
    actor = (payload.accepted_by or "").strip() or "admin"
    # Record who handled the rejection
    db.execute(text(
        """
        UPDATE public.gauge_requests
        SET status = 'rejected', accepted_by = :actor, accepted_at = NOW()
        WHERE id = :id
        """
    ), {"id": track_id, "actor": actor})
    db.commit()
    return list_gauge_tracks(limit=1, offset=0, db=db)[0]

@app.post("/gauge-tracker/{track_id}/return", response_model=schemas.GaugeTrackPublic)
def return_gauge_track(track_id: int, payload: schemas.GaugeTrackAction, db: Session = Depends(get_db)):
    req = db.execute(text("SELECT * FROM public.gauge_requests WHERE id = :id"), {"id": track_id}).mappings().first()
    if not req:
        raise HTTPException(status_code=404, detail="Tracker record not found")
    # Only allow return when accepted
    if (req.get("status") or "").lower() != "accepted":
        raise HTTPException(status_code=400, detail="Only accepted requests can be returned")
    # Ensure columns exist
    try:
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS returned_by VARCHAR(100)"))
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ"))
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS return_status VARCHAR(50)"))
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS return_remarks TEXT"))
    except Exception:
        pass
    # Prefer the actor provided; if missing, fall back to original requester, then a generic label
    returned_by = (payload.accepted_by or "").strip() or (req.get("requested_by") or "operator")
    # Normalize and validate return status and remarks
    rs = (payload.return_status or "").strip()
    rr = (payload.return_remarks or "").strip()
    # Map common typos/cases to standard values: Good, Bad, Needs Repair, or Custom
    rs_lower = rs.lower() if rs else ""
    if rs_lower in ("good condition", "good", "ok", "okay", "fine"):
        rs = "Good"
    elif rs_lower in ("bad", "damaged", "broken", "poor condition"):
        rs = "Bad"
    elif rs_lower in ("needs repair", "needs maintenance", "needs maintainance", "needs maintainace", "maintenance", "maintainance", "repair needed"):
        rs = "Needs Repair"
    elif rs_lower in ("custom", "other"):
        rs = "Custom"
    elif rs:
        # If it's not one of the standard values but provided, treat as Custom
        rs = "Custom"
    else:
        rs = None
    # If return_status is Custom or empty but remarks provided, set as Custom
    if not rs and rr:
        rs = "Custom"
    # Enforce remarks for Bad or Needs Repair
    if rs in ("Bad", "Needs Repair") and not rr:
        raise HTTPException(status_code=400, detail="Remarks are required for 'Bad' or 'Needs Repair' condition")
    # If Custom is selected, remarks are optional but recommended

    db.execute(text(
        """
        UPDATE public.gauge_requests
        SET status = 'returned', returned_by = :returned_by, returned_at = NOW(),
            return_status = :return_status, return_remarks = :return_remarks
        WHERE id = :id
        """
    ), {"id": track_id, "returned_by": returned_by, "return_status": rs, "return_remarks": rr if rr else None})
    db.commit()
    return list_gauge_tracks(limit=1, offset=0, db=db)[0]

    

# Analytics Routes

@app.get("/analytics/returns-rejects")

def get_returns_rejects_analytics(db: Session = Depends(get_db)):

    """Get analytics for returns and rejects"""

    try:

        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ"))

        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS return_status VARCHAR(50)"))

    except Exception:

        pass

    

    # Get returns and rejects counts

    result = db.execute(text("""

        SELECT 

            COUNT(*) FILTER (WHERE status = 'returned') as total_returns,

            COUNT(*) FILTER (WHERE status = 'rejected') as total_rejects,

            COUNT(*) FILTER (WHERE status = 'returned' AND return_status = 'Good') as returns_good,

            COUNT(*) FILTER (WHERE status = 'returned' AND return_status = 'Bad') as returns_bad,

            COUNT(*) FILTER (WHERE status = 'returned' AND return_status = 'Needs Repair') as returns_needs_repair,

            COUNT(*) FILTER (WHERE status = 'returned' AND return_status = 'Custom') as returns_custom,

            COUNT(*) FILTER (WHERE status = 'accepted') as total_accepted,

            COUNT(*) FILTER (WHERE status = 'requested') as total_requested

        FROM public.gauge_requests

    """)).mappings().first()

    

    # Get returns and rejects by month

    monthly_data = db.execute(text("""

        SELECT 

            DATE_TRUNC('month', requested_at) as month,

            COUNT(*) FILTER (WHERE status = 'returned') as returns,

            COUNT(*) FILTER (WHERE status = 'rejected') as rejects

        FROM public.gauge_requests

        WHERE status IN ('returned', 'rejected')

        GROUP BY DATE_TRUNC('month', requested_at)

        ORDER BY month DESC

        LIMIT 12

    """)).mappings().all()

    

    return {

        "summary": dict(result) if result else {},

        "monthly_trends": [dict(row) for row in monthly_data]

    }





@app.get("/analytics/most-used-tools")

def get_most_used_tools_analytics(limit: int = 10, db: Session = Depends(get_db)):

    """Get analytics for most used tools"""

    limit = max(1, min(limit, 100))

    

    result = db.execute(text("""

        SELECT 

            e.gauge_id,

            e.name_of_the_equipment,

            e.idfn_no,

            e.location,

            e.make_model,

            COUNT(gr.id) as request_count,

            COUNT(*) FILTER (WHERE gr.status = 'accepted') as accepted_count,

            COUNT(*) FILTER (WHERE gr.status = 'returned') as returned_count,

            COUNT(*) FILTER (WHERE gr.status = 'rejected') as rejected_count

        FROM public.gauge_requests gr

        JOIN public.equipment_used_for_calibration e ON e.gauge_id = gr.gauge_id

        GROUP BY e.gauge_id, e.name_of_the_equipment, e.idfn_no, e.location, e.make_model

        ORDER BY request_count DESC

        LIMIT :limit

    """), {"limit": limit}).mappings().all()

    

    return [dict(row) for row in result]





@app.get("/analytics/operator-analytics")

def get_operator_analytics(db: Session = Depends(get_db)):

    """Get analytics for operators"""

    # Get operator request statistics

    operator_stats = db.execute(text("""

        SELECT 

            requested_by as operator,

            COUNT(*) as total_requests,

            COUNT(*) FILTER (WHERE status = 'accepted') as accepted_requests,

            COUNT(*) FILTER (WHERE status = 'rejected') as rejected_requests,

            COUNT(*) FILTER (WHERE status = 'returned') as returned_requests,

            COUNT(*) FILTER (WHERE status = 'requested') as pending_requests

        FROM public.gauge_requests

        WHERE requested_by IS NOT NULL

        GROUP BY requested_by

        ORDER BY total_requests DESC

    """)).mappings().all()

    

    # Get operator acceptance/rejection rates

    operator_rates = db.execute(text("""

        SELECT 

            requested_by as operator,

            COUNT(*) as total,

            ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'accepted') / NULLIF(COUNT(*), 0), 2) as acceptance_rate,

            ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'rejected') / NULLIF(COUNT(*), 0), 2) as rejection_rate

        FROM public.gauge_requests

        WHERE requested_by IS NOT NULL AND status IN ('accepted', 'rejected')

        GROUP BY requested_by

        HAVING COUNT(*) > 0

        ORDER BY total DESC

    """)).mappings().all()

    

    # Get most active operators (by month)

    monthly_operators = db.execute(text("""

        SELECT 

            requested_by as operator,

            DATE_TRUNC('month', requested_at) as month,

            COUNT(*) as request_count

        FROM public.gauge_requests

        WHERE requested_by IS NOT NULL

        GROUP BY requested_by, DATE_TRUNC('month', requested_at)

        ORDER BY month DESC, request_count DESC

        LIMIT 20

    """)).mappings().all()

    

    return {

        "operator_stats": [dict(row) for row in operator_stats],

        "operator_rates": [dict(row) for row in operator_rates],

        "monthly_operators": [dict(row) for row in monthly_operators]

    }

# =========================
# Reports: Multi-file per report (MinIO/local)
# =========================

def ensure_reports_new_tables(db: Session):
    try:
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS public.reports (
              id SERIAL PRIMARY KEY,
              gauge_id INTEGER NOT NULL,
              title TEXT NOT NULL,
              notes TEXT,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        db.execute(text("""
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
        """))
        db.commit()
    except Exception:
        try: db.rollback()
        except Exception: pass

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

def _presign_get(bucket: str, object_key: str, expires_seconds: int = 900) -> str:
    try:
        client = _minio_client_from_env()
        from datetime import timedelta
        return client.presigned_get_object(bucket, object_key, expires=timedelta(seconds=expires_seconds))
    except Exception:
        try:
            return _build_minio_url(object_key)
        except Exception:
            return object_key

ALLOWED_REPORT_MIME = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/csv",
    "text/plain",
}
MAX_FILE_BYTES = 20 * 1024 * 1024

@app.post("/gauges/{gauge_id}/reports", status_code=201)
async def create_report_with_files(
    gauge_id: int,
    title: str = Form(...),
    notes: str = Form(""),
    files: list[UploadFile] = File([]),
    last_calibration_date: str | None = Form(None),
    calibration_freq_months: int | None = Form(None),
    db: Session = Depends(get_db),
):
    """Create a report row and attach multiple files. Optionally update equipment dates."""
    ensure_reports_new_tables(db)
    # Create parent report
    res = db.execute(text("""
        INSERT INTO public.reports (gauge_id, title, notes)
        VALUES (:gid, :title, :notes)
        RETURNING id
    """), {"gid": gauge_id, "title": title.strip(), "notes": (notes or "").strip()})
    report_id = int(res.fetchone()[0])

    # Optional equipment update (keeps legacy behavior)
    try:
        if last_calibration_date and calibration_freq_months is not None:
            d = dt.strptime(last_calibration_date, "%Y-%m-%d").date()
            months = int(calibration_freq_months)
            y = d.year + (d.month - 1 + months) // 12
            m = (d.month - 1 + months) % 12 + 1
            last_day = calendar.monthrange(y, m)[1]
            day = min(d.day, last_day)
            due = dt(year=y, month=m, day=day).date().isoformat()
            db.execute(text("""
                UPDATE public.equipment_used_for_calibration
                SET date_of_last_calibration = CAST(:last AS DATE),
                    calibration_freq_months = CAST(:freq AS INTEGER),
                    calibration_due = CAST(:due AS DATE)
                WHERE gauge_id = :gid
            """), {"last": last_calibration_date, "freq": calibration_freq_months, "due": due, "gid": gauge_id})
            db.commit()
    except Exception:
        try: db.rollback()
        except Exception: pass

    # Resolve gauge name and idfn for folder path construction
    eq = db.execute(text("SELECT idfn_no, name_of_the_equipment FROM public.equipment_used_for_calibration WHERE gauge_id = :gid"), {"gid": gauge_id}).mappings().first()
    gauge_name = (eq or {}).get("name_of_the_equipment") or "gauge"
    idfn_no = (eq or {}).get("idfn_no") or str(gauge_id)

    def _snake(s: str) -> str:
        import re as _re
        s = (s or "").strip().lower()
        s = _re.sub(r"\s+", "_", s)
        s = _re.sub(r"[^a-z0-9-_]", "_", s)
        s = _re.sub(r"_+", "_", s)
        return s or "folder"

    title_norm = _snake(title)
    # Use gauge_id-based path expected by UI (no extra 'reports' segment)
    gauge_key = f"reports/gauges/{gauge_id}"

    storage_mode = get_report_storage_mode()
    saved: list[dict] = []
    try:
        for up in files or []:
            if not up or not (up.filename or "").strip():
                continue
            ctype = (up.content_type or "").lower()
            if ctype not in ALLOWED_REPORT_MIME:
                raise HTTPException(status_code=415, detail=f"Unsupported type: {ctype}")
            data = await up.read()
            if data is None:
                data = b""
            if len(data) > MAX_FILE_BYTES:
                raise HTTPException(status_code=413, detail=f"File {up.filename} exceeds 20MB limit")

            # Use original filename under the structured folder path
            orig_name = up.filename or f"file_{uuid.uuid4().hex}"
            # Security: prevent traversal
            if ".." in orig_name or "/" in orig_name or "\\" in orig_name:
                orig_name = orig_name.split("/")[-1].split("\\")[-1]
            object_key = f"{gauge_key}/{title_norm}/{orig_name}"

            if storage_mode == "local":
                base_dir = get_report_storage_dir()
                out_dir = os.path.join(base_dir, "reports", f"gauges/{gauge_id}/reports/{report_id}")
                try: os.makedirs(out_dir, exist_ok=True)
                except Exception: pass
                fpath = os.path.join(out_dir, os.path.basename(object_key))
                with open(fpath, "wb") as f:
                    f.write(data)
                stored_key = f"local/reports/gauges/{gauge_id}/reports/{report_id}/{os.path.basename(object_key)}"
            else:
                storage = MinioStorage()
                storage.put_report(object_key, data, ctype or "application/octet-stream")
                stored_key = object_key

            db.execute(text("""
                INSERT INTO public.report_files (report_id, bucket, object_key, etag, size_bytes, content_type, original_name)
                VALUES (:rid, :bucket, :okey, :etag, :size, :ctype, :orig)
            """), {
                "rid": report_id,
                "bucket": os.getenv("MINIO_BUCKET", "reports"),
                "okey": stored_key if storage_mode == "local" else object_key,
                "etag": None,
                "size": len(data),
                "ctype": ctype,
                "orig": up.filename or "",
            })
            saved.append({
                "original_name": up.filename or "",
                "content_type": ctype,
                "size_bytes": len(data),
                "object_key": object_key,
            })
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to upload files: {str(e)}")

    # presign
    out = []
    bucket = os.getenv("MINIO_BUCKET", "reports")
    for s in saved:
        url = _presign_get(bucket, s["object_key"], 900)
        out.append({**s, "url": url})
    return {"report_id": report_id, "title": title, "notes": notes, "files": out}

@app.get("/gauges/{gauge_id}/reports/{report_id}/files")
def list_report_files(gauge_id: int, report_id: int, db: Session = Depends(get_db)):
    ensure_reports_new_tables(db)
    rpt = db.execute(text("SELECT id FROM public.reports WHERE id = :rid AND gauge_id = :gid"), {"rid": report_id, "gid": gauge_id}).mappings().first()
    if not rpt:
        raise HTTPException(status_code=404, detail="Report not found")
    rows = db.execute(text("SELECT id, object_key, content_type, size_bytes, original_name, uploaded_at FROM public.report_files WHERE report_id = :rid ORDER BY id"), {"rid": report_id}).mappings().all()
    bucket = os.getenv("MINIO_BUCKET", "reports")
    return [{
        "id": r["id"],
        "original_name": r.get("original_name"),
        "content_type": r.get("content_type"),
        "size_bytes": r.get("size_bytes"),
        "uploaded_at": str(r.get("uploaded_at") or ""),
        "url": _presign_get(bucket, r.get("object_key"), 900),
    } for r in rows]

@app.delete("/gauges/{gauge_id}/reports/{report_id}/files/{file_id}", status_code=204)
def delete_report_file(gauge_id: int, report_id: int, file_id: int, db: Session = Depends(get_db)):
    ensure_reports_new_tables(db)
    rpt = db.execute(text("SELECT id FROM public.reports WHERE id = :rid AND gauge_id = :gid"), {"rid": report_id, "gid": gauge_id}).mappings().first()
    if not rpt:
        raise HTTPException(status_code=404, detail="Report not found")
    row = db.execute(text("SELECT id, object_key FROM public.report_files WHERE id = :fid AND report_id = :rid"), {"fid": file_id, "rid": report_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        client = _minio_client_from_env()
        bucket = os.getenv("MINIO_BUCKET", "reports")
        client.remove_object(bucket, row.get("object_key"))
    except Exception:
        pass
    db.execute(text("DELETE FROM public.report_files WHERE id = :fid"), {"fid": file_id})
    db.commit()
    return None
