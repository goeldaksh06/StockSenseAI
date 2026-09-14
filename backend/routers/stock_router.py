from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models.stock_model import Stock

router = APIRouter(prefix="/stocks", tags=["Stocks"])

# ✅ Create new stock
@router.post("/")
def create_stock(symbol: str, company_name: str, db: Session = Depends(get_db)):
    existing_stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if existing_stock:
        raise HTTPException(status_code=400, detail="Stock already exists")
    new_stock = Stock(symbol=symbol, company_name=company_name)
    db.add(new_stock)
    db.commit()
    db.refresh(new_stock)
    return {"message": "Stock created successfully", "stock": new_stock}

# ✅ Get all stocks
@router.get("/")
def get_all_stocks(db: Session = Depends(get_db)):
    stocks = db.query(Stock).all()
    return {"stocks": stocks}

# ✅ Get stock by symbol
@router.get("/{symbol}")
def get_stock(symbol: str, db: Session = Depends(get_db)):
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if not stock:
        raise HTTPException(status_code=404, detail="Stock not found")
    return {"stock": stock}

# ✅ Delete a stock
@router.delete("/{symbol}")
def delete_stock(symbol: str, db: Session = Depends(get_db)):
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if not stock:
        raise HTTPException(status_code=404, detail="Stock not found")
    db.delete(stock)
    db.commit()
    return {"message": f"Stock '{symbol}' deleted successfully"}
