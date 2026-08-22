import sys
from pathlib import Path

# Add backend package path
sys.path.append(str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select, delete
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import User


def delete_all_users_except(keep_user_id: int):
    with SessionLocal() as db:  # type: Session
        # Get all users
        all_users = db.execute(select(User)).scalars().all()
        
        deleted_count = 0
        for user in all_users:
            if user.id != keep_user_id:
                print(f"Deleting user '{user.username}' (id={user.id})...")
                db.execute(delete(User).where(User.id == user.id))
                deleted_count += 1
        
        if deleted_count > 0:
            db.commit()
            print(f"Deleted {deleted_count} user(s). Kept user ID {keep_user_id}.")
        else:
            print("No users to delete. Only the specified user exists.")
        
        # Show remaining users
        remaining = db.execute(select(User)).scalars().all()
        print(f"\nRemaining users ({len(remaining)}):")
        for user in remaining:
            print(f"  - {user.username} (id={user.id}, role={user.role}, email={user.email})")


if __name__ == "__main__":
    keep_id = 33  # ID of the Nithish user we just created
    delete_all_users_except(keep_id)