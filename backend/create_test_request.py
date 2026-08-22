#!/usr/bin/env python3
"""
Create a test gauge request for gauge_id 1 to test email reminders
"""
from app.database import SessionLocal
from sqlalchemy import text
from datetime import datetime

def create_test_request():
    db = SessionLocal()
    try:
        # Create a test gauge request for gauge_id 1
        result = db.execute(
            text("""INSERT INTO public.gauge_requests (gauge_id, requested_by, requested_at, status, accepted_by, accepted_at) 
                    VALUES (:gauge_id, :requested_by, :requested_at, :status, :accepted_by, :accepted_at)"""),
            {
                "gauge_id": 1,
                "requested_by": "Yashas",  # Using a known user from the logs
                "requested_at": datetime.now(),
                "status": "accepted",
                "accepted_by": "admin",
                "accepted_at": datetime.now()
            }
        )
        
        db.commit()
        
        print("Created test gauge request for gauge_id 1")
        print("Requested by: Yashas")
        print("Status: accepted")
        
        # Verify the request was created
        check_result = db.execute(
            text("SELECT id, gauge_id, requested_by, status, accepted_by FROM public.gauge_requests WHERE gauge_id = 1 ORDER BY requested_at DESC LIMIT 1")
        ).mappings().first()
        
        if check_result:
            print(f"Verification: Request ID {check_result['id']} - Gauge {check_result['gauge_id']} - Requested by {check_result['requested_by']} - Status {check_result['status']}")
        
        print(f"\nNow you can trigger the reminder and it should send an email to Yashas")
        print("POST /admin/due-reminder/run")
        
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    create_test_request()