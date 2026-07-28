"use client";

import { useCallback, useEffect } from "react";
import { erc20Abi, type Abi, type PublicClient } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import {
  getCovenant,
  getCovenantAbi,
  getDeploymentMode,
  getUsdcAddress,
  resolveReadChainId,
  supportsContractFunction,
} from "../lib/contract";
import type {
  ApprovalConfig,
  Campaign,
  CreatorStats,
  Milestone,
  ProofSubmission,
  ReviewDecision,
} from "../lib/types";

export function useReadChain() {
  const connectedChainId = useChainId();
  const chainId = resolveReadChainId(connectedChainId);
  const deployment = getCovenant(chainId);
  const connectedMode = getDeploymentMode(connectedChainId);
  const mode = getDeploymentMode(chainId);
  return {
    chainId,
    address: deployment?.address,
    abi: getCovenantAbi(chainId),
    deployed: !!deployment,
    mode,
    connectedMode,
    writeEnabled: mode === "active",
    connectedChainId,
  };
}

export function useCampaignCount() {
  const { address, abi, chainId } = useReadChain();
  const q = useReadContract({
    address,
    abi,
    functionName: "campaignCount",
    chainId,
    query: { enabled: !!address },
  });
  return { ...q, count: (q.data as bigint | undefined) ?? 0n };
}

export function useAllCampaigns() {
  const { address, abi, chainId } = useReadChain();
  const q = useReadContract({
    address,
    abi,
    functionName: "getAllCampaigns",
    chainId,
    query: { enabled: !!address },
  });
  return { ...q, campaigns: (q.data as Campaign[] | undefined) ?? [] };
}

export function useCampaign(id?: bigint) {
  const { address, abi, chainId } = useReadChain();
  const q = useReadContract({
    address,
    abi,
    functionName: "getCampaign",
    args: id !== undefined ? [id] : undefined,
    chainId,
    query: { enabled: !!address && id !== undefined },
  });
  return { ...q, campaign: q.data as Campaign | undefined };
}

export function useMilestones(id?: bigint) {
  const { address, abi, chainId } = useReadChain();
  const q = useReadContract({
    address,
    abi,
    functionName: "getMilestones",
    args: id !== undefined ? [id] : undefined,
    chainId,
    query: { enabled: !!address && id !== undefined },
  });
  return { ...q, milestones: (q.data as Milestone[] | undefined) ?? [] };
}

export function useTrustScore(creator?: `0x${string}`) {
  const { address, abi, chainId } = useReadChain();
  const q = useReadContract({
    address,
    abi,
    functionName: "trustScore",
    args: creator ? [creator] : undefined,
    chainId,
    query: { enabled: !!address && !!creator },
  });
  return { ...q, score: Number((q.data as bigint | undefined) ?? 0n) };
}

export function useCreatorStats(creator?: `0x${string}`) {
  const { address, abi, chainId } = useReadChain();
  const q = useReadContract({
    address,
    abi,
    functionName: "getCreatorStats",
    args: creator ? [creator] : undefined,
    chainId,
    query: { enabled: !!address && !!creator },
  });
  return { ...q, stats: q.data as CreatorStats | undefined };
}

export function useMyDonation(id?: bigint, donor?: `0x${string}`) {
  const { address, abi, chainId } = useReadChain();
  const q = useReadContract({
    address,
    abi,
    functionName: "getDonation",
    args: id !== undefined && donor ? [id, donor] : undefined,
    chainId,
    query: { enabled: !!address && id !== undefined && !!donor },
  });
  return { ...q, donation: (q.data as bigint | undefined) ?? 0n };
}

/**
 * Anti-spam state for a creator address: whether the platform has approved
 * them (lifting limits), and when they last created a campaign (cooldown).
 * Both read as undefined against pre-limit deployments — treat that as
 * unrestricted in the UI; the contract is the actual enforcer.
 */
export function useCreatorAccess(creator?: `0x${string}`) {
  const { address, abi, chainId } = useReadChain();
  const supportsApprovedCreators = supportsContractFunction(chainId, "approvedCreators");
  const supportsLastCampaignAt = supportsContractFunction(chainId, "lastCampaignAt");
  const approvedQ = useReadContract({
    address,
    abi,
    functionName: "approvedCreators",
    args: creator ? [creator] : undefined,
    chainId,
    query: { enabled: !!address && !!creator && supportsApprovedCreators },
  });
  const lastQ = useReadContract({
    address,
    abi,
    functionName: "lastCampaignAt",
    args: creator ? [creator] : undefined,
    chainId,
    query: { enabled: !!address && !!creator && supportsLastCampaignAt },
  });
  return {
    approved: supportsApprovedCreators ? (approvedQ.data as boolean | undefined) : undefined,
    lastCampaignAt: supportsLastCampaignAt ? (lastQ.data as bigint | undefined) : undefined,
  };
}

