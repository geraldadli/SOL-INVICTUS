import { createSimulation, demoAccounts } from './simulation.js';
import { ensureWalletNetwork } from './wallet-network.js';
import { getMetaMaskProvider } from './metamask.js';
import { reportAmounts, utcPeriod } from './reporting.js';
import { auditIncome, validateEvidence, operatingStatuses } from './verification.js';
import { advanceLocalDemo, canAdvanceLocalDemo } from './local-demo-clock.js';
import { createHomeWall } from './home-wall.js';
import { createReveal, fadeInPage, initButtonRays, tick } from './motion.js';
import { createMilestoneScreen, readMilestones } from './milestones.js';
import { verifierEndpoint } from './deployment-settings.js';
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
const currentPeriod = () => utcPeriod(Date.now() / 1000);
const chainName = id => ({ 1: 'Ethereum Mainnet', [SEPOLIA]: 'Sepolia', 31337: 'the local test chain', 17000: 'Holesky', 560048: 'Hoodi' })[id] ?? `another network (chain ${id})`;
const isRejection = error => [error, error?.info?.error, error?.error].some(e => e?.code === 4001 || e?.code === 'ACTION_REJECTED');
let deployment, provider, contract, signer, address, walletName, accounts = [], state, loadError = '';
let simulation, walletProvider, walletChainId, usingMetaMask = false, accountTarget, connectAttempt = 0, scanFrom, toastId = 0;
let safeguards = false;
let milestoneSupport = false;
let verification = { required: false }, proofBundle, proofLoading = false, incomeAudit, auditError = '', auditRun = 0;
let advancingDemoClock = false;
const ui = { qty: '10', filter: 'All', busy: null, busyStage: null, modal: null, toasts: [] };
const logCache = new Map(), blockTimes = new Map();
const labels = ['Solar operator', 'Alice', 'Budi', 'Milestone reviewer'];
const onSepolia = () => deployment?.chainId === SEPOLIA;
const hasDemoWallets = () => accounts.length > 0;
const networkLabel = () => onSepolia() ? 'Sepolia' : 'the local chain';
const switchLabel = () => `Switch to ${networkLabel()}`;
const isOperator = () => Boolean(address && deployment && same(address, deployment.operator));
const isMilestoneReviewer = () => same(address, state?.milestones?.reviewer);
const wrongNetwork = () => Boolean(address && usingMetaMask && walletChainId !== deployment.chainId);
const txUrl = hash => onSepolia() ? `https://sepolia.etherscan.io/tx/${hash}` : '';
const balanceText = () => simulation ? idr(state.cash) : eth(state.ethBalance);
const reverts = {
  'Use an investor wallet': "The operator wallet can't buy Sol Coins. Switch to an investor account.",
  'Invalid share quantity': 'Fewer Sol Coins are left than you tried to buy. Pick a smaller number and try again.',
  'Incorrect payment': "The payment didn't match the Sol Coin price. Reload the page and try again.",
  'Period already reported or out of order': 'This month has already been reported, or it comes before the last report. Pick a later month and try again.',
  'No distributable income': "Costs and reserve are higher than this month's receipts, so there's nothing to share.",
  'Incorrect revenue deposit': "The deposit didn't match the report. Reload the page and try again.",
  'No income to claim': 'There is no income to claim right now.',
  'Payout failed': "The payout couldn't be sent to your wallet. Your income is still safe in the contract. Try again in a minute.",
  'No proceeds': 'There are no sale proceeds to withdraw.',
  'Withdrawal failed': "The withdrawal didn't go through. The proceeds are still in the contract. Try again in a minute.",
  'Sale inventory reserved': "The operator's unsold Sol Coins are reserved for buyers and can't be sent.",
  'Operator only': 'Only the operator wallet can do this.',
  'Purchases paused or reporting overdue': 'Purchases are paused. Existing claims and transfers remain available.',
  'Report the next required month': 'Report the next required month without skipping any months.',
  'Reporting month has not ended': 'This reporting month has not ended yet. Check the reporting opening time.',
};

