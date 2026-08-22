#!/usr/bin/env python3
"""
Check if Yashas has an email address in the system
"""
from app.database import SessionLocal
from sqlalchemy import text

def check_user_email():
    db = SessionLocal()
    try:
        # Check for Yashas user
        result = db.execute(
            text("SELECT id, username, email FROM public.users WHERE TRIM(LOWER(username)) = TRIM(LOWER(:username))"),
            {"username": "Yashas"}
        ).mappings().first()
        
        if result:
            print(f"User found: {result['username']}")
            print(f"Email: {result['email']}")
            if result['email']:
                print("Email is set - reminder should work")
            else:
                print("No email set - reminder will fail")
        else:
            print("User Yashas not found in the system")
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    check_user_email()