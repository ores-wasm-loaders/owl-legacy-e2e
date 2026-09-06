// Test fixtures and stubs, resolved through the fleet's package layout.
import { resolvePackage, resolveFile } from './resolve.mjs';

export const interfaces = await import(resolvePackage('owl-interfaces', 'ores-wasm-loaders'));
export const { manifests, fakeDocument, testEnv } = await import(
  resolveFile('owl-fixtures', 'ores-wasm-loaders-test', 'testkit.mjs')
);
