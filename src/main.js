import { createSimulation, demoAccounts } from './simulation.js';
import { ensureWalletNetwork } from './wallet-network.js';
import { getMetaMaskProvider } from './metamask.js';
import { BrowserProvider, Contract, JsonRpcProvider, ZeroAddress, formatEther, getAddress, isAddress } from 'ethers';

const $ = (selector) => document.querySelector(selector);
const simulationMode = import.meta.env.MODE === 'simulation';
const SEPOLIA = 11155111, GWEI = 1000000000n, SHARE_PRICE = 100000n * GWEI, TARIFF_IDR = 1500;
const fmt = value => Number(value).toLocaleString('en-US');
const idr = value => `Rp${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value))}`;
const demoIdr = wei => idr(Number(wei) / 1e9);
const eth = wei => `${formatEther(wei).replace(/\.0$/, '')} ${simulationMode ? 'simulated' : 'test'} ETH`;
const pct = shares => `${(shares / 10).toFixed(1)}%`;
const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;
const short = address => `${address.slice(0, 6)}…${address.slice(-4)}`;
const cap = text => text.startsWith('0x') ? text : text[0].toUpperCase() + text.slice(1);
const same = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const digits = (value, max) => value.replace(/\D/g, '').slice(0, max);
const whole = value => Number(value) || 0;
const periodLabel = period => { const s = String(period); return new Date(Number(s.slice(0, 4)), Number(s.slice(4)) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); };
const nextPeriod = period => period % 100 === 12 ? period + 89 : period + 1;
const currentPeriod = () => { const now = new Date(); return now.getFullYear() * 100 + now.getMonth() + 1; };
const chainName = id => ({ 1: 'Ethereum Mainnet', [SEPOLIA]: 'Sepolia', 31337: 'the local test chain', 17000: 'Holesky', 560048: 'Hoodi' })[id] ?? `another network (chain ${id})`;
const isRejection = error => [error, error?.info?.error, error?.error].some(e => e?.code === 4001 || e?.code === 'ACTION_REJECTED');
let deployment, provider, contract, signer, address, walletName, accounts = [], state, loadError = '';
let simulation, walletProvider, walletChainId, usingMetaMask = false, accountTarget, connectAttempt = 0, scanFrom, toastId = 0;
const ui = { qty: '10', filter: 'All', busy: null, busyStage: null, modal: null, toasts: [] };
const logCache = new Map(), blockTimes = new Map();
const labels = ['Solar operator', 'Alice', 'Budi'];
const onSepolia = () => deployment?.chainId === SEPOLIA;
const hasDemoWallets = () => accounts.length > 0;
const networkLabel = () => onSepolia() ? 'Sepolia' : 'the local chain';
const switchLabel = () => `Switch to ${networkLabel()}`;
const isOperator = () => Boolean(address && deployment && same(address, deployment.operator));
const wrongNetwork = () => Boolean(address && usingMetaMask && walletChainId !== deployment.chainId);
const txUrl = hash => onSepolia() ? `https://sepolia.etherscan.io/tx/${hash}` : '';
const balanceText = () => simulation ? idr(state.cash) : eth(state.ethBalance);
const reverts = {
  'Use an investor wallet': "The operator wallet can't buy shares. Switch to an investor account.",
  'Invalid share quantity': 'Fewer shares are left than you tried to buy. Pick a smaller number and try again.',
  'Incorrect payment': "The payment didn't match the share price. Reload the page and try again.",
  'Period already reported or out of order': 'This month has already been reported, or it comes before the last report. Pick a later month and try again.',
  'No distributable income': "Costs and reserve are higher than this month's receipts, so there's nothing to share.",
  'Incorrect revenue deposit': "The deposit didn't match the report. Reload the page and try again.",
  'No income to claim': 'There is no income to claim right now.',
  'Payout failed': "The payout couldn't be sent to your wallet. Your income is still safe in the contract. Try again in a minute.",
  'No proceeds': 'There are no sale proceeds to withdraw.',
  'Withdrawal failed': "The withdrawal didn't go through. The proceeds are still in the contract. Try again in a minute.",
  'Sale inventory reserved': "The operator's unsold shares are reserved for buyers and can't be sent.",
  'Operator only': 'Only the operator wallet can do this.',
};

function errorMessage(error) {
  if (isRejection(error)) return 'You cancelled the request in your wallet. Nothing was sent.';
  if (error.code === 'INSUFFICIENT_FUNDS' || /insufficient funds/i.test(error.message ?? '')) {
    return `Your wallet doesn't have enough test ETH to cover this and the network fee.${onSepolia() ? ' Get more from a Sepolia faucet and try again.' : ''}`;
  }
  return reverts[error.reason] || error.reason || error.shortMessage || error.message || 'The transaction could not be completed.';
}
function nameFor(account) {
  if (same(account, address)) return 'you';
  const index = accounts.findIndex(a => same(a, account));
  if (index >= 0) return labels[index];
  return same(account, deployment?.operator) ? 'the operator' : short(account);
}

// Toasts
const toastMeta = { wallet: ['Waiting for your wallet', ''], confirmed: ['Confirmed', 'ok'], info: ['Done', 'ok'], rejected: ['Rejected in wallet', ''], failed: ['Transaction failed', 'bad'], error: ['Something went wrong', 'bad'] };
function pushToast(toast) {
  const id = ++toastId;
  ui.toasts = [...ui.toasts.slice(-2), { ...toast, id }];
  renderToasts();
  return id;
}
function patchToast(id, patch) { ui.toasts = ui.toasts.map(t => t.id === id ? { ...t, ...patch } : t); renderToasts(); }
function dismissToast(id) { ui.toasts = ui.toasts.filter(t => t.id !== id); renderToasts(); }
function dismissLater(id, ms) { setTimeout(() => dismissToast(id), ms); }
function info(title, body) { dismissLater(pushToast({ status: 'info', title, body }), 4000); }
function notify(error, title = 'Something went wrong') { dismissLater(pushToast({ status: 'error', title, body: errorMessage(error) }), 10000); }
function toastIcon(status) {
  if (status === 'wallet' || status === 'pending') return '<span class="spinner"></span>';
  if (status === 'confirmed' || status === 'info') return '<span class="status-icon status-ok"><svg class="icon"><use href="#i-check" /></svg></span>';
  if (status === 'rejected') return '<span class="status-icon status-rejected"><svg class="icon"><use href="#i-x" /></svg></span>';
  return '<span class="status-icon status-bad">!</span>';
}
function renderToasts() {
  $('#toasts').innerHTML = ui.toasts.map(t => {
    const [label, tone] = t.status === 'pending' ? [`Pending on ${networkLabel()}`, ''] : toastMeta[t.status];
    const url = t.hash && t.status !== 'failed' ? txUrl(t.hash) : '';
    return `<div class="toast"><div class="toast-status" aria-hidden="true">${toastIcon(t.status)}</div><div class="toast-text"><div class="toast-label ${tone}">${label}</div><div class="toast-title">${esc(t.title)}</div>${t.body ? `<div class="toast-body">${esc(t.body)}</div>` : ''}${url ? `<a class="toast-link" href="${url}" target="_blank" rel="noopener noreferrer">View on Etherscan<svg class="icon icon-xs" aria-hidden="true"><use href="#i-ext" /></svg></a>` : ''}</div><button type="button" class="toast-close" data-dismiss="${t.id}" aria-label="Dismiss"><svg class="icon" aria-hidden="true"><use href="#i-x" /></svg></button></div>`;
  }).join('');
}

