# Vendored source

This package is a verbatim copy of `@ledgerhq/device-transport-kit-node-hid`, kept so it can
be ported to the Bare runtime (see [../../docs/STRATEGY.md](../../docs/STRATEGY.md)).

| | |
| --- | --- |
| Upstream repo | https://github.com/LedgerHQ/device-sdk-ts |
| Upstream path | `packages/transport/node-hid` |
| Tag | `@ledgerhq/device-transport-kit-node-hid@1.0.1` |
| Commit | `e6f7e04910329c7d15d856a6a46546762e22a10a` (2026-04-14) |

`src/` is byte for byte identical to that commit, tests included. Keep it that way until
step 4 of the plan, so a later rebase against upstream stays mechanical.

What was deliberately not copied, since it is monorepo tooling:

- `eslint.config.mjs`, `.prettierrc.js`, `.prettierignore`
- `tsconfig.prod.json` and the `ldmk-tool` build scripts. Nothing is built here; `tsx` runs
  the TypeScript sources directly.
- `vitest.config.mjs`, which extends the private `@ledgerhq/vitest-config-dmk`. This repo
  tests with noba, so the vendored `*.test.ts` files still need porting off vitest; they are
  excluded from `tsconfig.json` until then.
- `package.json`. This is not a separate package: it has no manifest of its own, and its
  dependencies are installed in the root `package.json`. Upstream resolves them through pnpm
  catalogs and workspace links that do not exist outside the monorepo, so each was pinned to
  the version the catalog resolved to:

| Dependency | Upstream | Here |
| --- | --- | --- |
| `node-hid` | `catalog:` | `^3.2.0` |
| `purify-ts` | `catalog:` | `2.1.0` |
| `usb` | `catalog:` | `^2.16.0` |
| `uuid` | `catalog:` | `11.0.3` |

`@types/uuid` is not installed: it is deprecated, since `uuid@11` ships its own types.

The one edit to `src/`: upstream's `@api/*` path alias was rewritten to relative imports, so
the tree resolves without any tsconfig `paths` entry. Nothing else was touched, and the
rewrite is mechanical to reapply after a rebase.
