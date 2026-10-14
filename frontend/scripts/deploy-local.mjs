import { ContractFactory, JsonRpcProvider, parseEther } from 'ethers';
import { compile } from './compile.mjs';
const provider = new JsonRpcProvider('http://127.0.0.1:8545');
if ((await provider.getNetwork()).chainId !== 1337n) throw new Error('Local deployment requires chain 1337');
const signer = await provider.getSigner(0);
const artifact = compile();
const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(await signer.getAddress(), parseEther('1'), 3600);
await contract.waitForDeployment();
console.log(`Contract: ${await contract.getAddress()}\nBeneficiary: ${await signer.getAddress()}\nGoal: 1 ETH\nDuration: 1 hour\nChain ID: 1337`);
