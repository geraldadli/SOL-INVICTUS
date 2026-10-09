import { mkdirSync, writeFileSync } from 'node:fs';
import { Contract, JsonRpcProvider } from 'ethers';
import { compile } from './compile.mjs';

const hash = process.argv[2];
if (!/^0x[\da-f]{64}$/i.test(hash ?? '')) throw new Error('Usage: npm run connect:sepolia -- <deployment transaction hash>');
const rpcUrl = process.env.PUBLIC_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
if (new URL(rpcUrl).protocol !== 'https:') throw new Error('A public HTTPS RPC is required.');
const provider = new JsonRpcProvider(rpcUrl);
try {
  if ((await provider.getNetwork()).chainId !== 11155111n) throw new Error('Expected Sepolia.');
  const receipt = await provider.getTransactionReceipt(hash);
  if (!receipt || receipt.status !== 1 || !receipt.contractAddress) throw new Error('A confirmed, successful contract deployment is required.');
  const artifact = compile();
  const tx = await provider.getTransaction(hash);
  if (tx.data.toLowerCase() !== artifact.bytecode.toLowerCase()) throw new Error('This transaction did not deploy the current SuryaShare contract.');
  const contract = new Contract(receipt.contractAddress, artifact.abi, provider);
  const operator = await contract.operator();
  if (operator.toLowerCase() !== receipt.from.toLowerCase() || await contract.totalSupply() !== 1000n) throw new Error('Contract verification failed.');
  const config = { address: receipt.contractAddress, operator, chainId: 11155111, rpcUrl, blockNumber: receipt.blockNumber, abi: artifact.abi };
  mkdirSync('deployments', { recursive: true });
  writeFileSync('deployments/sepolia.json', JSON.stringify(config, null, 2) + '\n');
  console.log(`Verified ${config.address}. Operator: ${operator}. Commit deployments/sepolia.json and push to connect Pages.`);
} finally { provider.destroy(); }
