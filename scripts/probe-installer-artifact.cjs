const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const name = `GDDXX-Jarvis-Windows-x64-Setup-${pkg.version}.exe`;
const installer = path.join(root, 'dist', name);
const blockmap = `${installer}.blockmap`;
const latestPath = path.join(root, 'dist', 'latest.yml');
const latest = fs.existsSync(latestPath) ? fs.readFileSync(latestPath, 'utf8') : '';
const bytes = fs.existsSync(installer) ? fs.readFileSync(installer) : Buffer.alloc(0);
const hash = crypto.createHash('sha256').update(bytes).digest('hex');
const checksumPath = `${installer}.sha256`;
if (bytes.length) fs.writeFileSync(checksumPath, `${hash}  ${name}\n`, 'ascii');
const checksum = fs.existsSync(checksumPath) ? fs.readFileSync(checksumPath, 'ascii').trim() : '';

const checks = {
  exactVersionedName: path.basename(installer) === name,
  installerExists: fs.existsSync(installer),
  installerHasPayload: bytes.length > 400 * 1024 * 1024,
  portableExecutableHeader: bytes.subarray(0, 2).toString('ascii') === 'MZ',
  blockmapExists: fs.existsSync(blockmap) && fs.statSync(blockmap).size > 100_000,
  updateMetadataMatchesVersion: new RegExp(`version:\\s*${pkg.version.replaceAll('.', '\\.')}`).test(latest),
  updateMetadataMatchesFile: latest.includes(name),
  checksumCreated: fs.existsSync(checksumPath),
  checksumMatchesArtifact: checksum === `${hash}  ${name}`,
  guidedInstallAllowsDirectoryChoice: pkg.build?.nsis?.oneClick === false && pkg.build?.nsis?.allowToChangeInstallationDirectory === true,
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed.length === 0, installer, size: bytes.length, sha256: hash, checks, failed }, null, 2));
if (failed.length) process.exit(1);
