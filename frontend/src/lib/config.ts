import { isAddress } from "ethers";

export const address = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";
export const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "11155111");
export const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";
export const configured = isAddress(address) && address !== "0x0000000000000000000000000000000000000000" && Number.isSafeInteger(chainId) && chainId > 0;
export const network = chainId === 11155111 ? "Sepolia" : `Chain ${chainId}`;
export const storageKey = `crowdfund:${chainId}:${address}`;