/** The campaign's approval authority configuration. */
export function useApprovalConfig(id?: bigint) {
  const { address, abi, chainId } = useReadChain();
  const q = useReadContract({
    address,
    abi,
    functionName: "getApprovalConfig",
    args: id !== undefined ? [id] : undefined,
    chainId,
    query: { enabled: !!address && id !== undefined },
  });
  return { ...q, config: q.data as ApprovalConfig | undefined };
}

/** All proof packages submitted for one milestone (oldest first). */
export function useSubmissions(id?: bigint, milestoneIndex?: number) {
  const { address, abi, chainId } = useReadChain();
  const q = useReadContract({
    address,
    abi,
    functionName: "getSubmissions",
    args:
      id !== undefined && milestoneIndex !== undefined
        ? [id, BigInt(milestoneIndex)]
        : undefined,
    chainId,
    query: { enabled: !!address && id !== undefined && milestoneIndex !== undefined },
  });
  return { ...q, submissions: (q.data as ProofSubmission[] | undefined) ?? [] };
}

/** Every review decision recorded for one milestone (oldest first). */
export function useReviews(id?: bigint, milestoneIndex?: number) {
  const { address, abi, chainId } = useReadChain();
  const q = useReadContract({
    address,
    abi,
    functionName: "getReviews",
    args:
      id !== undefined && milestoneIndex !== undefined
        ? [id, BigInt(milestoneIndex)]
        : undefined,
    chainId,
    query: { enabled: !!address && id !== undefined && milestoneIndex !== undefined },
  });
  return { ...q, reviews: (q.data as ReviewDecision[] | undefined) ?? [] };
}

/** Whether an account currently holds review authority for a campaign. */
export function useIsReviewer(id?: bigint, account?: `0x${string}`) {
  const { address, abi, chainId } = useReadChain();
  const q = useReadContract({
    address,
    abi,
    functionName: "isReviewer",
    args: id !== undefined && account ? [id, account] : undefined,
    chainId,
    query: { enabled: !!address && id !== undefined && !!account },
  });
  return { ...q, isReviewer: (q.data as boolean | undefined) ?? false };
}

/** A donor's claimable USDC refund (0 unless the campaign was cancelled). */
export function useRefund(id?: bigint, donor?: `0x${string}`) {
  const { address, abi, chainId } = useReadChain();
  const q = useReadContract({
    address,
    abi,
    functionName: "refundOf",
    args: id !== undefined && donor ? [id, donor] : undefined,
    chainId,
    query: { enabled: !!address && id !== undefined && !!donor },
  });
  return { ...q, refund: (q.data as bigint | undefined) ?? 0n };
}

/** True when the current milestone blew its deadline and anyone may fail the campaign. */
export function useMilestoneFailed(id?: bigint) {
  const { address, abi, chainId } = useReadChain();
  const q = useReadContract({
    address,
    abi,
    functionName: "milestoneFailed",
    args: id !== undefined ? [id] : undefined,
    chainId,
    query: { enabled: !!address && id !== undefined, refetchInterval: 30_000 },
  });
  return { ...q, failed: (q.data as boolean | undefined) ?? false };
}

/**
 * Pre-compute gas and EIP-1559 fee caps through the app's own transport (the
 * same-origin /api/rpc proxy) and hand the wallet a fully-specified
 * transaction.
 *
 * Why: MetaMask prepares transactions through its own built-in RPC (Infura,
 * for Base). When that connection is blocked in the user's browser (adblock
 * lists, VPN, an Infura hiccup) every write dies with
 * "RPC 0x2105 Infura eth_getBlockByNumber: Failed to fetch" before the
 * confirmation sheet even opens — even though the app's own RPC path is fine.
 * Supplying gas + fee caps removes those wallet-side estimation calls from
 * the critical path. (Broadcast still goes through the wallet's RPC; nothing
 * app-side can change that.)
 *
 * Failure semantics matter here:
 *  - A REVERT during estimation means the transaction would fail on-chain —
 *    rethrow it, with the real revert reason, instead of letting the user pay
 *    for a doomed transaction.
 *  - A NETWORK error during estimation must not become a new single point of
 *    failure — return {} and let the wallet estimate as before.
 */
