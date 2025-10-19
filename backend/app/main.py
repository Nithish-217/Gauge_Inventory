from fastapi import FastAPI, Depends, HTTPException, status
from fastapi import Request
from fastapi import UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import datetime
from sqlalchemy import text
from fastapi.responses import StreamingResponse
import io
from barcode import Code128
from barcode.writer import ImageWriter
import qrcode

from .database import get_db
from . import models, schemas
from .security import verify_password, get_password_hash
import os
from minio import Minio
from datetime import datetime as dt
import smtplib
import ssl
from email.message import EmailMessage
from dotenv import load_dotenv

app = FastAPI(title="CMTI Backend", version="0.1.0")

# CORS: allow local dev from any origin or restrict to your frontend port later
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/auth/login", response_model=schemas.LoginResponse)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    # Normalize provided username (trim spaces)
    provided_username = (payload.username or "").strip()
    # Find user by username (case-insensitive match)
    user = (
        db.query(models.User)
        .filter(models.User.username.ilike(provided_username))
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

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
    # Normalize role
    role = payload.role.lower()
    if role not in ("admin", "operator"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'operator'")

    user = models.User(
        username=payload.username,
        email=payload.email,
        role=role,
        password_hash=get_password_hash(payload.password),
    )
    try:
        db.add(user)
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Username or email already exists")

    return user


@app.get("/users", response_model=list[schemas.UserPublic])
def list_users(db: Session = Depends(get_db)):
    users = db.query(models.User).order_by(models.User.id.desc()).all()
    return users


@app.get("/users/{user_id}", response_model=schemas.UserPublic)
def get_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


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

@app.post("/reminders/email", response_model=schemas.ReminderResponse)
def send_gauge_reminder(payload: schemas.ReminderRequest, db: Session = Depends(get_db)):
    """Send an email reminder to the operator currently holding the gauge.
    - Finds the active gauge request (status 'accepted' and not returned) for the gauge_id
    - Looks up the operator's email from users table using accepted_by username
    - Composes and sends an email using SMTP credentials from environment variables
    """
    gid = int(payload.gauge_id)
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


@app.get("/equipment")
def list_equipment(limit: int = 50, offset: int = 0, q: str | None = None, db: Session = Depends(get_db)):
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    where = ""
    params = {"limit": limit, "offset": offset}
    if q:
        where = "WHERE name_of_the_equipment ILIKE :qs OR idfn_no ILIKE :qs OR location ILIKE :qs"
        params["qs"] = f"%{q}%"
    # Ensure returned_at column exists for availability checks
    try:
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ"))
    except Exception:
        pass
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
          EXISTS (
            SELECT 1 FROM public.gauge_requests gr
            WHERE gr.gauge_id = equipment_used_for_calibration.gauge_id
              AND gr.status = 'accepted'
              AND gr.returned_at IS NULL
          ) AS is_unavailable
        FROM public.equipment_used_for_calibration
        {where}
        ORDER BY gauge_id
        LIMIT :limit OFFSET :offset
        """
    )
    rows = db.execute(sql, params).mappings().all()
    return {
        "items": list(rows),
        "limit": limit,
        "offset": offset,
        "count": len(rows),
    }


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
        db.commit()
    except IntegrityError as ie:
        db.rollback()
        raise HTTPException(status_code=400, detail="Duplicate or integrity error while saving equipment")
    except Exception as e:
        db.rollback()
        # Return a readable message for common PG errors
        raise HTTPException(status_code=400, detail=f"Insert error: {str(e)}")
    if not row:
        raise HTTPException(status_code=500, detail="Insert failed")
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
        params["calibration_due"] = to_iso_date(data.get("calibration_due")) if data.get("calibration_due") else None
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
        db.commit()
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
def list_gauge_tracks(limit: int = 100, offset: int = 0, requested_by: str | None = None, db: Session = Depends(get_db)):
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
          accepted_at TIMESTAMPTZ
        )
        """
    ))
    # Build rows by joining equipment for display and current holder from existing gauge_tracker
    # Ensure return columns exist for consistent SELECT
    try:
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS returned_by VARCHAR(100)"))
        db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ"))
    except Exception:
        pass
    where = ""
    params = {"limit": limit, "offset": offset}
    if requested_by:
        where = "WHERE gr.requested_by ILIKE :rb"
        params["rb"] = requested_by
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
          gr.returned_at
        FROM public.gauge_requests gr
        LEFT JOIN public.equipment_used_for_calibration e ON e.gauge_id = gr.gauge_id
        LEFT JOIN public.gauge_tracker gt ON gt.gauge_id = gr.gauge_id AND gt.returned_at IS NULL
        LEFT JOIN public.users u ON u.id = gt.issued_to
        {where}
        ORDER BY gr.id DESC
        LIMIT :limit OFFSET :offset
        """
    )
    rows = db.execute(sql, params).mappings().all()
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
          accepted_at TIMESTAMPTZ
        )
        """
    ))
    # Ensure returned_at column exists before we query on it
    try:
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
            INSERT INTO public.gauge_requests (gauge_id, requested_by, requested_at, status)
            VALUES (:gauge_id, :requested_by, NOW(), 'requested')
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
          NULL::timestamptz as accepted_at
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
    db.execute(text(
        """
        UPDATE public.gauge_requests
        SET status = 'accepted', accepted_by = :accepted_by, accepted_at = NOW()
        WHERE id = :id
        """
    ), {"id": track_id, "accepted_by": accepted_by})
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
    report_url = f"{base}/reports/{row['gauge_id']}/download"
    # Encode only the direct report URL so scanners open the link immediately
    payload = report_url

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
                    except Exception:
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
    return os.getenv("MINIO_BUCKET", "gagecalibration")


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
def list_reports(limit: int = 200, offset: int = 0, q: str | None = None, db: Session = Depends(get_db)):
    ensure_reports_table(db)
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    where = ""
    params = {"limit": limit, "offset": offset}
    if q:
        where = "WHERE e.name_of_the_equipment ILIKE :qs OR e.idfn_no ILIKE :qs OR e.location ILIKE :qs"
        params["qs"] = f"%{q}%"
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
        ORDER BY e.gauge_id
        LIMIT :limit OFFSET :offset
        """
    )
    rows = db.execute(sql, params).mappings().all()
    return {"items": list(rows), "limit": limit, "offset": offset, "count": len(rows)}


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
        object_key = f"local/reports/{fname}"
    else:
        # Try MinIO first; on failure, fallback to local
        object_key = f"reports/{idfn}.{ext}"
        try:
            mc = get_minio_client()
            bucket = get_minio_bucket()
            try:
                if not mc.bucket_exists(bucket):
                    mc.make_bucket(bucket)
            except Exception:
                pass
            mc.put_object(bucket, object_key, io.BytesIO(data), length=len(data), content_type=report.content_type or "application/octet-stream")
        except Exception:
            # Fallback to local storage
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
            object_key = f"local/reports/{fname}"

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
    ), {"gid": gauge_id, "idfn": idfn, "okey": object_key, "user": updated_by})
    db.commit()
    return {"success": True, "object_key": object_key}


def _object_response(bucket: str, object_key: str, inline: bool):
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
        mc = get_minio_client()
        # Validate bucket and object to avoid long hangs and return helpful errors
        try:
            if not mc.bucket_exists(bucket):
                raise HTTPException(status_code=404, detail="Report bucket not found")
        except Exception as e:
            # Connection or auth issue
            raise HTTPException(status_code=502, detail=f"Object store not reachable: {str(e)}")

        try:
            # Will raise if object not found
            mc.stat_object(bucket, object_key)
        except Exception:
            raise HTTPException(status_code=404, detail="Report file not found")

        # Fetch the object; if the stream errors, surface a clear message
        try:
            obj = mc.get_object(bucket, object_key)
            data = obj.read()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to fetch report: {str(e)}")
        finally:
            try:
                obj.close()
            except Exception:
                pass

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
    except Exception:
        pass
    # Prefer the actor provided; if missing, fall back to original requester, then a generic label
    returned_by = (payload.accepted_by or "").strip() or (req.get("requested_by") or "operator")
    db.execute(text(
        """
        UPDATE public.gauge_requests
        SET status = 'returned', returned_by = :returned_by, returned_at = NOW()
        WHERE id = :id
        """
    ), {"id": track_id, "returned_by": returned_by})
    db.commit()
    return list_gauge_tracks(limit=1, offset=0, db=db)[0]
