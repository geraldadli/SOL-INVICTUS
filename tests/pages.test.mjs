import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
  assert.equal(deployment.chainId, 11155111);
  assert.equal(deployment.address, '0xBB3a9F81461aF1BF2FaD7c90A8D95FC3acca6065');
  assert.equal(deployment.operator, '0xaeEeC36568e5919ce3126ABde04285B90030F58b');
  assert.equal(new URL(deployment.rpcUrl).protocol, 'https:');
  assert.equal(deployment.blockNumber, 11875135);
  for (const name of ['buyShares', 'publishReport', 'claimRevenue']) {
    assert.ok(deployment.abi.some(item => item.type === 'function' && item.name === name));
  }
  assert.equal(existsSync('dist/deploy.html'), false);
  const invalid = spawnSync(process.execPath, ['scripts/connect-sepolia.mjs', 'not-a-transaction'], { encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /deployment transaction hash/);
});
