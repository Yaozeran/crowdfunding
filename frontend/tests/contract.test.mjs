import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, parseEther, ZeroAddress } from 'ethers';
import { compile } from '../scripts/compile.mjs';
const artifact = compile();

async function fixture(t, goal = '1') {
  const rpc = ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 3 } });
  t.after(() => rpc.disconnect());
  const provider = new BrowserProvider(rpc);
  provider.pollingInterval = 10;
  const owner = await provider.getSigner(0), donor = await provider.getSigner(1);
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, owner);
  const contract = await factory.deploy(await owner.getAddress(), parseEther(goal), 60);
  await contract.waitForDeployment();
  return { rpc, provider, owner, donor, factory, contract, end: async () => { await rpc.request({ method: 'evm_increaseTime', params: [61] }); await rpc.request({ method: 'evm_mine', params: [] }); } };
}

test('deployment validates campaign parameters', async t => {
  const { factory, owner } = await fixture(t);
  for (const args of [[ZeroAddress, 1, 60], [await owner.getAddress(), 0, 60], [await owner.getAddress(), 1, 0]]) await assert.rejects(factory.deploy(...args));
});
test('positive contribution is recorded, zero and premature settlement are rejected', async t => {
  const { contract, donor } = await fixture(t);
  await assert.rejects(contract.connect(donor).contribute({ value: 0 }));
  await (await contract.connect(donor).contribute({ value: parseEther('0.25') })).wait();
  assert.equal(await contract.totalRaised(), parseEther('0.25'));
  assert.equal(await contract.contributions(await donor.getAddress()), parseEther('0.25'));
  await assert.rejects(async () => { await (await contract.connect(donor).refund()).wait(); });
  await assert.rejects(contract.withdraw());
});
test('successful campaign permits only beneficiary to withdraw once, after deadline', async t => {
  const { contract, donor, end, rpc } = await fixture(t);
  await (await contract.connect(donor).contribute({ value: parseEther('1') })).wait();
  await assert.rejects(contract.withdraw());
  await end();
  await assert.rejects(contract.connect(donor).withdraw());
  await assert.rejects(async () => { await (await contract.connect(donor).refund()).wait(); });
  await (await contract.withdraw({ gasLimit: 150000 })).wait();
  assert.equal(await contract.withdrawn(), true);
  assert.equal(BigInt(await rpc.request({ method: 'eth_getBalance', params: [await contract.getAddress(), 'latest'] })), 0n);
  await assert.rejects(contract.withdraw());
  await assert.rejects(async () => { await (await contract.connect(donor).contribute({ value: 1 })).wait(); });
});
test('failed campaign refunds each donor only once and blocks beneficiary withdrawal', async t => {
  const { contract, donor, end, rpc } = await fixture(t);
  await (await contract.connect(donor).contribute({ value: parseEther('0.25') })).wait();
  await end();
  await assert.rejects(contract.withdraw());
  await (await contract.connect(donor).refund()).wait();
  assert.equal(await contract.contributions(await donor.getAddress()), 0n);
  assert.equal(await contract.totalRaised(), parseEther('0.25'));
  assert.equal(BigInt(await rpc.request({ method: 'eth_getBalance', params: [await contract.getAddress(), 'latest'] })), 0n);
  await assert.rejects(async () => { await (await contract.connect(donor).refund()).wait(); });
  await assert.rejects(contract.refund());
});

test('creator cancellation enables immediate refunds and prevents new funding or withdrawal', async t => {
  const { contract, donor } = await fixture(t);
  await (await contract.connect(donor).contribute({ value: parseEther('1') })).wait();
  await assert.rejects(contract.connect(donor).cancel());
  await (await contract.cancel()).wait();
  assert.equal(await contract.cancelled(), true);
  await assert.rejects(async () => { await (await contract.cancel()).wait(); });
  await assert.rejects(async () => { await (await contract.connect(donor).contribute({ value: 1 })).wait(); });
  await assert.rejects(contract.withdraw());
  await (await contract.connect(donor).refund()).wait();
  assert.equal(await contract.contributions(await donor.getAddress()), 0n);
  await assert.rejects(async () => { await (await contract.connect(donor).refund()).wait(); });
});
test('expired campaigns cannot be cancelled', async t => {
  const { contract, end } = await fixture(t);
  await end();
  await assert.rejects(async () => { await (await contract.cancel()).wait(); });
});
