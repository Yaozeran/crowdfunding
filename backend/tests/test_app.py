from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from web3 import Web3
from web3.exceptions import TransactionNotFound
from backend.src.app import create_app

CONTRACT = '0x' + 'a' * 40
WALLET = '0x' + 'b' * 40
HASH = '0x' + 'c' * 64


@pytest.fixture
def setup(tmp_path):
    eth = Mock()
    eth.chain_id = 1337
    eth.get_transaction.return_value = dict(to=CONTRACT, **{'from': WALLET},
        input=Web3.keccak(text='contribute()')[:4], value=10**18)
    eth.get_transaction_receipt.return_value = dict(status=1, blockNumber=12)
    config = dict(TESTING=True, DATABASE=str(tmp_path / 'tx.sqlite3'), CONTRACT_ADDRESS=CONTRACT, CHAIN_ID=1337)
    provider = SimpleNamespace(eth=eth)
    app = create_app(config, provider)
    return app.test_client(), eth, config, provider


def test_records_chain_data_not_client_claims_and_persists(setup):
    client, eth, config, provider = setup
    result = client.post('/api/transactions', json=dict(hash=HASH, status='failed', wallet='attacker', value_wei='0'))
    assert result.status_code == 200
    assert result.json['wallet'] == WALLET
    assert result.json['value_wei'] == str(10**18)
    assert result.json['status'] == 'confirmed'
    assert client.post('/api/transactions', json=dict(hash=HASH)).status_code == 200
    restarted = create_app(config, provider).test_client()
    assert len(restarted.get('/api/transactions?wallet=' + WALLET).json['transactions']) == 1
    assert restarted.get('/api/transactions?wallet=' + CONTRACT).json['transactions'] == []


@pytest.mark.parametrize('body', [None, [], {}, {'hash': 'bad'}, {'hash': 123}])
def test_invalid_body(setup, body):
    assert setup[0].post('/api/transactions', json=body).status_code == 400


def test_pending_to_confirmed_and_failed(setup):
    client, eth, _, _ = setup
    eth.get_transaction_receipt.side_effect = TransactionNotFound("not found")
    assert client.post('/api/transactions', json={'hash': HASH}).json['status'] == 'pending'
    eth.get_transaction_receipt.side_effect = None
    assert client.post('/api/transactions', json={'hash': HASH}).json['status'] == 'confirmed'
    eth.get_transaction_receipt.return_value = dict(status=0, blockNumber=13)
    assert client.post('/api/transactions', json={'hash': HASH}).json['status'] == 'failed'


def test_wrong_contract_and_unknown_method_rejected(setup):
    client, eth, _, _ = setup
    eth.get_transaction.return_value['to'] = WALLET
    assert client.post('/api/transactions', json={'hash': HASH}).status_code == 400
    eth.get_transaction.return_value['to'] = CONTRACT
    eth.get_transaction.return_value['input'] = b''
    assert client.post('/api/transactions', json={'hash': HASH}).status_code == 400


def test_unknown_transaction_rpc_failure_and_network_mismatch(setup):
    client, eth, _, _ = setup
    eth.get_transaction.side_effect = TransactionNotFound("not found")
    assert client.post('/api/transactions', json={'hash': HASH}).status_code == 404
    eth.get_transaction.side_effect = ConnectionError
    assert client.post('/api/transactions', json={'hash': HASH}).status_code == 503
    eth.chain_id = 1
    assert client.post('/api/transactions', json={'hash': HASH}).status_code == 503


def test_history_validation_cors_and_health(setup):
    client = setup[0]
    assert client.get('/api/transactions?wallet=bad').status_code == 400
    assert client.get('/api/health').json == {'status': 'ok'}
    assert client.get('/api/health', headers={'Origin': 'http://localhost:3000'}).headers['Access-Control-Allow-Origin'] == 'http://localhost:3000'
    assert 'Access-Control-Allow-Origin' not in client.get('/api/health', headers={'Origin': 'https://other.test'}).headers


def test_contract_configuration_required(setup):
    _, _, config, provider = setup
    config['CONTRACT_ADDRESS'] = ''
    client = create_app(config, provider).test_client()
    assert client.post('/api/transactions', json={'hash': HASH}).status_code == 503
