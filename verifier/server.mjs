import { createServer } from 'node:http';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { createDemoSource } from './demo-source.mjs';
import { signEvidence } from '../src/verification.js';

const ABI = ['function trustedVerifier() view returns(address)', 'function demoVerification() view returns(bool)',
  'function CONTRACT_VERSION() view returns(uint256)', 'function nextReportingPeriod() view returns(uint32)', 'function reportingOpensAt() view returns(uint256)'];

export async function createDemoVerifier({ rpcUrl, port = 8787 }) {
  const rpc = new URL(rpcUrl);
  if (rpc.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(rpc.hostname)) throw new Error('Demo verifier requires a loopback local chain.');
  const provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1 });
  if ((await provider.getNetwork()).chainId !== 31337n) { provider.destroy(); throw new Error('Demo verifier is restricted to chain 31337.'); }
  const source = createDemoSource((await provider.getBlock('latest')).timestamp);
  // Ephemeral test signing key: never written to disk or exposed by the API.
  const signer = Wallet.createRandom();
  let project, busy = false;
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    const reply = (status, value) => { res.writeHead(status); res.end(JSON.stringify(value)); };
    try {
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname)) return reply(403, { error: 'Local demo origins only.' });
        res.setHeader('Access-Control-Allow-Origin', origin.origin); res.setHeader('Vary', 'Origin');
      }
      if (!['127.0.0.1', 'localhost'].includes(new URL(`http://${req.headers.host}`).hostname)) return reply(403, { error: 'Local host required.' });
      if (req.method !== 'GET') return reply(405, { error: 'GET only.' });
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/health') return reply(200, { mode: 'simulated', verifier: signer.address, project: project ?? null });
      if (url.pathname !== '/proof') return reply(404, { error: 'Not found.' });
      if ([...url.searchParams.keys()].some(key => key !== 'period') || url.searchParams.getAll('period').length !== 1) return reply(400, { error: 'Only one reporting period is accepted. Operator readings are never accepted.' });
      if (!project) return reply(503, { error: 'Project not connected yet.' });
      if (busy) return reply(429, { error: 'Verifier busy. Retry shortly.' });
      busy = true;
      try {
        const contract = new Contract(project, ABI, provider), block = await provider.getBlock('latest');
        const [verifier, demo, version, period, opens] = await Promise.all([contract.trustedVerifier(), contract.demoVerification(), contract.CONTRACT_VERSION(), contract.nextReportingPeriod(), contract.reportingOpensAt()]);
        if (verifier !== signer.address || !demo || ![3n, 4n].includes(version)) throw new Error('Contract verifier configuration does not match this service.');
        if (String(period) !== url.searchParams.get('period')) throw new Error('Request the next required reporting month.');
        if (block.timestamp < Number(opens)) throw new Error('Reporting month has not ended.');
        const record = source.read(Number(period));
        reply(200, await signEvidence(signer, 31337, project, record, block.timestamp + 900));
      } finally { busy = false; }
    } catch (error) { reply(400, { error: error.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }).catch(error => { provider.destroy(); throw error; });
  return { address: signer.address, url: `http://127.0.0.1:${server.address().port}`,
    bind(address) { if (project) throw new Error('Verifier is already bound.'); project = address; },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); provider.destroy(); } };
}
