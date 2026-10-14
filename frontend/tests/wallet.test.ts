import test from 'node:test';
import assert from 'node:assert/strict';
import { connectWallet } from '../src/lib/wallet';
const address = '0x1111111111111111111111111111111111111111';

test('wallet connection requests permission and returns selected address', async () => {
  const calls: string[] = [];
  const wallet = { request: async ({ method }: { method: string }) => {
    calls.push(method);
    if (method === 'eth_chainId') return '0xaa36a7';
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
    throw new Error(method);
  } };
  assert.equal(await connectWallet(wallet, 11155111), address);
  assert.equal(calls[0], 'eth_requestAccounts');
  assert.ok(!calls.includes('wallet_switchEthereumChain'));
});
test('wrong network requests switch before accepting wallet', async () => {
  let chain = '0x1';
  const wallet = { request: async ({ method, params }: { method: string; params?: unknown }) => {
    if (method === 'eth_chainId') return chain;
    if (method === 'wallet_switchEthereumChain') { assert.deepEqual(params, [{ chainId: '0xaa36a7' }]); chain = '0xaa36a7'; return null; }
    return [address];
  } };
  assert.equal(await connectWallet(wallet, 11155111), address);
});
test('missing wallet and rejected connection are handled', async () => {
  await assert.rejects(connectWallet(undefined, 11155111), /Install MetaMask/);
  await assert.rejects(connectWallet({ request: async () => { throw new Error('User rejected'); } }, 11155111), /User rejected/);
});
test('wallet that fails to switch network is rejected', async () => {
  const wallet = { request: async ({ method }: { method: string }) => method === 'eth_chainId' ? '0x1' : [address] };
  await assert.rejects(connectWallet(wallet, 11155111), /network does not match/);
});
