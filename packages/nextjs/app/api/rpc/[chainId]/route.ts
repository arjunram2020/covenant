import { NextResponse } from "next/server";

/**
 * Same-origin JSON-RPC proxy for the chains Covenant reads and writes on.
 *
 * Why this exists
 * ---------------
 * The browser transport used to point straight at a provider URL held in
 * NEXT_PUBLIC_BASE_RPC_URL. That has two problems, and the second one is what
 * actually broke the wallet on every hosted deploy:
 *
 *  1. NEXT_PUBLIC_* is inlined into the client bundle, so the provider key ships
 *     to every visitor (the exact thing .env.example warns about).
 *  2. The usual mitigation — restricting the key to an allowed Origin list in
 *     the provider dashboard — silently breaks every origin that isn't on the
 *     list. A key whitelisted for localhost returns
 *       {"error":{"code":-32600,"message":"Origin <host> is not on whitelist."}}
 *     for the Vercel domain, a phone, a tunnel, or the EC2 box. wagmi routes
 *     eth_call, eth_estimateGas, eth_sendRawTransaction and receipt polling
 *     through that transport, so the site loads, the wallet connects, and then
 *     nothing reads and no transaction ever confirms.
 *
 * Routing RPC through this route fixes both: the key stays server-side (never in
 * the bundle) and the browser only ever talks to its own origin, so no Origin
 * whitelist can lock it out. It also means an unrestricted key is no longer
 * needed — restrict it to the server and it keeps working everywhere.
 *
 * Server env (NOT NEXT_PUBLIC_ — never shipped to the browser):
 *   BASE_RPC_URL           upstream for chain 8453. Falls back to the public
 *                          Base RPC when unset, so the app works unconfigured.
 *   BASE_SEPOLIA_RPC_URL   upstream for chain 84532. Same fallback behaviour.
 *
 * This is deliberately NOT an open relay: the chain id must be one we deploy to,
 * the upstream is chosen server-side (never taken from the request), and only
 * the JSON-RPC methods a dapp frontend actually needs are forwarded. Archive,
 * trace, debug and filter-subscription methods are rejected so the route can't
 * be used to burn someone else's provider quota.
 */

// Chain id -> upstream, resolved server-side only. A chain absent from this map
// is not proxied at all (localhost/31337 is reached directly by the browser).
const UPSTREAMS: Record<string, { env: string | undefined; fallback: string }> = {
  // Ethereum L1 is read-only here (ENS name lookups in <Address/>); Covenant
  // never transacts on chain 1. Proxied because viem's default mainnet RPC
  // rejects browser CORS, so direct lookups fail on every origin.
  "1": { env: process.env.MAINNET_RPC_URL, fallback: "https://ethereum-rpc.publicnode.com" },
  "8453": { env: process.env.BASE_RPC_URL, fallback: "https://mainnet.base.org" },
  "84532": { env: process.env.BASE_SEPOLIA_RPC_URL, fallback: "https://sepolia.base.org" },
};

/**
 * Methods a wallet-connected frontend needs: chain/state reads, gas estimation,
 * transaction broadcast, and receipt polling. Anything not listed is refused.
 */
const ALLOWED_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getLogs",
  "eth_sendRawTransaction",
  "net_version",
  "web3_clientVersion",
]);

// viem batches requests into JSON-RPC arrays; keep headroom for a batch but
// still bound what we forward upstream.
const MAX_BODY_BYTES = 512 * 1024;
const MAX_BATCH_SIZE = 50;

// Same in-memory fixed-window limiter as the other proxy routes: per-instance
// and best-effort behind a CDN, but it bounds single-source spam. The ceiling is
// high because a single page view legitimately makes many reads and then polls
// for a receipt every few seconds.
const RL_WINDOW_MS = 60_000;
const RL_MAX = 600;
const rlHits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(req: Request): boolean {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const now = Date.now();
  let e = rlHits.get(ip);
  if (!e || now > e.resetAt) {
    e = { count: 0, resetAt: now + RL_WINDOW_MS };
    rlHits.set(ip, e);
  }
  e.count += 1;
  if (rlHits.size > 5000) {
    for (const [k, v] of rlHits) if (now > v.resetAt) rlHits.delete(k);
  }
  return e.count > RL_MAX;
}

