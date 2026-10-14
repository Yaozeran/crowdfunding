import { parseEther } from "ethers";

export const ABI = [
  "function beneficiary() view returns (address)",
  "function goal() view returns (uint256)",
  "function deadline() view returns (uint256)",
  "function totalRaised() view returns (uint256)",
  "function withdrawn() view returns (bool)",
  "function contributions(address) view returns (uint256)",
  "function contribute() payable",
  "function refund()",
  "function withdraw()",
];
export function contributionWei(value: string): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value)) throw new Error("Enter an ETH amount with up to 18 decimal places.");
  const wei = parseEther(value);
  if (wei <= BigInt(0)) throw new Error("Contribution must be greater than zero.");
  return wei;
}
export function friendlyError(error: unknown): string {
  const e = error as { code?: string | number; shortMessage?: string; message?: string };
  if (e?.code === 4001 || e?.code === "ACTION_REJECTED") return "Request declined in your wallet. You can try again.";
  return e?.shortMessage || e?.message || "Something went wrong. Please try again.";
}
export function shortAddress(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
