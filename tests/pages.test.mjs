import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('Pages connects to the verified Sepolia deployment without publishing deployment tools', () => {
  const build = spawnSync(process.execPath, ['scripts/build-pages.mjs'], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  for (const entry of ['index.html']) {
    const html = readFileSync(`dist/${entry}`, 'utf8');
    for (const match of html.matchAll(/(?:src|href)="(\/[^\"]+)"/g)) {
      assert.ok(match[1].startsWith('/SOL-INVICTUS/'), `Wrong Pages base: ${match[1]}`);
      assert.ok(existsSync(`dist/${match[1].slice('/SOL-INVICTUS/'.length)}`), `Missing asset: ${match[1]}`);
    }
  }
  const deployment = JSON.parse(readFileSync('dist/deployment.json', 'utf8'));
  const configured = JSON.parse(readFileSync('deployments/sepolia.json', 'utf8'));
  assert.deepEqual(deployment, configured, 'Pages must publish the selected public deployment, not the local chain.');
  assert.equal(deployment.chainId, 11155111);
  assert.match(deployment.address, /^0x[\da-f]{40}$/i);
  assert.match(deployment.operator, /^0x[\da-f]{40}$/i);
  assert.equal(new URL(deployment.rpcUrl).protocol, 'https:');
  assert.ok(Number.isSafeInteger(deployment.blockNumber) && deployment.blockNumber > 0);
  for (const name of ['buyShares', 'publishReport', 'claimRevenue']) {
    assert.ok(deployment.abi.some(item => item.type === 'function' && item.name === name));
  }
  if (deployment.contractVersion === 2) {
    for (const name of ['CONTRACT_VERSION', 'reportingStatus', 'setPurchasesPaused', 'purchasesAllowed']) {
      assert.ok(deployment.abi.some(item => item.type === 'function' && item.name === name));
    }
  }
  if (deployment.contractVersion === 4) {
    assert.equal(new URL(deployment.verifierUrl).protocol, 'https:');
    for (const name of ['trustedVerifier', 'milestoneReviewer', 'submitMilestone', 'reviewMilestone', 'availableSaleProceeds']) {
      assert.ok(deployment.abi.some(item => item.type === 'function' && item.name === name));
    }
    assert.match(deployment.verifier, /^0x[\da-f]{40}$/i);
    assert.match(deployment.milestoneReviewer, /^0x[\da-f]{40}$/i);
  }
  assert.equal(existsSync('dist/deploy.html'), false);
  assert.equal(readdirSync('dist').some(name => /^deployment-.*\.json$/.test(name)), false);
  const invalid = spawnSync(process.execPath, ['scripts/connect-sepolia.mjs', 'not-a-transaction'], { encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /deployment transaction hash/);
});
