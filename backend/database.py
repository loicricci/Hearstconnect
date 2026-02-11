"""Database connection and session management."""
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import sessionmaker, Session
from sqlmodel import SQLModel

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# Build connection URL explicitly to handle Supabase pooler usernames with dots
DB_USER = os.getenv("DB_USER", "postgres.lofjkuhbtdxazcgtizum")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
DB_HOST = os.getenv("DB_HOST", "aws-1-ap-south-1.pooler.supabase.com")
DB_PORT = int(os.getenv("DB_PORT", "6543"))
DB_NAME = os.getenv("DB_NAME", "postgres")

DATABASE_URL = URL.create(
    drivername="postgresql+psycopg2",
    username=DB_USER,
    password=DB_PASSWORD,
    host=DB_HOST,
    port=DB_PORT,
    database=DB_NAME,
)

engine = create_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    connect_args={"sslmode": "require"},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """Dependency that yields a DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_db_and_tables():
    """Create all tables from SQLModel metadata."""
    SQLModel.metadata.create_all(engine)
