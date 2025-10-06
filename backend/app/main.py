from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import text

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
    # Find user by username
    user = db.query(models.User).filter(models.User.username == payload.username).first()
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


@app.get("/equipment")
def list_equipment(limit: int = 50, offset: int = 0, q: str | None = None, db: Session = Depends(get_db)):
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    where = ""
    params = {"limit": limit, "offset": offset}
    if q:
        where = "WHERE name_of_the_equipment ILIKE :qs OR idfn_no ILIKE :qs OR location ILIKE :qs"
        params["qs"] = f"%{q}%"
    sql = text(
        f"""
        SELECT 
          gauge_id,
          name_of_the_equipment,
          location,
          make_model,
          idfn_no,
          date_of_last_calibration,
          calibration_due
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
    # Insert record if idfn_no not duplicate; allow duplicates depending on your DB rules
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
    colnames = ", ".join(cols)
    placeholders = ", ".join([":" + c for c in cols])
    sql = text(
        f"""
        INSERT INTO public.equipment_used_for_calibration ({colnames})
        VALUES ({placeholders})
        RETURNING gauge_id, name_of_the_equipment, location, make_model, idfn_no, date_of_last_calibration, calibration_due
        """
    )
    row = db.execute(sql, payload.model_dump()).mappings().first()
    db.commit()
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

    row = db.execute(
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
    ).first()
    db.commit()
    return {"success": True, "id": row.id}
