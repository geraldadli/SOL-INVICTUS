import { Contract, Interface, getAddress, keccak256, toUtf8Bytes, verifyTypedData } from 'ethers';
import { getLogsInRange } from './logs.js';

export const REPORT_TYPES = { VerifiedReport: [
  ['period', 'uint32'], ['kwh', 'uint256'], ['costsIdr', 'uint256'], ['reserveIdr', 'uint256'],
  ['incomeWei', 'uint256'], ['operatingStatus', 'uint8'], ['evidenceHash', 'bytes32'], ['validUntil', 'uint256'],
].map(([name, type]) => ({ name, type })) };
export const operatingStatuses = { 1: 'Operating', 2: 'Maintenance', 3: 'Offline' };
export const reportDomain = (chainId, contract) => ({ name: 'SolInvictusReports', version: '1', chainId, verifyingContract: getAddress(contract) });
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const check = (condition, message) => { if (!condition) throw new Error(message); };
const whole = (n, max) => Number.isSafeInteger(n) && n >= 0 && n <= max;

// Only these explicitly ordered fields form the evidence commitment. No operator form values are used.
export function evidenceRecord(input) {
  check(input && input.schema === 1, 'Unsupported evidence schema.');
  check(whole(input.period, 210012) && input.period >= 200001 && input.period % 100 >= 1 && input.period % 100 <= 12, 'Invalid evidence month.');
  for (const [key, max] of [['kwh', 1000000], ['receiptsIdr', 1500000000], ['costsIdr', 1500000000], ['reserveIdr', 1500000000]]) {
    check(whole(input[key], max), `Invalid evidence ${key}.`);
  }
  check(input.receiptsIdr === input.kwh * 1500, 'Receipts do not match this demo contract tariff.');
  check(Object.hasOwn(operatingStatuses, input.operatingStatus), 'Invalid evidence operating status.');
  check(['simulated', 'external'].includes(input.sourceKind), 'Invalid evidence source kind.');
  check(typeof input.source === 'string' && input.source.length > 0 && input.source.length <= 240, 'Evidence source is required.');
  check(Array.isArray(input.references) && input.references.length >= 1 && input.references.length <= 10
    && input.references.every(r => typeof r === 'string' && r.length > 0 && r.length <= 500), 'Evidence references are required.');
  return { schema: 1, period: input.period, kwh: input.kwh, receiptsIdr: input.receiptsIdr, costsIdr: input.costsIdr,
    reserveIdr: input.reserveIdr, operatingStatus: input.operatingStatus, sourceKind: input.sourceKind,
    source: input.source, references: [...input.references] };
}
export const evidenceHash = record => keccak256(toUtf8Bytes(JSON.stringify(evidenceRecord(record))));
export function reportStatement(record, validUntil) {
  const r = evidenceRecord(record);
  check(Number.isSafeInteger(validUntil) && validUntil > 0, 'Invalid proof expiry.');
  return { period: r.period, kwh: r.kwh, costsIdr: r.costsIdr, reserveIdr: r.reserveIdr,
    incomeWei: (BigInt(Math.max(0, r.receiptsIdr - r.costsIdr - r.reserveIdr)) * 1000000000n).toString(),
    operatingStatus: r.operatingStatus, evidenceHash: evidenceHash(r), validUntil };
}
export async function signEvidence(signer, chainId, contract, record, validUntil) {
  const evidence = evidenceRecord(record), statement = reportStatement(evidence, validUntil);
  const signature = await signer.signTypedData(reportDomain(chainId, contract), REPORT_TYPES, statement);
  return { schema: 1, chainId, contract: getAddress(contract), evidence, statement, signature };
}
export function validateEvidence(bundle, { chainId, address, verifier, operator, demo, period, timestamp }) {
  check(bundle, 'Load verifier evidence before publishing this report.');
  check(bundle?.schema === 1 && bundle.chainId === chainId && same(bundle.contract, address), 'Evidence is for another chain or project.');
  check(!same(verifier, operator), 'The operator cannot be its own verifier.');
  const record = evidenceRecord(bundle.evidence), expected = reportStatement(record, bundle.statement?.validUntil);
  check(record.period === period, 'Evidence is for another reporting month.');
  check((record.sourceKind === 'simulated') === demo, 'Evidence source mode does not match the contract.');
  check(expected.validUntil >= timestamp && expected.validUntil <= timestamp + 3600, 'Proof expired or too long.');
  for (const key of Object.keys(expected)) check(String(bundle.statement[key]) === String(expected[key]), 'Evidence contents do not match the signed statement.');
  const recovered = verifyTypedData(reportDomain(chainId, address), REPORT_TYPES, expected, bundle.signature);
  check(same(recovered, verifier), 'Evidence was not signed by the trusted verifier.');
  return { operatingStatus: expected.operatingStatus, evidenceHash: expected.evidenceHash, validUntil: expected.validUntil, signature: bundle.signature };
}

