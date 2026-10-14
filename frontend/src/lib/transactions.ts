import { api, storageKey } from "./config";

export async function apiRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${api}${path}`, { ...init, signal: AbortSignal.timeout(12000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Transaction service is unavailable.");
  return body;
}
export function pendingHashes(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(stored) ? stored.filter((hash): hash is string => typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash)).slice(-100) : [];
  } catch { return []; }
}
export async function saveHash(hash: string) {
  return apiRequest("/api/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hash }) });
}

