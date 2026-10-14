"""SQLite connections and schema initialization."""
from contextlib import contextmanager
import sqlite3
from flask import current_app


@contextmanager
def database():
    db = sqlite3.connect(current_app.config["DATABASE"])
    db.row_factory = sqlite3.Row
    try:
        with db:
            yield db
    finally:
        db.close()


def init_database():
    with database() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS transactions (
            hash TEXT NOT NULL, chain_id INTEGER NOT NULL, contract_address TEXT NOT NULL,
            wallet TEXT NOT NULL, action TEXT NOT NULL, value_wei TEXT NOT NULL,
            status TEXT NOT NULL, block_number INTEGER,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            PRIMARY KEY (chain_id, hash)
        )''')


        db.executescript("""
        CREATE TABLE IF NOT EXISTS challenges (nonce TEXT PRIMARY KEY, wallet TEXT, message TEXT, expires INTEGER);
        CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, wallet TEXT, expires INTEGER);
        CREATE TABLE IF NOT EXISTS campaigns (
          address TEXT PRIMARY KEY, creator TEXT NOT NULL, title TEXT NOT NULL,
          description TEXT NOT NULL, category TEXT NOT NULL, image TEXT NOT NULL,
          goal TEXT NOT NULL, deadline INTEGER NOT NULL, raised TEXT NOT NULL DEFAULT '0',
          cancelled INTEGER NOT NULL DEFAULT 0, withdrawn INTEGER NOT NULL DEFAULT 0,
          hidden INTEGER NOT NULL DEFAULT 0, flagged INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL, start_block INTEGER NOT NULL, indexed_block INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        """)
