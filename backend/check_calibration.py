#!/usr/bin/env python3
"""
Check calibration due dates to see if there are any gauges due for reminders
"""
from app.database import SessionLocal
from sqlalchemy import text
from datetime import date, timedelta

def check_calibration_dates():
    db = SessionLocal()
    try:
        result = db.execute(text(
            """SELECT gauge_id, name_of_the_equipment, calibration_due 
               FROM equipment_used_for_calibration 
               WHERE calibration_due IS NOT NULL 
               ORDER BY calibration_due LIMIT 10"""
        )).mappings().all()
        
        print("Gauges with calibration due dates:")
        print("=" * 80)
        if not result:
            print("No gauges with calibration due dates found")
        else:
            for r in result:
                print(f"{r['gauge_id']} - {r['name_of_the_equipment']} - Due: {r['calibration_due']}")
        
        print(f"\nToday: {date.today()}")
        print(f"Target date (offset 3): {date.today() + timedelta(days=3)}")
        
        # Check for gauges due exactly 3 days from now
        target = date.today() + timedelta(days=3)
        due_result = db.execute(text(
            """SELECT gauge_id, name_of_the_equipment, calibration_due 
               FROM equipment_used_for_calibration 
               WHERE calibration_due = :due""",
            {"due": target}
        )).mappings().all()
        
        print(f"\nGauges due exactly 3 days from now ({target}):")
        print("=" * 80)
        if not due_result:
            print("No gauges due exactly 3 days from now")
        else:
            for r in due_result:
                print(f"{r['gauge_id']} - {r['name_of_the_equipment']} - Due: {r['calibration_due']}")
                
    except Exception as e:
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    check_calibration_dates()