"""Authenticated campaign catalog and event indexing for ETH campaigns."""
import hashlib
import json
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from functools import wraps
from eth_account import Account
from eth_account.messages import encode_defunct
from flask import Blueprint, current_app, request, jsonify, g
from web3 import Web3
from .database import database

platform = Blueprint('platform', __name__)
ARTIFACT = json.loads(Path(__file__).with_name('contract-artifact.json').read_text())


def payload():
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else {}


def failure(message, code=400):
    return jsonify(error=message), code


def authenticated(admin=False):
    def decorator(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            token = request.headers.get('Authorization', '').removeprefix('Bearer ')
            with database() as db:
                row = db.execute('SELECT wallet FROM sessions WHERE token=? AND expires>?',
                                 (hashlib.sha256(token.encode()).hexdigest(), int(time.time()))).fetchone()
            if not row:
                return failure('Sign in with your wallet first', 401)
            g.wallet = row['wallet']
            if admin and g.wallet not in current_app.config['ADMIN_WALLETS']:
                return failure('Administrator access required', 403)
            return fn(*args, **kwargs)
        return wrapped
    return decorator


@platform.post('/api/auth/challenge')
def challenge():
    body = payload()
    wallet = body.get('wallet', '')
    if not isinstance(wallet, str) or not Web3.is_address(wallet):
        return failure('Valid wallet required')
    nonce = secrets.token_hex(16)
    now = int(time.time())
    origin = current_app.config['WEB_ORIGIN']
    issued = datetime.fromtimestamp(now, timezone.utc).isoformat().replace('+00:00', 'Z')
    expiry = datetime.fromtimestamp(now + 300, timezone.utc).isoformat().replace('+00:00', 'Z')
    message = (f"{urlparse(origin).netloc} wants you to sign in with your Ethereum account:\n"
               f"{Web3.to_checksum_address(wallet)}\n\nSign in to Common Ground.\n\nURI: {origin}\n"
               f"Version: 1\nChain ID: {current_app.config['CHAIN_ID']}\nNonce: {nonce}\nIssued At: {issued}\nExpiration Time: {expiry}")
    with database() as db:
        db.execute('DELETE FROM challenges WHERE expires<?', (now,))
        db.execute('INSERT INTO challenges VALUES (?,?,?,?)', (nonce, wallet.lower(), message, now + 300))
    return jsonify(nonce=nonce, message=message)


@platform.post('/api/auth/verify')
def verify():
    body = payload()
    with database() as db:
        row = db.execute('SELECT * FROM challenges WHERE nonce=? AND expires>?',
                         (body.get('nonce', ''), int(time.time()))).fetchone()
        if not row:
            return failure('Challenge expired or already used', 401)
        try:
            signer = Account.recover_message(encode_defunct(text=row['message']), signature=body.get('signature', ''))
        except Exception:
            return failure('Invalid signature', 401)
        if signer.lower() != row['wallet']:
            return failure('Signature does not match wallet', 401)
        # Consume once within the same SQLite write transaction.
        result = db.execute('DELETE FROM challenges WHERE nonce=?', (row['nonce'],))
        if result.rowcount != 1:
            return failure('Challenge already used', 401)
        token = secrets.token_urlsafe(32)
        db.execute('INSERT INTO sessions VALUES (?,?,?)',
                   (hashlib.sha256(token.encode()).hexdigest(), row['wallet'], int(time.time()) + 3600))
    return jsonify(token=token, wallet=row['wallet'], admin=row['wallet'] in current_app.config['ADMIN_WALLETS'])


@platform.post('/api/auth/logout')
@authenticated()
def logout():
    token = request.headers['Authorization'].removeprefix('Bearer ')
    with database() as db:
        db.execute('DELETE FROM sessions WHERE token=?', (hashlib.sha256(token.encode()).hexdigest(),))
    return jsonify(ok=True)


def metadata(body):
    values = []
    for key, limit in [('title', 120), ('description', 6000), ('category', 60), ('image', 2000)]:
        value = body.get(key)
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise ValueError(f'{key} is required (maximum {limit} characters)')
        values.append(value.strip())
    parsed = urlparse(values[3])
    if parsed.scheme != 'https' or not parsed.netloc or parsed.username:
        raise ValueError('Image must be an HTTPS URL')
    return values


def chain():
    w3 = current_app.extensions['web3']
    if w3.eth.chain_id != current_app.config['CHAIN_ID']:
        raise ValueError('RPC network mismatch')
    return w3


@platform.post('/api/campaigns')
@authenticated()
def register():
    body = payload()
    try:
        fields = metadata(body)
        w3 = chain()
        receipt = w3.eth.get_transaction_receipt(body.get('deployment_hash', ''))
        tx = w3.eth.get_transaction(body['deployment_hash'])
        address = receipt.get('contractAddress')
        # Require our exact creation bytecode, deployed by the authenticated wallet.
        if receipt['status'] != 1 or not address or tx['from'].lower() != g.wallet or len(bytes(tx['input'])) != (len(ARTIFACT['bytecode']) - 2) // 2 + 96 or not bytes(tx['input']).hex().startswith(ARTIFACT['bytecode'][2:]):
            return failure('Deploy the supported campaign contract from your signed-in wallet')
        contract = w3.eth.contract(address=address, abi=ARTIFACT['abi'])
        creator = contract.functions.beneficiary().call().lower()
        goal = contract.functions.goal().call()
        deadline = contract.functions.deadline().call()
        if creator != g.wallet or goal <= 0 or deadline <= w3.eth.get_block('latest')['timestamp']:
            return failure('Campaign creator, target or deadline invalid')
        with database() as db:
            pause = db.execute("SELECT value FROM settings WHERE key='creation_paused'").fetchone()
            if pause and pause['value'] == 'true':
                return failure('Campaign creation is paused', 403)
            existing = db.execute('SELECT creator FROM campaigns WHERE address=?', (address.lower(),)).fetchone()
            if existing:
                return jsonify(address=address.lower()), 200
            db.execute('INSERT INTO campaigns (address,creator,title,description,category,image,goal,deadline,created_at,start_block,indexed_block) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                       (address.lower(), creator, *fields, str(goal), deadline, int(time.time()), receipt['blockNumber'], receipt['blockNumber'] - 1))
        return jsonify(address=address.lower()), 201
    except ValueError as exc:
        return failure(str(exc))
    except Exception:
        current_app.logger.exception('Campaign registration failed')
        return failure('Unable to register campaign; verify deployment and RPC availability', 503)


@platform.get('/api/campaigns')
def browse():
    with database() as db:
        rows = db.execute('SELECT * FROM campaigns WHERE hidden=0').fetchall()
    campaigns = []
    query = request.args.get('q', '').lower()
    status_filter = request.args.get('status', '')
    for row in rows:
        item = dict(row)
        item['status'] = ('cancelled' if item['cancelled'] else 'active' if item['deadline'] > time.time()
                          else 'successful' if int(item['raised']) >= int(item['goal']) else 'failed')
        if query not in (item['title'] + ' ' + item['category']).lower() or (status_filter and item['status'] != status_filter):
            continue
        campaigns.append(item)
    sort = request.args.get('sort', 'created_at')
    if sort not in ('deadline', 'raised', 'created_at'):
        return failure('Invalid sort')
    campaigns.sort(key=lambda c: int(c[sort]), reverse=sort != 'deadline')
    return jsonify(campaigns=campaigns)


@platform.patch('/api/campaigns/<address>')
@authenticated()
def edit(address):
    try:
        fields = metadata(payload())
    except ValueError as exc:
        return failure(str(exc))
    with database() as db:
        row = db.execute('SELECT * FROM campaigns WHERE address=?', (address.lower(),)).fetchone()
        if not row:
            return failure('Campaign not found', 404)
        if row['creator'] != g.wallet and g.wallet not in current_app.config['ADMIN_WALLETS']:
            return failure('Only creator or administrator can edit', 403)
        if row['hidden'] and g.wallet not in current_app.config['ADMIN_WALLETS']:
            return failure('Hidden listings require administrator review', 403)
        db.execute('UPDATE campaigns SET title=?,description=?,category=?,image=? WHERE address=?', (*fields, address.lower()))
    return jsonify(ok=True)


@platform.post('/api/campaigns/<address>/sync')
def sync(address):
    with database() as db:
        row = db.execute('SELECT * FROM campaigns WHERE address=?', (address.lower(),)).fetchone()
    if not row:
        return failure('Campaign not found', 404)
    try:
        w3 = chain()
        contract = w3.eth.contract(address=Web3.to_checksum_address(address), abi=ARTIFACT['abi'])
        latest = w3.eth.block_number
        # Bounded batches also index wallet transactions made outside this website.
        end = min(latest, row['indexed_block'] + 2000)
        records = []
        if end > row['indexed_block']:
            for event, action, actor in [('Contributed','contribute','contributor'), ('Refunded','refund','contributor'), ('Withdrawn','withdraw','beneficiary')]:
                for log in getattr(contract.events, event)().get_logs(from_block=row['indexed_block'] + 1, to_block=end):
                    block = w3.eth.get_block(log['blockNumber'])
                    stamp = datetime.fromtimestamp(block['timestamp'], timezone.utc).isoformat()
                    records.append(('0x' + bytes(log['transactionHash']).hex(), current_app.config['CHAIN_ID'], address.lower(), log['args'][actor].lower(), action, str(log['args']['amount']), 'confirmed', log['blockNumber'], stamp))
        raised = contract.functions.totalRaised().call()
        cancelled = contract.functions.cancelled().call()
        withdrawn = contract.functions.withdrawn().call()
        with database() as db:
            for record in records:
                db.execute('INSERT INTO transactions (hash,chain_id,contract_address,wallet,action,value_wei,status,block_number,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(chain_id,hash) DO UPDATE SET value_wei=excluded.value_wei,status=excluded.status,block_number=excluded.block_number,created_at=excluded.created_at', record)
            db.execute('UPDATE campaigns SET raised=?,cancelled=?,withdrawn=?,indexed_block=? WHERE address=?', (str(raised), int(cancelled), int(withdrawn), end, address.lower()))
        return jsonify(ok=True, indexed_block=end, latest_block=latest)
    except Exception:
        current_app.logger.exception('Event indexing failed')
        return failure('Blockchain unavailable; campaign state may be stale', 503)


@platform.get('/api/admin/campaigns')
@authenticated(admin=True)
def admin_campaigns():
    with database() as db:
        return jsonify(campaigns=[dict(r) for r in db.execute('SELECT * FROM campaigns').fetchall()])


@platform.patch('/api/admin/campaigns/<address>')
@authenticated(admin=True)
def moderate(address):
    body = payload()
    if not all(type(body.get(k)) is bool for k in ('hidden', 'flagged')):
        return failure('hidden and flagged must be booleans')
    with database() as db:
        result = db.execute('UPDATE campaigns SET hidden=?,flagged=? WHERE address=?', (body['hidden'], body['flagged'], address.lower()))
    return jsonify(ok=True) if result.rowcount else failure('Campaign not found', 404)


@platform.route('/api/settings', methods=['GET', 'PATCH'])
def settings():
    if request.method == 'PATCH':
        return update_settings()
    with database() as db:
        row = db.execute("SELECT value FROM settings WHERE key='creation_paused'").fetchone()
    return jsonify(creation_paused=bool(row and row['value'] == 'true'))


@authenticated(admin=True)
def update_settings():
    body = payload()
    if type(body.get('creation_paused')) is not bool:
        return failure('creation_paused must be a boolean')
    with database() as db:
        db.execute("INSERT INTO settings VALUES ('creation_paused',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(body['creation_paused']),))
    return jsonify(ok=True)
