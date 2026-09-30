"""Public blockchain transaction index; never accepts keys or client-supplied status."""
from contextlib import contextmanager
import os
import re
import sqlite3
from pathlib import Path

from flask import Flask, jsonify, request
from web3 import Web3
from web3.exceptions import TransactionNotFound

ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
HASH = re.compile(r"^0x[0-9a-fA-F]{64}$")
ACTIONS = {Web3.keccak(text=f"{name}()")[:4].hex(): name
           for name in ("contribute", "refund", "withdraw")}


def create_app(config=None, provider=None):
    app = Flask(__name__)
    app.config.update(
        DATABASE=os.getenv("DATABASE", str(Path(__file__).resolve().parents[1] / "transactions.sqlite3")),
        RPC_URL=os.getenv("RPC_URL", "http://127.0.0.1:8545"),
        CONTRACT_ADDRESS=os.getenv("CONTRACT_ADDRESS", ""),
        CHAIN_ID=int(os.getenv("CHAIN_ID", "11155111")),
        WEB_ORIGIN=os.getenv("WEB_ORIGIN", "http://localhost:3000"),
        MAX_CONTENT_LENGTH=2048,
    )
    app.config.update(config or {})
    w3 = provider or Web3(Web3.HTTPProvider(app.config["RPC_URL"], request_kwargs={"timeout": 10}))

    @contextmanager
    def database():
        db = sqlite3.connect(app.config["DATABASE"])
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    with database() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS transactions (
            hash TEXT NOT NULL, chain_id INTEGER NOT NULL, contract_address TEXT NOT NULL,
            wallet TEXT NOT NULL, action TEXT NOT NULL, value_wei TEXT NOT NULL,
            status TEXT NOT NULL, block_number INTEGER,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            PRIMARY KEY (chain_id, hash)
        )''')

    @app.after_request
    def cors(response):
        if request.headers.get("Origin") == app.config["WEB_ORIGIN"]:
            response.headers["Access-Control-Allow-Origin"] = app.config["WEB_ORIGIN"]
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        return response

    @app.errorhandler(413)
    def too_large(_):
        return jsonify(error="Request too large"), 413

    @app.get('/api/health')
    def health():
        return jsonify(status="ok")

    @app.get('/api/transactions')
    def history():
        wallet = request.args.get('wallet', '')
        if not ADDRESS.fullmatch(wallet):
            return jsonify(error="A valid wallet address is required"), 400
        with database() as db:
            rows = db.execute('''SELECT * FROM transactions WHERE wallet=? AND chain_id=?
                AND contract_address=? ORDER BY created_at DESC LIMIT 100''',
                (wallet.lower(), app.config['CHAIN_ID'], app.config['CONTRACT_ADDRESS'].lower())).fetchall()
        return jsonify(transactions=[dict(row) for row in rows])

    @app.post('/api/transactions')
    def record():
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or not isinstance(body.get('hash'), str) or not HASH.fullmatch(body['hash']):
            return jsonify(error="A valid transaction hash is required"), 400
        address = app.config['CONTRACT_ADDRESS']
        if not ADDRESS.fullmatch(address) or int(address, 16) == 0:
            return jsonify(error="Server contract address is not configured"), 503
        tx_hash = body['hash'].lower()
        try:
            if w3.eth.chain_id != app.config['CHAIN_ID']:
                return jsonify(error="Server RPC network does not match configuration"), 503
            tx = w3.eth.get_transaction(tx_hash)
            if (tx.get('to') or '').lower() != address.lower():
                return jsonify(error="Transaction is not for this campaign"), 400
            data = bytes(tx['input'])
            action = ACTIONS.get(data.hex()) if len(data) == 4 else None
            if action is None:
                return jsonify(error="Unsupported campaign action"), 400
            try:
                receipt = w3.eth.get_transaction_receipt(tx_hash)
                status = 'confirmed' if receipt['status'] == 1 else 'failed'
                block = receipt['blockNumber']
            except TransactionNotFound:
                status, block = 'pending', None
        except TransactionNotFound:
            return jsonify(error="Transaction not yet visible to server RPC; retry shortly"), 404
        except Exception:
            app.logger.exception("Blockchain lookup failed")
            return jsonify(error="Blockchain provider unavailable; retry shortly"), 503
        with database() as db:
            db.execute('''INSERT INTO transactions
                (hash, chain_id, contract_address, wallet, action, value_wei, status, block_number)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(chain_id, hash) DO UPDATE SET status=excluded.status, block_number=excluded.block_number''',
                (tx_hash, app.config['CHAIN_ID'], address.lower(), tx['from'].lower(), action,
                 str(tx['value']), status, block))
            row = db.execute('SELECT * FROM transactions WHERE hash=? AND chain_id=?', (tx_hash, app.config['CHAIN_ID'])).fetchone()
        return jsonify(dict(row))

    return app
