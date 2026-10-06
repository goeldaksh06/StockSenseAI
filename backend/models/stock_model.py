from sqlalchemy import Column, Integer, String, Float, DateTime
from datetime import datetime, timezone
from backend.database import Base

class Stock(Base):
    __tablename__ = "stocks"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(10), unique=True, nullable=False)
    company_name = Column(String(100), nullable=False)
    last_price = Column(Float, nullable=True)
    change_percent = Column(Float, nullable=True)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
