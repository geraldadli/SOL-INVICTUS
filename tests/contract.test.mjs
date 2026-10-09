import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContractFactory, JsonRpcProvider, ZeroAddress } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { monthStart, nextMonth, previousMonth, utcPeriod, REPORT_GRACE } from '../src/reporting.js';

const testRpc = process.env.CONTRACT_TEST_RPC_URL;
if (!testRpc || new URL(testRpc).hostname !== '127.0.0.1') throw new Error('Run npm test to use an isolated disposable chain.');
const artifact = compile();
async function mineAt(provider, timestamp) {
  await provider.send('evm_setNextBlockTimestamp', [Number(timestamp)]);
  await provider.send('evm_mine', []);
}

test('purchase, proportional income, claims, transfers, and operator boundaries', async () => {
  const provider = new JsonRpcProvider(testRpc, undefined, { cacheTimeout: -1 });
  try {
    assert.equal((await provider.getNetwork()).chainId, 31337n, 'Tests require the disposable local chain.');
    const [operator, alice, budi] = await Promise.all([0, 1, 2].map(i => provider.getSigner(i)));
    const c = await new ContractFactory(artifact.abi, artifact.bytecode, operator).deploy();
    await c.waitForDeployment();
    const price = await c.SHARE_PRICE(), scale = await c.WEI_PER_DEMO_IDR();
    const A = await alice.getAddress(), B = await budi.getAddress(), O = await operator.getAddress();
    const firstPeriod = Number(await c.nextReportingPeriod()), secondPeriod = nextMonth(firstPeriod);
    assert.equal(await c.totalSupply(), 1000n);
    await assert.rejects(c.connect(alice).buyShares(0, { value: 0 }));
    await assert.rejects(c.connect(alice).buyShares(100, { value: price }));
    await assert.rejects(c.connect(alice).buyShares(1001, { value: price * 1001n }));
    await assert.rejects(c.buyShares(1, { value: price }));
    await assert.rejects(c.transfer(A, 1));
    await (await c.connect(alice).buyShares(100, { value: price * 100n })).wait();
    await (await c.connect(budi).buyShares(50, { value: price * 50n })).wait();
    assert.equal(await c.balanceOf(A), 100n);
    assert.equal(await c.availableShares(), 850n);
    const deposit = 1200000n * scale;
    await assert.rejects(c.connect(alice).publishReport(firstPeriod, 1200, 400000, 200000, { value: deposit }));
    await assert.rejects(c.publishReport(202613, 1200, 400000, 200000, { value: deposit }));
    await assert.rejects(c.publishReport(firstPeriod, 1200, 400000, 200000, { value: 1n }));
    await assert.rejects(c.publishReport(firstPeriod, 1200, 1800000, 1, { value: deposit }));
    await (await c.publishReport(firstPeriod, 1200, 400000, 200000, { value: deposit })).wait();
    assert.equal(await c.claimable(A), deposit / 10n);
    assert.equal(await c.claimable(B), deposit / 20n);
    assert.equal(await c.claimable(O), deposit * 85n / 100n);
    await assert.rejects(c.publishReport(firstPeriod, 1200, 400000, 200000, { value: deposit }));
    await assert.rejects(c.publishReport(previousMonth(firstPeriod), 1200, 400000, 200000, { value: deposit }));
    await (await c.connect(alice).buyShares(100, { value: price * 100n })).wait();
    assert.equal(await c.claimable(A), deposit / 10n, 'Later purchases cannot receive old income.');
    await (await c.connect(alice).transfer(B, 100)).wait();
    assert.equal(await c.claimable(A), deposit / 10n, 'Earned income stays with the sender.');
    assert.equal(await c.claimable(B), deposit / 20n, 'Receiving shares does not receive old income.');
    await (await c.connect(budi).approve(A, 10)).wait();
    await (await c.connect(alice).transferFrom(B, A, 10)).wait();
    assert.equal(await c.claimable(B), deposit / 20n, 'transferFrom preserves previously earned income.');
    await assert.rejects(c.connect(alice).transfer(ZeroAddress, 1));
    await assert.rejects(c.connect(alice).transfer(B, 1001));
    await mineAt(provider, await c.reportingOpensAt());
    await (await c.publishReport(secondPeriod, 1200, 400000, 200000, { value: deposit })).wait();
    assert.equal(await c.claimable(A), deposit * 21n / 100n);
    assert.equal(await c.claimable(B), deposit * 19n / 100n);
    const due = await c.claimable(A);
    const before = await provider.getBalance(A);
    const claim = await (await c.connect(alice).claimRevenue()).wait();
    const after = await provider.getBalance(A);
    assert.equal(after - before + claim.fee, due, 'Claim pays actual test ETH.');
    assert.equal(await c.totalClaimed(A), due);
    assert.equal(await c.claimable(A), 0n);
    await assert.rejects(c.connect(alice).claimRevenue());
    await assert.rejects(c.connect(alice).withdrawSaleProceeds());
    await (await c.withdrawSaleProceeds()).wait();
    assert.equal(await c.saleProceeds(), 0n);
    assert.equal(await provider.getBalance(await c.getAddress()), (await c.claimable(B)) + (await c.claimable(O)), 'Withdrawing sale proceeds preserves all unpaid holder income.');
    await (await c.connect(budi).claimRevenue()).wait();
    await (await c.claimRevenue()).wait();
    assert.equal(await provider.getBalance(await c.getAddress()), 0n, 'Every deposited wei is accounted for.');
    await (await c.connect(budi).buyShares(750, { value: price * 750n })).wait();
    assert.equal(await c.availableShares(), 0n);
    await assert.rejects(c.connect(alice).buyShares(1, { value: price }));
    console.log('Verified actual EVM transactions, proportional payouts, no retroactive income, no double claims, and reserved funds.');
  } finally { provider.destroy(); }
});

