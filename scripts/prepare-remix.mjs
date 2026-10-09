import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { compile } from './compile.mjs';
import { deploymentSettings, verifierEndpoint, checkVerifierService } from '../src/deployment-settings.js';

const previous = JSON.parse(readFileSync('deployments/sepolia.json', 'utf8'));
const setup = JSON.parse(readFileSync('deployments/sepolia-setup.json', 'utf8'));
const settings = deploymentSettings({ ...setup, operator: previous.operator });
await checkVerifierService(settings);
const artifact = compile(4);
const script = `// Sol Invictus v4 — Sepolia only, labeled sample records.
// In Remix: choose Injected Provider / Browser Extension (MetaMask), Sepolia,
// select the operator account, then run this script ONCE and review MetaMask.
// Uses the exact locally compiled bytecode so connect:sepolia can verify it.
(async () => {
  try {
    const ethers = require('ethers');
    const settings = ${JSON.stringify(settings, null, 2)};
    const artifact = ${JSON.stringify(artifact)};
    const provider = ethers.BrowserProvider ? new ethers.BrowserProvider(web3Provider) : new ethers.providers.Web3Provider(web3Provider);
    if (BigInt((await provider.getNetwork()).chainId) !== 11155111n) throw new Error('Choose MetaMask on Sepolia in Deploy & Run before running this script.');
    const signer = await provider.getSigner();
    if ((await signer.getAddress()).toLowerCase() !== settings.operator.toLowerCase()) throw new Error('Select the operator wallet: ' + settings.operator);
    const response = await fetch(${JSON.stringify(verifierEndpoint(settings.verifierUrl, 'health'))});
    if (!response.ok) throw new Error('Hosted verifier health check failed (HTTP ' + response.status + '). No deployment was submitted.');
    const health = await response.json();
    if (health.chainId !== 11155111 || health.mode !== 'simulated' || !health.persistentKey || health.project || health.verifier.toLowerCase() !== settings.verifier.toLowerCase()) throw new Error('Verifier is not ready for a new deployment.');
    if (health.operator.toLowerCase() !== settings.operator.toLowerCase() || health.reviewer.toLowerCase() !== settings.reviewer.toLowerCase()) throw new Error('Hosted verifier roles do not match these deployment settings.');
    console.log('Permanent operator:', settings.operator, 'Reviewer:', settings.reviewer, 'Verifier:', settings.verifier);
    console.log('Deploying a NEW project with 1,000 shares. Review and confirm the fee in MetaMask.');
    const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(settings.verifier, true, settings.reviewer);
    const tx = typeof contract.deploymentTransaction === 'function' ? contract.deploymentTransaction() : contract.deployTransaction;
    console.log('DEPLOYMENT TRANSACTION — SAVE THIS AND DO NOT RUN AGAIN:', tx.hash);
    const receipt = await tx.wait();
    if (Number(receipt.status) !== 1) throw new Error('Transaction failed. Inspect the receipt before retrying.');
    console.log('DEPLOYED CONTRACT:', receipt.contractAddress);
    console.log('Send the deployment transaction hash to Codex to bind the verifier and update GitHub Pages.');
  } catch (error) { console.error(error.message || error); }
})();
`;
mkdirSync('work/remix', { recursive: true });
writeFileSync('work/remix/deploy-sol-invictus-v4.js', script);
writeFileSync('work/remix/MilestoneSuryaShare.artifact.json', JSON.stringify(artifact, null, 2));
console.log('Prepared work/remix/deploy-sol-invictus-v4.js. Import into Remix and run with MetaMask on Sepolia.');
