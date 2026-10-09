import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

// Each test run owns a disposable chain. Time-travel tests cannot affect the app's chain.
const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const assigned = probe.address().port; probe.close(() => resolve(assigned)); });
});
const rpc = `http://127.0.0.1:${port}`;
const chain = spawn(process.execPath, ['node_modules/hardhat/dist/src/cli.js', 'node', '--hostname', '127.0.0.1', '--port', String(port)], {
  stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
});
let startupError = '', test;
chain.stderr.on('data', chunk => { startupError = (startupError + chunk).slice(-4000); });
chain.on('error', error => { startupError = error.message; });
const stop = () => { test?.kill(); chain.kill(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (chain.exitCode !== null) throw new Error(startupError || 'Test chain exited during startup.');
    try {
      const response = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), signal: AbortSignal.timeout(500) });
      if ((await response.json()).result === '0x7a69') { ready = true; break; }
    } catch { /* Wait for the isolated child node. */ }
    await delay(250);
  }
  if (!ready) throw new Error(startupError || 'Test chain did not start.');
  test = spawn(process.execPath, ['--test', 'tests/contract.test.mjs'], {
    stdio: 'inherit', windowsHide: true, env: { ...process.env, CONTRACT_TEST_RPC_URL: rpc },
  });
  process.exitCode = await new Promise((resolve, reject) => { test.on('exit', code => resolve(code ?? 1)); test.on('error', reject); });
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally { stop(); }
