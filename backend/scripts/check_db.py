import sys
from pathlib import Path

# Add backend package path
sys.path.append(str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.database import SessionLocal, engine
from app.models import User


def check_database_connection():
    try:
        # Test basic connection
        with engine.connect() as connection:
            result = connection.execute(text("SELECT 1"))
            print("SUCCESS: Database connection successful!")
            
        # Get database info
        with engine.connect() as connection:
            result = connection.execute(text("SELECT current_database(), current_user, version()"))
            db_info = result.fetchone()
            print(f"\nDatabase Info:")
            print(f"  Database: {db_info[0]}")
            print(f"  User: {db_info[1]}")
            print(f"  Version: {db_info[2]}")
            
        # List all users
        with SessionLocal() as db:
            users = db.execute(select(User)).scalars().all()
            print(f"\nCurrent users in database ({len(users)}):")
            if users:
                for user in users:
                    print(f"  - ID: {user.id}")
                    print(f"    Username: {user.username}")
                    print(f"    Email: {user.email}")
                    print(f"    Role: {user.role}")
                    print(f"    Employee ID: {user.employee_id}")
                    print(f"    Created: {user.created_at}")
                    print()
            else:
                print("  No users found in database.")
                
    except Exception as e:
        print(f"ERROR: Database connection failed: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    check_database_connection()