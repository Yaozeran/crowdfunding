"""Verify transaction data using the configured chain provider."""
from flask import current_app
from web3 import Web3
from web3.exceptions import TransactionNotFound

ACTIONS = {Web3.keccak(text=f"{name}()")[:4].hex(): name
           for name in ("contribute", "refund", "withdraw", "cancel")}


class BlockchainError(Exception):
    def __init__(self, message, status_code):
        super().__init__(message)
        self.status_code = status_code


def verify_transaction(tx_hash, address):
    w3 = current_app.extensions["web3"]
    try:
        if w3.eth.chain_id != current_app.config['CHAIN_ID']:
            raise BlockchainError("Server RPC network does not match configuration", 503)
        tx = w3.eth.get_transaction(tx_hash)
        if (tx.get('to') or '').lower() != address.lower():
            raise BlockchainError("Transaction is not for this campaign", 400)
        data = bytes(tx['input'])
        action = ACTIONS.get(data.hex()) if len(data) == 4 else None
        if action is None:
            raise BlockchainError("Unsupported campaign action", 400)
        try:
            receipt = w3.eth.get_transaction_receipt(tx_hash)
            status = 'confirmed' if receipt['status'] == 1 else 'failed'
            block = receipt['blockNumber']
        except TransactionNotFound:
            status, block = 'pending', None
    except TransactionNotFound:
        raise BlockchainError("Transaction not yet visible to server RPC; retry shortly", 404)
    except BlockchainError:
        raise
    except Exception:
        current_app.logger.exception("Blockchain lookup failed")
        raise BlockchainError("Blockchain provider unavailable; retry shortly", 503)
    return tx, action, status, block
