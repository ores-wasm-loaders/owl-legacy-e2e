// Hosting checks.
//
// Most "the loader is slow" reports are hosting reports. These are the response properties
// the loading layer actually depends on, checked against a real deployment (or the fixture
// server) rather than assumed:
//
//   * `application/wasm` — streaming instantiation requires it. The wrong type degrades
//     silently to the slower path or fails outright.
//   * immutable caching on versioned assets — the whole point of putting the release id in
//     the path is that the response can be cached forever.
//   * a manifest that is NOT cached forever — it is the pointer that moves.
//   * cross-origin isolation, but only where a release asks for it (Flutter's threaded
//     renderer). Applying it fleet-wide breaks unrelated embeds for no gain.

const IMMUTABLE = /max-age=(\d+)/;

export async function checkHosting(manifest, { fetch, requireIsolation = manifest.requiresCrossOriginIsolation }) {
  const problems = [];
  const checked = [];

  const module = manifest.entrypoints.find((e) => e.role === 'module');
  const targets = [module, manifest.entrypoints.find((e) => e.role === 'glue' || e.role === 'bootstrap')].filter(Boolean);

  for (const item of targets) {
    const url = `${manifest.baseUrl}${item.path}`;
    const response = await fetch(url, { method: 'GET' });
    checked.push(url);
    if (!response.ok) {
      problems.push(`${url}: HTTP ${response.status}`);
      continue;
    }
    const type = response.headers.get('content-type')?.split(';')[0].trim();
    if (item.contentType === 'application/wasm' && type !== 'application/wasm') {
      problems.push(`${url}: served as \`${type ?? 'nothing'}\`, but streaming instantiation needs \`application/wasm\``);
    }
    const cache = response.headers.get('cache-control') ?? '';
    const maxAge = Number(cache.match(IMMUTABLE)?.[1] ?? 0);
    if (!cache.includes('immutable') && maxAge < 86_400) {
      problems.push(`${url}: \`cache-control: ${cache || 'none'}\` — a release path is immutable and should say so`);
    }
    if (requireIsolation) {
      const coop = response.headers.get('cross-origin-opener-policy');
      const coep = response.headers.get('cross-origin-embedder-policy');
      if (coop !== 'same-origin' || !coep) {
        problems.push(`${url}: this release declares the threaded renderer, which needs COOP \`same-origin\` and a COEP header (got ${coop ?? 'none'} / ${coep ?? 'none'})`);
      }
    }
  }

  const manifestUrl = `${manifest.baseUrl}owl-manifest.json`;
  const manifestResponse = await fetch(manifestUrl, { method: 'GET' });
  checked.push(manifestUrl);
  if (manifestResponse.ok) {
    const cache = manifestResponse.headers.get('cache-control') ?? '';
    if (cache.includes('immutable')) {
      problems.push(`${manifestUrl}: the manifest is the pointer that moves — it must not be immutable`);
    }
  } else {
    problems.push(`${manifestUrl}: HTTP ${manifestResponse.status}`);
  }

  return { checked, problems, ok: problems.length === 0 };
}