test('deadline and manual pause block purchases without blocking reporting, transfers or protected claims', async () => {
  const p = new JsonRpcProvider(testRpc, undefined, { cacheTimeout: -1 });
  try {
    const [operator, alice, budi] = await Promise.all([0, 1, 2].map(i => p.getSigner(i)));
    const c = await new ContractFactory(artifact.abi, artifact.bytecode, operator).deploy();
    await c.waitForDeployment();
    const price = await c.SHARE_PRICE(), A = await alice.getAddress(), B = await budi.getAddress();
    const first = Number(await c.nextReportingPeriod());
    const receipt = await c.deploymentTransaction().wait();
    const deployedAt = (await p.getBlock(receipt.blockNumber)).timestamp;
    assert.equal(await c.CONTRACT_VERSION(), 2n);
    assert.equal(await c.reportDueAt(), BigInt(deployedAt + REPORT_GRACE));
    await (await c.connect(alice).buyShares(100, { value: price * 100n })).wait();
    await assert.rejects(c.connect(alice).setPurchasesPaused(true), /Operator only/);
    await (await c.setPurchasesPaused(true)).wait();
    await assert.rejects(c.connect(alice).buyShares(1, { value: price }), /Purchases paused/);
    const deposit = 1500n * 1000000000n;
    await (await c.publishReport(first, 1, 0, 0, { value: deposit })).wait();
    assert.equal(await c.purchasesPaused(), true, 'Reporting never clears the manual pause.');
    const earned = await c.claimable(A);
    await (await c.connect(alice).transfer(B, 10)).wait();
    assert.equal(await c.claimable(A), earned);
    assert.equal(await c.claimable(B), 0n);
    await (await c.connect(alice).claimRevenue()).wait();
    await assert.rejects(c.connect(alice).claimRevenue());
    await (await c.setPurchasesPaused(false)).wait();
    assert.equal(await c.purchasesAllowed(), true);

    const next = Number(await c.nextReportingPeriod());
    await assert.rejects(c.publishReport(nextMonth(next), 0, 0, 0), /next required month/);
    await assert.rejects(c.publishReport(next, 0, 0, 0), /month has not ended/);
    const due = Number(await c.reportDueAt());
    await mineAt(p, due);
    assert.equal(await c.isReportingOverdue(), false, 'Deadline is inclusive.');
    await mineAt(p, due + 1);
    assert.equal(await c.isReportingOverdue(), true);
    await (await c.setPurchasesPaused(true)).wait();
    await (await c.setPurchasesPaused(false)).wait();
    assert.equal(await c.purchasesAllowed(), false, 'Unpausing does not override overdue reporting.');
    await assert.rejects(c.connect(alice).buyShares(2, { value: price * 2n }));
    await (await c.connect(alice).transfer(B, 1)).wait();
    const reserved = await c.claimable(await operator.getAddress());
    await (await c.withdrawSaleProceeds()).wait();
    assert.equal(await p.getBalance(await c.getAddress()), reserved, 'Income remains funded while overdue.');
    await (await c.claimRevenue()).wait();
    assert.equal(await p.getBalance(await c.getAddress()), 0n);

    // Several missing months must all be reported; one old report cannot reopen sales.
    await mineAt(p, monthStart(nextMonth(nextMonth(next))) + REPORT_GRACE + 1);
    await (await c.publishReport(next, 0, 100, 0)).wait();
    assert.equal(await c.purchasesAllowed(), false);
    let report = nextMonth(next);
    while (await c.isReportingOverdue()) {
      await (await c.publishReport(report, 0, 0, 0)).wait();
      report = nextMonth(report);
    }
    assert.equal(await c.purchasesAllowed(), true);
    await (await c.connect(alice).buyShares(2, { value: price * 2n })).wait();
    const total = await c.totalRevenue();
    assert.equal(total, deposit, 'Zero-income catch-up does not invent payouts.');
  } finally { p.destroy(); }
});

