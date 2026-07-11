const fs = require('node:fs');
const path = require('node:path');

const owner = String(process.argv[2] || '').trim();
const repo = String(process.argv[3] || '').trim();

if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
  console.error('Neveljavno GitHub uporabniško ime ali ime repozitorija.');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const releaseFile = path.join(root, 'release-config.js');
const packageFile = path.join(root, 'package.json');

fs.writeFileSync(
  releaseFile,
  `module.exports = {\n  owner: ${JSON.stringify(owner)},\n  repo: ${JSON.stringify(repo)},\n};\n`,
  'utf8',
);

const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
pkg.repository = {
  type: 'git',
  url: `https://github.com/${owner}/${repo}.git`,
};
fs.writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

console.log(`Nastavljeno: https://github.com/${owner}/${repo}`);
