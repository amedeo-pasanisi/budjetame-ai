from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings, overridable via BUDJETAME_* environment variables or a .env file."""

    database_url: str = "postgresql+psycopg://budjetame:budjetame@localhost:5432/budjetame"

    model_config = SettingsConfigDict(env_prefix="BUDJETAME_", env_file=".env")


settings = Settings()
