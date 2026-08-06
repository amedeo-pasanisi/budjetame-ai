from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings, overridable via BUDJETAME_* environment variables or a .env file."""

    database_url: str = "postgresql+psycopg://budjetame:budjetame@localhost:5432/budjetame"

    # JWT signing
    jwt_secret: str = "dev-secret-change-me-please-32-bytes-minimum"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24

    # The single Account seeded at setup (override in production)
    seed_account_email: str = "admin@budjetame.dev"
    seed_account_password: str = "budjetame-dev-password"

    model_config = SettingsConfigDict(env_prefix="BUDJETAME_", env_file=".env")


settings = Settings()
