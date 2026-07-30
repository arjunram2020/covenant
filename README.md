# Covenant

Milestone-based crowdfunding with enforced accountability on Ethereum.

Donations stay locked in a smart contract escrow until campaign creators post public milestone evidence on-chain. Every donation, evidence update, and fund release is part of a permanent public record on-chain.

**Live app:** Update this link after assigning the Covenant deployment domain.
**Contract on Base Mainnet:** [`0x9CA2E453462b87584f5A4D15f5962a4f2174BCE9`](https://basescan.org/address/0x9CA2E453462b87584f5A4D15f5962a4f2174BCE9)
(deployed at block 48079282; the earlier approval-based deployment at
`0x000f8e23a416396184Cd97fF9dD750F3753F4C0c` is retired)

---

## The Problem

Traditional crowdfunding platforms like GoFundMe rely on trust. Once money moves, donors have no enforceable way to verify how it is used. Updates are optional. The platform holds the funds, not you.

Covenant changes the money flow:

1. **Donate** — ETH goes into smart contract escrow, not the creator's wallet
2. **Evidence** — Once donations cover the current milestone, the creator submits proof for it (URL, IPFS link, or text)
3. **Release** — Posting proof releases exactly that milestone's amount to the creator, in the same transaction

The rest stays locked for future milestones. A milestone can only release once the
campaign's own donations cover it, so no campaign can ever be paid out of another
campaign's escrow.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart contract | Solidity + Hardhat |
| Frontend | Next.js + TypeScript |
| Wallet connection | RainbowKit + wagmi + viem |
| Network | Base Mainnet (Ethereum L2) |
| Off-chain indexer | Node.js + Express + SQLite |
| Deployment | AWS EC2 + Nginx + PM2 |
| Base framework | Scaffold-ETH 2 |

The browser never talks to a third-party RPC directly — all JSON-RPC goes
through a same-origin proxy (`app/api/rpc/[chainId]`) so provider keys never
ship to the client and the app isn't at the mercy of an Origin allowlist.

---

## Project Structure

```
covenant/
├── packages/
│   ├── hardhat/              # Smart contract, tests, deploy scripts
│   │   ├── contracts/
│   │   │   └── Covenant.sol
│   │   ├── scripts/
│   │   │   └── seed.ts
│   │   └── test/
│   ├── indexer/              # Base event indexer, SQLite cache, HTTP API
│   │   └── README.md         # Indexer-specific run/deploy notes
│   ├── loadtest/             # Seed data + simulated actors/browser load
│   └── nextjs/               # Frontend app
│       ├── app/              # Next.js pages + API routes
│       │   └── api/
│       │       ├── rpc/[chainId]/       # Same-origin RPC proxy (see above)
│       │       ├── evidence/[locator]/  # Authenticated evidence write proxy
│       │       └── draft-milestones/    # Draft milestone helper endpoint
│       ├── components/       # UI components
│       ├── contracts/
│       │   └── deployedContracts.json   # Contract address + ABI
│       ├── hooks/            # Contract interaction hooks
│       └── scripts/
│           └── smoke-hydration.mjs      # CI hydration/CSP smoke test
├── docs/                     # AWS, security, SOC 2 readiness, and architecture docs
└── SECURITY.md               # Vulnerability reporting policy
```

---

## Local Development

**Prerequisites:** Node.js 18+, Yarn, MetaMask

```bash
# Install dependencies
yarn install

# Start a local blockchain
yarn chain

# Deploy the contract locally (separate terminal)
yarn deploy

# Start the frontend (separate terminal)
yarn start
```

Open [http://localhost:3000](http://localhost:3000) and connect MetaMask to `localhost:8545`.

---

## Learn and Deploy on AWS

- Start with [Learning AWS by deploying Covenant](docs/AWS_FOR_BEGINNERS.md) to
  understand what AWS hosts, what remains on Base, and why each service exists.
- Then follow [Deploying Covenant on AWS EC2](docs/AWS_DEPLOYMENT.md) for the
  exact EC2, PM2, Nginx, DNS, HTTPS, update, and troubleshooting steps.

The learning architecture runs the frontend and read-only event indexer on one
EC2 instance. Covenant's contract and escrowed funds remain on Base Mainnet.

---

## Deploy to Base Mainnet

1. Create `packages/hardhat/.env`:

```
DEPLOYER_PRIVATE_KEY=0x<your_key>
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/<your_key>
```

2. Deploy:

```bash
yarn deploy:base
```

3. Commit the updated `deployedContracts.json` and push. The EC2 deployment
   pulls committed code from this repository.

```bash
git add packages/nextjs/contracts/deployedContracts.json
git commit -m "deploy Covenant to Base Mainnet"
git push
```

---

## Environment Variables (Hosted Frontend)

Every `NEXT_PUBLIC_*` variable is inlined into the JS bundle shipped to every
visitor — never put a provider key in one. See
`packages/nextjs/.env.example` for the full, annotated list; the essentials:

| Variable | Where it lives | Value |
|---|---|---|
| `NEXT_PUBLIC_DEFAULT_CHAIN_ID` | client | `8453` for Base mainnet |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | client | from [cloud.walletconnect.com](https://cloud.walletconnect.com) |
| `NEXT_PUBLIC_INDEXER_URL` | client | public URL of the indexer API (see `packages/indexer`) |
| `BASE_RPC_URL` | **server only** | your dedicated Base RPC/provider URL — used by the `/api/rpc/[chainId]` proxy; leave unset to fall back to the keyless public RPC |
| `EVIDENCE_WRITE_TOKEN` | **server only** | must match `EVIDENCE_WRITE_TOKEN` in `packages/indexer/.env`; lets the evidence write proxy authenticate without exposing the token to the browser |

Leave the `NEXT_PUBLIC_*_RPC_URL` variables empty unless you have a genuinely
public, unrestricted RPC endpoint — a key-bearing URL in a `NEXT_PUBLIC_*`
var is visible to every visitor, and a provider Origin allowlist will break
the app on any host you didn't list (Vercel domain, phone, tunnel).

For AWS, create these in `packages/nextjs/.env.local` **before** building the
frontend, as shown in [AWS deployment Stage 7](docs/AWS_DEPLOYMENT.md#stage-7--configure-build-and-start-nextjs).

---

## How the Smart Contract Works

The `Covenant.sol` contract stores everything on-chain:

- **Campaigns** — title, description, goal, raised amount, milestone list, creator address
- **Milestones** — description, amount, evidence string, release status
- **Donations** — how much each donor gave to each campaign
- **Reputation** — each creator's history: campaigns completed, funds raised, milestones delivered

**Core functions:**

| Function | Who calls it | What it does |
|---|---|---|
| `createCampaign` | Creator | Creates a campaign with milestones |
| `donate` | Donor | Sends ETH into escrow |
| `submitEvidence` | Creator | Submits proof for the current (funded) milestone and releases its funds |

---

## Testing & CI

Every PR runs three gates (`.github/workflows/ci.yml`):

| Job | Checks |
|---|---|
| Typecheck | `yarn workspace @covenant/nextjs typecheck` |
| Contracts | Hardhat compile + test suite (incl. security tests) |
| Hydration smoke | Builds the production bundle with the real CSP, serves it, and loads every page in headless Chrome — catches "page renders but the app is dead" failures that typecheck/build can't see |

Any change to `packages/nextjs/next.config.js` headers or the CSP must be
verified locally first:

```bash
yarn workspace @covenant/nextjs smoke                        # against yarn start
yarn workspace @covenant/nextjs build && npx next start -p 3010 &
yarn workspace @covenant/nextjs smoke http://localhost:3010   # against a prod build
```

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability reporting process and
[docs/soc2/](docs/soc2/README.md) for Covenant's honest SOC 2 readiness status.
Deeper architecture and threat-model notes live under [docs/](docs/), including
`EVIDENCE_SECURITY_MODEL.md`, `CONTRACT_SECURITY_REVIEW.md`, and
`SECURE_CONFIGURATION.md`.

---

## Safety

This contract holds real ETH on Base Mainnet. For demos and testing, use small amounts only (0.0001–0.0005 ETH). The same contract architecture can be redeployed to Ethereum Mainnet without changes.
