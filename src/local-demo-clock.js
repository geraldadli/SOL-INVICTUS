import { Contract, JsonRpcProvider } from 'ethers';

const localHost = host => ['127.0.0.1', 'localhost'].includes(host);
export function canAdvanceLocalDemo(deployment, hostname) {
  try {
    const rpc = new URL(deployment.rpcUrl);
    return deployment.chainId === 31337 && localHost(hostname) && rpc.protocol === 'http:' && localHost(rpc.hostname);
  } catch { return false; }
}

// Development-only: recheck the actual network and contract before changing its test clock.
export async function advanceLocalDemo(deployment, hostname) {
  if (!canAdvanceLocalDemo(deployment, hostname)) throw new Error('The demo clock is available only on your local test chain.');
  const provider = new JsonRpcProvider(deployment.rpcUrl, undefined, { cacheTimeout: -1 });
  try {
    if ((await provider.getNetwork()).chainId !== 31337n) throw new Error('The connected network is not the local test chain.');
    const contract = new Contract(deployment.address, [
      'function CONTRACT_VERSION() view returns(uint256)', 'function demoVerification() view returns(bool)',
      'function reportingOpensAt() view returns(uint256)',
    ], provider);
    if (![3n, 4n].includes(await contract.CONTRACT_VERSION()) || !await contract.demoVerification()) throw new Error('Only contracts using demo data can use the demo clock.');
    const opens = Number(await contract.reportingOpensAt());
    const block = await provider.getBlock('latest');
    if (block.timestamp >= opens) return { moved: false, timestamp: block.timestamp };
    await provider.send('evm_setNextBlockTimestamp', [opens]);
    await provider.send('evm_mine', []);
    return { moved: true, timestamp: (await provider.getBlock('latest')).timestamp };
  } finally { provider.destroy(); }
}
