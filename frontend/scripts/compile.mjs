import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import solc from 'solc';

export function compile() {
  const source = readFileSync(new URL('../../sol/Crowdfund.sol', import.meta.url), 'utf8');
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'Crowdfund.sol': { content: source } }, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  const errors = output.errors?.filter(e => e.severity === 'error');
  if (errors?.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  const artifact = output.contracts['Crowdfund.sol'].Crowdfund;
  return { abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` };
}
if (process.argv[1]?.endsWith('/compile.mjs')) {
  mkdirSync(new URL('../../sol/artifacts/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../../sol/artifacts/Crowdfund.json', import.meta.url), JSON.stringify(compile(), null, 2));
  const serialized = JSON.stringify(compile(), null, 2);
  writeFileSync(new URL('../src/lib/contract-artifact.json', import.meta.url), serialized);
  writeFileSync(new URL('../../backend/src/contract-artifact.json', import.meta.url), serialized);
  console.log('Compiled and synchronized campaign artifacts');
}
