import sys
from pathlib import Path

# Add backend package path
sys.path.append(str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select, delete
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import User
from app.security import get_password_hash


def recreate_user(username: str, password: str, role: str, email: str):
    with SessionLocal() as db:  # type: Session
        # Delete existing user if exists
        existing = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
        if existing:
            print(f"Deleting existing user '{username}' (id={existing.id})...")
            db.execute(delete(User).where(User.username == username))
            db.commit()
        
        # Create new user
        user = User(
            username=username,
            password_hash=get_password_hash(password),
            role=role,
            email=email,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        print(f"Created user '{username}' (id={user.id}) with role '{role}' and email '{email}'.")
        return 1


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python recreate_user.py <username> <password> <role> <email>")
        raise SystemExit(1)
    username = sys.argv[1]
    password = sys.argv[2]
    role = sys.argv[3]
    email = sys.argv[4] if len(sys.argv) > 4 else f"{username}@example.com"
    recreate_user(username, password, role, email)