/** JSON-RPC error in the shape viem expects, so it surfaces as a real RPC error. */
function rpcError(id: unknown, code: number, message: string, status = 400) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

export async function POST(req: Request, { params }: { params: { chainId: string } }) {
  const upstream = UPSTREAMS[params.chainId];
  if (!upstream) {
    return rpcError(null, -32601, `chain ${params.chainId} is not proxied`, 404);
  }

  if (rateLimited(req)) {
    return rpcError(null, -32005, "too many requests", 429);
  }

  const declaredLen = Number(req.headers.get("content-length") ?? 0);
  if (declaredLen > MAX_BODY_BYTES) {
    return rpcError(null, -32600, "body too large", 413);
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return rpcError(null, -32600, "body too large", 413);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return rpcError(null, -32700, "parse error");
  }

  // Validate every call in the batch before forwarding any of it, so a single
  // disallowed method can't ride along inside an otherwise-valid batch.
  const calls = Array.isArray(payload) ? payload : [payload];
  if (calls.length === 0 || calls.length > MAX_BATCH_SIZE) {
    return rpcError(null, -32600, "invalid batch size");
  }
  for (const call of calls) {
    const method = (call as { method?: unknown })?.method;
    if (typeof method !== "string") {
      return rpcError((call as { id?: unknown })?.id, -32600, "invalid request");
    }
    if (!ALLOWED_METHODS.has(method)) {
      return rpcError((call as { id?: unknown })?.id, -32601, `method ${method} is not permitted`, 403);
    }
  }

  // Configured provider first, keyless public RPC behind it. The retry matters:
  // a provider key that is Origin-restricted rejects this server (which sends no
  // Origin) with a JSON-RPC error rather than an HTTP failure, and a quota-
  // exhausted key 429s. Neither should take the demo down when a public endpoint
  // can serve the same call.
  const targets = upstream.env && upstream.env !== upstream.fallback
    ? [upstream.env, upstream.fallback]
    : [upstream.fallback];

  let lastStatus = 502;
  let lastBody = "";
  for (const target of targets) {
    let res: Response;
    let text: string;
    try {
      res = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: raw,
        // Never let a hung provider hold a serverless invocation open.
        signal: AbortSignal.timeout(20_000),
      });
      text = await res.text();
    } catch {
      // Unreachable or timed out — try the next endpoint.
      continue;
    }

    if (res.ok && !isProviderRejection(text)) {
      return new NextResponse(text, {
        status: res.status,
        headers: {
          "Content-Type": res.headers.get("content-type") || "application/json",
          // RPC responses are per-request state; never let a CDN serve a stale one.
          "Cache-Control": "no-store",
        },
      });
    }
    lastStatus = res.status;
    lastBody = text;
  }

  // Every endpoint failed. Pass the last provider response through when it was a
  // real JSON-RPC body so the cause is visible in the browser; otherwise report a
  // gateway error. Either way viem's fallback transport sees an error, not a
  // silent null result.
  if (lastBody && isProviderRejection(lastBody)) {
    return new NextResponse(lastBody, {
      status: 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  return rpcError(null, -32603, "upstream rpc unreachable", lastStatus >= 400 ? lastStatus : 502);
}

/**
 * True when a 200 response is the provider refusing us rather than the chain
 * answering — an Origin whitelist rejection, a bad/expired key, or a quota trip.
 *
 * This must stay narrow. A reverted eth_call is also a JSON-RPC error, and
 * retrying that against a second endpoint would just produce the same revert one
 * round-trip later. Only provider-level refusals, which are always a single
 * (non-batch) error object, are matched here.
 */
function isProviderRejection(text: string): boolean {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return false;
  }
  if (Array.isArray(body)) return false;
  const error = (body as { error?: { code?: unknown; message?: unknown } })?.error;
  if (!error) return false;
  const code = typeof error.code === "number" ? error.code : undefined;
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  if (code === -32600 && /origin|whitelist|forbidden/.test(message)) return true;
  if (/not on whitelist|invalid api key|unauthorized|forbidden|rate limit|quota/.test(message)) {
    return true;
  }
  return false;
}
