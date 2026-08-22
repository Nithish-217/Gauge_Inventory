#!/usr/bin/env python3
"""
Check if there are active gauge requests for gauge_id 1
"""
from app.database import SessionLocal
from sqlalchemy import text

def check_gauge_requests():
    db = SessionLocal()
    try:
        # Check for active gauge requests for gauge_id 1
        result = db.execute(
            text("SELECT id, gauge_id, requested_by, status, accepted_by, accepted_at, returned_at FROM public.gauge_requests WHERE gauge_id = 1 ORDER BY requested_at DESC")
        ).mappings().all()
        
        print(f"Active gauge requests for gauge_id 1:")
        print("=" * 80)
        if not result:
            print("No active gauge requests found for gauge_id 1")
            print("The reminder system needs an active request to send emails to the operator")
        else:
            for r in result:
                print(f"Request ID: {r['id']}")
                print(f"Requested by: {r['requested_by']}")
                print(f"Status: {r['status']}")
                print(f"Accepted by: {r['accepted_by']}")
                print(f"Accepted at: {r['accepted_at']}")
                print(f"Returned at: {r['returned_at']}")
                print("-" * 40)
                
    except Exception as e:
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    check_gauge_requests()