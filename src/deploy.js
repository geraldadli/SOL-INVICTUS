import { BrowserProvider, ContractFactory, formatEther } from 'ethers';
import { ensureWalletNetwork } from './wallet-network.js';
import { getMetaMaskProvider } from './metamask.js';
import artifact from '../artifacts/SuryaShare.json';

const $ = selector => document.querySelector(selector);
const pendingKey = 'suryashare.sepolia.deployment.v2';
let signer;
const message = error => error.code === 'ACTION_REJECTED' || error.code === 4001
  ? 'Cancelled in your wallet. No deployment was submitted.'
  : error.shortMessage || error.message;

function showTransaction(hash) {
  $('#receipt').href = `https://sepolia.etherscan.io/tx/${hash}`;
  $('#receipt').textContent = `Deployment transaction: ${hash}`;
  $('#receipt').hidden = false;
  $('#next').hidden = false;
  $('#deploy').disabled = true;
}
let savedHash;
try { savedHash = localStorage.getItem(pendingKey); } catch { /* Wallet history also retains the transaction. */ }
if (/^0x[\da-f]{64}$/i.test(savedHash ?? '')) {
  showTransaction(savedHash);
  $('#status').textContent = 'A deployment was already submitted from this browser. Check its receipt before deploying again.';
}

$('#connect').onclick = async () => {
  $('#connect').disabled = true;
  $('#deploy').disabled = true;
  signer = null;
  try {
    const wallet = await getMetaMaskProvider();
    await wallet.request({ method: 'eth_requestAccounts' });
    await ensureWalletNetwork(wallet, 11155111);
    const provider = new BrowserProvider(wallet);
    if ((await provider.getNetwork()).chainId !== 11155111n) throw new Error('Select Sepolia in your wallet.');
    signer = await provider.getSigner();
    const address = await signer.getAddress();
    const balance = await provider.getBalance(address);
    $('#wallet').textContent = `${address} · ${formatEther(balance)} Sepolia ETH`;
    if (balance === 0n) throw new Error('Get free Sepolia test ETH from a faucet, then connect again.');
    $('#deploy').disabled = !$('#receipt').hidden;
    $('#status').textContent = 'Connected to Sepolia. Your connected wallet will be the permanent operator.';
  } catch (error) { $('#status').textContent = message(error); }
  finally { $('#connect').disabled = false; }
};

$('#deploy').onclick = async () => {
  $('#deploy').disabled = true;
  $('#connect').disabled = true;
  let submitted = false;
  try {
    if (!signer) throw new Error('Connect your operator wallet first.');
    if (await signer.provider.send('eth_chainId', []) !== '0xaa36a7') throw new Error('Switch back to Sepolia and reconnect.');
    const accounts = await signer.provider.send('eth_accounts', []);
    if (accounts[0]?.toLowerCase() !== (await signer.getAddress()).toLowerCase()) throw new Error('Your account changed. Reconnect before deploying.');
    $('#status').textContent = 'Review the deployment fee and confirm in your wallet.';
    const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy();
    const tx = contract.deploymentTransaction();
    submitted = true;
    showTransaction(tx.hash);
    try { localStorage.setItem(pendingKey, tx.hash); } catch { /* The transaction remains visible above and in the wallet. */ }
    $('#status').textContent = 'Submitted. Waiting for Sepolia confirmation…';
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error('Deployment reverted. Check the receipt before retrying.');
    $('#status').textContent = `Deployed! Contract: ${receipt.contractAddress}`;
  } catch (error) {
    $('#status').textContent = submitted ? `Transaction submitted. Check its receipt before retrying. ${message(error)}` : message(error);
  } finally {
    $('#connect').disabled = false;
    $('#deploy').disabled = submitted || !signer;
  }
};
