import test from 'node:test';
import assert from 'node:assert/strict';
import { contributionWei, friendlyError } from '../src/lib/campaign';
test('ETH parsing preserves precision without floating point', () => {
  assert.equal(contributionWei('0.000000000000000001'), BigInt(1));
  assert.equal(contributionWei('1.123456789012345678'), BigInt("1123456789012345678"));
});
test('invalid, zero, negative and over-precision amounts cannot be submitted', () => {
  for (const value of ['', '0', '-1', '1e2', 'NaN', 'Infinity', '0.0000000000000000001', ' 1', '01', '.']) assert.throws(() => contributionWei(value));
});
test('wallet rejection produces an actionable message', () => {
  assert.match(friendlyError({ code: 4001 }), /declined/);
  assert.match(friendlyError({ code: 'ACTION_REJECTED' }), /declined/);
});
