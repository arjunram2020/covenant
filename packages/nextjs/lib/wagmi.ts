import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { fallback, http } from "wagmi";
import { base, baseSepolia, hardhat } from "wagmi/chains";
import type { Chain } from "viem";
import { defaultChainId } from "./contract";

// A placeholder is fine for local development with an injected wallet (MetaMask).
// Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to enable WalletConnect / mobile wallets
// (required for a second phone/laptop to connect to a hosted demo).
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "covenant_local_demo";

// Every network Covenant can target. The actual default is chosen below.
// Ethereum mainnet is deliberately excluded: Covenant only deploys to Base,
// and offering chain 1 in the wallet lets users preview/send transactions at
// L1 gas prices (~100x Base). ENS lookups use a standalone read client instead.
const ALL_CHAINS: Chain[] = [base, baseSepolia, hardhat];

// Put the configured default chain (NEXT_PUBLIC_DEFAULT_CHAIN_ID, e.g. 8453 = Base)
// first so the wallet modal and RainbowKit's initial chain prefer it. Use the
// env value directly — contract.ts's defaultChainId can fall back to localhost
// when the target chain's deployment is stale, and the wallet must never be
// steered to a localhost chain on a hosted site.
const preferredChainId = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID) || defaultChainId;
const ordered = [
  ...ALL_CHAINS.filter((c) => c.id === preferredChainId),
  ...ALL_CHAINS.filter((c) => c.id !== preferredChainId),
] as [Chain, ...Chain[]];

/**
 * Per-chain RPC endpoints, in priority order.
 *
 * Every wagmi read, gas estimate, transaction broadcast and receipt poll goes
 * through these. A single dead endpoint here therefore looks exactly like "the
 * wallet is broken": the page loads, the wallet connects, and then nothing
 * resolves. Two rules follow from that:
 *
 *  1. Prefer the same-origin proxy (app/api/rpc/[chainId]). It keeps the
 *     provider key server-side and, because the browser only ever calls its own
 *     origin, no provider Origin whitelist can lock a deploy out. Pointing the
 *     browser straight at a key-bearing provider URL is what broke every hosted
 *     origin previously — the key was restricted to localhost, so Vercel, the
 *     EC2 box and phones all got `Origin ... is not on whitelist` on every call.
 *  2. Always keep a keyless public RPC behind it. viem's `fallback` moves to the
 *     next endpoint on error, so a rate-limited or misconfigured primary
 *     degrades instead of taking the app down.
 *
 * NEXT_PUBLIC_*_RPC_URL is still honoured for operators who have a genuinely
 * public, unrestricted endpoint, but it is no longer required and no longer the
 * only path to the chain.
 */
const PUBLIC_FALLBACK: Record<number, string> = {
  [base.id]: "https://mainnet.base.org",
  [baseSepolia.id]: "https://sepolia.base.org",
};

// Chains the server-side proxy route knows how to forward. Localhost/hardhat is
// reached directly — proxying a developer's own node adds a hop for nothing.
const PROXIED_CHAIN_IDS = new Set<number>([base.id, baseSepolia.id]);

const RPC_OVERRIDES: Record<number, string | undefined> = {
  [base.id]: process.env.NEXT_PUBLIC_BASE_RPC_URL,
  [baseSepolia.id]: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL,
};

function transportFor(chain: Chain) {
  const urls: string[] = [];

  // Relative URLs only resolve in the browser; during SSR there is no origin to
  // resolve them against, so the proxy is browser-only and the server falls
  // straight through to the public endpoint.
  if (typeof window !== "undefined" && PROXIED_CHAIN_IDS.has(chain.id)) {
    urls.push(`/api/rpc/${chain.id}`);
  }

  const override = RPC_OVERRIDES[chain.id];
  if (override) urls.push(override);

  const publicUrl = PUBLIC_FALLBACK[chain.id];
  if (publicUrl) urls.push(publicUrl);

  // Local chains (and anything without a known endpoint) use viem's default for
  // the chain, which is what http() with no argument resolves to.
  if (urls.length === 0) return http();

  return fallback(urls.map((url) => http(url)));
}

const transports = Object.fromEntries(ALL_CHAINS.map((c) => [c.id, transportFor(c)]));

export const config = getDefaultConfig({
  appName: "Covenant",
  projectId,
  chains: ordered,
  transports,
  ssr: true,
});
