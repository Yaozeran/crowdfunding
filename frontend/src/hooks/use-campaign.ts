"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserProvider, Contract } from "ethers";
import { ABI, contributionWei, friendlyError } from "@/lib/campaign";
import { connectWallet, type Wallet } from "@/lib/wallet";
import type { Campaign, Transaction } from "@/lib/types";
import { address, chainId, configured, network, storageKey } from "@/lib/config";
import { apiRequest, pendingHashes, saveHash } from "@/lib/transactions";

declare global { interface Window { ethereum?: Wallet } }

export function useCampaign() {
  const session = useRef(0);
  const [account, setAccount] = useState("");
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [amount, setAmount] = useState("0.01");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [submittedHash, setSubmittedHash] = useState("");

  const refresh = useCallback(async (wallet: string) => {
    if (!window.ethereum || !configured) return;
    const version = session.current;
    const provider = new BrowserProvider(window.ethereum);
    if (Number((await provider.getNetwork()).chainId) !== chainId) throw new Error(`Switch your wallet to ${network}.`);
    const contract = new Contract(address, ABI, provider);
    const [beneficiary, goal, raised, deadline, withdrawn, contribution, block] = await Promise.all([
      contract.beneficiary(), contract.goal(), contract.totalRaised(), contract.deadline(),
      contract.withdrawn(), contract.contributions(wallet), provider.getBlock("latest"),
    ]);
    if (version !== session.current) return;
    setCampaign({ beneficiary, goal, raised, deadline: Number(deadline), ended: (block?.timestamp || 0) >= Number(deadline), withdrawn, contribution });
  }, []);

  const refreshHistory = useCallback(async (wallet: string) => {
    const version = session.current;
    try {
      const old = await apiRequest(`/api/transactions?wallet=${wallet}`);
      const hashes = [...new Set([...pendingHashes(), ...old.transactions.filter((tx: Transaction) => tx.status === "pending").map((tx: Transaction) => tx.hash)])];
      const unresolved: string[] = [];
      for (const hash of hashes) {
        try { const tx = await saveHash(hash); if (tx.status === "pending") unresolved.push(hash); }
        catch { unresolved.push(hash); }
      }
      const processed = new Set(hashes);
      const remaining = [...new Set([...pendingHashes().filter(hash => !processed.has(hash)), ...unresolved])];
      try { localStorage.setItem(storageKey, JSON.stringify(remaining)); } catch { /* History still works without browser storage. */ }
      const data = await apiRequest(`/api/transactions?wallet=${wallet}`);
      if (version !== session.current) return;
      setTransactions(data.transactions);
      setHistoryError(unresolved.length ? "Some transactions are awaiting confirmation or indexing. Retrying automatically." : "");
    } catch { if (version !== session.current) return; setHistoryError("History service unavailable. Submitted transactions remain on-chain; indexing will retry automatically."); }
  }, []);

  useEffect(() => {
    const wallet = window.ethereum;
    const reset = () => { session.current += 1; setHistoryError(""); setSubmittedHash(""); setAccount(""); setCampaign(null); setTransactions([]); setError(""); setMessage("Wallet changed. Connect again to refresh your campaign."); };
    wallet?.on?.("accountsChanged", reset);
    wallet?.on?.("chainChanged", reset);
    return () => { wallet?.removeListener?.("accountsChanged", reset); wallet?.removeListener?.("chainChanged", reset); };
  }, []);

  useEffect(() => {
    if (!account) return;
    let active = true;
    let running = false;
    const update = async () => {
      if (running) return;
      running = true;
      try { await refresh(account); } catch (e) { if (active) { setCampaign(null); setError(friendlyError(e)); } }
      if (active) await refreshHistory(account);
      running = false;
    };
    void update();
    const timer = setInterval(update, 12000);
    return () => { active = false; clearInterval(timer); };
  }, [account, refresh, refreshHistory]);

  async function connect() {
    setError(""); setMessage(""); setBusy(true);
    try {
      if (!window.ethereum) throw new Error("Install MetaMask to connect your wallet, then reload this page.");
      if (!configured) throw new Error("Deploy the campaign and configure its contract address first. See README.md.");
      const wallet = await connectWallet(window.ethereum, chainId);
      const version = session.current;
      await refresh(wallet);
      if (version === session.current) setAccount(wallet);
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function transact(action: "contribute" | "refund" | "withdraw") {
    setError(""); setBusy(true); setSubmittedHash("");
    let broadcast = false;
    const version = session.current;
    try {
      if (!window.ethereum || !account) throw new Error("Connect your wallet first.");
      const value = action === "contribute" ? contributionWei(amount) : undefined;
      const provider = new BrowserProvider(window.ethereum);
      if (Number((await provider.getNetwork()).chainId) !== chainId) throw new Error(`Switch your wallet to ${network}.`);
      const signer = await provider.getSigner();
      if ((await signer.getAddress()).toLowerCase() !== account.toLowerCase()) throw new Error("Wallet changed. Connect again.");
      if (await provider.getCode(address) === "0x") throw new Error("No campaign contract exists at the configured address.");
      const contract = new Contract(address, ABI, signer);
      setMessage("Confirm the transaction in MetaMask.");
      const tx = action === "contribute" ? await contract.contribute({ value }) : await contract[action]();
      broadcast = true;
      setSubmittedHash(tx.hash);
      setMessage("Transaction submitted. Waiting for a block confirmation…");
      try { localStorage.setItem(storageKey, JSON.stringify([...new Set([...pendingHashes(), tx.hash])])); }
      catch { setHistoryError("Browser storage unavailable. Keep the transaction hash to index it later."); }
      try { await saveHash(tx.hash); } catch { setHistoryError("Transaction submitted; history indexing will retry automatically."); }
      const receipt = await tx.wait(1, 120000);
      if (!receipt || receipt.status !== 1) throw new Error("Transaction reverted on-chain.");
      setMessage("Transaction confirmed on-chain.");
      if (version === session.current) await Promise.all([refresh(account), refreshHistory(account)]);
    } catch (e) {
      setError(friendlyError(e));
      setMessage(broadcast ? "A transaction was submitted. Check its hash or history before trying again." : "");
    } finally { setBusy(false); }
  }

  const progress = campaign ? Math.min(100, Number(campaign.raised * BigInt(10000) / campaign.goal) / 100) : 0;
  const funded = campaign ? campaign.raised >= campaign.goal : false;
  const status = !campaign ? "Connect to view" : campaign.withdrawn ? "Funds withdrawn" : campaign.ended ? funded ? "Goal reached" : "Refunds available" : "Accepting contributions";
  return { account, campaign, transactions, amount, setAmount, busy, message, error, historyError, submittedHash, connect, transact, refreshHistory, progress, funded, status };
}

export type CampaignState = ReturnType<typeof useCampaign>;