const utcShort = timestamp => `${new Date(timestamp * 1000).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} UTC`;
const utcDay = timestamp => new Date(timestamp * 1000).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const utcMonthStart = period => Date.UTC(Math.floor(period / 100), period % 100 - 1, 1) / 1000;
const idrCompact = wei => { const n = Number(wei) / 1e9; return n >= 1e6 ? `Rp${(n / 1e6).toFixed(1)}M` : idr(n); };
const greeting = () => { const hour = new Date().getHours(); return `Good ${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}, operator`; };
function tween(el, to, format) {
  const from = el._v ?? 0, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  el._v = to;
  cancelAnimationFrame(el._raf);
  if (from === to || reduce) { el.textContent = format(to); return; }
  const start = performance.now();
  const tick = now => { const p = Math.min(1, (now - start) / 700); el.textContent = format(p === 1 ? to : from + (to - from) * (1 - (1 - p) ** 3)); if (p < 1) el._raf = requestAnimationFrame(tick); };
  el._raf = requestAnimationFrame(tick);
}
const dayDelta = (timestamp, now) => { const days = Math.round(Math.abs(timestamp - now) / 86400); return days < 1 ? 'under a day' : `${days} day${days === 1 ? '' : 's'}`; };
const utcDate = timestamp => `${new Date(timestamp * 1000).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC`;
async function readReportingStatus() {
  if (!safeguards) return { safeguards: false };
  const block = await provider.getBlock('latest');
  if (!block) throw new Error('Latest block is unavailable.');
  const [[next, opens, due, paused, overdue, allowed], lastPeriod] = await Promise.all([
    contract.reportingStatus({ blockTag: block.number }), contract.lastPeriod({ blockTag: block.number }),
  ]);
  return { safeguards: true, lastPeriod: Number(lastPeriod), nextReportingPeriod: Number(next), reportingOpensAt: Number(opens), reportDueAt: Number(due),
    purchasesPaused: paused, overdue, purchasesAllowed: allowed, timestamp: block.timestamp, statusUnavailable: false };
}
// Reporting & checks window: every block is a dropdown. Both panels are redrawn from scratch, so the open ones are remembered here.
const openDrops = new Set();
const drop = (key, label, title, body) => `<details class="drop" data-drop="${key}"${openDrops.has(key) ? ' open' : ''}><summary><span class="drop-text"><span class="drop-label">${label}</span><span class="drop-title">${title}</span></span><svg class="icon drop-chevron" aria-hidden="true"><use href="#i-down" /></svg></summary><div class="drop-body">${body}</div></details>`;
const reportSourceNote = () => verification.required ? verification.demo ? 'Monthly figures must pass an automatic check using sample data.' : 'Monthly figures must be approved by the data-checking service.' : 'Monthly figures are supplied by the operator.';
function renderReporting() {
  const status = !state ? 'Loading reporting status…' : !state.safeguards ? 'Reporting protections unavailable on this contract'
    : state.statusUnavailable ? 'Reporting status unavailable — purchases disabled'
    : state.purchasesPaused && state.overdue ? 'Operator pause and overdue report'
    : state.purchasesPaused ? 'Purchases paused by operator' : state.overdue ? 'Report overdue — purchases blocked' : 'Reporting up to date';
  const sourceNote = reportSourceNote();
  const detail = state?.safeguards ? `<p>Last report: ${state.lastPeriod ? periodLabel(state.lastPeriod) : 'None yet'}. Next required: <strong>${periodLabel(state.nextReportingPeriod)}</strong>.</p><p>Reporting opens: ${utcDate(state.reportingOpensAt)}<br>Due by: ${utcDate(state.reportDueAt)}</p><p>Claims and transfers remain available. ${sourceNote}</p>` : '<p>Monthly deadlines and purchase pausing require a version 2 or later contract.</p>';
  // The operator lab's #operator-reporting-status is drawn as a schedule by renderOperatorOverview().
  $('#reporting-status').innerHTML = drop('status', 'Reporting status', status, detail);
  $('#reporting-controls').hidden = !state?.safeguards;
  $('#simulation-clock').hidden = !simulation;
  const pauseSwitch = $('#pause-purchases');
  pauseSwitch.setAttribute('aria-checked', String(!state?.purchasesPaused));
  pauseSwitch.disabled = !(state?.safeguards && isOperator() && !state.statusUnavailable) || Boolean(ui.busy);
  pauseSwitch.classList.toggle('is-busy', ui.busy === 'pause');
}

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
const tones = { Bought: ['BUY', 'Purchase'], Report: ['kWh', 'Monthly report'], Claimed: ['Rp', 'Claim'], Sent: ['OUT', 'Transfer'], Received: ['IN', 'Transfer'], Pause: ['II', 'Purchase controls'], Withdrawn: ['Rp', 'Withdrawal'] };
const reports = () => (state?.logs ?? []).filter(log => log.name === 'ReportPublished').map(log => ({
  period: Number(log.args.period), kwh: Number(log.args.kwh), costs: Number(log.args.costsIdr), reserve: Number(log.args.reserveIdr),
  deposited: BigInt(log.args.deposited), hash: log.transactionHash, block: log.blockNumber,
}));
function activity() {
  return (state?.logs ?? []).flatMap(log => {
    const a = log.args, item = { hash: log.transactionHash, block: log.blockNumber };
    if (log.name === 'SharesPurchased') return { ...item, kind: 'Bought', mine: same(a.buyer, address), title: `${cap(nameFor(a.buyer))} bought ${plural(Number(a.shares), 'Sol Coin')}`, wei: BigInt(a.paid) };
    if (log.name === 'ReportPublished') return { ...item, kind: 'Report', mine: false, title: `${periodLabel(a.period)} report · ${fmt(a.kwh)} kWh`, wei: BigInt(a.deposited) };
    if (log.name === 'PurchasesPauseChanged') return { ...item, kind: 'Pause', mine: false, title: a.paused ? 'Operator paused purchases' : 'Operator removed manual pause' };
    if (log.name === 'ProceedsWithdrawn') return { ...item, kind: 'Withdrawn', mine: false, title: 'Operator withdrew sale proceeds', wei: BigInt(a.amount) };
    if (log.name === 'RevenueClaimed') return { ...item, kind: 'Claimed', mine: same(a.holder, address), title: `${cap(nameFor(a.holder))} claimed income`, wei: BigInt(a.amount) };
    if (log.name === 'Transfer' && same(a.from, address)) return { ...item, kind: 'Sent', mine: true, title: `You sent ${plural(Number(a.value), 'Sol Coin')} to ${nameFor(a.to)}`, shares: Number(a.value) };
    if (log.name === 'Transfer' && same(a.to, address)) return { ...item, kind: 'Received', mine: true, title: `${cap(nameFor(a.from))} sent you ${plural(Number(a.value), 'Sol Coin')}`, shares: Number(a.value) };
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
  const amount = item.kind === 'Pause' ? 'Claims remain available' : item.wei === undefined ? plural(item.shares, 'Sol Coin') : demoIdr(item.wei);
  const head = `<span class="feed-badge kind-${item.kind}" aria-hidden="true">${badge}</span><div class="feed-text"><div class="feed-title">${esc(item.title)}</div><div class="feed-meta">${mine ? amount : kindName} · ${when(item)}</div></div>`;
  if (mine) return `<div class="feed-row">${head}${receipt(item, item.title)}</div>`;
  return `<div class="feed-row">${head}<div class="feed-end"><div class="feed-amount"><strong>${amount}</strong>${item.wei === undefined ? '' : `<span>${eth(item.wei)}</span>`}</div>${receipt(item, item.title)}</div></div>`;
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
  const page = ['home', 'project', 'portfolio', 'how', 'operator', 'milestones'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  document.querySelectorAll('.page').forEach(section => { section.hidden = section.id !== `${page}-page`; });
  document.querySelectorAll('[data-page]').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  closeMenu();
  window.scrollTo({ top: 0, behavior: 'instant' });
  fadeInPage($(`#${page}-page`)); reveal.replay($(`#${page}-page`));
  if (page === 'how') lightHowSteps(); else stopHowSteps();
}
function render() {
  renderHeader(); renderProject(); renderPortfolio(); renderOperator(); renderReporting(); renderVerification(); renderMenu(); renderModal(); milestoneScreen.render();
  $('#home-sold').textContent = state ? fmt(1000 - state.available) : '—';
  const held = state && address && !isOperator() ? state.balance : 0;
  $('#home-mine').textContent = !state ? '—' : !address ? 'Not connected' : isOperator() ? 'Operator' : plural(held, 'coin');
  wall.update({ ready: Boolean(state), sold: state ? 1000 - state.available : 0, mine: held });
  $('#load-error').textContent = loadError;
  $('#load-error').hidden = !loadError;
}
function renderHeader() {
  const operator = isOperator(), wrong = wrongNetwork();
  document.querySelectorAll('[data-operator-only]').forEach(link => { link.hidden = !operator; });
  // Funding milestones are run by the operator and the milestone reviewer; investor wallets don't see the entry point.
  const admin = operator || isMilestoneReviewer();
  document.querySelectorAll('[data-admin-only]').forEach(el => { el.hidden = !admin; });
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
  $('#last-kwh').textContent = last ? `${fmt(last.kwh)} kWh` : 'None yet';
  $('#last-label').textContent = last ? periodLabel(last.period) : 'First report pending';
  $('#sold-pct').textContent = pct(sold);
  $('#sold-count').textContent = fmt(sold);
  $('#left-count').textContent = fmt(left);
  document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === ui.filter)));
  const kind = { Purchases: 'Bought', Reports: 'Report', Claims: 'Claimed' }[ui.filter];
  const feed = activity().filter(item => ['Bought', 'Report', 'Claimed', 'Pause'].includes(item.kind) && (!kind || item.kind === kind)).slice(0, 20);
  $('#project-feed').innerHTML = feed.length ? `<div class="feed">${feed.map(item => feedRow(item)).join('')}</div>`
    : `<div class="feed-empty"><div class="feed-empty-title">${ui.filter === 'All' ? 'No activity yet' : `No ${ui.filter.toLowerCase()} yet`}</div><p>Purchases, monthly reports and claims show up here${onSepolia() ? ', each with a receipt you can check on Etherscan' : ''}.</p></div>`;
  renderBuy();
}
function renderBuy() {
  if (!state) return;
  const left = state.available, last = reports().at(-1), q = whole(ui.qty), price = BigInt(q) * SHARE_PRICE;
  const connected = Boolean(address), operator = isOperator(), wrong = wrongNetwork();
  let error = '';
  if (ui.qty !== '' && q < 1) error = 'Choose at least 1 Sol Coin.';
  else if (q > left) error = left ? `Only ${fmt(left)} Sol Coins are left.` : 'All 1,000 Sol Coins are sold.';
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
    $('#estimate-title').textContent = `${periodLabel(last.period).split(' ')[0]}'s payout for ${plural(q, 'Sol Coin')}`;
    $('#estimate-rp').textContent = demoIdr(payout);
    $('#estimate-eth').textContent = eth(payout);
  }
  let label, enabled = true, faucet = false;
  let note = simulation ? 'Paid from your demo balance. No real money.' : 'Your wallet shows the network fee before you confirm.';
  if (!left) { label = 'Sold out'; enabled = false; }
  else if (!connected) { label = 'Connect wallet to buy'; note = onSepolia() ? "You'll need a wallet with Sepolia test ETH." : 'Pick a demo wallet to start.'; faucet = onSepolia(); }
  else if (wrong) label = switchLabel();
  else if (operator) { label = "Operator wallet can't buy"; enabled = false; note = `Switch to an investor ${usingMetaMask ? 'account' : 'wallet'} from the wallet menu to buy Sol Coins.`; }
  else { label = q > 0 ? `Buy ${plural(q, 'Sol Coin')}` : 'Buy Sol Coins'; enabled = q >= 1 && !error; faucet = onSepolia() && price > state.ethBalance; }
  if (state.safeguards && (!state.purchasesAllowed || state.statusUnavailable)) {
    label = state.statusUnavailable ? 'Reporting status unavailable' : state.purchasesPaused ? 'Purchases paused by operator' : 'Purchases paused: report overdue';
    enabled = false; faucet = false;
    note = 'Existing shares can still be transferred and deposited income can still be claimed.';
  }
  setActionButton($('#buy-button'), 'buy', label, enabled);
  $('#buy-note').textContent = note;
  $('#buy-faucet').hidden = !faucet;
  renderLedger();
}
function sendCheck() {
  const to = $('#send-to').value.trim(), raw = $('#send-qty').value, q = whole(raw), owned = state?.balance ?? 0;
  let toErr = '', qtyErr = '';
  if (to && !(/^0x[0-9a-fA-F]{40}$/.test(to) && isAddress(to))) toErr = "That doesn't look like a wallet address. It should start with 0x and have 42 characters.";
  else if (same(to, ZeroAddress)) toErr = "Sol Coins can't be sent to the zero address.";
  else if (same(to, address)) toErr = "That's your own address.";
  else if (same(to, deployment?.operator)) toErr = "Sol Coins can't be sent to the operator wallet.";
  else if (to && simulation && !demoAccounts.slice(1).some(a => same(a, to))) toErr = 'In the simulation, send Sol Coins to the other demo investor.';
  if (raw && q < 1) qtyErr = 'Enter at least 1 Sol Coin.';
  else if (q > owned) qtyErr = `You only have ${plural(owned, 'Sol Coin')}.`;
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
  renderIncome();
  const check = sendCheck();
  $('#send-owned').textContent = `You own ${plural(state.balance, 'Sol Coin')}`;
  for (const [field, message] of [['to', check.toErr], ['qty', check.qtyErr]]) {
    $(`#send-${field}`).classList.toggle('invalid', Boolean(message));
    $(`#send-${field}`).setAttribute('aria-invalid', String(Boolean(message)));
    $(`#send-${field}-error`).textContent = message;
    $(`#send-${field}-error`).hidden = !message;
  }
  setActionButton($('#send-button'), 'send', wrong ? switchLabel() : 'Send Sol Coins', wrong || (check.ok && state.balance > 0));
  const other = hasDemoWallets() ? accounts.find((account, i) => i > 0 && !same(account, address)) : null;
  $('#send-demo').hidden = !other;
  if (other) { $('#send-demo').textContent = `Use ${labels[accounts.indexOf(other)]}'s demo address`; $('#send-demo').dataset.address = other; }
  $('#my-feed').innerHTML = mine.length ? `<div class="feed">${mine.slice(0, 20).map(item => feedRow(item, true)).join('')}</div>`
    : '<p class="feed-note">Nothing here yet. Your purchases, claims and transfers will appear with receipts.</p>';
}
function breakdown() {
  const kwh = whole($('#report-kwh').value), costs = whole($('#report-costs').value), reserve = whole($('#report-reserve').value);
  const { gross: receipts, net: dist, loss } = reportAmounts(kwh, costs, reserve);
  const period = Number($('#report-period').value);
  let bad = '';
  if (['#report-kwh', '#report-costs', '#report-reserve'].some(id => !/^\d+$/.test($(id).value))) bad = 'Enter whole numbers for generation, costs and reserve; use 0 when there is none.';
  else if (!kwh && !state.safeguards) bad = 'Enter the kWh generated this month.';
  else if (kwh > 1000000 || costs > 1500000000 || reserve > 1500000000) bad = 'Generation must be at most 1,000,000 kWh; costs and reserve at most Rp1,500,000,000 each.';
  else if (state.safeguards && state.statusUnavailable) bad = 'Refresh reporting status before publishing.';
  else if (state.safeguards && period !== state.nextReportingPeriod) bad = 'Report the next required month without skipping any months.';
  else if (state.safeguards && state.timestamp < state.reportingOpensAt) bad = `This month is still in progress. Reporting opens ${utcDate(state.reportingOpensAt)}.`;
  else if (!state.safeguards && dist <= 0) bad = 'This older contract requires positive distributable income.';
  else if (!(period > state.lastPeriod)) bad = 'This month is already reported. Pick a later month.';
  else if (BigInt(dist) * GWEI > state.ethBalance) bad = `This deposit is more than your ${simulation ? 'demo balance' : 'wallet'} holds (${balanceText()}).${onSepolia() ? ' Get more test ETH from a Sepolia faucet.' : ''}`;
  if (!bad && verification.required) {
    try {
      validateEvidence(proofBundle, { ...deployment, ...verification, period, timestamp: state.timestamp });
      if (proofBundle.evidence.kwh !== kwh || proofBundle.evidence.costsIdr !== costs || proofBundle.evidence.reserveIdr !== reserve) throw new Error('Report figures must match the verifier evidence.');
    } catch (error) { bad = verificationMessage(error); }
  }
  return { kwh, costs, reserve, receipts, dist, loss, period, ok: !bad, bad };
}
function renderBreakdown() {
  if (!state || !isOperator()) return;
  const r = breakdown(), share = value => r.receipts > 0 ? Math.max(0, Math.min(100, value / r.receipts * 100)) : 0;
  $('#bd-receipts-note').textContent = `${fmt(r.kwh)} kWh × ${idr(TARIFF_IDR)}`;
  $('#bd-receipts').textContent = idr(r.receipts);
  $('#bd-costs').textContent = idr(r.costs);
  $('#bd-reserve').textContent = idr(r.reserve);
  $('#bd-holders').textContent = idr(Math.max(0, r.dist));
  const costsPct = share(r.costs), reservePct = Math.min(100 - costsPct, share(r.reserve));
  $('#st-donut').style.setProperty('--a', `${costsPct}%`);
  $('#st-donut').style.setProperty('--b', `${costsPct + reservePct}%`);
  $('#st-pct').textContent = `${Math.round(share(Math.max(0, r.dist)))}%`;
  $('#bd-ok').hidden = !r.ok;
  $('#bd-bad').hidden = r.ok;
  $('#bd-bad').textContent = r.bad;
  $('#report-kwh').classList.toggle('invalid', (!r.kwh && !state.safeguards) || r.kwh > 1000000);
  $('#zero-income-note').hidden = !r.ok || r.dist !== 0;
  $('#zero-income-note').textContent = `Zero-income report: no deposit is required.${r.loss ? ` Shortfall after costs and reserves: ${idr(r.loss)}. No holder debt is created and the shortfall is not carried forward.` : ''}`;
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
  const base = state.safeguards ? state.nextReportingPeriod : state.lastPeriod ? nextPeriod(state.lastPeriod) : currentPeriod();
  const options = state.safeguards ? [base] : [base, nextPeriod(base), nextPeriod(nextPeriod(base))], select = $('#report-period');
  if (select.dataset.options !== options.join()) {
    const previous = Number(select.value);
    select.innerHTML = options.map(period => `<option value="${period}">${periodLabel(period)}</option>`).join('');
    select.value = String(options.includes(previous) ? previous : base);
    select.dataset.options = options.join();
  }
  const all = reports(), last = all.at(-1);
  $('#last-published-note').textContent = last ? `Last published: ${periodLabel(last.period)}. Months must go in order.` : 'No reports yet. Start with your first month of production.';
  renderBreakdown();
  renderQuickFill(last);
  renderOperatorOverview(all);
  $('#reports-count').textContent = all.length ? plural(all.length, 'report') : '';
  const sum = key => all.reduce((total, r) => total + r[key], 0), sumDeposited = all.reduce((total, r) => total + r.deposited, 0n);
  $('#reports-table').innerHTML = all.length
    ? `<div class="op-reports">${[...all].reverse().map(reportRow).join('')}</div>${all.length > 1 ? `<div class="op-total"><span>Total across ${plural(all.length, 'report')}</span><span><b>${fmt(sum('kwh'))} kWh</b> &nbsp;·&nbsp; <b>${demoIdr(sumDeposited)}</b> distributed</span></div>` : ''}`
    : `<div class="feed-empty"><div class="feed-empty-title">No reports yet</div><p>Your first monthly report will appear here once it's published. Shareholders can claim as soon as it confirms.</p></div>`;
  const available = state.milestones?.available ?? state.proceeds;
  const hasProceeds = available > 0n;
  $('#proceeds-rp').textContent = demoIdr(available);
  $('#proceeds-eth').textContent = eth(available);
  $('#proceeds-note').textContent = state.milestones ? `Approved funding available to withdraw. ${eth(state.milestones.held - available)} remains locked pending milestone approval.` : 'Funding received from Sol Coin purchases. This deployment has no milestone approval requirement.';
  setActionButton($('#withdraw-button'), 'withdraw', wrongNetwork() ? switchLabel() : hasProceeds ? 'Withdraw to operator wallet' : 'Nothing to withdraw', wrongNetwork() || hasProceeds);
  const recent = activity().filter(item => item.kind in opIcons).slice(0, 6);
  $('#op-feed').innerHTML = recent.length ? `<div>${recent.map(activityRow).join('')}</div>` : `<p class="card-text">Purchases, reports, claims and withdrawals will show up here.</p>`;
}
function reportRow(r) {
  const receipts = r.kwh * TARIFF_IDR, pct = value => receipts > 0 ? Math.max(0, Math.min(100, value / receipts * 100)) : 0;
  const costs = pct(r.costs), reserve = Math.min(100 - costs, pct(r.reserve)), holders = Math.min(100 - costs - reserve, pct(Number(r.deposited) / 1e9));
  const year = Math.floor(r.period / 100), month = new Date(year, r.period % 100 - 1, 1).toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  return `<div class="op-rep"><div class="op-cal" aria-hidden="true"><span>${month}</span><b>${String(year).slice(2)}</b></div>`
    + `<div class="op-rep-t">${periodLabel(r.period)}<small>${fmt(r.kwh)} kWh</small></div>`
    + `<div class="op-rep-bar"><div class="op-minibar" aria-hidden="true"><i style="width:${costs}%"></i><i style="width:${reserve}%"></i><i style="width:${holders}%"></i></div><div class="op-minibar-l">${Math.round(pct(Number(r.deposited) / 1e9))}% to shareholders</div></div>`
    + `<div class="op-rep-amt">${demoIdr(r.deposited)}<small>${demoIdr(r.deposited / 1000n)} / coin</small></div>${receipt(r, `${periodLabel(r.period)} report`)}</div>`;
}
const opIcons = { Bought: 'i-sun', Report: 'i-doc', Claimed: 'i-check', Pause: 'i-chain', Withdrawn: 'i-wallet' };
function activityRow(item) {
  const url = txUrl(item.hash), tag = url ? `a href="${url}" target="_blank" rel="noopener noreferrer"` : 'div';
  return `<${tag} class="op-act"><span class="op-act-ic k-${item.kind}"><svg class="icon" aria-hidden="true"><use href="#${opIcons[item.kind]}" /></svg></span><div class="op-act-t">${esc(item.title)}<small>${when(item)}</small></div>${item.wei === undefined ? '' : `<span class="op-act-v">${idrCompact(item.wei)}</span>`}</${url ? 'a' : 'div'}>`;
}
// Quick-fill chips for generation, based on the last published month.
function renderQuickFill(last) {
  const chips = $('#kwh-chips');
  chips.hidden = !last;
  if (!last) { chips.innerHTML = ''; return; }
  const html = [[`Last month · ${fmt(last.kwh)}`, last.kwh], ['+5%', Math.round(last.kwh * 1.05)], ['−5%', Math.round(last.kwh * .95)]].map(([label, value]) => `<button type="button" data-kwh="${value}">${label}</button>`).join('');
  if (chips.dataset.html !== html) { chips.innerHTML = html; chips.dataset.html = html; }
}
// Header, overview stats, reporting schedule and purchase state on the operator page.
function renderOperatorOverview(all) {
  const s = state, ok = s.safeguards && !s.statusUnavailable, waiting = ok && s.timestamp < s.reportingOpensAt;
  const sold = TOTAL - s.available, buyers = new Set(s.logs.filter(log => log.name === 'SharesPurchased').map(log => String(log.args.buyer).toLowerCase())).size;
  const month = s.safeguards ? periodLabel(s.nextReportingPeriod) : 'next';

  $('#op-greeting').textContent = greeting();
  $('#op-sub').innerHTML = !s.safeguards ? 'Publish a report once each production month has ended.'
    : s.statusUnavailable ? 'Reporting status is unavailable. Refresh to try again.'
    : s.overdue ? `Your <strong>${month}</strong> report is <strong>${dayDelta(s.reportDueAt, s.timestamp)}</strong> late. Purchases stay blocked until you publish it.`
    : s.purchasesPaused ? `You've paused purchases. Claims and transfers still work.`
    : waiting ? `Your ${month} report opens in <strong>${dayDelta(s.reportingOpensAt, s.timestamp)}</strong>. Everything else is running smoothly.`
    : `Your ${month} report is ready to publish, due in <strong>${dayDelta(s.reportDueAt, s.timestamp)}</strong>.`;

  tween($('#op-sold'), sold, fmt);
  $('#op-cells').innerHTML = Array.from({ length: 25 }, (_, i) => `<i${i < Math.round(sold / 40) ? ' class="on"' : ''}></i>`).join('');
  $('#op-sold-note').textContent = `${plural(buyers, 'investor')} · ${idr(sold * Number(SHARE_PRICE / GWEI))} raised`;
  tween($('#op-income'), Number(s.revenue) / 1e9, idr);
  const points = all.slice(-6).map(r => Number(r.deposited) / 1e9), low = Math.min(...points), span = Math.max(...points) - low;
  const xy = points.map((v, i) => [i / (points.length - 1) * 120, span ? 26 - (v - low) / span * 22 : 15]);
  $('#op-spark').innerHTML = points.length > 1
    ? `<defs><linearGradient id="op-sg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#E95C05" stop-opacity=".28" /><stop offset="1" stop-color="#E95C05" stop-opacity="0" /></linearGradient></defs><path d="M${xy.map(p => p.join(' ')).join(' L')} L120 30 L0 30Z" fill="url(#op-sg)" /><path d="M${xy.map(p => p.join(' ')).join(' L')}" fill="none" stroke="#E95C05" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />`
    : '<path d="M0 22 L120 22" fill="none" stroke="#E6C9B4" stroke-width="2" stroke-dasharray="3 5" stroke-linecap="round" vector-effect="non-scaling-stroke" />';
  $('#op-income-note').textContent = all.length ? `${plural(all.length, 'report')} · ${demoIdr(all.at(-1).deposited / 1000n)} per Sol Coin latest` : 'No reports published yet';
  const held = s.milestones?.held ?? s.proceeds, withdrawable = s.milestones?.available ?? s.proceeds;
  tween($('#op-held'), Number(held) / 1e9, idr);
  $('#op-held-note').textContent = s.milestones && held > withdrawable ? `${demoIdr(withdrawable)} withdrawable · rest awaits milestone approval` : withdrawable > 0n ? `Ready to withdraw · ${eth(withdrawable)}` : 'Nothing waiting';

  const [tone, label] = !s.safeguards ? ['muted', 'Not tracked'] : s.statusUnavailable ? ['bad', 'Unavailable']
    : s.overdue ? ['bad', 'Overdue'] : s.purchasesPaused ? ['warn', 'Paused'] : ['ok', 'On track'];
  $('#op-state').dataset.tone = tone;
  $('#op-state-text').textContent = label;
  const progress = ok ? Math.max(0, Math.min(1, (s.timestamp - s.reportingOpensAt) / (s.reportDueAt - s.reportingOpensAt))) : 0;
  $('#op-track-fill').style.width = `${progress * 100}%`;
  $('#op-track-dot').style.left = `${progress * 100}%`;
  $('#op-track-open').textContent = ok ? `Opens ${utcDay(s.reportingOpensAt)}` : '';
  $('#op-track-due').textContent = ok ? `Due ${utcDay(s.reportDueAt)}` : '';
  $('#report-window-note').textContent = !ok ? '' : waiting ? `Opens ${utcShort(s.reportingOpensAt)}` : `Due ${utcShort(s.reportDueAt)}`;

  const step = (cls, title, note, time, mark = '') => `<li class="${cls}"><span class="sched-dot">${mark}</span><div><h3>${title}</h3><p>${note}</p></div><time>${time}</time></li>`;
  $('#operator-reporting-status').innerHTML = s.safeguards
    ? `<ol class="sched">${s.lastPeriod ? step('done', `${periodLabel(s.lastPeriod)} report`, 'Published and claimable', 'Done', '<svg class="icon" aria-hidden="true"><use href="#i-check" /></svg>') : ''}`
      + step(s.overdue ? 'late' : 'now', `${month} report`, s.overdue ? `${dayDelta(s.reportDueAt, s.timestamp)} overdue` : waiting ? `Opens in ${dayDelta(s.reportingOpensAt, s.timestamp)}` : `Open now · due in ${dayDelta(s.reportDueAt, s.timestamp)}`, utcDay(waiting ? s.reportingOpensAt : s.reportDueAt))
      + step('', `${periodLabel(nextPeriod(s.nextReportingPeriod))} report`, 'Opens after the month ends', utcDay(utcMonthStart(nextPeriod(nextPeriod(s.nextReportingPeriod))))) + `</ol><p class="field-help field-help-small">${reportSourceNote()}</p>`
    : '<p class="card-text">Monthly deadlines and purchase pausing require a version 2 or later contract.</p>';
  $('#purchase-state').textContent = s.purchasesPaused ? 'Purchases paused' : s.overdue ? 'Purchases blocked' : 'Accepting purchases';
  $('#purchase-state-note').textContent = s.purchasesPaused ? 'Paused by you. Claims still work.' : s.overdue ? 'Report overdue. Publish it to reopen sales.' : 'Investors can buy Sol Coins.';
}
function renderMenu() {
  if (!address) { closeMenu(); return; }
  const role = isOperator() ? 'Operator' : isMilestoneReviewer() ? 'Milestone reviewer' : 'Investor';
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
  if (ui.modal === 'wrong') $('#modal-wrong-text').textContent = `Your wallet is on ${chainName(walletChainId)}. Sol Invictus only works on ${onSepolia() ? 'the Sepolia test network' : 'the local test chain'}, so nothing here touches real money.`;
  const dialog = $('#wallet-modal');
  if (ui.modal && !dialog.open) dialog.showModal();
  if (!ui.modal && dialog.open) dialog.close();
}
function renderWalletOptions() {
  const options = hasDemoWallets() ? [[1, 'Alice', 'Demo investor', 'A', 'tone-maroon'], [2, 'Budi', 'Demo investor', 'B', 'tone-crimson'], [0, 'Solar operator', 'Run the income demo', 'S', 'tone-ink']] : [];
  if (milestoneSupport && accounts.length > 3) options.push([3, 'Milestone reviewer', 'Review funding stages · demo', 'R', 'tone-ink']);
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
    : sepolia ? 'Sol Invictus runs on the Sepolia test network. Nothing here uses real money.' : 'Pick a funded demo wallet on the local test chain, or connect MetaMask.';
  $('#modal-faucet').hidden = !sepolia;
  $('#switch-network').textContent = switchLabel();
  $('#modal-wrong-title').textContent = switchLabel();
  $('#modal-switching-text').textContent = `Approve the switch to ${networkLabel()} in your wallet.`;
  if (simulation) {
    $('#pf-no-wallet p').textContent = 'Pick a demo wallet to see its Sol Coins and income. Everything stays in this browser tab.';
    $('#how-note').textContent = 'This build is a browser simulation: the solar project, money, Sol Coins and reports are simulated and saved in this tab only. No wallet or blockchain is involved.';
  } else if (!sepolia) {
    $('#pf-no-wallet p').textContent = 'Your Sol Coins and income live in your wallet. Connecting lets Sol Invictus read them from the local test chain. It can\'t move anything without your approval.';
    $('#how-note').textContent = 'The solar project and its reports are fictional. This build runs on a local test chain, so its transactions exist only on your computer. Rp1 of demo value equals 1 gwei of test ETH. That\'s a display scale, not an exchange rate.';
  }
  renderWalletOptions();
}

