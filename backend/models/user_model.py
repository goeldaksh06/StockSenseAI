from sqlalchemy import Column, Integer, String, DateTime
from datetime import datetime, timezone
from backend.database import Base
from sqlalchemy.orm import relationship  # ✅ Add this import

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # ✅ Connects User ↔ Watchlist (One-to-Many)
    watchlist = relationship("Watchlist", back_populates="user")
