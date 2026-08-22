#!/usr/bin/env python3
"""
Check recent email logs to see what's happening with email sending
"""
from app.database import SessionLocal
from sqlalchemy import text

def check_email_logs():
    db = SessionLocal()
    try:
        result = db.execute(text(
            """SELECT * FROM public.email_logs ORDER BY sent_at DESC LIMIT 10"""
        )).mappings().all()
        
        print("Recent email logs:")
        print("=" * 80)
        if not result:
            print("No email logs found")
        else:
            for r in result:
                print(f"Time: {r['sent_at']}")
                print(f"Status: {r['status']}")
                print(f"To: {r['to_email']}")
                print(f"Subject: {r['subject']}")
                print(f"Error: {r.get('error', 'None')}")
                print(f"Context: {r.get('context', 'None')}")
                print("-" * 80)
    except Exception as e:
        print(f"Error checking email logs: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    check_email_logs()