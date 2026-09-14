# routers/user_router.py
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
import bcrypt
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models.user_model import User
from backend.models.watchlist_model import Watchlist
import os
import jwt

router = APIRouter(prefix="/users", tags=["Users"])


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))

JWT_SECRET = os.getenv("JWT_SECRET", "change-me")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")


class UserRegister(BaseModel):
    email: str
    password: str


class UserLogin(BaseModel):
    email: str
    password: str


def create_access_token(user_id: int, email: str):
    payload = {"user_id": user_id, "email": email}
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token


def get_current_user(authorization: str | None = Header(None), db: Session = Depends(get_db)) -> User:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Invalid auth scheme")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token payload")
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Token decode error")


@router.post("/register")
def register_user(payload: UserRegister, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="User already exists")
    hashed_pw = hash_password(payload.password)
    user = User(email=payload.email, hashed_password=hashed_pw)
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(user.id, user.email)
    return {"message": "User registered", "access_token": token}


@router.post("/login")
def login_user(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect password")
    token = create_access_token(user.id, user.email)
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email}


@router.get("/watchlist")
def get_watchlist(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items = db.query(Watchlist).filter(Watchlist.user_id == user.id).all()
    return {"watchlist": [{"symbol": i.symbol, "name": i.name} for i in items]}


class WatchlistItem(BaseModel):
    symbol: str
    name: str | None = None


@router.post("/watchlist")
def add_watchlist(item: WatchlistItem, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    w = Watchlist(symbol=item.symbol.upper(), name=item.name or item.symbol.upper(), user_id=user.id)
    db.add(w)
    db.commit()
    db.refresh(w)
    return {"message": "Added", "item": {"symbol": w.symbol, "name": w.name}}


@router.delete("/watchlist/{symbol}")
def remove_watchlist(symbol: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    symbol = symbol.upper()
    w = db.query(Watchlist).filter(Watchlist.user_id == user.id, Watchlist.symbol == symbol).first()
    if not w:
        raise HTTPException(status_code=404, detail="Watchlist item not found")
    db.delete(w)
    db.commit()
    return {"message": "Removed"}