// Ownership ledger: one tile per Sol Coin on the project page
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TOTAL = 1000, COLS = 40;
const GLOW_FIRST_GAP = 160, GLOW_SPEEDUP = .92, GLOW_MS = 800; // ms between the first two glowing coins, gap multiplier per coin, one coin's glow
const ledgerEl = $('#tiles'), tipEl = $('#tip');
const tileEls = Array.from({ length: TOTAL }, () => document.createElement('i'));
ledgerEl.append(...tileEls);
const ledger = { kinds: [], geo: null, tx: -1e4, ty: -1e4, hover: -1, rippling: false, painting: false, mine: undefined, owner: undefined, reports: undefined };
function renderLedger() {
  if (!state) return;
  const sold = TOTAL - state.available, mine = address && !isOperator() ? Math.min(state.balance, sold) : 0;
  const pick = Math.min(whole(ui.qty), state.available);
  const fresh = ledger.owner === address && ledger.mine !== undefined && mine > ledger.mine ? mine - ledger.mine : 0;
  for (let i = 0; i < TOTAL; i++) {
    const kind = i < sold - mine ? 'sold' : i < sold ? 'mine' : i < sold + pick ? 'pick' : '';
    if (ledger.kinds[i] !== kind) { ledger.kinds[i] = kind; tileEls[i].className = kind; }
  }
  // Newly bought coins light up one after another, each gap shorter than the last, so the speed grows exponentially.
  let delay = 0, gap = GLOW_FIRST_GAP;
  for (let k = 0; k < fresh && !reduceMotion; k++, delay += gap, gap *= GLOW_SPEEDUP) {
    const tile = tileEls[sold - fresh + k], wait = Math.round(delay);
    tile.classList.add('fresh'); tile.style.animationDelay = `${wait}ms`;
    setTimeout(() => { tile.classList.remove('fresh'); tile.style.animationDelay = ''; }, wait + GLOW_MS + 300);
  }
  const reportCount = reports().length;
  if (ledger.reports !== undefined && reportCount > ledger.reports) waveTiles();
  ledger.reports = reportCount; ledger.mine = mine; ledger.owner = address;
  ledgerEl.setAttribute('aria-label', `${fmt(sold)} of 1,000 Sol Coins bought${mine ? `, ${fmt(mine)} of them yours` : ''}`);
}
function waveTiles() {
  if (reduceMotion) return;
  tileEls.forEach((tile, i) => { tile.classList.remove('wave'); void tile.offsetWidth; tile.style.animationDelay = `${(i % COLS) * 14 + Math.floor(i / COLS) * 10}ms`; tile.classList.add('wave'); });
  setTimeout(() => tileEls.forEach(tile => { tile.classList.remove('wave'); tile.style.animationDelay = ''; }), 1800);
}
function tileAt(x, y) {
  const r = ledgerEl.getBoundingClientRect(), rows = TOTAL / COLS;
  const col = Math.min(COLS - 1, Math.max(0, Math.floor((x - r.left - 4) / ((r.width - 8) / COLS))));
  const row = Math.min(rows - 1, Math.max(0, Math.floor((y - r.top - 4) / ((r.height - 8) / rows))));
  return row * COLS + col;
}
function paintTo(i) {
  if (!state?.available) return;
  setQty(Math.min(state.available, Math.max(1, i - (TOTAL - state.available) + 1)));
}
function showTip(text, x, y) {
  tipEl.textContent = text; tipEl.classList.add('on');
  tipEl.style.left = `${Math.min(Math.max(8, x + 14), innerWidth - tipEl.offsetWidth - 8)}px`; tipEl.style.top = `${y + 18}px`;
}
// The tile under the pointer grows and brightens (--f); its neighbours brighten a little along a soft falloff (--h). Both ease in and out frame by frame.
const easeTo = (cur, target) => Math.abs(target - cur) < .003 ? target : cur + (target - cur) * .25;
function ripple() {
  ledger.geo ??= tileEls.map(tile => ({ x: tile.offsetLeft + tile.offsetWidth / 2, y: tile.offsetTop + tile.offsetHeight / 2 }));
  const radius = (ledger.geo[1].x - ledger.geo[0].x) * 2.2, near = ledger.tx > -1e3;
  let moving = false;
  tileEls.forEach((tile, i) => {
    const g = ledger.geo[i], t = near ? Math.max(0, 1 - Math.hypot(g.x - ledger.tx, g.y - ledger.ty) / radius) : 0;
    const glow = easeTo(tile._glow ?? 0, t * t * (3 - 2 * t)), focus = easeTo(tile._focus ?? 0, i === ledger.hover ? 1 : 0);
    if (glow === (tile._glow ?? 0) && focus === (tile._focus ?? 0)) return;
    tile._glow = glow; tile._focus = focus; moving = true;
    if (!glow && !focus) { tile.style.removeProperty('--f'); tile.style.filter = tile.style.scale = tile.style.zIndex = ''; return; }
    tile.style.setProperty('--f', focus.toFixed(3));
    tile.style.filter = `brightness(${(1 + glow * .2 + focus * .3).toFixed(3)}) saturate(${(1 + focus * .2).toFixed(3)})`;
    tile.style.scale = (1 + 1.4 * focus).toFixed(3); tile.style.zIndex = String(1 + Math.round(focus * 10));
  });
  if (moving) requestAnimationFrame(ripple); else ledger.rippling = false;
}
const kickRipple = () => { if (!reduceMotion && !ledger.rippling) { ledger.rippling = true; requestAnimationFrame(ripple); } };
ledgerEl.addEventListener('pointerdown', event => {
  if (!state || event.button > 0) return;
  const i = tileAt(event.clientX, event.clientY);
  if (i < TOTAL - state.available) return;
  ledger.painting = true; ledgerEl.setPointerCapture(event.pointerId); paintTo(i);
});
ledgerEl.addEventListener('pointermove', event => {
  const r = ledgerEl.getBoundingClientRect(), i = tileAt(event.clientX, event.clientY), kind = ledger.kinds[i];
  ledger.tx = event.clientX - r.left; ledger.ty = event.clientY - r.top; ledger.hover = i;
  if (ledger.painting) paintTo(i);
  const name = `Sol Coin #${String(i + 1).padStart(4, '0')}`;
  showTip(kind === 'mine' ? `${name} · Yours` : kind === 'sold' ? `${name} · Held by another investor` : `${name} · Available · ${idr(100000)}`, event.clientX, event.clientY);
  if (event.pointerType === 'mouse') kickRipple();
});
ledgerEl.addEventListener('pointerleave', () => { ledger.tx = ledger.ty = -1e4; ledger.hover = -1; tipEl.classList.remove('on'); kickRipple(); });
for (const type of ['pointerup', 'pointercancel']) ledgerEl.addEventListener(type, () => { ledger.painting = false; });
addEventListener('resize', () => { ledger.geo = null; });

