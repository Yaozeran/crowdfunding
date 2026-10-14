"""Environment defaults for the API."""
import os
from pathlib import Path


def configure_app(app, config=None):
    app.config.update(
        DATABASE=os.getenv("DATABASE", str(Path(__file__).resolve().parents[1] / "transactions.sqlite3")),
        RPC_URL=os.getenv("RPC_URL", "http://127.0.0.1:8545"),
        CONTRACT_ADDRESS=os.getenv("CONTRACT_ADDRESS", ""),
        CHAIN_ID=int(os.getenv("CHAIN_ID", "11155111")),
        WEB_ORIGIN=os.getenv("WEB_ORIGIN", "http://localhost:3000"),
        MAX_CONTENT_LENGTH=16384,
        ADMIN_WALLETS=[address.strip().lower() for address in os.getenv("ADMIN_WALLETS", "").split(",") if address.strip()],
    )
    app.config.update(config or {})