// Chain data as display items
const tones = { Bought: ['BUY', 'Purchase'], Report: ['kWh', 'Monthly report'], Claimed: ['Rp', 'Claim'], Sent: ['OUT', 'Transfer'], Received: ['IN', 'Transfer'] };
const reports = () => (state?.logs ?? []).filter(log => log.name === 'ReportPublished').map(log => ({
  period: Number(log.args.period), kwh: Number(log.args.kwh), costs: Number(log.args.costsIdr), reserve: Number(log.args.reserveIdr),
  deposited: BigInt(log.args.deposited), hash: log.transactionHash, block: log.blockNumber,
}));
function activity() {
  return (state?.logs ?? []).flatMap(log => {
    const a = log.args, item = { hash: log.transactionHash, block: log.blockNumber };
    if (log.name === 'SharesPurchased') return { ...item, kind: 'Bought', mine: same(a.buyer, address), title: `${cap(nameFor(a.buyer))} bought ${plural(Number(a.shares), 'share')}`, wei: BigInt(a.paid) };
    if (log.name === 'ReportPublished') return { ...item, kind: 'Report', mine: false, title: `${periodLabel(a.period)} report · ${fmt(a.kwh)} kWh`, wei: BigInt(a.deposited) };
    if (log.name === 'RevenueClaimed') return { ...item, kind: 'Claimed', mine: same(a.holder, address), title: `${cap(nameFor(a.holder))} claimed income`, wei: BigInt(a.amount) };
    if (log.name === 'Transfer' && same(a.from, address)) return { ...item, kind: 'Sent', mine: true, title: `You sent ${plural(Number(a.value), 'share')} to ${nameFor(a.to)}`, shares: Number(a.value) };
    if (log.name === 'Transfer' && same(a.to, address)) return { ...item, kind: 'Received', mine: true, title: `${cap(nameFor(a.from))} sent you ${plural(Number(a.value), 'share')}`, shares: Number(a.value) };
    return [];
  }).reverse();
}
function when(item) {
  if (simulation) return `Demo step ${item.block}`;
  const time = blockTimes.get(item.block);
  if (!time) return `Block ${fmt(item.block)}`;
  const seconds = Date.now() / 1000 - time, hours = Math.floor(seconds / 3600), days = Math.floor(seconds / 86400);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (days < 1) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(time * 1000).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}
function receipt(item, label) {
  const url = txUrl(item.hash);
  if (!url) return `<span class="receipt-tag">${simulation ? 'Simulated' : 'Local chain'}</span>`;
  return `<a class="receipt-link" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Receipt for ${esc(label)} on Etherscan">Receipt<svg class="icon icon-xs" aria-hidden="true"><use href="#i-ext" /></svg></a>`;
}
function feedRow(item, mine = false) {
  const [badge, kindName] = tones[item.kind];
  const amount = item.wei === undefined ? plural(item.shares, 'share') : demoIdr(item.wei);
  const head = `<span class="feed-badge kind-${item.kind}" aria-hidden="true">${badge}</span><div class="feed-text"><div class="feed-title">${esc(item.title)}</div><div class="feed-meta">${mine ? amount : kindName} · ${when(item)}</div></div>`;
  if (mine) return `<div class="feed-row">${head}${receipt(item, item.title)}</div>`;
  return `<div class="feed-row">${head}<div class="feed-end"><div class="feed-amount"><strong>${amount}</strong><span>${eth(item.wei)}</span></div>${receipt(item, item.title)}</div></div>`;
}