// A receipt proves an actual test-ETH deposit, independently of UI labels or offchain evidence.
export async function auditIncome(provider, deployment) {
  check(Number((await provider.getNetwork()).chainId) === deployment.chainId, 'Income verification RPC is on the wrong chain.');
  const block = await provider.getBlock('latest');
  check(block, 'Latest block unavailable.');
  const contract = new Contract(deployment.address, deployment.abi, provider), iface = new Interface(deployment.abi);
  const at = { blockTag: block.number };
  const [revenue, proceeds, balance, operator, events] = await Promise.all([
    contract.totalRevenue(at), contract.saleProceeds(at), provider.getBalance(deployment.address, block.number), contract.operator(at),
    getLogsInRange(provider, { address: deployment.address }, deployment.blockNumber, block.number),
  ]);
  const logs = events.map(log => ({ ...log, parsed: iface.parseLog(log) }));
  const reports = logs.filter(log => log.parsed?.name === 'ReportPublished');
  const deposited = reports.reduce((n, log) => n + log.parsed.args.deposited, 0n);
  const claimed = logs.filter(log => log.parsed?.name === 'RevenueClaimed').reduce((n, log) => n + log.parsed.args.amount, 0n);
  check(deposited === revenue && claimed <= deposited, 'Income totals do not reconcile with contract events.');
  const reserved = deposited - claimed;
  check(balance >= proceeds + reserved, 'Contract balance does not cover sale proceeds and unpaid income.');
  let latest = null;
  const last = reports.at(-1);
  if (last) {
    const [tx, receipt, canonical] = await Promise.all([provider.getTransaction(last.transactionHash), provider.getTransactionReceipt(last.transactionHash), provider.getBlock(last.blockNumber)]);
    check(tx && receipt?.status === 1 && same(tx.to, deployment.address) && same(tx.from, operator), 'Report transaction is not a successful operator deposit.');
    check(same(receipt.blockHash, canonical?.hash) && same(last.blockHash, canonical?.hash) && tx.blockNumber === receipt.blockNumber
      && receipt.blockNumber === last.blockNumber && same(tx.hash, last.transactionHash), 'Report is not in the canonical chain.');
    const call = iface.parseTransaction({ data: tx.data, value: tx.value }), args = last.parsed.args;
    check(call?.name === 'publishReport', 'Deposit transaction is not a report.');
    for (const key of ['period', 'kwh', 'costsIdr', 'reserveIdr']) check(call.args[key] === args[key], 'Report receipt does not match transaction inputs.');
    check(receipt.logs.some(l => same(l.address, deployment.address) && l.data === last.data && l.topics.join() === last.topics.join()), 'Report event is missing from its receipt.');
    const net = args.kwh * 1500n - args.costsIdr - args.reserveIdr;
    const expected = (net > 0n ? net : 0n) * 1000000000n;
    check(tx.value === expected && args.deposited === expected, 'Actual deposit does not match the report calculation.');
    latest = { period: Number(args.period), amount: expected, hash: tx.hash, confirmations: block.number - last.blockNumber + 1 };
  }
  // Detect a reorg during the read rather than combining incompatible snapshots.
  check(same((await provider.getBlock(block.number))?.hash, block.hash), 'Chain changed during verification. Retry.');
  return { blockNumber: block.number, deposited, claimed, reserved, proceeds, balance, latest };
}
