import { copyFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const deployment = JSON.parse(readFileSync('deployments/sepolia.json', 'utf8'));
if (deployment.chainId !== 11155111 || new URL(deployment.rpcUrl).protocol !== 'https:' || !/^0x[\da-f]{40}$/i.test(deployment.address)) {
  throw new Error('Pages requires a Sepolia deployment with an HTTPS RPC.');
}
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--base=/SOL-INVICTUS/', '--mode=pages'], {
  stdio: 'inherit', env: { ...process.env, VITE_DEPLOYMENT_FILE: 'deployment.json' },
});
if (result.status !== 0) process.exit(result.status ?? 1);
// Replace any developer's loopback configuration with the verified Sepolia deployment.
copyFileSync('deployments/sepolia.json', 'dist/deployment.json');
// Local parallel demos must never publish their loopback configurations.
for (const name of readdirSync('dist')) {
  if (/^deployment-[a-z0-9-]+\.json$/.test(name)) unlinkSync(`dist/${name}`);
}
console.log('Sepolia demo ready for GitHub Pages.');