// Rendering
function setActionButton(button, key, idle, enabled) {
  const active = ui.busy === key;
  const label = active ? (ui.busyStage === 'wallet' ? 'Confirm in your wallet…' : `Processing on ${networkLabel()}…`) : idle;
  const html = active ? `<span class="spinner" aria-hidden="true"></span>${esc(label)}` : esc(label);
  if (button.dataset.html !== html) { button.innerHTML = html; button.dataset.html = html; }
  button.disabled = !enabled || Boolean(ui.busy);
  button.classList.toggle('is-busy', active);
}
function showPage() {
  if (location.hash === '#main-content') return;
  const page = ['home', 'project', 'portfolio', 'how', 'operator'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  document.querySelectorAll('.page').forEach(section => { section.hidden = section.id !== `${page}-page`; });
  document.querySelectorAll('[data-page]').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  closeMenu();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function render() {
  renderHeader(); renderProject(); renderPortfolio(); renderOperator(); renderMenu(); renderModal();
  $('#home-sold').textContent = state ? fmt(1000 - state.available) : '—';
  $('#load-error').textContent = loadError;
  $('#load-error').hidden = !loadError;
}
function renderHeader() {
  const operator = isOperator(), wrong = wrongNetwork();
  document.querySelectorAll('[data-operator-only]').forEach(link => { link.hidden = !operator; });
  $('#wrong-network').hidden = !wrong;
  $('#network-pill').hidden = wrong;
  $('#wallet-chip').hidden = !address;
  $('#connect-button').hidden = Boolean(address);
  $('#operator-tag').hidden = !operator;
  $('#operator-dot').hidden = !operator;
  if (!address) return;
  $('#wallet-address-wide').textContent = short(address);
  $('#wallet-address-narrow').textContent = `${address.slice(0, 4)}…${address.slice(-4)}`;
}
function renderProject() {
  $('#project-loading').hidden = Boolean(state || loadError);
  $('#project-content').hidden = !state;
  if (!state) return;
  const left = state.available, sold = 1000 - left, last = reports().at(-1);
  $('#status-chip').textContent = left ? `Selling · ${fmt(left)} shares left` : 'Fully funded';
  $('#last-kwh').textContent = last ? `${fmt(last.kwh)} kWh` : 'None yet';
  $('#last-label').textContent = last ? periodLabel(last.period) : 'First report pending';
  $('#sold-pct').textContent = pct(sold);
  $('#sold-count').textContent = fmt(sold);
  $('#left-count').textContent = fmt(left);
  $('#sold-progress').setAttribute('aria-valuenow', sold);
  $('#sold-fill').style.width = `${sold / 10}%`;
  document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === ui.filter)));
  const kind = { Purchases: 'Bought', Reports: 'Report', Claims: 'Claimed' }[ui.filter];
  const feed = activity().filter(item => ['Bought', 'Report', 'Claimed'].includes(item.kind) && (!kind || item.kind === kind)).slice(0, 20);
  $('#project-feed').innerHTML = feed.length ? `<div class="feed">${feed.map(item => feedRow(item)).join('')}</div>`
    : `<div class="feed-empty"><div class="feed-empty-title">${ui.filter === 'All' ? 'No activity yet' : `No ${ui.filter.toLowerCase()} yet`}</div><p>Purchases, monthly reports and claims show up here${onSepolia() ? ', each with a receipt you can check on Etherscan' : ''}.</p></div>`;
  renderBuy();
}
function renderBuy() {
  if (!state) return;
  const left = state.available, last = reports().at(-1), q = whole(ui.qty), price = BigInt(q) * SHARE_PRICE;
  const connected = Boolean(address), operator = isOperator(), wrong = wrongNetwork();
  let error = '';
  if (ui.qty !== '' && q < 1) error = 'Choose at least 1 share.';
  else if (q > left) error = left ? `Only ${fmt(left)} shares are left.` : 'All 1,000 shares are sold.';
  else if (connected && !operator && !wrong && price > state.ethBalance) error = `That's more than your ${simulation ? 'demo balance' : 'wallet'} holds (${balanceText()}).`;
  document.querySelectorAll('[data-preset]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.preset) === q)));
  $('#qty-stepper').classList.toggle('invalid', Boolean(error));
  $('#qty').setAttribute('aria-invalid', String(Boolean(error)));
  $('#qty-error').textContent = error;
  $('#qty-error').hidden = !error;
  $('#own-pct').textContent = pct(q);
  $('#total-rp').textContent = idr(q * 100000);
  $('#total-eth').textContent = eth(price);
  $('#payout-estimate').hidden = !last;
  if (last) {
    const payout = BigInt(q) * last.deposited / 1000n;
    $('#estimate-title').textContent = `${periodLabel(last.period).split(' ')[0]}'s payout for ${plural(q, 'share')}`;
    $('#estimate-rp').textContent = demoIdr(payout);
    $('#estimate-eth').textContent = eth(payout);
  }
  let label, enabled = true, faucet = false;
  let note = simulation ? 'Paid from your demo balance. No real money.' : 'Your wallet shows the network fee before you confirm.';
  if (!left) { label = 'Sold out'; enabled = false; }
  else if (!connected) { label = 'Connect wallet to buy'; note = onSepolia() ? "You'll need a wallet with Sepolia test ETH." : 'Pick a demo wallet to start.'; faucet = onSepolia(); }
  else if (wrong) label = switchLabel();
  else if (operator) { label = "Operator wallet can't buy"; enabled = false; note = `Switch to an investor ${usingMetaMask ? 'account' : 'wallet'} from the wallet menu to buy shares.`; }
  else { label = q > 0 ? `Buy ${plural(q, 'share')}` : 'Buy shares'; enabled = q >= 1 && !error; faucet = onSepolia() && price > state.ethBalance; }
  setActionButton($('#buy-button'), 'buy', label, enabled);
  $('#buy-note').textContent = note;
  $('#buy-faucet').hidden = !faucet;
}
function sendCheck() {
  const to = $('#send-to').value.trim(), raw = $('#send-qty').value, q = whole(raw), owned = state?.balance ?? 0;
  let toErr = '', qtyErr = '';
  if (to && !(/^0x[0-9a-fA-F]{40}$/.test(to) && isAddress(to))) toErr = "That doesn't look like a wallet address. It should start with 0x and have 42 characters.";
  else if (same(to, ZeroAddress)) toErr = "Shares can't be sent to the zero address.";
  else if (same(to, address)) toErr = "That's your own address.";
  else if (same(to, deployment?.operator)) toErr = "Shares can't be sent to the operator wallet.";
  else if (to && simulation && !demoAccounts.slice(1).some(a => same(a, to))) toErr = 'In the simulation, send shares to the other demo investor.';
  if (raw && q < 1) qtyErr = 'Enter at least 1 share.';
  else if (q > owned) qtyErr = `You only have ${plural(owned, 'share')}.`;
  return { to, q, toErr, qtyErr, ok: Boolean(to) && !toErr && q >= 1 && !qtyErr };
}
function renderPortfolio() {
  const operator = isOperator(), mine = state && address ? activity().filter(item => item.mine) : [];
  const empty = Boolean(state && address && !operator && !state.balance && !state.claimable && !state.claimed && !mine.length);
  const full = Boolean(state && address && !operator && !empty);
  $('#portfolio-address').textContent = address ? short(address) : 'Not connected';
  $('#portfolio-loading').hidden = !(address && !state && !loadError);
  $('#pf-no-wallet').hidden = Boolean(address);
  $('#pf-operator').hidden = !operator;
  $('#pf-switch').textContent = usingMetaMask ? 'Switch account in MetaMask' : 'Use investor wallet';
  $('#pf-empty').hidden = !empty;
  $('#pf-full').hidden = !full;
  if (!full) return;
  const wrong = wrongNetwork(), canClaim = state.claimable > 0n;
  $('#my-shares').textContent = fmt(state.balance);
  $('#my-pct').textContent = pct(state.balance);
  $('#my-value-rp').textContent = idr(state.balance * 100000);
  $('#my-value-eth').textContent = eth(BigInt(state.balance) * SHARE_PRICE);
  $('#my-claimed-rp').textContent = demoIdr(state.claimed);
  $('#my-claimed-eth').textContent = eth(state.claimed);
  $('#claim-ready').hidden = !canClaim;
  $('#claim-none').hidden = canClaim;
  $('#claimable-rp').textContent = demoIdr(state.claimable);
  $('#claimable-eth').textContent = eth(state.claimable);
  setActionButton($('#claim-button'), 'claim', wrong ? switchLabel() : `Claim ${demoIdr(state.claimable)}`, canClaim);
  const next = state.lastPeriod ? `${periodLabel(nextPeriod(state.lastPeriod))} report` : 'first monthly report';
  $('#claim-none-text').textContent = `Your next payout arrives when the operator publishes the ${next}. We'll show it here as soon as it lands.`;
  const check = sendCheck();
  $('#send-owned').textContent = `You own ${plural(state.balance, 'share')}`;
  for (const [field, message] of [['to', check.toErr], ['qty', check.qtyErr]]) {
    $(`#send-${field}`).classList.toggle('invalid', Boolean(message));
    $(`#send-${field}`).setAttribute('aria-invalid', String(Boolean(message)));
    $(`#send-${field}-error`).textContent = message;
    $(`#send-${field}-error`).hidden = !message;
  }
  setActionButton($('#send-button'), 'send', wrong ? switchLabel() : 'Send shares', wrong || (check.ok && state.balance > 0));
  const other = hasDemoWallets() ? accounts.find((account, i) => i > 0 && !same(account, address)) : null;
  $('#send-demo').hidden = !other;
  if (other) { $('#send-demo').textContent = `Use ${labels[accounts.indexOf(other)]}'s demo address`; $('#send-demo').dataset.address = other; }
  $('#my-feed').innerHTML = mine.length ? `<div class="feed">${mine.slice(0, 20).map(item => feedRow(item, true)).join('')}</div>`
    : '<p class="feed-note">Nothing here yet. Your purchases, claims and transfers will appear with receipts.</p>';
}
function breakdown() {
  const kwh = whole($('#report-kwh').value), costs = whole($('#report-costs').value), reserve = whole($('#report-reserve').value);
  const receipts = kwh * TARIFF_IDR, dist = receipts - costs - reserve, period = Number($('#report-period').value);
  let bad = '';
  if (!kwh) bad = 'Enter the kWh generated this month.';
  else if (kwh > 1000000) bad = 'Enter at most 1,000,000 kWh for one month.';
  else if (dist <= 0) bad = "Costs and reserve are higher than this month's receipts, so there's nothing to share. Lower them or check the kWh.";
  else if (!(period > state.lastPeriod)) bad = 'This month is already reported. Pick a later month.';
  else if (BigInt(dist) * GWEI > state.ethBalance) bad = `This deposit is more than your ${simulation ? 'demo balance' : 'wallet'} holds (${balanceText()}).${onSepolia() ? ' Get more test ETH from a Sepolia faucet.' : ''}`;
  return { kwh, costs, reserve, receipts, dist, period, ok: !bad, bad };
}
function renderBreakdown() {
  if (!state || !isOperator()) return;
  const r = breakdown(), width = value => `${r.receipts > 0 ? Math.max(0, Math.min(100, value / r.receipts * 100)) : 0}%`;
  $('#bd-receipts-note').textContent = `${fmt(r.kwh)} kWh × ${idr(TARIFF_IDR)}`;
  $('#bd-receipts').textContent = idr(r.receipts);
  $('#bd-costs').textContent = idr(r.costs);
  $('#bd-reserve').textContent = idr(r.reserve);
  $('#bar-costs').style.width = width(r.costs);
  $('#bar-reserve').style.width = width(r.reserve);
  $('#bar-dist').style.width = width(Math.max(0, r.dist));
  $('#bd-ok').hidden = !r.ok;
  $('#bd-bad').hidden = r.ok;
  $('#bd-bad').textContent = r.bad;
  $('#report-kwh').classList.toggle('invalid', !r.kwh || r.kwh > 1000000);
  if (r.ok) {
    const deposit = BigInt(r.dist) * GWEI;
    $('#bd-dist').textContent = idr(r.dist);
    $('#bd-dist-eth').textContent = eth(deposit);
    $('#bd-per-share').textContent = idr(r.dist / 1000);
    $('#bd-per-share-eth').textContent = eth(deposit / 1000n);
  }
  setActionButton($('#publish-button'), 'publish', wrongNetwork() ? switchLabel() : `Publish ${periodLabel(r.period)} report`, wrongNetwork() || r.ok);
}
function renderOperator() {
  const operator = isOperator();
  $('#op-guard').hidden = operator;
  $('#op-loading').hidden = !(operator && !state && !loadError);
  $('#op-content').hidden = !(operator && state);
  if (!operator) {
    const text = 'Only the operator wallet can publish monthly reports and withdraw sale proceeds.';
    $('#op-guard-text').textContent = hasDemoWallets() && !usingMetaMask ? `${text} For the demo, you can switch to it.` : deployment ? `${text} The operator is ${short(deployment.operator)}.` : text;
    $('#op-guard-button').textContent = !address ? 'Connect wallet' : usingMetaMask ? 'Switch account in MetaMask' : 'Use operator wallet (demo)';
    return;
  }
  if (!state) return;
  $('#op-address').textContent = short(address);
  const base = state.lastPeriod ? nextPeriod(state.lastPeriod) : currentPeriod();
  const options = [base, nextPeriod(base), nextPeriod(nextPeriod(base))], select = $('#report-period');
  if (select.dataset.options !== options.join()) {
    const previous = Number(select.value);
    select.innerHTML = options.map(period => `<option value="${period}">${periodLabel(period)}</option>`).join('');
    select.value = String(options.includes(previous) ? previous : base);
    select.dataset.options = options.join();
  }
  const all = reports(), last = all.at(-1);
  $('#last-published-note').textContent = last ? `Last published: ${periodLabel(last.period)}. Months must go in order.` : 'No reports yet. Start with your first month of production.';
  renderBreakdown();
  $('#reports-table').innerHTML = all.length
    ? `<div class="table-scroll"><table class="report-table"><thead><tr><th scope="col">Month</th><th scope="col">kWh</th><th scope="col">Receipts</th><th scope="col">Costs</th><th scope="col">Reserve</th><th scope="col">Distributed</th><th scope="col">Per share</th><th scope="col"><span class="visually-hidden">Receipt</span></th></tr></thead><tbody>${all.reverse().map(r => `<tr><td>${periodLabel(r.period)}</td><td>${fmt(r.kwh)}</td><td>${idr(r.kwh * TARIFF_IDR)}</td><td>${idr(r.costs)}</td><td>${idr(r.reserve)}</td><td>${demoIdr(r.deposited)}</td><td>${demoIdr(r.deposited / 1000n)}</td><td>${receipt(r, `${periodLabel(r.period)} report`)}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="feed-empty"><div class="feed-empty-title">No reports yet</div><p>Your first monthly report will appear here once it's published. Shareholders can claim as soon as it confirms.</p></div>`;
  const hasProceeds = state.proceeds > 0n;
  $('#proceeds-rp').textContent = demoIdr(state.proceeds);
  $('#proceeds-eth').textContent = eth(state.proceeds);
  setActionButton($('#withdraw-button'), 'withdraw', wrongNetwork() ? switchLabel() : hasProceeds ? 'Withdraw to operator wallet' : 'Nothing to withdraw', wrongNetwork() || hasProceeds);
}
function renderMenu() {
  if (!address) { closeMenu(); return; }
  const role = isOperator() ? 'Operator' : 'Investor';
  $('#menu-role').textContent = usingMetaMask ? `${role} wallet` : `${walletName} · ${role.toLowerCase()} wallet`;
  $('#menu-address').textContent = address;
  $('#menu-balance').textContent = state ? balanceText() : '—';
  $('#menu-balance-sub').textContent = !state ? '' : simulation ? 'Demo money' : `${demoIdr(state.ethBalance)} at the demo scale`;
  $('#menu-switch-label').textContent = usingMetaMask ? 'Switch MetaMask account' : 'Switch demo wallet';
  $('#menu-switch-tag').hidden = usingMetaMask;
  $('#menu-faucet').hidden = !onSepolia();
  $('#menu-reset').hidden = !simulation;
}
function renderModal() {
  for (const name of ['choose', 'connecting', 'wrong', 'switching']) $(`#modal-${name}`).hidden = ui.modal !== name;
  if (ui.modal === 'wrong') $('#modal-wrong-text').textContent = `Your wallet is on ${chainName(walletChainId)}. SuryaShare only works on ${onSepolia() ? 'the Sepolia test network' : 'the local test chain'}, so nothing here touches real money.`;
  const dialog = $('#wallet-modal');
  if (ui.modal && !dialog.open) dialog.showModal();
  if (!ui.modal && dialog.open) dialog.close();
}
function renderWalletOptions() {
  const options = hasDemoWallets() ? [[1, 'Alice', 'Demo investor', 'A', 'tone-maroon'], [2, 'Budi', 'Demo investor', 'B', 'tone-crimson'], [0, 'Solar operator', 'Run the income demo', 'S', 'tone-ink']] : [];
  if (!simulation) options.push(['metamask', 'MetaMask', 'Browser extension', 'M', '']);
  $('#wallet-options').innerHTML = options.map(([id, name, hint, letter, tone]) => `<button type="button" class="wallet-option" data-wallet="${id}"><span class="wallet-letter ${tone}" aria-hidden="true">${letter}</span><span class="wallet-option-text"><strong>${name}</strong><small>${hint}</small></span><svg class="icon" aria-hidden="true"><use href="#i-next" /></svg></button>`).join('');
}
function applyMode() {
  const sepolia = onSepolia(), network = simulation ? 'Simulation' : sepolia ? 'Sepolia' : 'Local chain';
  $('#banner-text').textContent = simulation ? 'Browser simulation. Fictional asset. No real money or blockchain transactions.'
    : `${sepolia ? 'Sepolia testnet' : 'Local test chain'}. Fictional asset. No real money. No legal ownership rights.`;
  $('#network-name').textContent = network;
  $('#network-pill').title = simulation ? 'Browser simulation' : sepolia ? 'Sepolia testnet' : 'Local test chain';
  $('#network-pill').setAttribute('aria-label', `Network: ${network}`);
  $('#contract-link').hidden = !sepolia;
  if (sepolia) $('#contract-link').href = `https://sepolia.etherscan.io/address/${deployment.address}`;
  $('#modal-choose-text').textContent = simulation ? 'Pick a role. Each starts with Rp100,000,000 in demo money, saved in this browser tab only.'
    : sepolia ? 'SuryaShare runs on the Sepolia test network. Nothing here uses real money.' : 'Pick a funded demo wallet on the local test chain, or connect MetaMask.';
  $('#modal-faucet').hidden = !sepolia;
  $('#switch-network').textContent = switchLabel();
  $('#modal-wrong-title').textContent = switchLabel();
  $('#modal-switching-text').textContent = `Approve the switch to ${networkLabel()} in your wallet.`;
  if (simulation) {
    $('#pf-no-wallet p').textContent = 'Pick a demo wallet to see its shares and income. Everything stays in this browser tab.';
    $('#how-note').textContent = 'This build is a browser simulation: the solar project, money, shares and reports are simulated and saved in this tab only. No wallet or blockchain is involved.';
  } else if (!sepolia) {
    $('#pf-no-wallet p').textContent = 'Your shares and income live in your wallet. Connecting lets SuryaShare read them from the local test chain. It can\'t move anything without your approval.';
    $('#how-note').textContent = 'The solar project and its reports are fictional. This build runs on a local test chain, so its transactions exist only on your computer. Rp1 of demo value equals 1 gwei of test ETH. That\'s a display scale, not an exchange rate.';
  }
  renderWalletOptions();
}

// Dialogs
function openModal(name) { closeMenu(); ui.modal = name; renderModal(); }
function closeModal() {
  if (ui.modal === 'connecting') connectAttempt++;
  ui.modal = null; renderModal();
}
function openMenu() {
  renderMenu();
  if (!$('#wallet-menu').open) $('#wallet-menu').showModal();
  $('#wallet-menu-button').setAttribute('aria-expanded', 'true');
}
function closeMenu() { if ($('#wallet-menu').open) $('#wallet-menu').close(); }

// Chain state
async function refresh() {
  if (simulation) {
    const snapshot = simulation.snapshot(address);
    state = { ...snapshot, ethBalance: BigInt(Math.round(snapshot.cash * 1000)) * 1000000n };
    render(); return;
  }
  if (!contract) return;
  const currentAddress = address;
  const [latest, available, revenue, lastPeriod, proceeds, balance, claimable, claimed, ethBalance, rawLogs] = await Promise.all([
    provider.getBlockNumber(), contract.availableShares(), contract.totalRevenue(), contract.lastPeriod(), contract.saleProceeds(),
    currentAddress ? contract.balanceOf(currentAddress) : 0n, currentAddress ? contract.claimable(currentAddress) : 0n,
    currentAddress ? contract.totalClaimed(currentAddress) : 0n, currentAddress ? provider.getBalance(currentAddress) : 0n,
    // ponytail: after one full scan, rescans only a short overlap of recent blocks; use a dedicated indexer for long-lived projects.
    provider.getLogs({ address: deployment.address, fromBlock: scanFrom ?? deployment.blockNumber, toBlock: 'latest' }),
  ]);
  for (const log of rawLogs) logCache.set(`${log.transactionHash}:${log.index}`, { ...log, ...contract.interface.parseLog(log) });
  scanFrom = Math.max(deployment.blockNumber, latest - 50);
  if (currentAddress !== address) return;
  const parsed = [...logCache.values()].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
  const purchases = new Set(parsed.filter(log => log.name === 'SharesPurchased').map(log => log.transactionHash));
  const logs = parsed.filter(log => log.name === 'Transfer' ? log.args.from !== ZeroAddress && !purchases.has(log.transactionHash) : log.name !== 'Approval');
  state = { available: Number(available), revenue, lastPeriod: Number(lastPeriod), proceeds, balance: Number(balance), claimable, claimed, ethBalance, logs };
  loadError = '';
  render();
  loadBlockTimes(logs);
}
async function loadBlockTimes(logs) {
  const mine = logs.filter(log => Object.values(log.args).some(value => typeof value === 'string' && same(value, address)));
  const missing = [...new Set([...logs.slice(-40), ...mine.slice(-20)].map(log => log.blockNumber))].filter(block => !blockTimes.has(block));
  if (!missing.length) return;
  try {
    const blocks = await Promise.all(missing.map(block => provider.getBlock(block)));
    blocks.forEach((block, i) => { if (block) blockTimes.set(missing[i], block.timestamp); });
    render();
  } catch { /* Relative times are optional; block numbers stay visible. */ }
}
function manualRefresh() {
  refresh().then(() => info('Up to date', simulation ? 'Demo state reloaded.' : `Latest activity loaded from ${networkLabel()}.`)).catch(error => notify(error, "Couldn't refresh"));
}
async function transact(key, title, action, success) {
  if (ui.busy) return false;
  if (simulation) {
    try {
      await action(simulation.forAccount(address));
      await refresh();
      dismissLater(pushToast({ status: 'confirmed', title, body: success() }), 9000);
      return true;
    } catch (error) { pushToast({ status: 'failed', title, body: errorMessage(error) }); return false; }
  }
  if (wrongNetwork()) { openModal('wrong'); return false; }
  if (!signer) { openModal('choose'); return false; }
  ui.busy = key; ui.busyStage = 'wallet';
  const id = pushToast({ status: 'wallet', title, body: 'Confirm the request in your wallet.' });
  render();
  try {
    const chainId = await signer.provider.send('eth_chainId', []);
    if (BigInt(chainId) !== BigInt(deployment.chainId)) throw new Error(`Your wallet is on the wrong network. ${switchLabel()} and try again.`);
    if (signer.provider !== provider) {
      const connectedAccounts = await signer.provider.send('eth_accounts', []);
      if (!same(connectedAccounts[0], address)) throw new Error('Your account changed. Reconnect your wallet before continuing.');
    }
    const tx = await action(contract.connect(signer));
    ui.busyStage = 'pending';
    patchToast(id, { status: 'pending', body: `Sent to ${networkLabel()}. This usually takes 10 to 20 seconds.`, hash: tx.hash });
    render();
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error('The transaction reverted.');
    ui.busy = null;
    try { await refresh(); patchToast(id, { status: 'confirmed', body: success() }); }
    catch { patchToast(id, { status: 'confirmed', body: 'Confirmed, but the page could not refresh. Use Refresh to load the latest state.' }); }
    dismissLater(id, 9000);
    return true;
  } catch (error) {
    if (isRejection(error)) { patchToast(id, { status: 'rejected', body: errorMessage(error) }); dismissLater(id, 7000); }
    else patchToast(id, { status: 'failed', body: errorMessage(error) });
    return false;
  } finally {
    ui.busy = null; ui.busyStage = null; render();
  }
}

// Wallets
async function chooseWallet(index, quiet = false) {
  if (ui.busy) return;
  if (!simulation && (!provider || deployment.chainId !== 31337 || !['localhost', '127.0.0.1'].includes(location.hostname))) throw new Error('Demo wallets are available only on the local development chain.');
  usingMetaMask = false; walletChainId = null; accountTarget = null;
  if (simulation) address = accounts[index];
  else { signer = await provider.getSigner(index); address = await signer.getAddress(); }
  walletName = labels[index];
  closeMenu(); ui.modal = null; renderModal();
  await refresh();
  if (!quiet) info('Wallet connected', `Using the ${walletName} demo wallet.`);
}
function attachWallet(selected) {
  if (selected === walletProvider) return;
  for (const [event, handler] of [['accountsChanged', onAccountsChanged], ['chainChanged', onChainChanged], ['disconnect', onWalletDisconnect]]) {
    walletProvider?.removeListener?.(event, handler);
    selected.on?.(event, handler);
  }
  walletProvider = selected;
}
async function useAccount(account) {
  const next = getAddress(account);
  if (next === accountTarget) return false;
  accountTarget = next;
  let chainId;
  try { chainId = Number(await walletProvider.request({ method: 'eth_chainId' })); }
  catch (error) { if (accountTarget === next) accountTarget = null; throw error; }
  if (accountTarget !== next) return false;
  usingMetaMask = true; walletChainId = chainId; address = next; walletName = 'MetaMask';
  signer = chainId === deployment.chainId ? await new BrowserProvider(walletProvider).getSigner(next) : null;
  render();
  refresh().catch(error => notify(error, "Couldn't load your wallet"));
  return true;
}
async function connectMetaMask() {
  if (ui.busy) return;
  if (!deployment || simulation) throw new Error('The project is not connected to a blockchain yet.');
  const attempt = ++connectAttempt;
  openModal('connecting');
  try {
    const selected = await getMetaMaskProvider();
    attachWallet(selected);
    const [account] = await selected.request({ method: 'eth_requestAccounts' });
    if (attempt !== connectAttempt) return;
    if (!account) throw new Error('MetaMask did not share an account. Unlock MetaMask and try again.');
    accountTarget = null;
    await useAccount(account);
    if (attempt !== connectAttempt) return;
    ui.modal = wrongNetwork() ? 'wrong' : null; renderModal();
    if (!wrongNetwork()) info('Wallet connected', `Connected with MetaMask on ${networkLabel()}.`);
  } catch (error) {
    if (attempt !== connectAttempt) return;
    ui.modal = 'choose'; renderModal();
    if (isRejection(error)) dismissLater(pushToast({ status: 'rejected', title: 'Connection cancelled', body: 'Nothing was shared with SuryaShare.' }), 7000);
    else notify(error, "Couldn't connect");
  }
}
const announceAccount = () => info('Account changed', `Now using ${short(address)}${isOperator() ? ', the operator wallet' : ''}.`);
function onAccountsChanged(list) {
  if (!usingMetaMask) return;
  if (!list?.length) { resetWallet(); info('Wallet disconnected', 'MetaMask disconnected this site.'); return; }
  useAccount(list[0]).then(changed => changed && announceAccount()).catch(error => notify(error, "Couldn't switch account"));
}
async function onChainChanged(chainId) {
  if (!usingMetaMask || !address) return;
  walletChainId = Number(chainId);
  signer = walletChainId === deployment.chainId ? await new BrowserProvider(walletProvider).getSigner(address).catch(() => null) : null;
  if (!wrongNetwork() && ui.modal === 'wrong') ui.modal = null;
  render();
}
function onWalletDisconnect() { if (usingMetaMask) resetWallet(); }
async function switchAccount() {
  closeMenu();
  if (!usingMetaMask) { openModal('choose'); return; }
  try {
    // MetaMask shows its account picker; the chosen account becomes the first one returned.
    await walletProvider.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
    const [account] = await walletProvider.request({ method: 'eth_accounts' });
    if (account && await useAccount(account)) announceAccount();
  } catch (error) { if (!isRejection(error)) notify(error, "Couldn't switch account"); }
}
async function switchNetwork() {
  if (!walletProvider) return;
  openModal('switching');
  try {
    await ensureWalletNetwork(walletProvider, deployment.chainId);
    await onChainChanged(await walletProvider.request({ method: 'eth_chainId' }));
    ui.modal = null; renderModal();
    info(`Switched to ${networkLabel()}`, "You're on the right network now.");
  } catch (error) {
    openModal('wrong');
    if (isRejection(error)) dismissLater(pushToast({ status: 'rejected', title: 'Network switch cancelled', body: `Your wallet is still on ${chainName(walletChainId)}.` }), 7000);
    else notify(error, "Couldn't switch network");
  }
}
function resetWallet() {
  signer = null; address = null; walletName = null; usingMetaMask = false; walletChainId = null; accountTarget = null;
  closeMenu(); render();
  refresh().catch(() => {});
}
function disconnect() {
  if (usingMetaMask) walletProvider?.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch(() => {});
  ui.modal = null;
  resetWallet();
  info('Disconnected', simulation ? 'Pick a demo wallet to continue.' : 'Your wallet is no longer connected to SuryaShare.');
}
async function copyAddress() {
  if (!address) return;
  try { await navigator.clipboard.writeText(address); info('Address copied', short(address)); }
  catch { notify(new Error(`Copy it from the wallet menu: ${address}`), "Couldn't copy the address"); }
}

// Events
function setQty(n) { ui.qty = String(n); $('#qty').value = ui.qty; renderBuy(); }
document.addEventListener('click', event => {
  const target = event.target.closest('[data-connect],[data-close-modal],[data-wallet],[data-dismiss],[data-filter],[data-preset],[data-refresh]');
  if (!target) return;
  if (target.matches('[data-connect]')) openModal('choose');
  else if (target.matches('[data-close-modal]')) closeModal();
  else if (target.matches('[data-wallet]')) {
    const id = target.dataset.wallet;
    (id === 'metamask' ? connectMetaMask() : chooseWallet(Number(id))).catch(error => notify(error, "Couldn't connect"));
  }
  else if (target.matches('[data-dismiss]')) dismissToast(Number(target.dataset.dismiss));
  else if (target.matches('[data-filter]')) { ui.filter = target.dataset.filter; renderProject(); }
  else if (target.matches('[data-preset]')) setQty(Math.min(Number(target.dataset.preset), Math.max(state?.available ?? 1000, 1)));
  else manualRefresh();
});
$('#wallet-modal').addEventListener('close', () => {
  if ($('#wallet-modal').open) return;
  if (ui.modal === 'connecting') connectAttempt++;
  ui.modal = null;
});
$('#wallet-menu').addEventListener('click', event => { if (event.target === event.currentTarget) closeMenu(); });
$('#wallet-menu').addEventListener('close', () => $('#wallet-menu-button').setAttribute('aria-expanded', 'false'));
$('#wallet-menu-button').onclick = openMenu;
$('#copy-address').onclick = copyAddress;
$('#menu-copy').onclick = copyAddress;
$('#menu-switch').onclick = () => { if (usingMetaMask) switchAccount(); else openModal('choose'); };
$('#menu-reset').onclick = async () => {
  try { simulation.reset(); await chooseWallet(1, true); info('Demo reset', 'Everyone starts fresh.'); }
  catch (error) { notify(error, "Couldn't reset the demo"); }
};
$('#menu-disconnect').onclick = disconnect;
$('#modal-disconnect').onclick = disconnect;
$('#wrong-network').onclick = () => openModal('wrong');
$('#switch-network').onclick = switchNetwork;
$('#pf-switch').onclick = () => {
  if (usingMetaMask) switchAccount();
  else chooseWallet(1).catch(error => notify(error));
};
$('#op-guard-button').onclick = () => {
  if (!address) openModal('choose');
  else if (usingMetaMask) switchAccount();
  else chooseWallet(0).catch(error => notify(error));
};
$('#qty').oninput = event => {
  const value = digits(event.target.value, 4);
  if (value !== event.target.value) event.target.value = value;
  ui.qty = value; renderBuy();
};
$('#qty-dec').onclick = () => setQty(Math.max(1, whole(ui.qty) - 1));
$('#qty-inc').onclick = () => setQty(Math.min(Math.max(state?.available ?? 1000, 1), whole(ui.qty) + 1));
$('#buy-form').onsubmit = event => {
  event.preventDefault();
  if (!state) return;
  if (!address) { openModal('choose'); return; }
  if (wrongNetwork()) { openModal('wrong'); return; }
  const q = whole(ui.qty);
  if (isOperator() || q < 1 || q > state.available) return;
  transact('buy', `Buy ${plural(q, 'share')}`, c => c.buyShares(q, { value: BigInt(q) * SHARE_PRICE }),
    () => `You now own ${plural(state.balance, 'share')}, ${pct(state.balance)} of the project.`);
};
$('#claim-button').onclick = () => {
  if (wrongNetwork()) { openModal('wrong'); return; }
  const amount = state?.claimable ?? 0n;
  if (!amount) return;
  transact('claim', `Claim ${demoIdr(amount)}`, c => c.claimRevenue(), () => `${demoIdr(amount)} (${eth(amount)}) is in your ${simulation ? 'demo balance' : 'wallet'}.`);
};
$('#send-form').oninput = event => {
  if (event.target.id === 'send-qty') event.target.value = digits(event.target.value, 4);
  renderPortfolio();
};
$('#send-max').onclick = () => { $('#send-qty').value = String(state?.balance ?? 0); renderPortfolio(); };
$('#send-demo').onclick = () => { $('#send-to').value = $('#send-demo').dataset.address; renderPortfolio(); };
$('#send-form').onsubmit = async event => {
  event.preventDefault();
  if (wrongNetwork()) { openModal('wrong'); return; }
  const check = sendCheck();
  if (!check.ok || !address || isOperator()) return;
  const sent = await transact('send', `Send ${plural(check.q, 'share')}`, c => c.transfer(check.to, check.q),
    () => `${plural(check.q, 'share')} ${check.q === 1 ? 'is' : 'are'} now with ${nameFor(check.to)}. Income you earned before sending stays with you.`);
  if (sent) { $('#send-to').value = ''; $('#send-qty').value = ''; renderPortfolio(); }
};
$('#report-form').oninput = event => {
  if (event.target.matches('input')) event.target.value = digits(event.target.value, 10);
  renderBreakdown();
};
$('#report-form').onsubmit = event => {
  event.preventDefault();
  if (wrongNetwork()) { openModal('wrong'); return; }
  if (!state || !isOperator()) return;
  const r = breakdown();
  if (!r.ok) return;
  transact('publish', `Publish ${periodLabel(r.period)} report`, c => c.publishReport(r.period, r.kwh, r.costs, r.reserve, { value: BigInt(r.dist) * GWEI }),
    () => `${idr(r.dist)} is now claimable by shareholders, ${idr(r.dist / 1000)} per share.`);
};
$('#withdraw-button').onclick = () => {
  if (wrongNetwork()) { openModal('wrong'); return; }
  const amount = state?.proceeds ?? 0n;
  if (!amount || !isOperator()) return;
  transact('withdraw', `Withdraw ${demoIdr(amount)}`, c => c.withdrawSaleProceeds(), () => `${demoIdr(amount)} (${eth(amount)}) was sent to the operator wallet.`);
};
window.addEventListener('hashchange', showPage);
// Pick up purchases, reports and claims made by other wallets.
setInterval(() => { if (contract && !document.hidden && !ui.busy) refresh().catch(() => {}); }, 30000);
document.addEventListener('visibilitychange', () => { if (contract && !document.hidden && !ui.busy) refresh().catch(() => {}); });
showPage(); renderWalletOptions(); render();

async function initialize() {
  if (simulationMode) {
    simulation = createSimulation(sessionStorage);
    accounts = demoAccounts;
    deployment = { operator: accounts[0], chainId: null };
    applyMode();
    await chooseWallet(1, true);
    if (simulation.warning) notify(new Error(simulation.warning), 'Demo restarted');
    return;
  }
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}deployment.json`, { cache: 'no-store' });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Deployment configuration is missing.');
    deployment = await response.json();
    if (![31337, SEPOLIA].includes(deployment.chainId)) throw new Error('This app only supports local Ethereum or Sepolia.');
    const rpc = new URL(deployment.rpcUrl);
    if (!['http:', 'https:'].includes(rpc.protocol)) throw new Error('Invalid RPC URL.');
    if (deployment.chainId === 31337 && !['127.0.0.1', 'localhost'].includes(rpc.hostname)) throw new Error('Local development wallets require a loopback RPC.');
    provider = new JsonRpcProvider(deployment.rpcUrl, undefined, { cacheTimeout: -1 });
    if ((await provider.getNetwork()).chainId !== BigInt(deployment.chainId)) throw new Error('Deployment network does not match the node.');
    if (await provider.getCode(deployment.address) === '0x') throw new Error('The node restarted. Run npm run deploy to create a new demo contract.');
    contract = new Contract(deployment.address, deployment.abi, provider);
    if (deployment.chainId === 31337) accounts = (await provider.listAccounts()).slice(0, 3).map(account => account.address);
    applyMode();
    await refresh();
  } catch (error) {
    state = null;
    loadError = deployment?.chainId === SEPOLIA
      ? `Sepolia could not be reached. Reload to retry. ${errorMessage(error)}`
      : `Local demo is not connected. Run npm start in the SuryaShare folder, then reload. ${errorMessage(error)}`;
    render();
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
