export type Campaign = { beneficiary: string; goal: bigint; raised: bigint; deadline: number; ended: boolean; withdrawn: boolean; contribution: bigint };
export type Transaction = { hash: string; action: string; value_wei: string; status: string; created_at: string };
