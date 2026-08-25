from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings, overridable via BUDJETAME_* environment variables or a .env file."""

    database_url: str = "postgresql+psycopg://budjetame:budjetame@localhost:5432/budjetame"

    # JWT signing
    jwt_secret: str = "dev-secret-change-me-please-32-bytes-minimum"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24

    # Google sign-in (issue #81): the OAuth client id is public (it ships to
    # the browser); empty disables the Google button.
    google_oauth_client_id: str = ""

    # Email (issue #83): password-reset links. An empty smtp_host means dev
    # posture — the email is logged, never sent.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "budjetame@localhost"
    smtp_tls: bool = True
    password_reset_expire_minutes: int = 30
    # Where the SPA lives; reset links point at it (prod: https://budjetame.de).
    public_base_url: str = "http://localhost:5173"

    # The single Account seeded at setup (override in production)
    seed_account_email: str = "admin@budjetame.dev"
    seed_account_password: str = "budjetame-dev-password"

    model_config = SettingsConfigDict(env_prefix="BUDJETAME_", env_file=".env")


settings = Settings()
