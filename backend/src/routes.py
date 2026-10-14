"""Health and transaction API endpoints."""
import re
from flask import Blueprint, current_app, jsonify, request
from .database import database
from .blockchain import BlockchainError, verify_transaction

ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
HASH = re.compile(r"^0x[0-9a-fA-F]{64}$")
api = Blueprint("api", __name__)


@api.after_app_request
def cors(response):
    if request.headers.get("Origin") == current_app.config["WEB_ORIGIN"]:
        response.headers["Access-Control-Allow-Origin"] = current_app.config["WEB_ORIGIN"]
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, OPTIONS"
    return response

@api.app_errorhandler(413)
def too_large(_):
    return jsonify(error="Request too large"), 413

@api.get('/api/health')
def health():
    return jsonify(status="ok")

@api.get('/api/transactions')
def history():
    wallet = request.args.get('wallet', '')
    campaign = request.args.get('campaign', current_app.config['CONTRACT_ADDRESS']).lower()
    if not ADDRESS.fullmatch(campaign):
        return jsonify(error='Valid campaign required'), 400
    if not ADDRESS.fullmatch(wallet) and wallet != '':
        return jsonify(error="A valid wallet address is required"), 400
    with database() as db:
        rows = db.execute('''SELECT * FROM transactions WHERE (?='' OR wallet=?) AND chain_id=?
            AND contract_address=? ORDER BY created_at DESC LIMIT 100''',
            (wallet.lower(), wallet.lower(), current_app.config['CHAIN_ID'], campaign)).fetchall()
    return jsonify(transactions=[dict(row) for row in rows])

@api.post('/api/transactions')
def record():
    body = request.get_json(silent=True)
    if not isinstance(body, dict) or not isinstance(body.get('hash'), str) or not HASH.fullmatch(body['hash']):
        return jsonify(error="A valid transaction hash is required"), 400
    address = body.get('campaign', current_app.config['CONTRACT_ADDRESS'])
    if not isinstance(address, str):
        return jsonify(error='Valid campaign required'), 400
    if address.lower() != current_app.config['CONTRACT_ADDRESS'].lower():
        with database() as db:
            if not db.execute('SELECT 1 FROM campaigns WHERE address=?', (address.lower(),)).fetchone():
                return jsonify(error='Unknown campaign'), 400
    if not ADDRESS.fullmatch(address) or int(address, 16) == 0:
        return jsonify(error="Server contract address is not configured"), 503
    tx_hash = body['hash'].lower()
    try:
        tx, action, status, block = verify_transaction(tx_hash, address)
    except BlockchainError as exc:
        return jsonify(error=str(exc)), exc.status_code
    with database() as db:
        db.execute('''INSERT INTO transactions
            (hash, chain_id, contract_address, wallet, action, value_wei, status, block_number)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(chain_id, hash) DO UPDATE SET status=excluded.status, block_number=excluded.block_number''',
            (tx_hash, current_app.config['CHAIN_ID'], address.lower(), tx['from'].lower(), action,
             str(tx['value']), status, block))
        row = db.execute('SELECT * FROM transactions WHERE hash=? AND chain_id=?', (tx_hash, current_app.config['CHAIN_ID'])).fetchone()
    return jsonify(dict(row))