function burst(x, y) {
  if (reduceMotion) return;
  for (let i = 0; i < 22; i++) {
    const dot = document.createElement('i'), angle = Math.random() * Math.PI * 2, speed = 90 + Math.random() * 150;
    dot.className = 'confetti'; dot.style.left = `${x}px`; dot.style.top = `${y}px`; dot.style.background = ['#FABD3D', '#E95C05', '#F59A2B', '#FFFFFF'][i % 4];
    document.body.append(dot);
    dot.animate([{ transform: 'translate(0, 0) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(angle) * speed}px, ${Math.sin(angle) * speed - 60}px) scale(.2)`, opacity: 0 }], { duration: 900 + Math.random() * 400, easing: 'cubic-bezier(.2, .8, .3, 1)' }).onfinish = () => dot.remove();
  }
}

// Page motion: content blocks fade up into view, and buttons flash sunrays on hover
const reveal = createReveal('.home-copy, .wall-stat, .project-hero, .stat, .card, .buy-card, .page-head, .tile, .empty-card, .claim-card, .claim-empty, .breakdown, .how-title, .how-lede, .example, .example-result, .how-note');
initButtonRays();

// How it works: the five steps light up one by one like lamps, then the worked example counts up to the payout for the chosen holding
const EXAMPLE_PER_COIN = 1189; // Rp per Sol Coin in the worked example
const flowEl = $('.flow'), flowSteps = [...flowEl.children], heldQty = $('#held-qty'), heldAmount = $('#held-amount');
const how = { timers: [], lampsDone: false, inView: false, counted: false };
if (!reduceMotion) flowEl.classList.add('lamps');
function lightHowSteps() {
  stopHowSteps(); how.lampsDone = false; how.counted = false;
  if (reduceMotion) { flowSteps.forEach(step => step.classList.add('lit')); how.lampsDone = true; countHeld(); return; }
  tick(heldAmount, 0, { duration: 0, format: idr });
  flowSteps.forEach((step, i) => { step.classList.remove('lit'); how.timers.push(setTimeout(() => step.classList.add('lit'), 250 + i * 380)); });
  how.timers.push(setTimeout(() => { how.lampsDone = true; countHeld(); }, 250 + flowSteps.length * 380 + 150));
}
function stopHowSteps() { how.timers.forEach(clearTimeout); how.timers = []; }
function countHeld() { if (how.lampsDone && how.inView && !how.counted) { how.counted = true; renderHeld(1200); } }
function renderHeld(duration = 450) {
  const qty = Math.min(1000, whole(heldQty.value)), amount = qty * EXAMPLE_PER_COIN;
  $('#held-dec').disabled = qty <= 1; $('#held-inc').disabled = qty >= 1000;
  $('#held-eth').textContent = `${eth(BigInt(amount) * GWEI)}, ready to claim`;
  $('#held-live').textContent = `${plural(qty, 'Sol Coin')} would earn ${idr(amount)}`;
  if (how.counted) tick(heldAmount, amount, { duration, format: idr });
}
const setHeld = qty => { heldQty.value = String(Math.min(1000, Math.max(1, qty))); how.counted = true; renderHeld(); };
new IntersectionObserver(([entry]) => { how.inView = entry.isIntersecting; countHeld(); }, { threshold: .4 }).observe($('.example-result'));
heldQty.oninput = () => { heldQty.value = digits(heldQty.value, 4); how.counted = true; renderHeld(); };
heldQty.onchange = () => setHeld(whole(heldQty.value));
$('#held-dec').onclick = () => setHeld(whole(heldQty.value) - 1);
$('#held-inc').onclick = () => setHeld(whole(heldQty.value) + 1);
renderHeld();

// Income: how a month's sunshine becomes money in your wallet (My Sol Coins page)
const inc = { whatIf: null, run: 0, played: false };
const incNodes = [...document.querySelectorAll('#inc-pipe .inc-node')], incStops = ['12.5%', '37.5%', '62.5%', '87.5%'];
const shortHash = hash => hash.startsWith('0x') ? short(hash) : hash;
function incomeModel() {
  const last = reports().at(-1), kwh = inc.whatIf ?? last?.kwh ?? 1200, costs = last?.costs ?? 420000, reserve = last?.reserve ?? 250000;
  const receipts = kwh * TARIFF_IDR, dist = receipts - costs - reserve;
  return { last, kwh, costs, reserve, receipts, dist, ok: dist > 0, perCoin: dist > 0 ? dist / 1000 : 0 };
}
function renderIncome() {
  const m = incomeModel(), live = Boolean(m.last) && inc.whatIf === null, held = state.balance;
  $('#inc-period').textContent = live ? `Latest report · ${periodLabel(m.last.period)}` : m.last ? 'What if · you choose the month' : 'Example month · no report yet';
  $('#inc-kwh').textContent = `${fmt(m.kwh)} kWh`;
  const slider = $('#inc-slider');
  slider.min = Math.min(300, m.last?.kwh ?? 300); slider.max = Math.max(1600, m.last?.kwh ?? 1600); slider.value = m.kwh;
  $('#inc-reset').hidden = inc.whatIf === null;
  $('#inc-reset').textContent = m.last ? 'Back to latest report' : 'Back to the example';
  $('#inc-help').textContent = live ? 'This is the latest report recorded on the blockchain. Slide to see what a different month would pay you.' : 'Preview only. Nothing is sent to the blockchain.';
  const base = Math.max(m.receipts, 1), costsPct = Math.min(m.costs, m.receipts) / base * 100, reservePct = Math.min(m.reserve, Math.max(0, m.receipts - m.costs)) / base * 100;
  $('#inc-bar-c').style.width = `${costsPct}%`; $('#inc-bar-r').style.width = `${reservePct}%`; $('#inc-bar-d').style.width = `${Math.max(0, 100 - costsPct - reservePct)}%`;
  $('#inc-rec').textContent = idr(m.receipts);
  $('#inc-dist').textContent = idr(Math.max(0, m.dist));
  $('#inc-costs-lbl').textContent = `Costs ${idr(m.costs)}`;
  $('#inc-reserve-lbl').textContent = `Reserve ${idr(m.reserve)}`;
  $('#inc-err').hidden = m.ok;
  $('#inc-err').textContent = `Costs and reserve (${idr(m.costs + m.reserve)}) are higher than this month's receipts, so there's nothing to share.`;
  $('#inc-n0').textContent = `${fmt(m.kwh)} kWh`;
  $('#inc-n1').textContent = m.ok ? `${idr(m.dist)} to share` : 'Nothing to share';
  $('#inc-n2').textContent = m.ok ? `${idr(m.perCoin)} per coin` : '—';
  $('#inc-n3').textContent = !m.ok ? '—' : held ? `${idr(held * m.perCoin)} for ${plural(held, 'coin')}` : 'You hold no Sol Coins';
  $('#inc-block').hidden = !live;
  if (live) {
    $('#inc-block-text').textContent = `Block ${fmt(m.last.block)} · ${shortHash(m.last.hash)} · confirmed`;
    $('#inc-block-receipt').innerHTML = receipt(m.last, `${periodLabel(m.last.period)} report`);
  }
}
function incomeStatic() {
  inc.run++; inc.played = true;
  const lit = incomeModel().ok ? 4 : 2, packet = $('#inc-packet');
  incNodes.forEach((node, i) => node.classList.toggle('on', i < lit));
  packet.classList.add('go'); packet.style.left = incStops[lit - 1];
  document.querySelectorAll('#inc-pips i').forEach(pip => pip.classList.add('on'));
}
async function playIncome() {
  if (reduceMotion) { incomeStatic(); return; }
  const run = ++inc.run, m = incomeModel(), live = Boolean(m.last) && inc.whatIf === null, packet = $('#inc-packet');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms)), pips = [...document.querySelectorAll('#inc-pips i')];
  const step = i => { incNodes[i].classList.add('on'); packet.classList.add('go'); packet.style.left = incStops[i]; };
  inc.played = true;
  incNodes.forEach(node => node.classList.remove('on')); pips.forEach(pip => pip.classList.remove('on')); packet.classList.remove('go'); packet.style.left = incStops[0];
  step(0); await pause(800); if (run !== inc.run) return;
  step(1); await pause(900); if (run !== inc.run) return;
  if (!m.ok) return;
  if (live) for (const pip of pips) { pip.classList.add('on'); await pause(450); if (run !== inc.run) return; }
  step(2); await pause(900); if (run !== inc.run) return;
  step(3);
}
$('#inc-slider').oninput = event => { inc.whatIf = Number(event.target.value); renderIncome(); incomeStatic(); };
$('#inc-reset').onclick = () => { inc.whatIf = null; renderIncome(); playIncome(); };
$('#inc-replay').onclick = () => playIncome();
// Play the income story once, when it first scrolls into view.
new IntersectionObserver(entries => { if (!inc.played && entries.some(entry => entry.isIntersecting)) playIncome(); }, { threshold: .4 }).observe($('#income'));

// Home hero: the solar panel of 1,000 cells
const touch = matchMedia('(pointer: coarse)').matches;
function renderWallSelection(n) {
  $('#wall-pick').classList.toggle('on', n > 0);
  $('#wall-pick-text').textContent = n ? `${plural(n, 'Sol Coin')} · ${idr(n * 100000)} · ${pct(n)} of the project` : '';
  $('#home-selection').textContent = n ? plural(n, 'coin') : '—';
  $('#home-hint').textContent = n ? 'Drag again to change your selection, or click a bought cell to clear it.' : touch ? 'Touch and drag across the dark cells to pick your Sol Coins.' : 'Move your cursor over the panel. You are the sun. Drag across dark cells to pick your Sol Coins.';
}
const wall = createHomeWall({ canvas: $('#wall-canvas'), tilt: $('#wall-tilt'), onSelect: renderWallSelection });
renderWallSelection(0);
$('#wall-buy').addEventListener('click', () => { if (wall.selection) setQty(wall.selection); });

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
let noticesScroll = 0;
function openNotices() {
  closeMenu();
  const dialog = $('#notices-modal');
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = noticesScroll;
  $('#notices-button').setAttribute('aria-expanded', 'true');
}

// Chain state
async function refresh() {
  if (simulation) {
    const snapshot = simulation.snapshot(address);
    state = { ...snapshot, ethBalance: BigInt(Math.round(snapshot.cash * 1000)) * 1000000n };
    render(); return;
  }
  if (!contract) return;
  const currentAddress = address;
  const [latest, available, revenue, lastPeriod, proceeds, balance, claimable, claimed, ethBalance, rawLogs, reporting, milestones] = await Promise.all([
    provider.getBlockNumber(), contract.availableShares(), contract.totalRevenue(), contract.lastPeriod(), contract.saleProceeds(),
    currentAddress ? contract.balanceOf(currentAddress) : 0n, currentAddress ? contract.claimable(currentAddress) : 0n,
    currentAddress ? contract.totalClaimed(currentAddress) : 0n, currentAddress ? provider.getBalance(currentAddress) : 0n,
    // ponytail: after one full scan, rescans only a short overlap of recent blocks; use a dedicated indexer for long-lived projects.
    provider.getLogs({ address: deployment.address, fromBlock: scanFrom ?? deployment.blockNumber, toBlock: 'latest' }),
    readReportingStatus(),
    milestoneSupport ? readMilestones(contract, provider) : null,
  ]);
  for (const log of rawLogs) logCache.set(`${log.transactionHash}:${log.index}`, { ...log, ...contract.interface.parseLog(log) });
  scanFrom = Math.max(deployment.blockNumber, latest - 50);
  if (currentAddress !== address) return;
  const parsed = [...logCache.values()].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
  const purchases = new Set(parsed.filter(log => log.name === 'SharesPurchased').map(log => log.transactionHash));
  const logs = parsed.filter(log => log.name === 'Transfer' ? log.args.from !== ZeroAddress && !purchases.has(log.transactionHash) : log.name !== 'Approval');
  state = { ...reporting, milestones, available: Number(available), revenue, lastPeriod: Number(lastPeriod), proceeds, balance: Number(balance), claimable, claimed, ethBalance, logs };
  loadError = '';
  render();
  loadBlockTimes(logs);
  refreshIncomeAudit();
}

function verificationMessage(error) {
  const message = error?.message ?? '';
  if (message === 'Load verifier evidence before publishing this report.') return 'Click “Check monthly data” before publishing.';
  if (/expired|expiry|too long/i.test(message)) return 'This data check has expired. Click “Check monthly data” again.';
  if (/another chain|another reporting month|source mode/.test(message)) return 'These records do not match this project or month. Check the monthly data again.';
  if (/signed|signature|do not match|must match|own verifier/.test(message)) return 'These figures could not be approved. Check the monthly data again before publishing.';
  if (/not ended/.test(message)) return 'This month is not finished yet. Check again after the reporting opening date.';
  if (/No source records/.test(message)) return 'There are no source records for this month yet. Publishing is paused until they are available.';
  if (/No verifier service|loopback|HTTPS/.test(message)) return 'The data-checking service is not set up for this project. Publishing is paused until it is connected.';
  return 'The data check could not finish. Please try again. You cannot publish until the check passes.';
}
function renderVerification() {
  const title = simulation ? 'Practice demo' : verification.required
    ? verification.demo ? 'Automatic checks · sample data' : 'Automatic report checks'
    : 'Operator figures · not independently checked';
  const explanation = simulation ? 'This demo lets you practise buying shares and sharing income. It does not check real records or send blockchain payments.'
    : verification.required ? `Before a report can be published, the checking service must approve its figures. The operator must send the exact income amount with the report.${verification.demo ? ' This demo uses made-up records and test money. It does not confirm real electricity production or earnings.' : ' These checks depend on the checking service and the records it uses.'}`
    : 'The operator supplies the generation, cost and maintenance figures. This version checks payments, but does not require an independent check of those figures.';
  let funds = simulation ? '' : `<p>${auditError ? 'We could not check the payments right now. Try refreshing the page.' : !incomeAudit ? 'Checking payments and income held for share owners…' : `<strong>Income received:</strong> ${eth(incomeAudit.deposited)}<br><strong>Already paid to share owners:</strong> ${eth(incomeAudit.claimed)}<br><strong>Still held for share owners to claim:</strong> ${eth(incomeAudit.reserved)}`}</p>`;
  if (!auditError && incomeAudit?.latest) {
    const r = incomeAudit.latest;
    funds += `<p><strong>${periodLabel(r.period)}:</strong> ${r.amount === 0n ? 'No payment was needed based on this report’s figures' : `The full reported income of ${eth(r.amount)} was received`}. ${onSepolia() ? `<a href="${txUrl(r.hash)}" target="_blank" rel="noopener noreferrer">View payment ↗</a>` : ''}</p>`;
  } else if (!auditError && incomeAudit) funds += '<p>No monthly income report has been published yet.</p>';
  const verified = state?.logs?.filter(log => log.name === 'ReportVerified').at(-1);
  const status = verified ? `<p>Project status in the ${periodLabel(verified.args.period)} report: <strong>${operatingStatuses[Number(verified.args.operatingStatus)] ?? 'Unknown'}</strong>.</p>` : '';
  const technical = `${verification.required ? `<p>The contract checks the verifier’s digital signature, the reporting month, the figures, and the exact payment amount. Verifier address: <code class="evidence-hash">${esc(verification.verifier)}</code>.</p>` : ''}${verified ? `<p>Record identifier: <code class="evidence-hash">${esc(verified.args.evidenceHash)}</code>. This lets reviewers check that the records have not changed.</p>` : ''}${!simulation ? `<p>We compare blockchain transactions and receipts with the report, and check that the contract still holds unpaid income separately from share-sale proceeds. A matching payment does not prove that the project earned real revenue.</p>${incomeAudit && !auditError ? `<p>Checked at block ${fmt(incomeAudit.blockNumber)}.${incomeAudit.latest ? ` The latest report has ${incomeAudit.latest.confirmations} block confirmation${incomeAudit.latest.confirmations === 1 ? '' : 's'}; this is not a guarantee of finality.` : ''}</p>` : ''}${auditError ? `<p>Check details: ${esc(auditError)}</p>` : ''}` : '<p>Run the local blockchain demo with npm start to try the automatic data and payment checks.</p>'}`;
  $('#verification-panel').innerHTML = [
    drop('checks', 'Report checks', title, `<p>${esc(explanation)}</p>${status}<p class="field-help">Late reports pause new purchases. You can still claim income already received and send your shares.</p>`),
    funds && drop('payments', 'Payments', 'Income received and held', funds),
    drop('method', 'Details', 'How this is checked', technical),
  ].join('');
  $('#proof-controls').hidden = !verification.required;
  const waitingForMonth = Boolean(state && state.timestamp < state.reportingOpensAt);
  $('#load-evidence').disabled = proofLoading || advancingDemoClock || Boolean(ui.busy) || !state || !isOperator() || waitingForMonth;
  $('#load-evidence').textContent = proofLoading ? 'Checking monthly data…' : 'Check monthly data';
  $('#report-opening-note').hidden = !waitingForMonth;
  $('#report-opening-note').textContent = waitingForMonth ? `${periodLabel(state.nextReportingPeriod)} is still in progress. You can check its monthly data from ${utcDate(state.reportingOpensAt)}.${state.lastPeriod ? ` ${periodLabel(state.lastPeriod)} has already been published.` : ''}` : '';
  const localClock = verification.required && verification.demo && canAdvanceLocalDemo(deployment, location.hostname);
  $('#local-report-clock').hidden = !localClock || !waitingForMonth;
  $('#advance-local-report').disabled = advancingDemoClock || proofLoading || Boolean(ui.busy) || !isOperator();
  $('#advance-local-report').textContent = advancingDemoClock ? 'Moving demo date…' : 'Move demo to next reporting date';
  $('#download-evidence').hidden = !proofBundle;
  for (const id of ['report-kwh', 'report-costs', 'report-reserve']) $(`#${id}`).readOnly = verification.required;
}
async function refreshIncomeAudit() {
  if (simulation || !contract) return;
  const run = ++auditRun;
  incomeAudit = null; auditError = ''; renderVerification();
  try { const result = await auditIncome(provider, deployment); if (run === auditRun) incomeAudit = result; }
  catch (error) { if (run === auditRun) auditError = errorMessage(error); }
  if (run === auditRun) renderVerification();
}
// Replays the slide-down animation on elements whose content just arrived.
function slideDown(...elements) {
  for (const el of elements) {
    if (!el || el.hidden) continue;
    el.classList.remove('slide-down'); void el.offsetWidth; el.classList.add('slide-down');
  }
}
$('#load-evidence').onclick = async () => {
  if (!verification.required || proofLoading || advancingDemoClock || ui.busy || !state) return;
  proofLoading = true; proofBundle = null; $('#evidence-note').textContent = ''; renderVerification(); renderBreakdown();
  try {
    if (!deployment.verifierUrl) throw new Error('No verifier service is configured. Reports remain blocked.');
    const url = new URL(verifierEndpoint(deployment.verifierUrl, 'proof'));
    if (deployment.chainId === 31337) {
      if (!['localhost', '127.0.0.1'].includes(location.hostname) || url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Local evidence requires a loopback verifier.');
    } else if (url.protocol !== 'https:') throw new Error('External verification requires HTTPS.');
    url.searchParams.set('period', String(state.nextReportingPeriod));
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const bundle = await response.json();
    if (!response.ok) throw new Error(bundle.error || 'Verifier unavailable.');
    const block = await provider.getBlock('latest');
    validateEvidence(bundle, { ...deployment, ...verification, period: state.nextReportingPeriod, timestamp: block.timestamp });
    proofBundle = bundle;
    $('#report-kwh').value = String(bundle.evidence.kwh);
    $('#report-costs').value = String(bundle.evidence.costsIdr);
    $('#report-reserve').value = String(bundle.evidence.reserveIdr);
    $('#evidence-note').textContent = `${periodLabel(bundle.evidence.period)}: data check passed. Project status: ${operatingStatuses[bundle.evidence.operatingStatus]}. You can publish using these figures until ${utcDate(bundle.statement.validUntil)}. ${bundle.evidence.sourceKind === 'simulated' ? 'These are sample records for the demo.' : 'You can download the supporting records below.'}`;
    await refresh();
  } catch (error) { $('#evidence-note').textContent = verificationMessage(error); }
  finally {
    proofLoading = false; renderVerification(); renderBreakdown();
    if (proofBundle) slideDown($('#evidence-note'), $('#download-evidence'), ...['report-kwh', 'report-costs', 'report-reserve'].map(id => $(`#${id}`).closest('.input-wrap')), $('#bd-ok'));
  }
};
$('#advance-local-report').onclick = async () => {
  if (advancingDemoClock || proofLoading || ui.busy || !isOperator() || !verification.demo) return;
  advancingDemoClock = true; renderVerification();
  try {
    await advanceLocalDemo(deployment, location.hostname);
    proofBundle = null;
    $('#evidence-note').textContent = 'The demo month has ended. Click “Check monthly data” to continue.';
    await refresh();
    info('Demo reporting is open', 'Your demo shares and earned income are unchanged. You can now check the next month’s data.');
  } catch (error) { notify(error, 'Could not move the demo date'); }
  finally { advancingDemoClock = false; renderVerification(); renderBreakdown(); }
};
$('#download-evidence').onclick = () => {
  if (!proofBundle) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(proofBundle, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `evidence-${proofBundle.evidence.period}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
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
async function transact(key, title, action, success, onConfirmed) {
  if (ui.busy) return false;
  if (simulation) {
    try {
      await action(simulation.forAccount(address));
      onConfirmed?.();
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
    onConfirmed?.();
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
    if (isRejection(error)) dismissLater(pushToast({ status: 'rejected', title: 'Connection cancelled', body: 'Nothing was shared with Sol Invictus.' }), 7000);
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
  info('Disconnected', simulation ? 'Pick a demo wallet to continue.' : 'Your wallet is no longer connected to Sol Invictus.');
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
$('#notices-button').onclick = openNotices;
$('#notices-modal').addEventListener('click', event => {
  if (event.target === event.currentTarget || event.target.closest('[data-close-notices]')) $('#notices-modal').close();
});
// toggle doesn't bubble, so listen in the capture phase to remember which dropdowns are open.
$('#notices-modal').addEventListener('toggle', ({ target }) => { if (target.dataset.drop) target.open ? openDrops.add(target.dataset.drop) : openDrops.delete(target.dataset.drop); }, true);
// A closed dialog is display:none, which resets its scroll, so remember it while it is open.
$('#notices-modal').addEventListener('scroll', event => { if (event.target.open) noticesScroll = event.target.scrollTop; });
$('#notices-modal').addEventListener('close', () => $('#notices-button').setAttribute('aria-expanded', 'false'));
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
  if (state.safeguards && (!state.purchasesAllowed || state.statusUnavailable)) return;
  if (isOperator() || q < 1 || q > state.available) return;
  transact('buy', `Buy ${plural(q, 'Sol Coin')}`, c => c.buyShares(q, { value: BigInt(q) * SHARE_PRICE }),
    () => `You now own ${plural(state.balance, 'Sol Coin')}, ${pct(state.balance)} of the project.`,
    () => { ui.qty = ''; $('#qty').value = ''; }); // the bought coins are no longer a selection
};
$('#claim-button').onclick = () => {
  if (wrongNetwork()) { openModal('wrong'); return; }
  const amount = state?.claimable ?? 0n;
  if (!amount) return;
  const rect = $('#claim-button').getBoundingClientRect();
  transact('claim', `Claim ${demoIdr(amount)}`, c => c.claimRevenue(), () => `${demoIdr(amount)} (${eth(amount)}) is in your ${simulation ? 'demo balance' : 'wallet'}.`)
    .then(claimed => { if (claimed) burst(rect.left + rect.width / 2, rect.top + rect.height / 2); });
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
  const sent = await transact('send', `Send ${plural(check.q, 'Sol Coin')}`, c => c.transfer(check.to, check.q),
    () => `${plural(check.q, 'Sol Coin')} ${check.q === 1 ? 'is' : 'are'} now with ${nameFor(check.to)}. Income you earned before sending stays with you.`);
  if (sent) { $('#send-to').value = ''; $('#send-qty').value = ''; renderPortfolio(); }
};
$('#report-form').oninput = event => {
  if (event.target.matches('input')) event.target.value = digits(event.target.value, 10);
  renderBreakdown();
};
$('#kwh-chips').onclick = event => {
  const chip = event.target.closest('[data-kwh]');
  if (!chip) return;
  $('#report-kwh').value = chip.dataset.kwh;
  $('#report-form').dispatchEvent(new Event('input'));
};
$('#report-form').onsubmit = event => {
  event.preventDefault();
  if (wrongNetwork()) { openModal('wrong'); return; }
  if (!state || !isOperator()) return;
  const r = breakdown();
  if (!r.ok) return;
  const proof = verification.required ? validateEvidence(proofBundle, { ...deployment, ...verification, period: r.period, timestamp: state.timestamp }) : null;
  transact('publish', `Publish ${periodLabel(r.period)} report`, c => c.publishReport(r.period, r.kwh, r.costs, r.reserve, ...(proof ? [proof] : []), { value: BigInt(r.dist) * GWEI }),
    () => `${idr(r.dist)} is now claimable by shareholders, ${idr(r.dist / 1000)} per Sol Coin.`);
};
$('#withdraw-button').onclick = () => {
  if (wrongNetwork()) { openModal('wrong'); return; }
  const amount = state?.milestones?.available ?? state?.proceeds ?? 0n;
  if (!amount || !isOperator()) return;
  transact('withdraw', `Withdraw ${demoIdr(amount)}`, c => c.withdrawSaleProceeds(), () => `${demoIdr(amount)} (${eth(amount)}) was sent to the operator wallet.`);
};
$('#pause-purchases').onclick = () => {
  if (wrongNetwork()) { openModal('wrong'); return; }
  if (!state?.safeguards || !isOperator()) return;
  const paused = !state.purchasesPaused;
  transact('pause', paused ? 'Pause purchases' : 'Remove manual purchase pause', c => c.setPurchasesPaused(paused),
    () => paused ? 'Claims and transfers remain available.' : 'Manual pause removed. Overdue reporting still blocks purchases.');
};
async function advanceDemoClock(target) {
  try { if (target > simulation.snapshot(address).timestamp) simulation.advanceTo(target); await refresh(); }
  catch (error) { notify(error); }
}
$('#advance-report-clock').onclick = () => advanceDemoClock(state.reportingOpensAt);
$('#advance-overdue-clock').onclick = () => advanceDemoClock(state.reportDueAt + 1);
window.addEventListener('hashchange', showPage);
// Pick up purchases, reports and claims made by other wallets.
setInterval(() => { if (contract && !document.hidden && !ui.busy) refresh().catch(() => {}); }, 30000);
document.addEventListener('visibilitychange', () => { if (contract && !document.hidden && !ui.busy) refresh().catch(() => {}); });
const milestoneScreen = createMilestoneScreen({ $, esc, eth, transact, notify, setActionButton, chooseWallet,
  getContext: () => ({ state, address, supported: milestoneSupport, operator: isOperator(), reviewer: isMilestoneReviewer(),
    local: milestoneSupport && hasDemoWallets() && ['localhost', '127.0.0.1'].includes(location.hostname), wrong: wrongNetwork(), busy: ui.busy }) });
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
    const response = await fetch(`${import.meta.env.BASE_URL}${import.meta.env.VITE_DEPLOYMENT_FILE || 'deployment.json'}`, { cache: 'no-store' });
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
    deployment.operator = await contract.operator();
    const version = contract.interface.hasFunction('CONTRACT_VERSION') ? Number(await contract.CONTRACT_VERSION()) : 1;
    safeguards = [2, 3, 4].includes(version);
    milestoneSupport = version === 4;
    if ([3, 4].includes(version)) verification = { required: true, verifier: await contract.trustedVerifier(), demo: await contract.demoVerification() };
    if (deployment.chainId === 31337) accounts = (await provider.listAccounts()).slice(0, milestoneSupport ? 4 : 3).map(account => account.address);
    applyMode();
    await refresh();
  } catch (error) {
    state = null;
    loadError = deployment?.chainId === SEPOLIA
      ? `Sepolia could not be reached. Reload to retry. ${errorMessage(error)}`
      : `Local demo is not connected. Run npm start in the SOL-INVICTUS project folder and keep it running, then open http://127.0.0.1:5173/. ${errorMessage(error)}`;
    render();
  }
}
await initialize();
let pollingReporting = false;
const reportingTimer = setInterval(async () => {
  if (!state?.safeguards || ui.busy || pollingReporting) return;
  pollingReporting = true;
  const previousState = state;
  try {
    const reporting = simulation ? simulation.snapshot(address) : await readReportingStatus();
    if (state !== previousState || ui.busy) return;
    Object.assign(state, reporting);
    renderReporting(); renderProject(); renderOperator();
  } catch {
    if (state !== previousState || ui.busy) return;
    state.statusUnavailable = true;
    renderReporting(); renderProject(); renderOperator();
  } finally { pollingReporting = false; }
}, 15000);
window.addEventListener('pagehide', () => clearInterval(reportingTimer), { once: true });
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
