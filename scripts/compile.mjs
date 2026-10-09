import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import solc from 'solc';

export function compile(version = 2) {
  if (![2, 3, 4].includes(version)) throw new Error('Unsupported contract version.');
  const name = { 2: 'SuryaShare', 3: 'VerifiedSuryaShare', 4: 'MilestoneSuryaShare' }[version];
  const result = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: { [`${name}.sol`]: { content: readFileSync(`contracts/${name}.sol`, 'utf8') } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  }), { import: (path) => {
    try { return { contents: readFileSync(resolve('node_modules', path), 'utf8') }; }
    catch { return { error: `Cannot resolve ${path}` }; }
  } }));
  const errors = (result.errors ?? []).filter(e => e.severity === 'error');
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  const contract = result.contracts[`${name}.sol`][name];
  const artifact = { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(`artifacts/${name}.json`, JSON.stringify(artifact, null, 2));
  return artifact;
}
if (process.argv[1]?.endsWith('compile.mjs')) { compile(); compile(3); compile(4); console.log('SuryaShare v2, verified v3, and milestone v4 compiled.'); }
