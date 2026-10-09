import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { createDemoVerifier } from '../verifier/server.mjs';

const chainPort = Number(process.env.LOCAL_CHAIN_PORT || 8545), appPort = Number(process.env.LOCAL_APP_PORT || 5173), verifierPort = Number(process.env.LOCAL_VERIFIER_PORT || 8787);
if ([chainPort, appPort, verifierPort].some(p => !Number.isInteger(p) || p < 1024 || p > 65535) || new Set([chainPort, appPort, verifierPort]).size !== 3) throw new Error('Use three distinct valid local ports.');
const rpcUrl = `http://127.0.0.1:${chainPort}`;
const configName = process.env.LOCAL_DEPLOYMENT_FILE || 'deployment.json';
if (!/^deployment(?:-[a-z0-9-]+)?\.json$/.test(configName)) throw new Error('Invalid local deployment filename.');
let verifier;

// A fresh process starts a fresh demo. Keep it running to retain local chain history.
for (const port of [chainPort, appPort, verifierPort]) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is already in use. Stop the previous demo before running npm start.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
mkdirSync('work', { recursive: true });
const chainLog = createWriteStream('work/chain.log');
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach(child => child.kill());
  verifier?.close().catch(() => {});
  chainLog.end();
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
function launch(args, stdio = 'inherit') {
  const child = spawn(process.execPath, args, { stdio, windowsHide: true, env: { ...process.env, RPC_URL: rpcUrl, PUBLIC_RPC_URL: rpcUrl,
    VITE_DEPLOYMENT_FILE: configName,
    ...(verifier ? { VERIFIER_ADDRESS: verifier.address, VERIFIER_URL: verifier.url } : {}) } });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  return child;
}
try {
  const chain = launch(['node_modules/hardhat/dist/src/cli.js', 'node', '--hostname', '127.0.0.1', '--port', String(chainPort)], ['ignore', 'pipe', 'pipe']);
  chain.stdout.pipe(chainLog); chain.stderr.pipe(chainLog);
  chain.on('exit', () => { if (!stopping) { console.error('Local chain stopped. See work/chain.log.'); stop(1); } });
  let ready = false;
  for (let i = 0; i < 90 && !stopping; i++) {
    try {
      const response = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), signal: AbortSignal.timeout(1000) });
      if ((await response.json()).result === '0x7a69') { ready = true; break; }
    } catch { /* Wait for this child node to start. */ }
    await delay(500);
  }
  if (!ready) throw new Error('Local chain did not start. See work/chain.log.');
  verifier = await createDemoVerifier({ rpcUrl, port: verifierPort });
  const deploy = launch(['scripts/deploy.mjs']);
  await new Promise((resolve, reject) => deploy.on('exit', code => code === 0 ? resolve() : reject(new Error('Deployment failed.'))));
  verifier.bind(JSON.parse(readFileSync(`public/${configName}`, 'utf8')).address);
  const app = launch(['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(appPort), '--strictPort']);
  app.on('exit', code => { if (!stopping) stop(code ?? 1); });
  console.log(`\nVerified Sol Invictus demo: http://127.0.0.1:${appPort}\nChoose Alice, buy 100 shares, then use the operator to check monthly data and publish income.\nVerification uses synthetic records and an ephemeral service key; no additional user wallet is needed.\nCtrl+C stops the app. Restarting creates a fresh local demo.\n`);
} catch (error) { console.error(error.message); stop(1); }
