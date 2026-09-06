import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePackage } from './resolve.mjs';

const { createCoordinator } = await import(resolvePackage('owl-coordinator', 'ores-wasm-loaders'));
const { createLeptosAdapter } = await import(resolvePackage('owl-rust-loader', 'ores-wasm-loaders'));
import { meteredNetwork, runScenario, checkHosting } from '../index.mjs';
import { interfaces, manifests, fakeDocument } from './helpers.mjs';

const scenarios = JSON.parse(readFileSync(join(new URL('.', import.meta.url).pathname, '..', 'scenarios/entry-paths.json'), 'utf8'));
const validate = (m) => interfaces.checkManifest(m, interfaces.manifestSchema);

/**
 * A glue stub that behaves like real wasm-bindgen glue where it matters to this suite: it
 * pulls its companion module over the network when handed a URL, and does not when handed a
 * module that preparation already produced. Counting initializations lets "one
 * initialization, however many callers" be an acceptance claim rather than a hope.
 */
function glueStub(counter, network) {
  return {
    async default({ module_or_path: source } = {}) {
      counter.init += 1;
      if (typeof source === 'string') await network.fetch(source);
    },
    hydrate_islands() {
      counter.hydrate += 1;
    },
  };
}

function harness(manifest, { latencyMs = 0 } = {}) {
  const counter = { init: 0, hydrate: 0 };
  const network = meteredNetwork({ manifests: [manifest], latencyMs });
  const env = {
    now: (() => {
      let t = 0;
      return () => (t += 1);
    })(),
    document: fakeDocument(),
    wasm: null,
    idle: (cb) => cb(),
    fetch: (url, init) => network.fetch(url, init),
  };
  const coordinator = createCoordinator({
    env,
    validate,
    adapters: [
      createLeptosAdapter({
        interfaces,
        // A real page loads the glue itself; model that so post-click bytes are honest.
        importModule: async (url) => {
          await network.fetch(url);
          return glueStub(counter, network);
        },
      }),
    ],
  });
  coordinator.register(manifest);
  return { coordinator, network, counter };
}

for (const scenario of scenarios) {
  test(`entry path: ${scenario.name} — ${scenario.description}`, async () => {
    const manifest = manifests.leptos;
    const { coordinator, network, counter } = harness(manifest, { latencyMs: scenario.cancelAfterMs === undefined ? 0 : 20 });
    const outcome = await runScenario(scenario, { coordinator, network, manifest });

    assert.equal(outcome.error, null, `${scenario.name} must end with a running application`);
    assert.ok(outcome.instance, 'no instance');
    assert.equal(counter.hydrate >= 1, true, 'the app must actually have hydrated');

    if (scenario.expect.noBytesAfterClick) {
      assert.equal(
        outcome.bytesAfterClick,
        0,
        `preparation should have covered the click path, but ${outcome.requestsAfterClick} request(s) still crossed the network`,
      );
    }
    if (scenario.expect.singleInitialization) {
      assert.equal(counter.init, 1, 'a second activation must reuse the first initialization');
      assert.equal(outcome.second, outcome.instance);
    }
    if (scenario.name === 'stale') {
      assert.equal(outcome.instance.mode, 'hydrate-islands');
      // The new release's bytes are fetched after the click precisely because the stale
      // preparation was discarded — that is the correct, safe outcome.
      assert.ok(outcome.bytesAfterClick > 0, 'a new release must be fetched, not assumed');
    }
  });
}

test('the prepared path moves the work off the click', async () => {
  const manifest = manifests.leptos;

  const cold = harness(manifest);
  const coldOutcome = await runScenario({ name: 'cold', prepare: false, expect: {} }, { coordinator: cold.coordinator, network: cold.network, manifest });

  const warm = harness(manifest);
  const warmOutcome = await runScenario({ name: 'prepared', prepare: true, expect: {} }, { coordinator: warm.coordinator, network: warm.network, manifest });

  assert.ok(coldOutcome.bytesAfterClick > 0, 'the cold path must pay for the release after the click');
  assert.equal(warmOutcome.bytesAfterClick, 0, 'the prepared path must not');
  assert.ok(
    coldOutcome.bytesAfterClick > warmOutcome.bytesAfterClick,
    `expected preparation to reduce post-click bytes (cold ${coldOutcome.bytesAfterClick}, prepared ${warmOutcome.bytesAfterClick})`,
  );
});

test('hosting: the checks catch the mistakes that actually happen', async () => {
  const manifest = manifests.leptos;
  const headers = new Map([
    ['content-type', 'application/wasm'],
    ['cache-control', 'public, max-age=31536000, immutable'],
  ]);
  const good = await checkHosting(manifest, {
    fetch: async (url) => ({
      ok: true,
      status: 200,
      headers: {
        get: (h) => {
          if (url.endsWith('owl-manifest.json')) return h === 'cache-control' ? 'public, max-age=60' : 'application/json';
          if (h === 'content-type') return url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
          return headers.get(h) ?? null;
        },
      },
    }),
  });
  assert.deepEqual(good.problems, []);

  const bad = await checkHosting(manifest, {
    fetch: async (url) => ({
      ok: true,
      status: 200,
      headers: {
        get: (h) => {
          if (h === 'content-type') return 'application/octet-stream';
          if (h === 'cache-control') return url.endsWith('owl-manifest.json') ? 'public, max-age=31536000, immutable' : 'no-store';
          return null;
        },
      },
    }),
  });
  assert.ok(bad.problems.some((p) => p.includes('application/wasm')), bad.problems.join('\n'));
  assert.ok(bad.problems.some((p) => p.includes('immutable')), bad.problems.join('\n'));
  assert.ok(bad.problems.some((p) => p.includes('pointer that moves')), bad.problems.join('\n'));
});

test('hosting: cross-origin isolation is required only where a release asks for it', async () => {
  const plain = async (url) => ({
    ok: true,
    status: 200,
    headers: {
      get: (h) => {
        if (h === 'content-type') return url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
        if (h === 'cache-control') return url.endsWith('owl-manifest.json') ? 'public, max-age=60' : 'public, max-age=31536000, immutable';
        return null;
      },
    },
  });
  const leptos = await checkHosting(manifests.leptos, { fetch: plain });
  assert.deepEqual(leptos.problems, [], 'a Leptos release must not be told it needs isolation');

  const flutter = await checkHosting(manifests.flutter, { fetch: plain });
  assert.ok(flutter.problems.some((p) => p.includes('threaded renderer')), flutter.problems.join('\n'));
});