async function prepareWriteGas(
  publicClient: PublicClient | undefined,
  call: {
    account?: `0x${string}`;
    address: `0x${string}`;
    abi: Abi;
    functionName: string;
    args: unknown[];
  },
): Promise<{ gas?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }> {
  if (!publicClient || !call.account) return {};

  const params: { gas?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } = {};
  try {
    const gas = await publicClient.estimateContractGas(call as never);
    // Estimation runs against the latest block; state can shift before
    // inclusion, so pad 20% rather than sending an exact-fit limit.
    params.gas = (gas * 120n) / 100n;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/revert|execution reverted/i.test(msg)) throw err;
    return {};
  }
  try {
    const fees = await publicClient.estimateFeesPerGas();
    params.maxFeePerGas = fees.maxFeePerGas;
    params.maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
  } catch {
    // Fee caps are optional — with a gas limit already set, the wallet can
    // still price the transaction on its own.
  }
  return params;
}

export type CovenantFn =
  | "createCampaign"
  | "donate"
  | "submitProof"
  | "reviewProof"
  | "cancelCampaign"
  | "failCampaign"
  | "claimRefund";

export function useCovenantWrite() {
  const { address, abi, chainId, writeEnabled } = useReadChain();
  const connectedChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { address: account } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const queryClient = useQueryClient();
  const { writeContractAsync, data: hash, isPending, error, reset } = useWriteContract();
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash, chainId });

  const execute = useCallback(
    async (functionName: CovenantFn, args: unknown[]) => {
      if (!writeEnabled) {
        throw new Error(
          "This network only has a legacy ETH Covenant deployment. Redeploy the USDC contract before sending write transactions.",
        );
      }
      if (!address) throw new Error("Covenant is not deployed on this network.");
      if (connectedChainId !== chainId) {
        await switchChainAsync({ chainId });
      }
      const gasParams = await prepareWriteGas(publicClient, {
        account,
        address,
        abi: abi as Abi,
        functionName,
        args,
      });
      const txHash = await writeContractAsync({
        address,
        abi,
        functionName,
        args,
        chainId,
        ...gasParams,
      } as any);
      return txHash;
    },
    [account, address, abi, chainId, connectedChainId, publicClient, switchChainAsync, writeContractAsync, writeEnabled],
  );

  const refresh = useCallback(() => {
    queryClient.invalidateQueries();
  }, [queryClient]);

  return {
    execute,
    refresh,
    hash,
    isPending,
    isConfirming,
    isConfirmed,
    error: error ?? receiptError,
    reset,
  };
}

/**
 * USDC state for a wallet: balance, allowance granted to the Covenant escrow,
 * and an approve() writer. Donating is a two-step flow — approve, then donate.
 */
export function useUsdc(owner?: `0x${string}`) {
  const { address: covenantAddress, chainId, writeEnabled } = useReadChain();
  const usdcAddress = getUsdcAddress(chainId);
  const connectedChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId });

  const allowanceQ = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: owner && covenantAddress ? [owner, covenantAddress] : undefined,
    chainId,
    query: { enabled: writeEnabled && !!usdcAddress && !!owner && !!covenantAddress },
  });

  const balanceQ = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: owner ? [owner] : undefined,
    chainId,
    query: { enabled: writeEnabled && !!usdcAddress && !!owner },
  });

  const { writeContractAsync, data: hash, isPending, error, reset } = useWriteContract();
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash, chainId });

  // Once an approval confirms, the allowance read is stale — refetch it.
  useEffect(() => {
    if (isConfirmed) {
      allowanceQ.refetch();
      balanceQ.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed]);

  const approve = useCallback(
    async (amount: bigint) => {
      if (!writeEnabled) {
        throw new Error(
          "This network only has a legacy ETH Covenant deployment. Redeploy the USDC contract before approving donations.",
        );
      }
      if (!usdcAddress || !covenantAddress) {
        throw new Error("USDC is not configured on this network.");
      }
      if (connectedChainId !== chainId) {
        await switchChainAsync({ chainId });
      }
      const gasParams = await prepareWriteGas(publicClient, {
        account: owner,
        address: usdcAddress,
        abi: erc20Abi as Abi,
        functionName: "approve",
        args: [covenantAddress, amount],
      });
      return writeContractAsync({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [covenantAddress, amount],
        chainId,
        ...gasParams,
      });
    },
    [usdcAddress, covenantAddress, chainId, connectedChainId, owner, publicClient, switchChainAsync, writeContractAsync, writeEnabled],
  );

  return {
    usdcAddress,
    allowance: allowanceQ.data as bigint | undefined,
    balance: balanceQ.data as bigint | undefined,
    refetchAllowance: allowanceQ.refetch,
    approve,
    approveHash: hash,
    isApprovePending: isPending,
    isApproveConfirming: isConfirming,
    isApproveConfirmed: isConfirmed,
    approveError: error ?? receiptError,
    resetApprove: reset,
  };
}
