# Vendored source

This package is a verbatim copy of `@ledgerhq/device-transport-kit-node-hid`, kept so it can
be ported to the Bare runtime (see [../../docs/STRATEGY.md](../../docs/STRATEGY.md)).

|               |                                                         |
| ------------- | ------------------------------------------------------- |
| Upstream repo | https://github.com/LedgerHQ/device-sdk-ts               |
| Upstream path | `packages/transport/node-hid`                           |
| Tag           | `@ledgerhq/device-transport-kit-node-hid@1.0.1`         |
| Commit        | `e6f7e04910329c7d15d856a6a46546762e22a10a` (2026-04-14) |

`src/` is byte for byte identical to that commit, tests included. Keep it that way until
step 4 of the plan, so a later rebase against upstream stays mechanical.

What was deliberately not copied, since it is monorepo tooling:

- `eslint.config.mjs`, `.prettierrc.js`, `.prettierignore`
- `tsconfig.prod.json` and the `ldmk-tool` build scripts. Nothing is built here; `tsx` runs
  the TypeScript sources directly.
- `vitest.config.mjs`, which extends the private `@ledgerhq/vitest-config-dmk`. This repo
  tests with noba, so the vendored `*.test.ts` files still need porting off vitest; they are
  excluded from `tsconfig.json` until then.
- `package.json`. This package has its own manifest, but written from scratch rather than
  copied: upstream resolves dependencies through pnpm catalogs and workspace links that do not
  exist outside that monorepo, so each was pinned to the version the catalog resolved to:

| Dependency  | Upstream   | Here      |
| ----------- | ---------- | --------- |
| `node-hid`  | `catalog:` | `^3.2.0`  |
| `purify-ts` | `catalog:` | `2.1.0`   |
| `usb`       | `catalog:` | `^2.16.0` |
| `uuid`      | `catalog:` | `11.0.3`  |

`@types/uuid` is not installed: it is deprecated, since `uuid@11` ships its own types.

Two edits to `src/`, both mechanical to reapply after a rebase:

1. Upstream's `@api/*` path alias was rewritten to relative imports, so the tree resolves
   without any tsconfig `paths` entry.
2. `NodeHidTransport.ts` imports `v4` from `@tetherto/uuid` rather than `uuid`. That wrapper
   picks uuid's Bare safe build under Bare and the plain one elsewhere; see
   [../../docs/STRATEGY.md](../../docs/STRATEGY.md) section 4.2d. its own `tsup.config.ts` keeps it external,
   otherwise the bundle inlines the non Bare branch.
