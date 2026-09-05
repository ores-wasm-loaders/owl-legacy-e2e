# owl-e2e

The acceptance suite: cold entry, prepared entry, repeat entry, full-page navigation and persistent-shell navigation, measured from click to useful interaction rather than to 'loader reported success'.

Part of [`ores-wasm-loaders`](https://github.com/ores-wasm-loaders) — the org that owns the fleet's shared
web-loading layer for the 35+ marketing sites and their applications. Its sibling
[`ores-wasm-loaders-test`](https://github.com/ores-wasm-loaders-test) carries the external-facing test surface.

## What this org is for

Marketing sites are HTML-first and cheap. The applications behind them are not: a Flutter
web release or a Leptos/Dioxus island bundle costs a download, a compile and an
initialization before it is useful. This org shares the *loading and integration
infrastructure* across every product — one coordinator, one Flutter adapter, one Rust
adapter family, one manifest contract — so the expensive part is prepared while the visitor
is still reading, and so 80–90% of that plumbing is written once rather than 35 times.

It deliberately does **not** claim to share application bytes, application memory, or a
running runtime across a normal navigation. See `owl-docs/docs/architecture.md`.

## Depends on (zed-pkg)

- `ores-wasm-loaders/owl-coordinator`
- `ores-wasm-loaders-test/owl-fixtures`

## Shared building blocks

| Concern | Repo |
| --- | --- |
| Auth (OAuth, SAML, SCIM, RBAC) | github.com/shared-auth |
| Cross-device sync | github.com/opto-sync |
| Logging / telemetry | github.com/ores-otel |
| Feature flags | github.com/flags-2-env |
| Packages | github.com/zed-pkg |
| Web ⇄ API transport | github.com/ORESoftware/ores-transport |
| Locks and leases | github.com/ORESoftware/ores-locks-and-leases |
| TypeSpec + JSON Schema parity | github.com/ORESoftware/ores-contracts |
| Reusable GitHub workflows | github.com/ORESoftware/ores-gha-workflows |
| Edge failover | github.com/ORESoftware/ores-edge-router |

## Conventions for this repository

- Scenarios are declarative (`scenarios/*.json`) so the same matrix runs against the fixtures here and against a pilot deployment.
- Hosting checks are part of the suite: `application/wasm` content type, cache headers on versioned assets, CSP, and the cross-origin-isolation headers Flutter's multi-threaded rendering needs.
- A scenario asserts elapsed work, not wall-clock thresholds, so it stays meaningful on CI runners.

## Tests

```sh
node --test test/*.test.mjs
```

No third-party dependencies: the whole org builds and tests offline, because it has to run
in every product org's CI before anything else is installed.
