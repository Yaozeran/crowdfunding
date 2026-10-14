import time
import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from backend.src.app import create_app
from backend.src.database import database

@pytest.fixture
def setup(tmp_path):
    owner, other = Account.create(), Account.create()
    app = create_app({'TESTING': True, 'DATABASE': str(tmp_path / 'test.sqlite'), 'CHAIN_ID': 1337, 'ADMIN_WALLETS': [owner.address.lower()]})
    return app, app.test_client(), owner, other

def login(client, account):
    challenge = client.post('/api/auth/challenge', json={'wallet': account.address}).get_json()
    signature = Account.sign_message(encode_defunct(text=challenge['message']), account.key).signature.hex()
    response = client.post('/api/auth/verify', json={'nonce': challenge['nonce'], 'signature': signature})
    assert response.status_code == 200
    return {'Authorization': 'Bearer ' + response.get_json()['token']}, challenge, signature

def seed(app, owner):
    with app.app_context(), database() as db:
        db.execute('INSERT INTO campaigns (address,creator,title,description,category,image,goal,deadline,created_at,start_block,indexed_block) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                   ('0x' + 'a'*40, owner.address.lower(), 'Library', 'Books for everyone', 'Community', 'https://example.com/image.jpg', '100', int(time.time()) + 1000, 1, 1, 0))

def test_signature_replay_wrong_signer_and_logout(setup):
    app, client, owner, other = setup
    headers, challenge, signature = login(client, owner)
    assert 'Chain ID: 1337' in challenge['message']
    assert 'localhost:3000 wants you' in challenge['message']
    assert client.post('/api/auth/verify', json={'nonce': challenge['nonce'], 'signature': signature}).status_code == 401
    fresh = client.post('/api/auth/challenge', json={'wallet': owner.address}).get_json()
    wrong = Account.sign_message(encode_defunct(text=fresh['message']), other.key).signature.hex()
    assert client.post('/api/auth/verify', json={'nonce': fresh['nonce'], 'signature': wrong}).status_code == 401
    assert client.post('/api/auth/logout', headers=headers).status_code == 200
    assert client.get('/api/admin/campaigns', headers=headers).status_code == 401

def test_expired_challenge(setup):
    app, client, owner, _ = setup
    challenge = client.post('/api/auth/challenge', json={'wallet': owner.address}).get_json()
    with app.app_context(), database() as db:
        db.execute('UPDATE challenges SET expires=0')
    signature = Account.sign_message(encode_defunct(text=challenge['message']), owner.key).signature.hex()
    assert client.post('/api/auth/verify', json={'nonce': challenge['nonce'], 'signature': signature}).status_code == 401

def test_discovery_owner_edit_and_moderation(setup):
    app, client, owner, other = setup
    seed(app, owner)
    owner_headers, _, _ = login(client, owner)
    other_headers, _, _ = login(client, other)
    address = '0x' + 'a'*40
    assert len(client.get('/api/campaigns?q=community&status=active').get_json()['campaigns']) == 1
    assert client.get('/api/campaigns?q=unknown').get_json()['campaigns'] == []
    body = {'title':'Changed','description':'Updated story','category':'Education','image':'https://example.com/new.jpg'}
    assert client.patch('/api/campaigns/' + address, headers=other_headers, json=body).status_code == 403
    assert client.patch('/api/campaigns/' + address, headers=owner_headers, json=body).status_code == 200
    assert client.patch('/api/campaigns/' + address, headers=owner_headers, json={**body, 'image':'javascript:alert(1)'}).status_code == 400
    assert client.patch('/api/admin/campaigns/' + address, headers=other_headers, json={'hidden':True,'flagged':True}).status_code == 403
    assert client.patch('/api/admin/campaigns/' + address, headers=owner_headers, json={'hidden':True,'flagged':True}).status_code == 200
    assert client.get('/api/campaigns').get_json()['campaigns'] == []
    assert len(client.get('/api/admin/campaigns', headers=owner_headers).get_json()['campaigns']) == 1
    assert client.patch('/api/settings', headers=other_headers, json={'creation_paused':True}).status_code == 403
    assert client.patch('/api/settings', headers=owner_headers, json={'creation_paused':True}).status_code == 200
    assert client.get('/api/settings').get_json()['creation_paused'] is True

def test_public_history_filter_and_json_validation(setup):
    app, client, owner, _ = setup
    seed(app, owner)
    address = '0x' + 'a' * 40
    assert client.get('/api/transactions?campaign=' + address).status_code == 200
    assert client.post('/api/auth/challenge', json=[]).status_code == 400
    assert client.get('/api/campaigns?sort=untrusted').status_code == 400


def test_registered_contract_and_event_indexing(setup):
    from types import SimpleNamespace
    from unittest.mock import Mock
    from web3 import Web3
    from backend.src.platform import ARTIFACT
    app, client, owner, _ = setup
    headers, _, _ = login(client, owner)
    address = '0x' + 'a' * 40
    eth = Mock()
    eth.chain_id = 1337
    eth.block_number = 15
    eth.get_transaction_receipt.return_value = {'status':1,'contractAddress':Web3.to_checksum_address(address),'blockNumber':10}
    eth.get_transaction.return_value = {'from':owner.address,'input':bytes.fromhex(ARTIFACT['bytecode'][2:]) + bytes(96)}
    eth.get_block.return_value = {'timestamp':int(time.time())}
    contract = Mock()
    contract.functions.beneficiary().call.return_value = owner.address
    contract.functions.goal().call.return_value = 100
    contract.functions.deadline().call.return_value = int(time.time()) + 1000
    contract.functions.totalRaised().call.return_value = 25
    contract.functions.cancelled().call.return_value = False
    contract.functions.withdrawn().call.return_value = False
    event = {'transactionHash': bytes.fromhex('b'*64), 'blockNumber':12, 'args':{'contributor':owner.address,'amount':25}}
    contract.events.Contributed().get_logs.return_value = [event]
    contract.events.Refunded().get_logs.return_value = []
    contract.events.Withdrawn().get_logs.return_value = []
    eth.contract.return_value = contract
    app.extensions['web3'] = SimpleNamespace(eth=eth)
    body = {'deployment_hash':'0x'+'c'*64,'title':'Library','description':'Books','category':'Community','image':'https://example.com/a.jpg'}
    assert client.post('/api/campaigns', headers=headers, json=body).status_code == 201
    assert client.post('/api/campaigns/' + address + '/sync').status_code == 200
    assert client.get('/api/campaigns').get_json()['campaigns'][0]['raised'] == '25'
    history = client.get('/api/transactions?campaign=' + address).get_json()['transactions']
    assert history[0]['value_wei'] == '25'
    assert history[0]['action'] == 'contribute'
    assert client.post('/api/campaigns/' + address + '/sync').status_code == 200
    assert len(client.get('/api/transactions?campaign=' + address).get_json()['transactions']) == 1
    eth.get_transaction.return_value['input'] = bytes(100)
    assert client.post('/api/campaigns', headers=headers, json=body).status_code == 400
