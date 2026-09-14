from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./stocksense.db"  # Use PostgreSQL later

settings = Settings()
