// The acceptance harness.
//
// It measures the thing that matters — how much work is still outstanding when the visitor
// clicks — instead of wall-clock milliseconds, which on a CI runner mostly measure the CI
// runner. Bytes-after-click and requests-after-click are stable, comparable across machines,
// and they are what preparation is supposed to move.
//
// The five entry paths a product must keep working:
//
//   cold          the visitor lands directly on the app. Nothing was prepared.
//   prepared      the marketing page prepared this app; the visitor clicked through.
//   cancelled     preparation started and was abandoned (they scrolled away, went offline).
//   repeat        a second activation in the same document (another island, another view).
//   stale         a release was published between preparation and the click.
//
// Every one of them must end with a running application. That is the acceptance bar:
// preparation is an optimization, never a precondition.

/** Accounting fetch: records what crossed the network, and when relative to the click. */
export function meteredNetwork({ manifests, latencyMs = 0, failing = new Set() }) {
  const log = [];
  let phase = 'before-click';
  const bodies = new Map();
  const register = (manifest) => {
    for (const item of [...manifest.entrypoints, ...manifest.assets]) {
      bodies.set(`${manifest.baseUrl}${item.path}`, item);
    }
  };
  for (const manifest of manifests) register(manifest);
  return {
    log,
    /** Teach the network about a release published mid-scenario. */
    register,
    click() {
      phase = 'after-click';
    },
    /** Bytes the browser had to move once the visitor asked for the application. */
    get bytesAfterClick() {
      return log.filter((r) => r.phase === 'after-click' && !r.cached).reduce((a, b) => a + b.bytes, 0);
    },
    get requestsAfterClick() {
      return log.filter((r) => r.phase === 'after-click' && !r.cached).length;
    },
    /** A browser cache stand-in: what preparation pulled does not travel twice. */
    seen: new Set(),
    async fetch(url, init = {}) {
      const item = bodies.get(url);
      const bytes = item?.bytes ?? 0;
      const cached = this.seen.has(url);
      log.push({ url, phase, bytes, cached });
      if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (latencyMs) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, latencyMs);
          init.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          }, { once: true });
        });
      }
      if ([...failing].some((f) => url.includes(f))) return { ok: false, status: 503, url };
      this.seen.add(url);
      // Bodies are truncated to keep the suite fast; the accounting above uses the real
      // sizes from the manifest. The floor of 8 keeps the Wasm magic representable.
      const body = new Uint8Array(Math.max(8, Math.min(bytes, 4096)));
      if (url.endsWith('.wasm')) body.set([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00], 0);
      return {
        ok: true,
        status: 200,
        url,
        headers: { get: () => (url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript') },
        arrayBuffer: async () => body.buffer,
        json: async () => ({}),
      };
    },
  };
}

/**
 * Run one scenario against a coordinator that is already wired with its adapter.
 * Returns a receipt the test asserts on — the harness itself never asserts.
 */
export async function runScenario(scenario, { coordinator, network, manifest, activateOptions = {} }) {
  const outcome = { scenario: scenario.name, prepared: null, instance: null, error: null };

  if (scenario.prepare) {
    const promise = coordinator.prepare(manifest.appId);
    if (scenario.cancelAfterMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, scenario.cancelAfterMs));
      coordinator.cancel(manifest.appId);
    }
    outcome.prepared = await promise;
  }

  if (scenario.publishNewRelease) {
    const published = {
      ...manifest,
      releaseId: scenario.publishNewRelease,
      baseUrl: manifest.baseUrl.replace(manifest.releaseId, scenario.publishNewRelease),
    };
    network.register(published);
    coordinator.register(published);
  }

  network.click();
  try {
    outcome.instance = await coordinator.activate(manifest.appId, activateOptions);
    if (scenario.activateTwice) {
      outcome.second = await coordinator.activate(manifest.appId, activateOptions);
    }
  } catch (error) {
    outcome.error = error;
  }
  outcome.bytesAfterClick = network.bytesAfterClick;
  outcome.requestsAfterClick = network.requestsAfterClick;
  return outcome;
}
