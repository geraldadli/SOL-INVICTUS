import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContractFactory, JsonRpcProvider, Wallet, ZeroAddress, ZeroHash, keccak256, toUtf8Bytes } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { createDemoVerifier } from '../verifier/server.mjs';
import { auditIncome } from '../src/verification.js';
import { readMilestones } from '../src/milestones.js';

const rpc = process.env.CONTRACT_TEST_RPC_URL;
if (!rpc || new URL(rpc).hostname !== '127.0.0.1') throw new Error('Use npm test with the disposable chain.');
const artifact = compile(4);
const hash = text => keccak256(toUtf8Bytes(text));
test('separate reviewer enforces sequential 30/40/30 funding and exact evidence approval, preserving income', async () => {
  const p = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
  let service;
  try {
    service = await createDemoVerifier({ rpcUrl: rpc, port: 0 });
    const [operator, alice, outsider, reviewer] = await Promise.all([0, 1, 2, 3].map(i => p.getSigner(i)));
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, operator), R = await reviewer.getAddress();
    for (const invalid of [ZeroAddress, await operator.getAddress(), service.address]) {
      await assert.rejects(factory.deploy(service.address, true, invalid), /Separate milestone reviewer/);
    }
    const c = await factory.deploy(service.address, true, R); await c.waitForDeployment();
    const address = await c.getAddress(); service.bind(address);
    const deployment = { address, abi: artifact.abi, chainId: 31337, blockNumber: (await c.deploymentTransaction().wait()).blockNumber };
    const price = await c.SHARE_PRICE(), raised = 100n * price;
    await (await c.connect(alice).buyShares(100, { value: raised })).wait();
    await assert.rejects(c.withdrawSaleProceeds(), /Funding locked/);
    await assert.rejects(c.connect(alice).submitMilestone(0, hash('sample'), 'sample'), /Operator only/);
    await assert.rejects(c.submitMilestone(1, hash('sample'), 'sample'), /next milestone/);
    await assert.rejects(c.submitMilestone(0, ZeroHash, 'sample'), /Evidence/);
    await assert.rejects(c.submitMilestone(0, hash('sample'), ''), /Evidence/);
    await assert.rejects(c.submitMilestone(0, hash('sample'), 'x'.repeat(513)), /Evidence/);
    const review = (actor, stage, rev, evidence, approve = true, note = '') => actor.reviewMilestone(stage, rev, hash(evidence), approve, note);
    await assert.rejects(review(c.connect(reviewer), 0, 0, 'sample'), /No pending/);
    await (await c.submitMilestone(0, hash('sample'), 'sample')).wait();
    await assert.rejects(c.submitMilestone(0, hash('changed'), 'changed'), /Already awaiting/);
    await assert.rejects(review(c, 0, 1, 'sample'), /reviewer only/);
    await assert.rejects(review(c.connect(outsider), 0, 1, 'sample'), /reviewer only/);
    await assert.rejects(review(c.connect(reviewer), 1, 1, 'sample'), /next milestone/);
    await assert.rejects(review(c.connect(reviewer), 0, 1, 'changed'), /Submission changed/);
    await assert.rejects(review(c.connect(reviewer), 0, 1, 'sample', false), /Explain/);
    await (await review(c.connect(reviewer), 0, 1, 'sample', false, 'Add supplier quote')).wait();
    assert.equal((await c.milestones(0)).status, 2n);
    await assert.rejects(c.withdrawSaleProceeds(), /Funding locked/);
    await assert.rejects(review(c.connect(reviewer), 0, 1, 'sample'), /No pending/);
    await (await c.submitMilestone(0, hash('updated sample'), 'updated sample')).wait();
    await assert.rejects(review(c.connect(reviewer), 0, 1, 'sample'), /Submission changed/);
    await (await review(c.connect(reviewer), 0, 2, 'updated sample')).wait();
    assert.equal(await c.availableSaleProceeds(), raised * 30n / 100n);
    assert.equal(await p.getBalance(address), raised, 'Approval alone does not transfer money.');
    await assert.rejects(review(c.connect(reviewer), 0, 2, 'updated sample'), /next milestone/);
    await assert.rejects(c.connect(reviewer).withdrawSaleProceeds(), /Operator only/);
    await (await c.withdrawSaleProceeds()).wait();
    assert.equal(await c.saleProceeds(), raised * 70n / 100n);
    await assert.rejects(c.withdrawSaleProceeds(), /Funding locked/);
    // New purchases unlock only the already approved percentage.
    await (await c.connect(alice).buyShares(10, { value: price * 10n })).wait();
    assert.equal(await c.availableSaleProceeds(), price * 3n);
    const total = price * 110n;
    await (await c.withdrawSaleProceeds()).wait();
    const response = await fetch(`${service.url}/proof?period=${await c.nextReportingPeriod()}`), proof = await response.json();
    assert.equal(response.status, 200, proof.error);
    const e = proof.evidence, income = BigInt(proof.statement.incomeWei);
    await (await c.publishReport(e.period, e.kwh, e.costsIdr, e.reserveIdr, { ...proof.statement, signature: proof.signature }, { value: income })).wait();
    await (await c.connect(alice).transfer(await outsider.getAddress(), 10)).wait();
    await (await c.connect(alice).claimRevenue()).wait();
    await assert.rejects(c.connect(alice).claimRevenue(), /No income/);
    const reserved = income - income * 110n / 1000n;
    for (const [stage, portion] of [[1, 40n], [2, 30n]]) {
      const record = `DEMO ONLY stage ${stage}`;
      await (await c.submitMilestone(stage, hash(record), record)).wait();
      await assert.rejects(c.withdrawSaleProceeds(), /Funding locked/);
      await (await review(c.connect(reviewer), stage, 1, record)).wait();
      assert.equal(await c.availableSaleProceeds(), total * portion / 100n);
      await (await c.withdrawSaleProceeds()).wait();
      const audit = await auditIncome(p, deployment);
      assert.equal(audit.reserved, reserved);
      assert.equal(audit.balance, audit.proceeds + reserved);
    }
    assert.equal(await c.releasedSaleProceeds(), total);
    assert.equal(await c.saleProceeds(), 0n);
    assert.equal(await p.getBalance(address), reserved, 'All unpaid monthly income remains reserved.');
    await assert.rejects(c.submitMilestone(3, hash('extra'), 'extra'), /next milestone/);
    await assert.rejects(c.withdrawSaleProceeds(), /Funding locked/);
    const snapshot = await readMilestones(c, p);
    assert.equal(snapshot.approved, 3); assert.equal(snapshot.available, 0n); assert.equal(snapshot.raised, total);
    assert.equal((await c.queryFilter(c.filters.MilestoneSubmitted())).length, 4);
    assert.equal((await c.queryFilter(c.filters.MilestoneReviewed())).length, 4);
    await (await c.claimRevenue()).wait();
    assert.equal(await p.getBalance(address), 0n);
  } finally { await service?.close(); p.destroy(); }
});
