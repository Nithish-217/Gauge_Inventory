import re
from pathlib import Path
from typing import List, Optional, Dict, Any

from openpyxl import load_workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

# reuse backend app database and models
import sys
sys.path.append(str(Path(__file__).resolve().parents[1]))  # add backend/ to path
from app.database import SessionLocal, engine  # noqa: E402
from app.models import Base  # noqa: E402
from sqlalchemy import text

EXCEL_PATH = Path(r"d:\gaugeinventory\DOC-ML-014E-R40.xlsx")
TARGET_TABLE = "equipment_used_for_calibration"

HEADER_KEYS = {
    "name_of_the_equipment": ["Name Of The Equipment", "Equipment", "Name of the equipment"],
    "location": ["Location"],
    "receipt_date": ["Receipt date", "Receipt Date"],
    "make_model": ["Make/Model", "Make / Model", "Make - Model"],
    "idfn_no": ["Idfn No.", "IDFN No.", "IDFN"],
    "overall_measurement_uncertainty": [
        "Overall Measurement uncertainty",
        "Overall Measurement Uncertainty",
    ],
    "calibration_freq_months": ["Calibration Freq / Month", "Calibration freq / Month"],
    # composite column handled separately:
    # "date_of_last_calibration" and "calibration_due" from
    # "Date of last calibration/ calibration due on"
    "pcr_no": ["PCR No.", "PCR No"],
    # Optional extras (ignored unless we later extend schema):
    "range": ["Range"],
    "acceptable_limit": ["Acceptable Limit"],
    "remarks": ["Remarks"],
}


def find_header_row(ws) -> int:
    for i, row in enumerate(ws.iter_rows(min_row=1, max_row=200, values_only=True), start=1):
        row_text = ",".join(["" if c is None else str(c) for c in row]).lower()
        if "name of the equipment" in row_text and "location" in row_text:
            return i
    # fallback
    return 1


def normalize_int(val: Any) -> Optional[int]:
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    # Extract digits from strings like "24M"
    m = re.search(r"\d+", s)
    if m:
        try:
            return int(m.group(0))
        except ValueError:
            return None
    try:
        return int(float(s))
    except Exception:
        return None


def normalize_date(val: Any) -> Optional[str]:
    # return ISO date string YYYY-MM-DD for SQL
    from datetime import datetime, date

    if val is None or str(val).strip() == "":
        return None
    if isinstance(val, (date,)):
        return val.isoformat()
    s = str(val).strip()
    # try multiple formats
    for fmt in (
        "%d.%m.%Y",
        "%d-%m-%Y",
        "%d.%m.%y",
        "%d-%m-%y",
        "%b %y",
        "%B %y",
        "%b %Y",
        "%B %Y",
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%m/%d/%Y",
    ):
        try:
            dt = datetime.strptime(s, fmt)
            return dt.date().isoformat()
        except Exception:
            pass
    # last resort: month-year like "July 19"
    try:
        dt = datetime.strptime(s, "%B %y")
        return dt.date().isoformat()
    except Exception:
        return None


def parse_last_and_due(val: Any) -> (Optional[str], Optional[str]):
    if val is None:
        return None, None
    s = str(val)
    # Try to split by newline or comma
    parts = re.split(r"\n|/|,", s)
    dates = [normalize_date(p) for p in parts]
    dates = [d for d in dates if d]
    if not dates:
        return None, None
    if len(dates) == 1:
        return dates[0], None
    return dates[0], dates[1]


def map_headers(header_row_values: List[str]) -> Dict[str, int]:
    mapping: Dict[str, int] = {}
    for idx, raw in enumerate(header_row_values):
        name = ("" if raw is None else str(raw)).strip()
        for key, aliases in HEADER_KEYS.items():
            if any(name.lower() == a.lower() for a in aliases):
                mapping[key] = idx
                break
        # composite header
        if name.lower().startswith("date of last calibration"):
            mapping["last_due_combo"] = idx
    return mapping