test('zero generation, break-even and losses require exact zero deposits and preserve accrued income', async () => {
  const p = new JsonRpcProvider(testRpc, undefined, { cacheTimeout: -1 });
  try {
    const operator = await p.getSigner(0), alice = await p.getSigner(1);
    const c = await new ContractFactory(artifact.abi, artifact.bytecode, operator).deploy();
    await c.waitForDeployment();
    await (await c.connect(alice).buyShares(100, { value: (await c.SHARE_PRICE()) * 100n })).wait();
    let period = Number(await c.nextReportingPeriod());
    await (await c.publishReport(period, 1, 0, 0, { value: 1500000000000n })).wait();
    const credit = await c.claimable(await alice.getAddress());
    for (const [kwh, costs, reserve] of [[0, 0, 0], [1, 1400, 100], [1, 2000, 0], [0, 1500000000, 1500000000]]) {
      period = Number(await c.nextReportingPeriod());
      await mineAt(p, await c.reportingOpensAt());
      await assert.rejects(c.publishReport(period, kwh, costs, reserve, { value: 1n }));
      await assert.rejects(c.publishReport(period, 1000001, 0, 0));
      await assert.rejects(c.publishReport(period, 0, 1500000001, 0));
      await (await c.publishReport(period, kwh, costs, reserve)).wait();
      assert.equal(await c.claimable(await alice.getAddress()), credit);
      assert.equal(await c.totalRevenue(), 1500000000000n);
    }
  } finally { p.destroy(); }
});

test('UTC reporting handles year rollover, leap February, and non-leap century February', async () => {
  const p = new JsonRpcProvider(testRpc, undefined, { cacheTimeout: -1 });
  const snapshot = await p.send('evm_snapshot', []);
  try {
    for (const date of ['2028-01-10T00:00:00Z', '2028-03-10T00:00:00Z', '2100-03-10T00:00:00Z']) {
      const timestamp = Date.parse(date) / 1000;
      await mineAt(p, timestamp);
      const c = await new ContractFactory(artifact.abi, artifact.bytecode, await p.getSigner(0)).deploy();
      await c.waitForDeployment();
      const first = previousMonth(utcPeriod(timestamp));
      assert.equal(await c.nextReportingPeriod(), BigInt(first));
      assert.equal(await c.reportingOpensAt(), BigInt(monthStart(utcPeriod(timestamp))));
      await (await c.publishReport(first, 0, 0, 0)).wait();
      assert.equal(await c.reportingOpensAt(), BigInt(monthStart(nextMonth(utcPeriod(timestamp)))));
      assert.equal(await c.reportDueAt(), BigInt(monthStart(nextMonth(utcPeriod(timestamp))) + REPORT_GRACE));
    }
  } finally { await p.send('evm_revert', [snapshot]); p.destroy(); }
});
