// Resolve this org's packages the way the fleet lays them out — the vendored copy `zed
// install` writes, or the sibling checkout under ~/codes/<org>/<repo> — without a
// third-party resolver, so `node --test` works in a bare clone.
//
// It walks up from the calling file rather than assuming a fixed depth, because this module
// is used both from a repo root and from a `test/` directory.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;

function* ancestors(start, levels = 5) {
  let dir = start;
  for (let i = 0; i <= levels; i += 1) {
    yield dir;
    dir = dirname(dir);
  }
}

/** Absolute path to a package's entry module. Throws naming every place it looked. */
export function resolvePackage(pkg, org, from = HERE) {
  const candidates = [];
  for (const dir of ancestors(from)) {
    candidates.push(join(dir, '.vendor/.zed', pkg, 'index.mjs'), join(dir, pkg, 'index.mjs'), join(dir, org, pkg, 'index.mjs'));
  }
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(`${pkg} not found. Run \`zed install\`, or check it out under ~/codes/${org}. Looked in:\n  ${candidates.join('\n  ')}`);
  }
  return found;
}

/** A sibling file inside a resolved package (the fixtures' test kit, for instance). */
export function resolveFile(pkg, org, file, from = HERE) {
  return join(dirname(resolvePackage(pkg, org, from)), file);
}

export const load = (pkg, org, from = HERE) => import(resolvePackage(pkg, org, from));
