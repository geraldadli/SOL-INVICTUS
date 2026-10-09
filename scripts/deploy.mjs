import { mkdirSync, writeFileSync } from 'node:fs';
import { ContractFactory, JsonRpcProvider, Wallet } from 'ethers';
import { compile } from './compile.mjs';

const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:8545';
const provider = new JsonRpcProvider(rpcUrl);
const { chainId } = await provider.getNetwork();
if (![31337n, 11155111n].includes(chainId)) throw new Error('Only local development or Sepolia is allowed.');
if (chainId === 11155111n && (!process.env.PUBLIC_RPC_URL || !process.env.DEPLOYER_PRIVATE_KEY)) throw new Error('Set PUBLIC_RPC_URL and DEPLOYER_PRIVATE_KEY before deploying to Sepolia.');
const signer = chainId === 31337n ? await provider.getSigner(0) : new Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
const verified = Boolean(process.env.VERIFIER_ADDRESS);
if (verified && chainId !== 31337n) throw new Error('Automated verification deployment is local-only until an external evidence source is configured.');
const artifact = compile(verified ? 4 : 2);
const reviewer = verified ? await (await provider.getSigner(3)).getAddress() : null;
const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(...(verified ? [process.env.VERIFIER_ADDRESS, true, reviewer] : []));
await contract.waitForDeployment();
const receipt = await contract.deploymentTransaction().wait();
const deployment = {
  address: await contract.getAddress(), operator: await contract.operator(), contractVersion: Number(await contract.CONTRACT_VERSION()), chainId: Number(chainId),
  rpcUrl: chainId === 31337n ? rpcUrl : process.env.PUBLIC_RPC_URL,
  blockNumber: receipt.blockNumber, abi: artifact.abi,
  ...(verified ? { verifierUrl: process.env.VERIFIER_URL } : {}),
};
if (!deployment.rpcUrl) throw new Error('Set PUBLIC_RPC_URL to a browser-safe Sepolia RPC endpoint.');
mkdirSync('public', { recursive: true });
const configName = process.env.LOCAL_DEPLOYMENT_FILE || 'deployment.json';
if (!/^deployment(?:-[a-z0-9-]+)?\.json$/.test(configName) || (chainId !== 31337n && configName !== 'deployment.json')) throw new Error('Invalid deployment filename.');
writeFileSync(`public/${configName}`, JSON.stringify(deployment, null, 2));
console.log(`Deployed Sol Invictus at ${deployment.address} on chain ${chainId}`);
console.log(`Deployment transaction: ${receipt.hash}`);
provider.destroy();
