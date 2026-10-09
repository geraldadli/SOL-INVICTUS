import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import solc from 'solc';

export function compile() {
  const result = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: { 'SuryaShare.sol': { content: readFileSync('contracts/SuryaShare.sol', 'utf8') } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  }), { import: (path) => {
    try { return { contents: readFileSync(resolve('node_modules', path), 'utf8') }; }
    catch { return { error: `Cannot resolve ${path}` }; }
  } }));
  const errors = (result.errors ?? []).filter(e => e.severity === 'error');
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  const contract = result.contracts['SuryaShare.sol'].SuryaShare;
  const artifact = { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/SuryaShare.json', JSON.stringify(artifact, null, 2));
  return artifact;
}
if (process.argv[1]?.endsWith('compile.mjs')) { compile(); console.log('SuryaShare compiled.'); }
