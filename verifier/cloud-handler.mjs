import { Contract, FetchRequest, JsonRpcProvider, Wallet, getAddress } from 'ethers';
import { createDemoSource } from './demo-source.mjs';
import { signEvidence } from '../src/verification.js';

const cloudABI = ['function trustedVerifier() view returns(address)', 'function demoVerification() view returns(bool)',
  'function CONTRACT_VERSION() view returns(uint256)', 'function nextReportingPeriod() view returns(uint32)',
  'function reportingOpensAt() view returns(uint256)', 'function operator() view returns(address)', 'function milestoneReviewer() view returns(address)'];
const source = createDemoSource(Date.UTC(2026, 9, 1) / 1000);
const allowedOrigin = origin => {
  if (!origin || ['https://geraldadli.github.io', 'https://remix.ethereum.org', 'https://app.remix.live'].includes(origin)) return true;
  try { const u = new URL(origin); return u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname); } catch { return false; }
};

// The environment is server-side only. No request can choose the key, chain, project,
// operator, reviewer, or source figures. Keep this key stable across redeployments.
export function createCloudHandler(env, dependencies = {}) {
  const createProvider = dependencies.createProvider ?? (url => { const request = new FetchRequest(url); request.timeout = 10000; return new JsonRpcProvider(request, undefined, { cacheTimeout: -1 }); });
  const createContract = dependencies.createContract ?? ((address, provider) => new Contract(address, cloudABI, provider));
  return async function handle(req) {
    const origin = req.headers.get('Origin');
    const url = new URL(req.url), action = url.searchParams.get('action') ?? url.pathname.split('/').filter(Boolean).at(-1);
    // Health exposes only public deployment metadata, never a signature or secret.
    // Remix runs scripts in a separate sandbox origin, so this read-only endpoint
    // is intentionally public. Proof requests retain the explicit origin policy.
    const publicHealth = action === 'health';
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (publicHealth) headers['Access-Control-Allow-Origin'] = '*';
    else if (origin && allowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers });
    if (!publicHealth && !allowedOrigin(origin)) return reply(403, { error: 'This origin is not allowed.' });
    if (req.method === 'OPTIONS') return reply(204, null);
    if (req.method !== 'GET') return reply(405, { error: 'GET only.' });
    if (!['health', 'proof'].includes(action)) return reply(404, { error: 'Use /health or /proof.' });
    const keys = [...url.searchParams.keys()];
    if (keys.some(key => !['period', 'action'].includes(key)) || url.searchParams.getAll('action').length > 1 || url.searchParams.getAll('period').length > 1) return reply(400, { error: 'Only a reporting period is accepted; operator figures are never accepted.' });
    if (action === 'proof' && !/^\d{6}$/.test(url.searchParams.get('period') ?? '')) return reply(400, { error: 'Supply one reporting period as YYYYMM.' });
    let provider;
    try {
      const privateKey = env('SOL_VERIFIER_PRIVATE_KEY');
      if (!/^0x[0-9a-f]{64}$/i.test(privateKey ?? '')) return reply(503, { error: 'Persistent verifier key is not configured.' });
      const signer = new Wallet(privateKey);
      const projectValue = env('SOL_PROJECT_ADDRESS'), project = projectValue ? getAddress(projectValue) : null;
      const operator = getAddress(env('SOL_OPERATOR_ADDRESS') || '0xaeEeC36568e5919ce3126ABde04285B90030F58b');
      const reviewer = getAddress(env('SOL_REVIEWER_ADDRESS') || '0x0833738A169A9D2415bD3B7748d5D04B5eA63376');
      const rpc = env('SOL_SEPOLIA_RPC_URL') || 'https://ethereum-sepolia-rpc.publicnode.com';
      if (new URL(rpc).protocol !== 'https:') return reply(503, { error: 'An HTTPS Sepolia RPC is required.' });
      provider = createProvider(rpc);
      if ((await provider.getNetwork()).chainId !== 11155111n) return reply(503, { error: 'Verifier RPC must be Sepolia.' });
      const health = { chainId: 11155111, mode: 'simulated', persistentKey: true, verifier: signer.address, operator, reviewer, project };
      if (!project) return action === 'health' ? reply(200, health) : reply(503, { error: 'The verifier is not bound to a deployed project yet.' });
      const block = await provider.getBlock('latest');
      if (!block) return reply(503, { error: 'Latest Sepolia block unavailable.' });
      const contract = createContract(project, provider), opts = { blockTag: block.number };
      const [trusted, demo, version, actualOperator, actualReviewer, period, opens] = await Promise.all([
        contract.trustedVerifier(opts), contract.demoVerification(opts), contract.CONTRACT_VERSION(opts), contract.operator(opts),
        contract.milestoneReviewer(opts), contract.nextReportingPeriod(opts), contract.reportingOpensAt(opts),
      ]);
      if (getAddress(trusted) !== signer.address || !demo || version !== 4n || getAddress(actualOperator) !== operator || getAddress(actualReviewer) !== reviewer || new Set([signer.address, operator, reviewer]).size !== 3) return reply(503, { error: 'Onchain project roles do not match the verifier configuration.' });
      if (action === 'health') return reply(200, health);
      if (String(period) !== url.searchParams.get('period')) return reply(400, { error: 'Request the next required reporting month.' });
      if (block.timestamp < Number(opens)) return reply(400, { error: 'Reporting month has not ended.' });
      let record;
      try { record = source.read(Number(period)); } catch { return reply(404, { error: 'No labeled sample records exist for this month.' }); }
      return reply(200, await signEvidence(signer, 11155111, project, record, block.timestamp + 900));
    } catch {
      // Provider and wallet error messages may include configuration; never echo them publicly.
      return reply(503, { error: 'The verifier could not complete its checks. Try again later.' });
    } finally { provider?.destroy(); }
  };
}
