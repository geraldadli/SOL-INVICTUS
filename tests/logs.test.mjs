import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLogsInRange } from '../src/logs.js';

// Mimics public Sepolia RPCs, which reject wide eth_getLogs spans with non-standard errors.
function cappedProvider(limit, logBlocks) {
  const calls = [];
  return { calls, async getLogs({ fromBlock, toBlock }) {
    calls.push([fromBlock, toBlock]);
    if (typeof fromBlock !== 'number' || typeof toBlock !== 'number') throw new Error('expected numeric block bounds');
    if (toBlock - fromBlock + 1 > limit) throw new Error('could not coalesce error');
    return logBlocks.filter(n => n >= fromBlock && n <= toBlock).map(blockNumber => ({ blockNumber }));
  } };
}

test('reads a long history in windows the RPC accepts, without gaps or duplicates', async () => {
  const blocks = [100, 4999, 5000, 5100, 12000, 30000, 30001];
  const provider = cappedProvider(1000, blocks);
  const logs = await getLogsInRange(provider, { address: '0x1' }, 100, 30001);
  assert.deepEqual(logs.map(log => log.blockNumber), blocks);
  for (const [from, to] of provider.calls.slice(1)) assert.ok(from <= to);
});

test('returns nothing when the range is empty and rethrows errors that are not about the range', async () => {
  assert.deepEqual(await getLogsInRange(cappedProvider(1000, [5]), {}, 10, 9), []);
  const down = { async getLogs() { throw new Error('network down'); } };
  await assert.rejects(getLogsInRange(down, {}, 0, 100), /network down/);
});
