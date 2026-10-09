import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { createCloudHandler } from '../verifier/cloud-handler.mjs';
import { validateEvidence } from '../src/verification.js';

test('hosted verifier binds a persistent signer to Sepolia and fixed roles; requests cannot supply figures or another project', async () => {
  const signer = Wallet.createRandom(), operator = Wallet.createRandom().address, reviewer = Wallet.createRandom().address, project = Wallet.createRandom().address;
  const env = { SOL_VERIFIER_PRIVATE_KEY: signer.privateKey, SOL_OPERATOR_ADDRESS: operator, SOL_REVIEWER_ADDRESS: reviewer };
  let chain = 11155111n, version = 4n, trusted = signer.address, period = 202609n, opens = 0n, closed = 0;
  const timestamp = Date.UTC(2026, 9, 9) / 1000;
  const dependencies = { createProvider: () => ({ getNetwork: async () => ({ chainId: chain }), getBlock: async () => ({ number: 1, timestamp }), destroy: () => closed++ }),
    createContract: () => ({ trustedVerifier: async () => trusted, demoVerification: async () => true, CONTRACT_VERSION: async () => version,
      operator: async () => operator, milestoneReviewer: async () => reviewer, nextReportingPeriod: async () => period, reportingOpensAt: async () => opens }) };
  const handler = createCloudHandler(key => env[key], dependencies);
  const get = (path, options) => handler(new Request(`https://example.com/sol-verifier/${path}`, options));
  const health = await (await get('health')).json();
  assert.equal(health.verifier, signer.address); assert.equal(health.project, null); assert.equal(health.persistentKey, true);
  assert.equal((await get('proof?period=202609')).status, 503);
  env.SOL_PROJECT_ADDRESS = project;
  assert.equal((await get('proof?period=202609&kwh=999')).status, 400);
  assert.equal((await get(`proof?period=202609&project=${operator}`)).status, 400);
  assert.equal((await get('proof?period=202609&period=202610')).status, 400);
  assert.equal((await get('proof?period=202609', { method: 'POST' })).status, 405);
  for (const origin of ['null', 'https://sandbox.example']) {
    const publicHealth = await get('health', { headers: { Origin: origin } });
    assert.equal(publicHealth.status, 200);
    assert.equal(publicHealth.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal((await publicHealth.text()).includes(signer.privateKey), false);
    assert.equal((await get('proof?period=202609', { headers: { Origin: origin } })).status, 403);
  }
  assert.equal((await get('health', { method: 'OPTIONS', headers: { Origin: 'https://geraldadli.github.io' } })).status, 204);
  const result = await get('proof?period=202609', { headers: { Origin: 'https://geraldadli.github.io' } });
  assert.equal(result.status, 200);
  const bundle = await result.json();
  validateEvidence(bundle, { chainId: 11155111, address: project, verifier: signer.address, operator, demo: true, period: 202609, timestamp });
  assert.equal(bundle.evidence.sourceKind, 'simulated'); assert.equal(bundle.evidence.kwh, 1265);
  assert.equal((await get('proof?period=202610')).status, 400);
  opens = BigInt(timestamp + 1); assert.equal((await get('proof?period=202609')).status, 400); opens = 0n;
  chain = 31337n; assert.equal((await get('health')).status, 503); chain = 11155111n;
  trusted = operator; assert.equal((await get('proof?period=202609')).status, 503); trusted = signer.address;
  version = 2n; assert.equal((await get('health')).status, 503); version = 4n;
  period = 203001n; assert.equal((await get('proof?period=203001')).status, 404);
  assert.ok(closed > 0);
  assert.equal(JSON.stringify(bundle).includes(signer.privateKey), false);
});