def main():
    wb = load_workbook(EXCEL_PATH, data_only=True, read_only=True)
    ws = wb[wb.sheetnames[0]]  # Table 1

    header_row = find_header_row(ws)
    header_vals = [c for c in next(ws.iter_rows(min_row=header_row, max_row=header_row, values_only=True))]
    mapping = map_headers(["" if v is None else str(v) for v in header_vals])

    required = [
        "name_of_the_equipment",
        "location",
        "receipt_date",
        "make_model",
        "idfn_no",
        "overall_measurement_uncertainty",
        "calibration_freq_months",
        "pcr_no",
        "last_due_combo",
    ]

    missing = [k for k in required if k not in mapping]
    if missing:
        print("Missing expected columns in header:", missing)
        return 1

    rows_prepared = []
    for row in ws.iter_rows(min_row=header_row + 1, values_only=True):
        values = list(row)
        name = values[mapping["name_of_the_equipment"]]
        if not name or str(name).strip() in ("", "Sl.", "Sl. No."):
            # stop when empty or header-like
            continue
        record: Dict[str, Any] = {
            "name_of_the_equipment": str(name).strip(),
            "location": ("" if values[mapping["location"]] is None else str(values[mapping["location"]]).strip()),
            "receipt_date": normalize_date(values[mapping["receipt_date"]]),
            "make_model": ("" if values[mapping["make_model"]] is None else str(values[mapping["make_model"]]).strip()),
            "idfn_no": ("" if values[mapping["idfn_no"]] is None else str(values[mapping["idfn_no"]]).strip()),
            "overall_measurement_uncertainty": ("" if values[mapping["overall_measurement_uncertainty"]] is None else str(values[mapping["overall_measurement_uncertainty"]]).strip()),
            "calibration_freq_months": normalize_int(values[mapping["calibration_freq_months"]]),
        }
        last, due = parse_last_and_due(values[mapping["last_due_combo"]])
        record["date_of_last_calibration"] = last
        record["calibration_due"] = due
        # PCR No: extract digits to fit INT column; else None
        record["pcr_number"] = normalize_int(values[mapping["pcr_no"]])

        # Skip entirely empty rows
        if not any(v for v in record.values() if v not in (None, "")):
            continue
        rows_prepared.append(record)

    if not rows_prepared:
        print("No data rows prepared. Nothing to insert.")
        return 0

    # Insert into DB, skipping duplicates by idfn_no; if duplicate and DB.receipt_date is NULL
    # but we have a value, update receipt_date (and other nullable date fields if desired)
    inserted = 0
    updated = 0
    with SessionLocal() as db:
        for rec in rows_prepared:
            if not rec.get("idfn_no"):
                continue
            row = db.execute(
                text(f"SELECT gauge_id, receipt_date, date_of_last_calibration, calibration_due FROM public.{TARGET_TABLE} WHERE idfn_no = :idfn_no LIMIT 1"),
                {"idfn_no": rec["idfn_no"]},
            ).first()
            if row:
                # Perform targeted updates if missing in DB but present in incoming record
                fields_to_update = {}
                if row.receipt_date is None and rec.get("receipt_date"):
                    fields_to_update["receipt_date"] = rec["receipt_date"]
                if row.date_of_last_calibration is None and rec.get("date_of_last_calibration"):
                    fields_to_update["date_of_last_calibration"] = rec["date_of_last_calibration"]
                if row.calibration_due is None and rec.get("calibration_due"):
                    fields_to_update["calibration_due"] = rec["calibration_due"]
                if fields_to_update:
                    set_clause = ", ".join([f"{k} = :{k}" for k in fields_to_update.keys()])
                    params = {**fields_to_update, "idfn_no": rec["idfn_no"]}
                    db.execute(
                        text(f"UPDATE public.{TARGET_TABLE} SET {set_clause} WHERE idfn_no = :idfn_no"),
                        params,
                    )
                    updated += 1
                continue

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
            placeholders = ", ".join([":" + c for c in cols])
            colnames = ", ".join(cols)
            sql = text(
                f"INSERT INTO public.{TARGET_TABLE} ({colnames}) VALUES ({placeholders})"
            )
            db.execute(sql, rec)
            inserted += 1
        db.commit()

    print(f"Prepared rows: {len(rows_prepared)}; Inserted (skipping duplicates): {inserted}; Updated missing dates: {updated}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
