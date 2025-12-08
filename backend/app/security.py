from passlib.context import CryptContext

# Support verifying legacy bcrypt hashes while preferring pbkdf2_sha256 for new hashes
# pbkdf2_sha256 will be used for get_password_hash; bcrypt remains for verifying old passwords
pwd_context = CryptContext(schemes=["pbkdf2_sha256", "bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)
