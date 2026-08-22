#!/usr/bin/env python3
"""
Update a gauge's calibration due date for testing email reminders
"""
from app.database import SessionLocal
from sqlalchemy import text
from datetime import date, timedelta

def update_calibration_due_date():
    db = SessionLocal()
    try:
        # Set calibration due date to 1 day from now (2026-08-24)
        target_date = date.today() + timedelta(days=1)
        
        # Update gauge_id 1 to have this due date
        result = db.execute(
            text("UPDATE equipment_used_for_calibration SET calibration_due = :due_date WHERE gauge_id = 1"),
            {"due_date": target_date}
        )
        
        db.commit()
        
        print(f"Updated gauge_id 1 calibration due date to: {target_date}")

        # Verify the update
        check_result = db.execute(
            text("SELECT gauge_id, name_of_the_equipment, calibration_due FROM equipment_used_for_calibration WHERE gauge_id = 1")
        ).mappings().first()

        if check_result:
            print(f"Verification: Gauge {check_result['gauge_id']} - {check_result['name_of_the_equipment']} - Due: {check_result['calibration_due']}")

        print(f"\nNow you can trigger the reminder manually:")
        print("POST /admin/due-reminder/run")
        print("Or use the admin interface to trigger the due reminder")
        
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    update_calibration_due_date()