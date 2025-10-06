import sys
from pathlib import Path

# Add backend package path
sys.path.append(str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import User
from app.security import get_password_hash


def create_user(username: str, password: str, role: str, email: str):
    with SessionLocal() as db:  # type: Session
        # Check exists
        exists = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
        if exists:
            print(f"User '{username}' already exists (id={exists.id}). Skipping.")
            return 0
        user = User(
            username=username,
            password_hash=get_password_hash(password),
            role=role,
            email=email,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        print(f"Created user '{username}' (id={user.id}) with role '{role}'.")
        return 1


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python create_user.py <username> <password> <role> [email]")
        raise SystemExit(1)
    username = sys.argv[1]
    password = sys.argv[2]
    role = sys.argv[3]
    email = sys.argv[4] if len(sys.argv) > 4 else f"{username}@example.com"
    create_user(username, password, role, email)
