from pydantic import BaseModel, Field, EmailStr
from datetime import datetime, date

class ChangePasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=6)


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)
    password: str = Field(..., min_length=1)


class UserPublic(BaseModel):
    id: int
    username: str
    email: EmailStr
    role: str
    created_at: datetime

    class Config:
        from_attributes = True


class LoginResponse(BaseModel):
    success: bool
    message: str
    user: UserPublic | None = None


class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=6)
    role: str = Field(..., pattern=r"^(admin|operator)$")


class EquipmentCreate(BaseModel):
    name_of_the_equipment: str = Field(..., min_length=1, max_length=100)
    location: str | None = Field(None, max_length=100)
    receipt_date: str | None = None  # ISO date string YYYY-MM-DD
    make_model: str | None = Field(None, max_length=100)
    idfn_no: str = Field(..., min_length=1, max_length=100)
    overall_measurement_uncertainty: str | None = Field(None, max_length=200)
    calibration_freq_months: int | None = None
    date_of_last_calibration: str | None = None  # ISO date string
    calibration_due: str | None = None  # ISO date string
    pcr_number: int | None = None


class EquipmentPublic(BaseModel):
    gauge_id: int
    name_of_the_equipment: str
    location: str | None = None
    make_model: str | None = None
    idfn_no: str
    date_of_last_calibration: date | None = None
    calibration_due: date | None = None


class RequestCreate(BaseModel):
    gauge_id: int
    quantity: int = Field(..., ge=1)
    requested_by: str | None = Field(None, max_length=100)


class RequestResponse(BaseModel):
    success: bool
    id: int


# Gauge Tracker
class GaugeTrackCreate(BaseModel):
    gauge_id: int
    name_of_the_equipment: str
    idfn_no: str
    location: str | None = None
    make_model: str | None = None
    quantity: int = 1
    requested_by: str | None = None


class GaugeTrackPublic(BaseModel):
    id: int
    gauge_id: int
    name_of_the_equipment: str
    idfn_no: str
    location: str | None = None
    make_model: str | None = None
    quantity: int
    requested_by: str | None = None
    requested_at: datetime
    status: str
    accepted_by: str | None = None
    accepted_at: datetime | None = None
    returned_by: str | None = None
    returned_at: datetime | None = None


class GaugeTrackAction(BaseModel):
    accepted_by: str | None = None

