from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import datetime
from sqlalchemy import text
from fastapi.responses import StreamingResponse
import io
from barcode import Code128
from barcode.writer import ImageWriter

from .database import get_db
from . import models, schemas
from .security import verify_password, get_password_hash

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
    db.delete(user)
    db.commit()
    return None


@app.post("/users/{user_id}/password")
def change_password(user_id: int, payload: schemas.ChangePasswordRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = get_password_hash(payload.new_password)
    db.add(user)
    db.commit()
    return {"success": True}


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
          date_of_last_calibration,
          calibration_due,
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
    # Persist operator request into gauge_requests
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

    result = db.execute(
        text(
            """
            INSERT INTO public.gauge_requests (gauge_id, requested_by, requested_at, status)
            VALUES (:gauge_id, :requested_by, NOW(), 'requested')
            RETURNING id
        """
    ), data).mappings().first()
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
