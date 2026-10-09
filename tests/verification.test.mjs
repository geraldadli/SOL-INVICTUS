import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContractFactory, Interface, JsonRpcProvider, Wallet, ZeroAddress, ZeroHash } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { createDemoVerifier } from '../verifier/server.mjs';
import { auditIncome, validateEvidence, signEvidence, evidenceRecord } from '../src/verification.js';
import { advanceLocalDemo, canAdvanceLocalDemo } from '../src/local-demo-clock.js';

const rpc = process.env.CONTRACT_TEST_RPC_URL;
if (!rpc || new URL(rpc).hostname !== '127.0.0.1') throw new Error('Use npm test with the disposable chain.');
const artifact = compile(3);
test('demo clock opens the next month without changing balances and refuses public or non-demo deployments', async () => {
  const p = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
  try {
    const operator = await p.getSigner(0), investor = await p.getSigner(1), verifier = Wallet.createRandom();
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, operator);
    const c = await factory.deploy(verifier.address, true); await c.waitForDeployment();
    const deployment = { chainId: 31337, rpcUrl: rpc, address: await c.getAddress() };
    assert.equal(canAdvanceLocalDemo({ ...deployment, chainId: 11155111 }, 'localhost'), false);
    assert.equal(canAdvanceLocalDemo({ ...deployment, rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com' }, 'localhost'), false);
    assert.equal(canAdvanceLocalDemo(deployment, 'geraldadli.github.io'), false);
    await assert.rejects(advanceLocalDemo({ ...deployment, chainId: 11155111 }, 'localhost'), /local test chain/);
    assert.equal((await advanceLocalDemo(deployment, 'localhost')).moved, false, 'Already-open month needs no change.');
    await (await c.connect(investor).buyShares(100, { value: await c.SHARE_PRICE() * 100n })).wait();
    const period = Number(await c.nextReportingPeriod()), now = (await p.getBlock('latest')).timestamp;
    const bundle = await signEvidence(verifier, 31337, deployment.address, { schema: 1, period, kwh: 1, receiptsIdr: 1500,
      costsIdr: 0, reserveIdr: 0, operatingStatus: 1, sourceKind: 'simulated', source: 'Test', references: ['demo:test'] }, now + 900);
    await (await c.publishReport(period, 1, 0, 0, { ...bundle.statement, signature: bundle.signature }, { value: 1500000000000n })).wait();
    const A = await investor.getAddress();
    const snapshot = async () => Promise.all([c.balanceOf(A), c.claimable(A), c.totalRevenue(), c.saleProceeds(), p.getBalance(deployment.address), c.lastPeriod()]);
    const before = await snapshot(), opens = Number(await c.reportingOpensAt());
    assert.deepEqual(await advanceLocalDemo(deployment, 'localhost'), { moved: true, timestamp: opens });
    assert.deepEqual(await snapshot(), before);
    const nonDemo = await factory.deploy(verifier.address, false); await nonDemo.waitForDeployment();
    await assert.rejects(advanceLocalDemo({ ...deployment, address: await nonDemo.getAddress() }, 'localhost'), /Only contracts using demo data/);
  } finally { p.destroy(); }
});
test('proofs signed by the trusted key are still rejected on the wrong chain or outside their validity window', async () => {
  const p = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
  try {
    const operator = await p.getSigner(0), verifier = Wallet.createRandom();
    const c = await new ContractFactory(artifact.abi, artifact.bytecode, operator).deploy(verifier.address, true);
    await c.waitForDeployment();
    const period = Number(await c.nextReportingPeriod()), address = await c.getAddress(), now = (await p.getBlock('latest')).timestamp;
    const record = { schema: 1, period, kwh: 1, receiptsIdr: 1500, costsIdr: 0, reserveIdr: 0, operatingStatus: 1,
      sourceKind: 'simulated', source: 'Test fixture', references: ['demo:test'] };
    const execute = b => c.publishReport(period, 1, 0, 0, { operatingStatus: b.statement.operatingStatus,
      evidenceHash: b.statement.evidenceHash, validUntil: b.statement.validUntil, signature: b.signature }, { value: 1500000000000n });
    await assert.rejects(execute(await signEvidence(verifier, 11155111, address, record, now + 900)), /Untrusted verification/);
    await assert.rejects(execute(await signEvidence(verifier, 31337, address, record, now - 1)), /Proof expired/);
    await assert.rejects(execute(await signEvidence(verifier, 31337, address, record, now + 7200)), /Proof expired or too long/);
    const valid = await signEvidence(verifier, 31337, address, record, now + 900);
    await (await execute(valid)).wait();
    assert.equal(await c.totalRevenue(), 1500000000000n);
  } finally { p.destroy(); }
});
test('automated evidence is enforced onchain; deposits and protected income independently reconcile', async () => {
  const p = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
  let service;
  try {
    service = await createDemoVerifier({ rpcUrl: rpc, port: 0 });
    const [operator, alice, budi] = await Promise.all([0, 1, 2].map(i => p.getSigner(i)));
    const operatorAddress = await operator.getAddress(), A = await alice.getAddress(), B = await budi.getAddress();
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, operator);
    await assert.rejects(factory.deploy(ZeroAddress, true), /Separate verifier/);
    await assert.rejects(factory.deploy(operatorAddress, true), /Separate verifier/);
    const c = await factory.deploy(service.address, true); await c.waitForDeployment();
    const address = await c.getAddress(); service.bind(address);
    const deployment = { address, chainId: 31337, abi: artifact.abi, blockNumber: (await c.deploymentTransaction().wait()).blockNumber };
    const context = async () => ({ ...deployment, verifier: service.address, operator: operatorAddress, demo: true,
      period: Number(await c.nextReportingPeriod()), timestamp: (await p.getBlock('latest')).timestamp });
    const fetchProof = async () => {
      const r = await fetch(`${service.url}/proof?period=${await c.nextReportingPeriod()}`);
      const b = await r.json(); assert.equal(r.status, 200, b.error); return b;
    };
    assert.equal(await c.CONTRACT_VERSION(), 3n);
    const first = Number(await c.nextReportingPeriod());
    await (await c.connect(alice).buyShares(100, { value: (await c.SHARE_PRICE()) * 100n })).wait();
    const bundle = await fetchProof(), r = bundle.evidence;
    const proof = validateEvidence(bundle, await context()), amount = BigInt(bundle.statement.incomeWei);
    const publish = (patch = {}) => c.publishReport(patch.period ?? first, patch.kwh ?? r.kwh, patch.costs ?? r.costsIdr,
      patch.reserve ?? r.reserveIdr, { ...proof, ...patch.proof }, { value: patch.value ?? amount });
    await assert.rejects(publish({ value: amount - 1n }), /Incorrect revenue deposit/);
    await assert.rejects(publish({ value: amount + 1n }), /Incorrect revenue deposit/);
    await assert.rejects(publish({ kwh: r.kwh + 1, value: amount + 1500n * 1000000000n }), /Untrusted verification/);
    await assert.rejects(publish({ costs: r.costsIdr + 1, value: amount - 1000000000n }), /Untrusted verification/);
    await assert.rejects(publish({ reserve: r.reserveIdr + 1, value: amount - 1000000000n }), /Untrusted verification/);
    await assert.rejects(publish({ costs: 1500000000, value: 0n }), /Untrusted verification/);
    await assert.rejects(publish({ proof: { signature: '0x' } }));
    await assert.rejects(publish({ proof: { operatingStatus: 0 } }), /Invalid operating status/);
    await assert.rejects(publish({ proof: { operatingStatus: 3 } }), /Untrusted verification/);
    await assert.rejects(publish({ proof: { evidenceHash: ZeroHash } }), /Evidence required/);
    await assert.rejects(publish({ proof: { validUntil: (await context()).timestamp + 7200 } }), /Proof expired or too long/);
    const forged = await signEvidence(Wallet.createRandom(), 31337, address, r, bundle.statement.validUntil);
    await assert.rejects(publish({ proof: { signature: forged.signature } }), /Untrusted verification/);
    assert.throws(() => validateEvidence(forged, { ...deployment, verifier: service.address, operator: operatorAddress, demo: true, period: first, timestamp: bundle.statement.validUntil - 1 }), /trusted verifier/);
    const ctx = await context();
    assert.throws(() => validateEvidence(bundle, { ...ctx, chainId: 11155111 }), /another chain/);
    assert.throws(() => validateEvidence(bundle, { ...ctx, period: first + 1 }), /another reporting month/);
    assert.throws(() => validateEvidence(bundle, { ...ctx, operator: service.address }), /own verifier/);
    assert.throws(() => validateEvidence(bundle, { ...ctx, demo: false }), /source mode/);
    const altered = structuredClone(bundle); altered.evidence.references[0] = 'tampered';
    assert.throws(() => validateEvidence(altered, ctx), /do not match/);
    assert.throws(() => evidenceRecord({ ...r, receiptsIdr: r.receiptsIdr + 1 }), /tariff/);
    assert.equal((await fetch(`${service.url}/proof?period=${first}&kwh=1`)).status, 400, 'API refuses operator readings.');
    assert.equal((await fetch(`${service.url}/proof?period=${first}`, { headers: { Origin: 'https://attacker.example' } })).status, 403);
    const other = await factory.deploy(service.address, true); await other.waitForDeployment();
    await assert.rejects(other.publishReport(first, r.kwh, r.costsIdr, r.reserveIdr, proof, { value: amount }), /Untrusted verification/);
    await assert.rejects(c.connect(alice).publishReport(first, r.kwh, r.costsIdr, r.reserveIdr, proof, { value: amount }), /Operator only/);
    // The v2 selector cannot bypass the new proof argument.
    const old = new Interface(['function publishReport(uint32,uint256,uint256,uint256) payable']);
    await assert.rejects(operator.sendTransaction({ to: address, data: old.encodeFunctionData('publishReport', [first, r.kwh, r.costsIdr, r.reserveIdr]), value: amount }));
    assert.equal(await c.totalRevenue(), 0n, 'Rejected reports never allocate income.');
    await (await publish()).wait();
    assert.equal(await c.reportEvidence(first), proof.evidenceHash);
    assert.equal(await c.lastOperatingStatus(), 1n);
    assert.equal(await c.claimable(A), amount / 10n);
    let audit = await auditIncome(p, deployment);
    assert.equal(audit.latest.amount, amount); assert.equal(audit.reserved, amount);
    await assert.rejects(publish(), /next required month/);
    await (await c.connect(alice).transfer(B, 10)).wait();
    await (await c.connect(alice).claimRevenue()).wait();
    await (await c.withdrawSaleProceeds()).wait();
    audit = await auditIncome(p, deployment);
    assert.equal(audit.claimed, amount / 10n); assert.equal(audit.proceeds, 0n);
    assert.equal(audit.balance, audit.reserved); assert.equal(audit.reserved, amount * 9n / 10n);
    const next = Number(await c.nextReportingPeriod());
    assert.equal((await fetch(`${service.url}/proof?period=${next}`)).status, 400, 'Source cannot authorize an unfinished month.');
    await p.send('evm_setNextBlockTimestamp', [Number(await c.reportingOpensAt())]); await p.send('evm_mine', []);
    const zero = await fetchProof(), zeroProof = validateEvidence(zero, await context());
    assert.equal(zero.statement.incomeWei, '0'); assert.equal(zero.evidence.operatingStatus, 3);
    await p.send('evm_setNextBlockTimestamp', [zero.statement.validUntil + 1]); await p.send('evm_mine', []);
    await assert.rejects(c.publishReport(next, 0, zero.evidence.costsIdr, zero.evidence.reserveIdr, zeroProof, { value: 0 }), /Proof expired/);
    const renewed = await fetchProof();
    await (await c.setPurchasesPaused(true)).wait();
    await (await c.publishReport(next, 0, renewed.evidence.costsIdr, renewed.evidence.reserveIdr, validateEvidence(renewed, await context()), { value: 0 })).wait();
    assert.equal(await c.totalRevenue(), amount, 'Verified loss creates no debt or new income.');
    assert.equal(await c.purchasesPaused(), true); assert.equal(await c.lastOperatingStatus(), 3n);
    audit = await auditIncome(p, deployment); assert.equal(audit.latest.amount, 0n); assert.equal(audit.reserved, amount * 9n / 10n);
    await (await c.claimRevenue()).wait();
    assert.equal((await auditIncome(p, deployment)).reserved, 0n);
    // RPC or receipt inconsistencies fail closed, never retain a positive audit result.
    const badRpc = new Proxy(p, { get(target, key) { if (key === 'getTransactionReceipt') return async hash => ({ ...await target.getTransactionReceipt(hash), status: 0 }); const v = Reflect.get(target, key); return typeof v === 'function' ? v.bind(target) : v; } });
    await assert.rejects(auditIncome(badRpc, deployment), /successful operator deposit/);
  } finally { await service?.close(); p.destroy(); }
});
