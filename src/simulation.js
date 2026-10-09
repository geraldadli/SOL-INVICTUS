// Browser-only role play. No keys, RPC calls, or blockchain transactions.
export const demoAccounts = [1, 2, 3].map(n => `0x${String(n).padStart(40, '0')}`);
const key = 'suryashare.simulation.v1';
const scale = 1000000000n;
const fresh = () => ({ available: 1000, revenue: 0, proceeds: 0, lastPeriod: 0, logs: [],
  holders: Object.fromEntries(demoAccounts.map((a, i) => [a, { shares: i === 0 ? 1000 : 0, cash: 100000000000, credit: 0, claimed: 0 }])) });
const require = (condition, message) => { if (!condition) throw new Error(message); };
const whole = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;

function apply(s, action) {
  const { actor, method, args } = action;
  require(demoAccounts.includes(actor), 'Choose Alice, Budi, or the operator.');
  require(Array.isArray(args), 'Invalid demo action.');
  const owner = s.holders[actor];
  let event;
  if (method === 'buyShares') {
    const [quantity] = args;
    require(actor !== demoAccounts[0], 'Switch to an investor to buy shares.');
    require(whole(quantity, 1, s.available), 'Invalid share quantity.');
    const paid = quantity * 100000;
    require(owner.cash >= paid * 1000, 'Not enough demo money. Reset the demo to start again.');
    owner.cash -= paid * 1000; owner.shares += quantity;
    s.holders[demoAccounts[0]].shares -= quantity;
    s.available -= quantity; s.proceeds += paid;
    event = { name: 'SharesPurchased', args: { buyer: actor, shares: quantity, paid } };
  } else if (method === 'publishReport') {
    require(actor === demoAccounts[0], 'Only the operator can publish income.');
    const [period, kwh, costsIdr, reserveIdr] = args;
    require(whole(period, 200001, 210012) && period % 100 >= 1 && period % 100 <= 12 && period > s.lastPeriod, 'Choose a new, valid reporting month.');
    require(whole(kwh, 1, 1000000) && whole(costsIdr, 0, 1500000000) && whole(reserveIdr, 0, 1500000000), 'Invalid report numbers.');
    const deposited = kwh * 1500 - costsIdr - reserveIdr;
    require(deposited > 0 && owner.cash >= deposited * 1000, 'The deposit must be positive and within your demo balance.');
    owner.cash -= deposited * 1000;
    // Credits are recorded at deposit time, so transfers never move past income.
    for (const holder of Object.values(s.holders)) holder.credit += holder.shares * deposited;
    s.revenue += deposited; s.lastPeriod = period;
    event = { name: 'ReportPublished', args: { period, kwh, costsIdr, reserveIdr, deposited } };
  } else if (method === 'claimRevenue') {
    require(owner.credit > 0, 'No income to claim.');
    const amount = owner.credit;
    owner.credit = 0; owner.claimed += amount; owner.cash += amount;
    event = { name: 'RevenueClaimed', args: { holder: actor, amount } };
  } else if (method === 'transfer') {
    const [to, quantity] = args;
    require(actor !== demoAccounts[0], 'Operator inventory is reserved for purchases.');
    require(demoAccounts.slice(1).includes(to) && to !== actor, 'Choose the other demo investor as recipient.');
    require(whole(quantity, 1, owner.shares), 'Not enough shares to transfer.');
    owner.shares -= quantity; s.holders[to].shares += quantity;
    event = { name: 'Transfer', args: { from: actor, to, value: quantity } };
  } else if (method === 'withdrawSaleProceeds') {
    require(actor === demoAccounts[0] && s.proceeds > 0, 'Only the operator can withdraw available purchase proceeds.');
    const amount = s.proceeds;
    owner.cash += amount * 1000; s.proceeds = 0;
    event = { name: 'ProceedsWithdrawn', args: { operator: actor, amount: amount * 1000 } };
  } else throw new Error('Unknown demo action.');
  s.logs.push({ ...event, actor, blockNumber: s.logs.length + 1, transactionHash: `demo-${s.logs.length + 1}` });
}

export function createSimulation(storage) {
  let history = [], data = fresh(), warning = '';
  try {
    history = JSON.parse(storage.getItem(key) || '[]');
    require(Array.isArray(history) && history.length <= 5000, 'Invalid saved demo.');
    for (const action of history) apply(data, action);
  } catch {
    history = []; data = fresh(); warning = 'Saved demo could not be read. Starting a fresh simulation.';
  }
  function execute(actor, method, args) {
    // ponytail: replayable history is capped at 5,000 actions per tab; reset for longer demonstrations.
    require(history.length < 5000, 'Reset the demo before adding more activity.');
    const next = structuredClone(data), action = { actor, method, args };
    apply(next, action);
    storage.setItem(key, JSON.stringify([...history, action]));
    data = next; history.push(action);
  }
  return {
    warning,
    reset() { storage.removeItem(key); history = []; data = fresh(); },
    snapshot(actor) {
      const holder = data.holders[actor] ?? { shares: 0, credit: 0, claimed: 0, cash: 0 };
      // Wallet cash and credits use integer milli-IDR; no floating-point payout math.
      const wei = n => BigInt(n) * scale;
      const milliWei = n => BigInt(n) * 1000000n;
      return { available: data.available, revenue: wei(data.revenue), lastPeriod: data.lastPeriod,
        proceeds: wei(data.proceeds), balance: holder.shares, claimable: milliWei(holder.credit), claimed: milliWei(holder.claimed), cash: holder.cash / 1000,
        operatorBalance: BigInt(data.holders[demoAccounts[0]].shares),
        logs: data.logs.map(log => ({ ...log, args: Object.fromEntries(Object.entries(log.args).map(([k, v]) =>
          [k, k === 'amount' ? milliWei(v) : ['paid', 'deposited'].includes(k) ? wei(v) : v])) })) };
    },
    forAccount(actor) {
      return {
        buyShares: (n, payment) => { require(payment.value === BigInt(n) * 100000n * scale, 'Incorrect demo payment.'); execute(actor, 'buyShares', [n]); },
        publishReport: (period, kwh, costs, reserve, payment) => {
          require(payment.value === BigInt(kwh * 1500 - costs - reserve) * scale, 'Incorrect demo deposit.');
          execute(actor, 'publishReport', [period, kwh, costs, reserve]);
        },
        claimRevenue: () => execute(actor, 'claimRevenue', []),
        transfer: (to, n) => execute(actor, 'transfer', [to.toLowerCase(), n]),
        withdrawSaleProceeds: () => execute(actor, 'withdrawSaleProceeds', []),
      };
    },
  };
}
