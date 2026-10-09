import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// InsForge accepts one Deno module. These four application modules have no dynamic
// imports; collect their named ethers imports and inline their local code.
const files = ['src/reporting.js', 'src/verification.js', 'verifier/demo-source.mjs', 'verifier/cloud-handler.mjs'];
const ethersImports = new Set();
const bodies = files.map(file => readFileSync(file, 'utf8').replace(/^import \{([^}]+)\} from ['"]ethers['"];\r?\n/gm, (_, names) => {
  names.split(',').forEach(name => ethersImports.add(name.trim())); return '';
}).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''));
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/sol-verifier.js', `import { ${[...ethersImports].join(', ')} } from 'npm:ethers@6.17.0';\n${bodies.join('\n')}\nexport default createCloudHandler(name => Deno.env.get(name));\n`);
console.log('Built the hosted verifier (no secrets included).');
