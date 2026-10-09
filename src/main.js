import { createSimulation, demoAccounts } from './simulation.js';
import { ensureWalletNetwork } from './wallet-network.js';
import { getMetaMaskProvider } from './metamask.js';
import { BrowserProvider, Contract, JsonRpcProvider, ZeroAddress, formatEther, isAddress } from 'ethers';

const $ = (selector) => document.querySelector(selector);
const simulationMode = import.meta.env.MODE === 'simulation';
let simulation;
const idr = value => `Rp${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value))}`;
const demoIdr = wei => idr(Number(wei) / 1e9);
const short = address => `${address.slice(0, 6)}…${address.slice(-4)}`;
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let deployment, provider, contract, signer, address, walletName, accounts = [], state, busy = false, toastTimer;
let walletProvider, connecting = false;
const labels = ['Solar operator', 'Alice', 'Budi'];
const isOperator = () => Boolean(address && deployment && address.toLowerCase() === deployment.operator.toLowerCase());
const periodLabel = period => { const s = String(period); return new Date(Number(s.slice(0, 4)), Number(s.slice(4)) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); };
const nextPeriod = () => {
  if (!state?.lastPeriod) return '2026-10';
  const year = Math.floor(state.lastPeriod / 100), month = state.lastPeriod % 100;
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}`;
};

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.toggle('error', error);
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, error ? 10000 : 6000);
}
function errorMessage(error) {
  if (error.code === 4001 || error.code === 'ACTION_REJECTED') return 'Transaction cancelled in your wallet.';
  if (error.code === 'INSUFFICIENT_FUNDS') return 'This wallet needs test ETH for the transaction and network fee.';
  return error.reason || error.shortMessage || error.message || 'The transaction could not be completed.';
}
function showPage() {
  if (location.hash === '#main-content') return;
  const page = ['home', 'project', 'how', 'portfolio', 'operator'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  document.querySelectorAll('.page').forEach(section => { section.hidden = section.id !== `${page}-page`; });
  document.querySelectorAll('[data-page]').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function integer(value, min, max, label) {
  if (!/^\d+$/.test(String(value))) throw new Error(`${label} must be a whole number.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return n;
}
function updatePurchase() {
  const quantity = Number($('#share-count').value);
  const valid = Number.isInteger(quantity) && quantity > 0 && quantity <= (state?.available ?? 1000);
  $('#purchase-ownership').textContent = valid ? `${(quantity / 10).toFixed(1)}%` : '—';
  $('#purchase-total').textContent = valid ? idr(quantity * 100000) : '—';
  $('#buy-button').textContent = busy ? 'Confirming transaction…' : (!simulation && !contract) || !state ? 'Blockchain unavailable' : !address ? 'Connect wallet →' : isOperator() ? 'Switch to an investor wallet' : state.available === 0 ? 'All shares purchased' : 'Buy demo shares →';
  $('#buy-button').disabled = busy || (!simulation && !contract) || !state || !valid || isOperator();
  $('#purchase-footnote').textContent = simulation ? `Demo balance: ${idr(state?.cash ?? 0)} · No real money` : address ? `${walletName} · Test ETH + network fee` : 'Test ETH only. No real money.';
}
function activityHTML(logs) {
  if (!logs.length) return '<div class="empty-state">The first share starts the story. Purchase demo shares to begin.</div>';
  return logs.slice(-8).reverse().map(log => {
    const a = log.args;
    const title = log.name === 'SharesPurchased' ? `${nameFor(a.buyer)} purchased ${a.shares} shares`
      : log.name === 'ReportPublished' ? `${periodLabel(a.period)} income deposited`
      : log.name === 'RevenueClaimed' ? `${nameFor(a.holder)} claimed income`
      : log.name === 'Transfer' ? `${nameFor(a.from)} transferred ${a.value} shares to ${nameFor(a.to)}`
      : 'Operator withdrew purchase proceeds';
    const value = log.name === 'SharesPurchased' ? demoIdr(a.paid) : log.name === 'ReportPublished' ? demoIdr(a.deposited) : log.name === 'Transfer' ? `${a.value} SURYA` : demoIdr(a.amount);
    return `<div class="activity-row"><span class="activity-icon" aria-hidden="true">${log.name === 'ReportPublished' ? '☀' : '↗'}</span><div><strong>${esc(title)}</strong><p>${simulation ? 'Demo step' : 'Block'} ${log.blockNumber} · ${esc(value)}</p></div><button class="text-button" type="button" data-receipt="${log.transactionHash}">Receipt ↗</button></div>`;
  }).join('');
}
function nameFor(account) {
  const index = accounts.findIndex(a => a.toLowerCase() === account.toLowerCase());
  return labels[index] || short(account);
}
function renderPortfolio() {
  const balance = state?.balance ?? 0, claimable = state?.claimable ?? 0n, claimed = state?.claimed ?? 0n;
  const percent = balance / 10;
  const myLogs = (state?.logs ?? []).filter(log => Object.values(log.args).some(value => typeof value === 'string' && value.toLowerCase() === address?.toLowerCase()));
  $('#portfolio-page').innerHTML = `<div class="page-heading"><div><span class="eyebrow">MY SURYASHARE</span><h1>Your sunshine.<br>All in one place.</h1><p>${address ? `${esc(walletName)} · ${short(address)}` : 'Connect a wallet. Start your solar story.'}</p></div><button class="secondary-button" type="button" data-choose-wallet>${address ? 'Switch wallet ↗' : 'Connect wallet ↗'}</button></div>
    <div class="portfolio-stats"><div class="stat-card"><span>Your shares</span><strong>${balance} <small>SURYA</small></strong><small>${percent.toFixed(1)}% of the demo project</small></div><div class="stat-card"><span>Demo share value</span><strong>${idr(balance * 100000)}</strong><small>At the original issue price</small></div><div class="stat-card highlight"><span>Demo income claimed</span><strong>${demoIdr(claimed)}</strong><small>${simulation ? 'Added to your demo balance' : `${formatEther(claimed)} test ETH`}</small></div></div>
    <div class="portfolio-layout"><article class="card"><h2>Your piece of the rooftop.</h2><div class="ownership-row"><div class="ownership-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" fill="none" stroke="#eee9d8" stroke-width="11"/><circle cx="60" cy="60" r="50" fill="none" stroke="#ffd400" stroke-width="11" pathLength="100" stroke-dasharray="${percent} 100"/></svg><strong>${percent.toFixed(1)}%</strong></div><div><h3>Cikarang Solar</h3><p>${balance} of 1,000 demo shares.</p><a class="text-button" href="#project">Get more shares ↗</a></div></div></article>
    <article class="card payout-card"><h2>Your slice is ready.</h2><div class="payout-amount">${demoIdr(claimable)}</div><p>${simulation ? 'Simulated income. Your shares stay yours.' : `${formatEther(claimable)} test ETH to claim.`}</p><button type="button" class="primary-button" data-write id="claim-button" ${!address || claimable === 0n || busy ? 'disabled' : ''}>Claim demo income →</button></article></div>
    <details class="card activity-card transfer-details"><summary>Send shares to another wallet <span>↗</span></summary><p>Transfer tokens. No payment or sale is included.</p><form id="transfer-form" class="transfer-form"><div class="field"><label for="recipient">Wallet address</label><input id="recipient" placeholder="0x…" required autocomplete="off" /></div><div class="field share-field"><label for="transfer-quantity">Shares</label><input id="transfer-quantity" type="number" min="1" max="${balance}" step="1" value="10" required /></div><button type="submit" data-write class="secondary-button" ${!address || !balance || busy || isOperator() ? 'disabled' : ''}>Transfer shares →</button></form>${accounts[2] ? `<button type="button" id="use-demo-recipient" class="text-button">Use ${address?.toLowerCase() === accounts[2].toLowerCase() ? 'Alice' : 'Budi'}’s demo wallet →</button>` : ''}</details>
    <article class="card activity-card"><h2>${simulation ? 'Your demo activity' : 'Your on-chain activity'}</h2>${myLogs.length ? activityHTML(myLogs) : '<div class="empty-state">Buy your first shares to get started.</div>'}</article>`;
  $('#claim-button').onclick = () => transact(c => c.claimRevenue(), 'Demo income claimed. Your balance has been updated.');
  if ($('#use-demo-recipient')) $('#use-demo-recipient').onclick = () => { $('#recipient').value = address?.toLowerCase() === accounts[2].toLowerCase() ? accounts[1] : accounts[2]; };
  $('#transfer-form').onsubmit = event => {
    event.preventDefault();
    try {
      const recipient = $('#recipient').value.trim();
      if (!isAddress(recipient) || recipient === ZeroAddress || recipient.toLowerCase() === address?.toLowerCase()) throw new Error('Enter a different, valid Ethereum wallet address.');
      const quantity = integer($('#transfer-quantity').value, 1, balance, 'Shares');
      transact(c => c.transfer(recipient, quantity), `${quantity} demo shares transferred. Past income stays with its original holder.`);
    } catch (error) { toast(errorMessage(error), true); }
  };
}
function renderOperator() {
  $('#operator-page').innerHTML = `<div class="page-heading"><div><div class="eyebrow">THE DEMO LAB</div><h1>Make sunshine move.</h1><p>Simulate a month. Fund a payout. Watch your shares work.</p></div><span class="outline-tag">OPERATOR ONLY</span></div>
    ${!isOperator() ? '<div class="notice">Switch to the operator to run the demo. <button class="text-button" type="button" data-choose-wallet>Choose the operator wallet →</button></div>' : ''}
    <div class="operator-grid" style="margin-top:22px"><article class="card"><div class="section-heading"><h3>Simulate an energy report</h3><span class="small-tag">SIMULATED DATA</span></div><p>Sample data. No solar hardware connected.</p><form id="report-form" class="operator-form"><div class="field"><label for="report-month">Reporting month</label><input id="report-month" type="month" min="${nextPeriod()}" max="2100-12" value="${nextPeriod()}" required /></div><div class="field"><label for="generation">Electricity generated (kWh)</label><input id="generation" type="number" min="1" max="1000000" step="1" value="1200" required /></div><div class="field"><label for="operating-costs">Operating costs (demo IDR)</label><input id="operating-costs" type="number" min="0" max="1500000000" step="1" value="400000" required /></div><div class="field"><label for="reserve">Maintenance reserve (demo IDR)</label><input id="reserve" type="number" min="0" max="1500000000" step="1" value="200000" required /></div><div class="full-width"><div class="notice">Demo tariff: Rp1,500 / kWh.</div><button type="submit" id="publish-button" data-write class="primary-button" style="margin-top:20px" ${!isOperator() || busy ? 'disabled' : ''}>Publish report & deposit income →</button><p class="form-footnote">${simulation ? 'One report per month. Uses your demo balance.' : 'One report per month. Paid in test ETH.'}</p></div></form></article>
    <article class="card"><h3>Where the income goes</h3><div id="report-calculation"></div><p>Each share earns 1/1,000 of the deposit. Unsold shares belong to the operator.</p></article></div>
    <article class="card activity-card"><div class="section-heading"><div><h3>Published reports</h3><p>${simulation ? 'Simulated reports and deposits.' : 'Sample reports. Verifiable deposits.'}</p></div></div>${reportTable()}</article>
    <article class="card activity-card"><div class="section-heading"><div><h3>Purchase proceeds</h3><p>${demoIdr(state?.proceeds ?? 0n)} available. Holder income stays protected.</p></div><button type="button" id="withdraw-button" data-write class="secondary-button" ${!isOperator() || !state?.proceeds || busy ? 'disabled' : ''}>Withdraw proceeds</button></div></article>`;
  $('#report-form').oninput = updateReport;
  $('#report-form').onsubmit = event => {
    event.preventDefault();
    try {
      const report = readReport();
      transact(c => c.publishReport(report.period, report.kwh, report.costs, report.reserve, { value: BigInt(report.net) * 1000000000n }), `Report published. ${idr(report.net)} in demo income allocated to holders.`);
    } catch (error) { toast(errorMessage(error), true); }
  };
  $('#withdraw-button').onclick = () => transact(c => c.withdrawSaleProceeds(), 'Purchase proceeds withdrawn. Holder income remains reserved.');
  updateReport();
}
function readReport() {
  const month = $('#report-month').value;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Choose a valid reporting month.');
  const period = Number(month.replace('-', ''));
  if (period < 200001 || period > 210012 || period <= (state?.lastPeriod ?? 0)) throw new Error('Choose a month after the latest published report.');
  const kwh = integer($('#generation').value, 1, 1000000, 'Generation');
  const costs = integer($('#operating-costs').value, 0, 1500000000, 'Operating costs');
  const reserve = integer($('#reserve').value, 0, 1500000000, 'Maintenance reserve');
  const gross = kwh * 1500, net = gross - costs - reserve;
  if (net <= 0) throw new Error('Costs and reserves must leave a positive amount to distribute.');
  return { period, kwh, costs, reserve, gross, net };
}
function updateReport() {
  try {
    const r = readReport();
    $('#report-calculation').innerHTML = `<div class="calculation"><div class="order-row"><span>Electricity receipts</span><strong>${idr(r.gross)}</strong></div><div class="order-row"><span>Operating costs</span><strong>− ${idr(r.costs)}</strong></div><div class="order-row"><span>Maintenance reserve</span><strong>− ${idr(r.reserve)}</strong></div><div class="order-row total"><span>To distribute</span><strong>${idr(r.net)}</strong></div></div><div class="calculation"><div class="order-row"><span>Per ownership unit</span><strong>${idr(r.net / 1000)}</strong></div><div class="order-row"><span>100 shares receive</span><strong>${idr(r.net / 10)}</strong></div><div class="order-row"><span>${simulation ? 'Operator demo balance' : 'Test ETH deposit'}</span><strong>${simulation ? idr(state?.cash ?? 0) : formatEther(BigInt(r.net) * 1000000000n)}</strong></div></div>`;
    $('#publish-button').disabled = busy || !isOperator() || !state;
  } catch (error) {
    $('#report-calculation').innerHTML = `<div class="notice error">${esc(errorMessage(error))}</div>`;
    $('#publish-button').disabled = true;
  }
}
function reportTable() {
  const reports = (state?.logs ?? []).filter(log => log.name === 'ReportPublished').reverse();
  if (!reports.length) return '<div class="empty-state">Publish a month to start the income demo.</div>';
  return `<div class="table-scroll"><table class="report-table"><thead><tr><th>Period</th><th>Generation</th><th>Distributable</th><th>Per share</th><th>Proof</th></tr></thead><tbody>${reports.map(log => `<tr><td>${periodLabel(log.args.period)}</td><td>${log.args.kwh} kWh</td><td>${demoIdr(log.args.deposited)}</td><td>${demoIdr(log.args.deposited / 1000n)}</td><td><button type="button" class="text-button" data-receipt="${log.transactionHash}">Receipt ↗</button></td></tr>`).join('')}</tbody></table></div>`;
}
async function refresh() {
  if (!contract && !simulation) return;
  const currentAddress = address;
  let operatorBalance;
  if (simulation) {
    state = simulation.snapshot(address);
    operatorBalance = state.operatorBalance;
  } else {
  // ponytail: scan this single demo contract's history; use incremental indexing for long-lived projects.
  const [available, revenue, lastPeriod, proceeds, operatorShares, balance, claimable, claimed, rawLogs] = await Promise.all([
    contract.availableShares(), contract.totalRevenue(), contract.lastPeriod(), contract.saleProceeds(), contract.balanceOf(deployment.operator),
    currentAddress ? contract.balanceOf(currentAddress) : 0n, currentAddress ? contract.claimable(currentAddress) : 0n,
    currentAddress ? contract.totalClaimed(currentAddress) : 0n,
    provider.getLogs({ address: deployment.address, fromBlock: deployment.blockNumber, toBlock: 'latest' }),
  ]);
  if (currentAddress !== address) return;
  const parsed = rawLogs.map(log => ({ ...log, ...contract.interface.parseLog(log) }));
  const purchases = new Set(parsed.filter(log => log.name === 'SharesPurchased').map(log => log.transactionHash));
  const logs = parsed.filter(log => log.name === 'Transfer' ? log.args.from !== ZeroAddress && !purchases.has(log.transactionHash) : log.name !== 'Approval');
  state = { available: Number(available), revenue, lastPeriod: Number(lastPeriod), proceeds, balance: Number(balance), claimable, claimed, logs };
    operatorBalance = operatorShares;
  }
  const { revenue, logs } = state;
  const sold = 1000 - state.available;
  $('#community-ownership').textContent = `${(Number(1000n - operatorBalance) / 10).toFixed(1)}%`;
  $('#sold-caption').textContent = `${sold} shares purchased`;
  $('#project-revenue').textContent = demoIdr(revenue);
  $('#funding-label').textContent = `${sold.toLocaleString()} of 1,000 shares purchased`;
  $('#funding-percent').textContent = `${(sold / 10).toFixed(1)}%`;
  $('#funding-progress').value = sold;
  $('#share-count').max = state.available;
  $('#project-activity').className = '';
  $('#project-activity').innerHTML = activityHTML(logs);
  $('#connection-error').hidden = true;
  renderPortfolio(); renderOperator(); updatePurchase();
}
async function chooseWallet(index) {
  if (busy) return;
  if (simulation) {
    address = accounts[index]; walletName = labels[index];
    $('#wallet-button').textContent = `${walletName} · demo ↗`;
    $('#wallet-dialog').close();
    await refresh(); return;
  }
  if (!provider || deployment.chainId !== 31337 || !['localhost', '127.0.0.1'].includes(location.hostname)) throw new Error('Demo wallets are available only on the local development chain.');
  signer = await provider.getSigner(index);
  address = await signer.getAddress();
  walletName = labels[index];
  $('#wallet-button').textContent = `${walletName} · demo ↗`;
  $('#wallet-dialog').close();
  await refresh();
}
async function connectBrowserWallet() {
  if (busy || connecting) return;
  if (!deployment) throw new Error('The project is not connected to a blockchain yet.');
  connecting = true;
  $('#browser-wallet').disabled = true;
  try {
    const selected = await getMetaMaskProvider();
    if (selected !== walletProvider) {
      for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) {
        walletProvider?.removeListener?.(event, resetWallet);
        selected.on?.(event, resetWallet);
      }
      walletProvider = selected;
    }
    resetWallet();
    await walletProvider.request({ method: 'eth_requestAccounts' });
    await ensureWalletNetwork(walletProvider, deployment.chainId);
    const browser = new BrowserProvider(walletProvider);
    if ((await browser.getNetwork()).chainId !== BigInt(deployment.chainId)) throw new Error('Select the configured test network in your wallet.');
    signer = await browser.getSigner(); address = await signer.getAddress(); walletName = short(address);
    $('#wallet-button').textContent = `MetaMask · ${walletName} ↗`; $('#wallet-dialog').close(); await refresh();
  } finally {
    connecting = false;
    $('#browser-wallet').disabled = false;
  }
}
async function transact(action, successMessage) {
  if (busy) return;
  if (simulation) {
    try {
      await action(simulation.forAccount(address));
      await refresh(); toast(successMessage);
    } catch (error) { toast(errorMessage(error), true); }
    return;
  }
  if (!signer) { $('#wallet-dialog').showModal(); return; }
  busy = true;
  document.querySelectorAll('[data-write]').forEach(button => { button.disabled = true; });
  updatePurchase();
  let confirmed = false;
  try {
    const chainId = await signer.provider.send('eth_chainId', []);
    if (BigInt(chainId) !== BigInt(deployment.chainId)) throw new Error('Your wallet is on the wrong network. Reconnect to the configured test network.');
    if (signer.provider !== provider) {
      const connectedAccounts = await signer.provider.send('eth_accounts', []);
      if (connectedAccounts[0]?.toLowerCase() !== address?.toLowerCase()) throw new Error('Your account changed. Reconnect your wallet before continuing.');
    }
    toast('Waiting for transaction confirmation…');
    const tx = await action(contract.connect(signer));
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error('The transaction reverted.');
    confirmed = true;
    busy = false;
    await refresh();
    toast(successMessage);
    return receipt.hash;
  } catch (error) {
    toast(confirmed ? 'Transaction confirmed, but the display could not refresh. Press Refresh to reload the chain state.' : errorMessage(error), true);
  } finally {
    busy = false; updatePurchase();
    if (!confirmed && state) { renderPortfolio(); renderOperator(); }
  }
}
async function showReceipt(hash) {
  if (simulation) {
    const record = state.logs.find(log => log.transactionHash === hash);
    $('#receipt-content').textContent = record ? `Simulation record ${record.transactionHash}. ${record.name} by ${nameFor(record.actor)}. This action is saved in this browser tab only. No blockchain transaction, real payment, or gas fee was created.` : 'Demo record not found.';
    $('#receipt-dialog .dialog-heading h2').textContent = 'Your demo record.';
    $('#receipt-dialog').showModal(); return;
  }
  $('#receipt-content').textContent = 'Reading transaction from the chain…';
  $('#receipt-dialog').showModal();
  try {
    const receipt = await provider.getTransactionReceipt(hash);
    if (!receipt) throw new Error('This transaction is not available on the current chain.');
    $('#receipt-content').innerHTML = `<span class="small-tag green">${receipt.status === 1 ? 'CONFIRMED' : 'REVERTED'}</span><p style="margin-top:22px">Transaction hash</p><div class="receipt-value">${esc(hash)}</div><div class="order-row"><span>Network</span><strong>${deployment.chainId === 31337 ? 'Local Ethereum · 31337' : 'Ethereum Sepolia'}</strong></div><div class="order-row"><span>Block number</span><strong>${receipt.blockNumber}</strong></div><div class="order-row"><span>Gas used</span><strong>${receipt.gasUsed.toLocaleString()}</strong></div><p style="margin-top:18px">Sender</p><div class="receipt-value">${esc(receipt.from)}</div><p>Contract</p><div class="receipt-value">${esc(receipt.to)}</div>${deployment.chainId === 11155111 ? `<a class="text-button" href="https://sepolia.etherscan.io/tx/${hash}" target="_blank" rel="noopener noreferrer">View on Sepolia Etherscan ↗</a>` : '<p>Local transactions are verifiable on this running node. They do not appear on a public block explorer.</p>'}`;
  } catch (error) { $('#receipt-content').textContent = errorMessage(error); }
}
$('#wallet-button').onclick = () => { if (!busy) $('#wallet-dialog').showModal(); };
$('#about-button').onclick = () => $('#about-dialog').showModal();
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
document.querySelectorAll('[data-wallet]').forEach(button => button.onclick = () => chooseWallet(Number(button.dataset.wallet)).catch(error => toast(errorMessage(error), true)));
$('#browser-wallet').onclick = () => connectBrowserWallet().catch(error => toast(errorMessage(error), true));
$('#share-count').oninput = updatePurchase;
$('#decrease-shares').onclick = () => { $('#share-count').value = Math.max(1, Number($('#share-count').value) - 10); updatePurchase(); };
$('#increase-shares').onclick = () => { $('#share-count').value = Math.min(state?.available ?? 1000, Number($('#share-count').value) + 10); updatePurchase(); };
$('#buy-form').onsubmit = event => {
  event.preventDefault();
  try {
    const quantity = integer($('#share-count').value, 1, state?.available ?? 1000, 'Shares');
    transact(c => c.buyShares(quantity, { value: BigInt(quantity) * 100000000000000n }), `${quantity} SURYA shares purchased. See them in My shares.`);
  } catch (error) { toast(errorMessage(error), true); }
};
$('#refresh-button').onclick = () => refresh().then(() => toast(simulation ? 'Demo updated.' : 'Project updated from the blockchain.')).catch(error => toast(errorMessage(error), true));
document.addEventListener('click', event => {
  const receipt = event.target.closest('[data-receipt]');
  if (receipt) showReceipt(receipt.dataset.receipt);
  if (event.target.closest('[data-choose-wallet]') && !busy) $('#wallet-dialog').showModal();
});
window.addEventListener('hashchange', showPage);
function resetWallet() {
  signer = null; address = null; walletName = null;
  $('#wallet-button').textContent = 'Connect MetaMask ↗';
  refresh().catch(() => {});
}
showPage(); renderPortfolio(); renderOperator();
async function initialize() {
  if (simulationMode) {
    simulation = createSimulation(sessionStorage);
    accounts = demoAccounts;
    deployment = { operator: accounts[0], chainId: null };
    $('#network-badge').textContent = 'Browser simulation';
    $('#wallet-dialog > p').textContent = 'Choose a role. Each starts with Rp100,000,000 in demo money.';
    $('#wallet-dialog .form-footnote').textContent = 'Simulated balances only. No wallet installation needed.';
    $('#browser-wallet').hidden = true;
    $('.demo-note').textContent = '✳ Interactive simulation. No real money or blockchain transactions.';
    $('.ownership-label').textContent = 'Your shares. Simulated for the demo.';
    $('.price-note').textContent = 'Use your demo balance. No payment required.';
    $('.activity-card h2').textContent = 'Demo activity';
    $('.demo-explainer p').textContent = 'Buy, transfer, and claim using a browser simulation. No hardware, wallet, or blockchain connection is required.';
    $('.chain-hub .pill').textContent = 'Simulated shared record';
    $('.three-steps article:nth-child(2) h3').textContent = 'Try shared ownership.';
    $('.three-steps article:nth-child(2) p').textContent = 'Hold demo shares and follow your simulated activity.';
    $('#about-dialog').innerHTML = '<div class="dialog-heading"><h2>A solar ownership simulation.</h2><button type="button" aria-label="Close explanation" onclick="this.closest(\'dialog\').close()">×</button></div><p>Switch between Alice, Budi, and the operator. Buy shares, publish sample income, and claim your portion.</p><p>All money, shares, reports, and receipts are simulated. Your progress stays in this browser tab across reloads. It is not shared with other visitors.</p><p>Income does not increase the share price. Existing earnings stay with their owner when shares are transferred.</p><button type="button" class="secondary-button" id="reset-demo">Reset demo</button>';
    $('#reset-demo').onclick = async () => {
      try { simulation.reset(); await chooseWallet(1); $('#about-dialog').close(); toast('Demo reset. Everyone starts fresh.'); }
      catch (error) { toast(errorMessage(error), true); }
    };
    await chooseWallet(1);
    if (simulation.warning) toast(simulation.warning, true);
    return;
  }
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}deployment.json`, { cache: 'no-store' });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Deployment configuration is missing.');
    deployment = await response.json();
    if (![31337, 11155111].includes(deployment.chainId)) throw new Error('This app only supports local Ethereum or Sepolia.');
    const rpc = new URL(deployment.rpcUrl);
    if (!['http:', 'https:'].includes(rpc.protocol)) throw new Error('Invalid RPC URL.');
    if (deployment.chainId === 31337 && !['127.0.0.1', 'localhost'].includes(rpc.hostname)) throw new Error('Local development wallets require a loopback RPC.');
    provider = new JsonRpcProvider(deployment.rpcUrl, undefined, { cacheTimeout: -1 });
    if ((await provider.getNetwork()).chainId !== BigInt(deployment.chainId)) throw new Error('Deployment network does not match the node.');
    if (await provider.getCode(deployment.address) === '0x') throw new Error('The node restarted. Run npm run deploy to create a new demo contract.');
    contract = new Contract(deployment.address, deployment.abi, provider);
    if (deployment.chainId === 31337) accounts = (await provider.listAccounts()).slice(0, 3).map(account => account.address);
    else {
      document.querySelectorAll('[data-wallet]').forEach(button => { button.hidden = true; });
      $('#wallet-dialog > p').textContent = 'Connect MetaMask on Sepolia. Purchases and claims use free test ETH.';
      $('#browser-wallet').textContent = 'Connect MetaMask';
      $('#wallet-button').textContent = 'Connect MetaMask ↗';
      $('.demo-note').textContent = '✳ Sepolia testnet. Test ETH only. Real on-chain activity.';
      $('.demo-explainer p').textContent = 'Energy reports are simulated. Share purchases, transfers, and income claims run on Ethereum Sepolia. No hardware or utilities are connected.';
      $('#wallet-dialog .form-footnote').textContent = 'Eden operates the project. Jacob invests. Select your account in MetaMask, then connect.';
    }
    $('#network-badge').textContent = deployment.chainId === 31337 ? 'Local Ethereum' : 'Sepolia testnet';
    $('#contract-caption').textContent = `${short(deployment.address)} · Chain ${deployment.chainId}`;
    $('#contract-caption').hidden = false;
    await refresh();
  } catch (error) {
    state = null;
    $('#connection-error').textContent = deployment?.chainId === 11155111
      ? `Sepolia could not be reached. Reload to retry. ${errorMessage(error)}`
      : `Local demo is not connected. Run npm start in the SuryaShare folder, then reload. ${errorMessage(error)}`;
    $('#connection-error').hidden = false;
    updatePurchase();
  }
}
await initialize();
// Optional browser agent access uses the same loaded chain state as the visible interface.
if (!simulationMode && document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const tool = { name: 'read_solar_project', title: 'Read solar project', description: 'Read the loaded project totals and currently selected wallet. No transactions are sent.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Expected an empty object.');
    if (!state) throw new Error('The project is not connected.');
    return { project: 'Cikarang Rooftop Solar', simulatedAsset: true, chainId: deployment.chainId, totalShares: 1000, sharesAvailable: state.available, wallet: address ?? null, walletShares: state.balance, claimableTestEth: formatEther(state.claimable) };
  } };
  try { Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Optional API is unavailable in some clients. */ }
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
