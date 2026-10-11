import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { AbiCoder, Contract, JsonRpcProvider } from 'ethers';
import { compile } from './compile.mjs';
import { deploymentSettings, verifyCreationData, checkVerifierService } from '../src/deployment-settings.js';

const hash = process.argv[2];
if (!/^0x[\da-f]{64}$/i.test(hash ?? '')) throw new Error('Usage: npm run connect:sepolia -- <deployment transaction hash>');
// Keep the published RPCs across redeploys unless overridden. The logs RPC must serve full event history.
let previous = {};
try { previous = JSON.parse(readFileSync('deployments/sepolia.json', 'utf8')); } catch {}
const rpcUrl = process.env.PUBLIC_RPC_URL || previous.rpcUrl || 'https://sepolia.gateway.tenderly.co';
const logsRpcUrl = process.env.PUBLIC_LOGS_RPC_URL || previous.logsRpcUrl;
for (const url of [rpcUrl, logsRpcUrl ?? rpcUrl]) if (new URL(url).protocol !== 'https:') throw new Error('A public HTTPS RPC is required.');
const provider = new JsonRpcProvider(rpcUrl);
try {
  if ((await provider.getNetwork()).chainId !== 11155111n) throw new Error('Expected Sepolia.');
  const receipt = await provider.getTransactionReceipt(hash);
  if (!receipt || receipt.status !== 1 || !receipt.contractAddress) throw new Error('A confirmed, successful contract deployment is required.');
  let artifact = compile(), version = 2, settings;
  const tx = await provider.getTransaction(hash);
  if (!tx || tx.to !== null || tx.value !== 0n) throw new Error('Expected a direct zero-value deployment transaction.');
  if (tx.data.toLowerCase() !== artifact.bytecode.toLowerCase()) {
    version = 4; artifact = compile(4);
    if (!tx.data.toLowerCase().startsWith(artifact.bytecode.toLowerCase())) throw new Error('This transaction did not deploy the current Sol Invictus contract.');
    const [verifier, demo, reviewer] = AbiCoder.defaultAbiCoder().decode(['address', 'bool', 'address'], `0x${tx.data.slice(artifact.bytecode.length)}`);
    if (!demo) throw new Error('This workflow supports labeled demo records only.');
    const setup = JSON.parse(readFileSync('deployments/sepolia-setup.json', 'utf8'));
    settings = deploymentSettings({ operator: receipt.from, verifier, reviewer, verifierUrl: process.env.VERIFIER_URL || setup.verifierUrl });
    if (settings.reviewer.toLowerCase() !== setup.reviewer.toLowerCase() || settings.verifier.toLowerCase() !== setup.verifier.toLowerCase()) throw new Error('Deployment roles do not match the reviewed setup.');
    verifyCreationData(tx.data, artifact, settings);
  }
  const contract = new Contract(receipt.contractAddress, artifact.abi, provider);
  const operator = await contract.operator();
  if (operator.toLowerCase() !== receipt.from.toLowerCase() || await contract.totalSupply() !== 1000n || await contract.CONTRACT_VERSION() !== BigInt(version)) throw new Error('Contract verification failed.');
  if (version === 4) {
    if (await contract.trustedVerifier() !== settings.verifier || await contract.milestoneReviewer() !== settings.reviewer || !await contract.demoVerification()) throw new Error('Onchain roles do not match deployment settings.');
    await checkVerifierService(settings, receipt.contractAddress);
  }
  const config = { address: receipt.contractAddress, operator, contractVersion: version, chainId: 11155111, rpcUrl, ...(logsRpcUrl ? { logsRpcUrl } : {}), blockNumber: receipt.blockNumber, deploymentTransaction: hash, abi: artifact.abi,
    ...(settings ? { verifierUrl: settings.verifierUrl, verifier: settings.verifier, milestoneReviewer: settings.reviewer } : {}) };
  mkdirSync('deployments', { recursive: true });
  writeFileSync('deployments/sepolia.json', JSON.stringify(config, null, 2) + '\n');
  console.log(`Verified ${config.address}. Operator: ${operator}. Commit deployments/sepolia.json and push to connect Pages.`);
} finally { provider.destroy(); }
