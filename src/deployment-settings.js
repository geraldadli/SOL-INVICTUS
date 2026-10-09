import { AbiCoder, getAddress, ZeroAddress } from 'ethers';

export function deploymentSettings({ operator, reviewer, verifier, verifierUrl }) {
  const addresses = [operator, reviewer, verifier].map(value => getAddress(value));
  if (addresses.includes(ZeroAddress) || new Set(addresses).size !== 3) throw new Error('Operator, reviewer, and verifier must be three different nonzero addresses.');
  const url = new URL(verifierUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) throw new Error('Use the hosted verifier’s public HTTPS base URL, without credentials or query parameters.');
  return { operator: addresses[0], reviewer: addresses[1], verifier: addresses[2], verifierUrl: url.href.replace(/\/$/, '') };
}

export const verifierEndpoint = (base, route) => {
  const url = new URL(base);
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) return `${base.replace(/\/$/, '')}/${route}`;
  // Hosted functions expose one exact function URL; select an action in its query.
  url.searchParams.set('action', route);
  return url.href;
};
export async function checkVerifierService(settings, project = null) {
  const response = await fetch(verifierEndpoint(settings.verifierUrl, 'health'), { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('The hosted verifier is unavailable.');
  const health = await response.json();
  if (health.chainId !== 11155111 || health.mode !== 'simulated' || health.persistentKey !== true || getAddress(health.verifier) !== settings.verifier) throw new Error('The service must use Sepolia, labeled sample records, and the configured persistent verifier key.');
  if ((settings.operator && getAddress(health.operator) !== settings.operator) || (settings.reviewer && getAddress(health.reviewer) !== settings.reviewer)) throw new Error('The selected operator and reviewer do not match the hosted verifier configuration.');
  if (project ? !health.project || getAddress(health.project) !== getAddress(project) : health.project) throw new Error(project ? 'The verifier is not bound to the new contract yet.' : 'This verifier is already bound to a contract. Do not deploy another project with it.');
  return health;
}

// Compare the complete creation transaction, including exact constructor arguments.
export function verifyCreationData(data, artifact, settings) {
  const encoded = AbiCoder.defaultAbiCoder().encode(['address', 'bool', 'address'], [settings.verifier, true, settings.reviewer]);
  if (data.toLowerCase() !== `${artifact.bytecode}${encoded.slice(2)}`.toLowerCase()) throw new Error('Deployment bytecode or constructor settings do not match the compiled version 4 contract.');
}
