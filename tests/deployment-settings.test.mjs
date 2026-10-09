import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, Wallet, ZeroAddress } from 'ethers';
import { deploymentSettings, verifyCreationData, verifierEndpoint, checkVerifierService } from '../src/deployment-settings.js';

test('deployment requires distinct roles and a public HTTPS service; creation data binds exact roles and demo mode', () => {
  const input = { operator: Wallet.createRandom().address, reviewer: '0x0833738A169A9D2415bD3B7748d5D04B5eA63376', verifier: Wallet.createRandom().address, verifierUrl: 'https://example.com/functions/verifier/' };
  const s = deploymentSettings(input);
  assert.equal(verifierEndpoint(s.verifierUrl, 'proof'), 'https://example.com/functions/verifier?action=proof');
  assert.equal(verifierEndpoint('http://127.0.0.1:8787', 'proof'), 'http://127.0.0.1:8787/proof');
  for (const patch of [{ reviewer: input.operator }, { verifier: input.reviewer }, { verifier: ZeroAddress }, { verifierUrl: 'http://localhost:8787' }, { verifierUrl: 'https://example.com/?secret=x' }, { verifierUrl: 'https://user:pass@example.com' }]) {
    assert.throws(() => deploymentSettings({ ...input, ...patch }));
  }
  const artifact = { bytecode: '0x60006000' };
  const creation = (demo, reviewer = s.reviewer) => artifact.bytecode + AbiCoder.defaultAbiCoder().encode(['address', 'bool', 'address'], [s.verifier, demo, reviewer]).slice(2);
  verifyCreationData(creation(true), artifact, s);
  assert.throws(() => verifyCreationData(creation(false), artifact, s), /do not match/);
  assert.throws(() => verifyCreationData(creation(true, s.operator), artifact, s), /do not match/);
  assert.throws(() => verifyCreationData(creation(true) + '00', artifact, s), /do not match/);
});

test('deployment readiness rejects temporary keys, wrong networks, mismatched signers, and an already-bound verifier', async t => {
  const s = { verifier: Wallet.createRandom().address, verifierUrl: 'https://example.com' };
  let health = { chainId: 11155111, mode: 'simulated', verifier: s.verifier, persistentKey: true, project: null };
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => health }));
  await checkVerifierService(s);
  for (const patch of [{ persistentKey: false }, { chainId: 31337 }, { mode: 'external' }, { verifier: Wallet.createRandom().address }, { project: Wallet.createRandom().address }]) {
    const good = health; health = { ...good, ...patch }; await assert.rejects(checkVerifierService(s)); health = good;
  }
  const project = Wallet.createRandom().address;
  await assert.rejects(checkVerifierService(s, project), /not bound/);
  health.project = project;
  await checkVerifierService(s, project);
});
