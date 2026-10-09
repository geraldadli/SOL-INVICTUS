import { mkdirSync, writeFileSync } from 'node:fs';
import { ContractFactory, JsonRpcProvider, Wallet } from 'ethers';
import { compile } from './compile.mjs';

const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:8545';
const provider = new JsonRpcProvider(rpcUrl);
const { chainId } = await provider.getNetwork();
if (![31337n, 11155111n].includes(chainId)) throw new Error('Only local development or Sepolia is allowed.');
if (chainId === 11155111n && (!process.env.PUBLIC_RPC_URL || !process.env.DEPLOYER_PRIVATE_KEY)) throw new Error('Set PUBLIC_RPC_URL and DEPLOYER_PRIVATE_KEY before deploying to Sepolia.');
const signer = chainId === 31337n ? await provider.getSigner(0) : new Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
const artifact = compile();
const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy();
await contract.waitForDeployment();
const receipt = await contract.deploymentTransaction().wait();
const deployment = {
  address: await contract.getAddress(), operator: await signer.getAddress(), chainId: Number(chainId),
  rpcUrl: chainId === 31337n ? rpcUrl : process.env.PUBLIC_RPC_URL,
  blockNumber: receipt.blockNumber, abi: artifact.abi,
};
if (!deployment.rpcUrl) throw new Error('Set PUBLIC_RPC_URL to a browser-safe Sepolia RPC endpoint.');
mkdirSync('public', { recursive: true });
writeFileSync('public/deployment.json', JSON.stringify(deployment, null, 2));
console.log(`Deployed SuryaShare at ${deployment.address} on chain ${chainId}`);
console.log(`Deployment transaction: ${receipt.hash}`);
provider.destroy();
