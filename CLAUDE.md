# Covenant — repo rules

These rules exist because each one was violated once and broke production or
the local app in a way that curl, typecheck, and build all failed to catch.

## 1. CSP / security headers are load-bearing — never edit blind

The Content-Security-Policy in `packages/nextjs/next.config.js` can kill every
page's client-side JavaScript while the HTML still renders perfectly
(2026-07-27: `script-src` without `'unsafe-eval'` threw before hydration — no
wallet button, dead forms, no data, and every page still returned 200).

**Rule:** any change to `next.config.js` headers, the CSP constant, or
middleware that sets headers MUST be verified with the hydration smoke test
before it merges:

```bash
# against the dev server
yarn workspace @covenant/nextjs smoke

# against a production build (what CI does — the prod CSP is stricter)
yarn workspace @covenant/nextjs build && npx next start -p 3010 &
yarn workspace @covenant/nextjs smoke http://localhost:3010
```

CI runs this on every PR (`hydration-smoke` job). Do not delete or
`continue-on-error` that job to get a PR green.

## 2. The browser never talks to a third-party RPC directly

All JSON-RPC from the browser goes through the same-origin proxy
`packages/nextjs/app/api/rpc/[chainId]/route.ts`. No exceptions — this is what
fixed both the Origin-whitelist lockout (hosted deploys) and the ENS CORS
failures (viem's default mainnet RPC rejects browser CORS).

- Never hardcode a provider URL (Alchemy, Infura, merkle, llamarpc…) in client
  code, and never rely on a library's *default* RPC — a default endpoint is
  still a hardcoded endpoint you don't control.
- New chain needed in the browser? Add it to `UPSTREAMS` in the proxy route
  (server-side env var + keyless public fallback) and point the client at
  `/api/rpc/<chainId>`.
- Provider API keys live in server-side env only (`BASE_RPC_URL`,
  `MAINNET_RPC_URL`, …). **Never in a `NEXT_PUBLIC_*` var** — those are
  inlined into the shipped JS bundle.

## 3. "Page loads but nothing works" — diagnose hydration first

If the app renders but is inert (no Connect Wallet button, clicks ignored,
no on-chain data), suspect a hydration crash before suspecting
wagmi/RainbowKit/RPC. Check the browser console for `EvalError` / CSP
violations first, or just run the smoke test — it reproduces this in one
command. curl cannot see this failure class: SSR HTML looks complete.

Note: `next dev` shows up in `ps` as `next-server (vX.Y.Z)` — check the parent
process before concluding a prod build is running.

## 4. Env-var hygiene

- `NEXT_PUBLIC_*` = shipped to every visitor. Public config only, never keys.
- Every new env var gets documented in the package's `.env.example`.
- Secrets referenced in code must come from server-side env and have a
  sensible keyless fallback where possible, so an unconfigured checkout still
  runs.
