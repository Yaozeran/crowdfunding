"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserProvider, Contract, formatEther, isAddress } from "ethers";
import { ABI, contributionWei, friendlyError, shortAddress } from "@/lib/campaign";

import Link from "next/link";
import { connectWallet, type Wallet } from "@/lib/wallet";

declare global { interface Window { ethereum?: Wallet } }
type Campaign = { beneficiary: string; goal: bigint; raised: bigint; deadline: number; ended: boolean; withdrawn: boolean; contribution: bigint };
type Transaction = { hash: string; action: string; value_wei: string; status: string; created_at: string };
const address = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";
const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "11155111");
const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";
const configured = isAddress(address) && address !== "0x0000000000000000000000000000000000000000" && Number.isSafeInteger(chainId) && chainId > 0;
const network = chainId === 11155111 ? "Sepolia" : `Chain ${chainId}`;
const storageKey = `crowdfund:${chainId}:${address}`;

async function apiRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${api}${path}`, { ...init, signal: AbortSignal.timeout(12000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Transaction service is unavailable.");
  return body;
}
function pendingHashes(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(stored) ? stored.filter((hash): hash is string => typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash)).slice(-100) : [];
  } catch { return []; }
}
async function saveHash(hash: string) {
  return apiRequest("/api/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hash }) });
}

export default function Home() {
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
  return (
    <div className="shell">
      <header><Link className="brand" href="/" aria-label="Common Ground home"><span className="brand-icon">↗</span> Common Ground</Link><div className="wallet"><span className="network"><i />{network} testnet</span><button onClick={connect} disabled={busy}>{account ? shortAddress(account) : "Connect wallet"}</button></div></header>
      <main>
        <div className="eyebrow">SMALL CONTRIBUTIONS. SHARED POSSIBILITIES.</div>
        <h1>A little from each of us.<br /><span>A lot for all of us.</span></h1>
        <p className="intro">Help build a community learning space. Fund it together, follow every contribution, and let the smart contract hold everyone to the same promise.</p>
        {!configured && <div className="notice">Setup required: deploy Crowdfund.sol, then set the contract address in the web and server environment files. No campaign data is simulated.</div>}
        <div className="campaign-grid">
          <section className="story card">
            <div className="illustration" aria-hidden="true"><div className="sun" /><div className="building"><div className="roof" /><div className="windows"><i /><i /><i /></div><div className="door" /></div><div className="ground" /><span className="art-label">SPACE TO GROW</span></div>
            <div className="story-body"><span className="tag">EDUCATION & COMMUNITY</span><h2>The neighborhood learning room</h2><p>A welcoming place to read, learn, and share ideas. This demonstration campaign brings transparent, all-or-nothing funding to a community project.</p><div className="promise"><span>◇</span><p><strong>A goal with a guarantee</strong><br />After the deadline, the beneficiary can withdraw if the goal is met. Otherwise, each contributor can claim their ETH back. Network fees are not refundable.</p></div></div>
          </section>
          <section className="funding card" aria-labelledby="fund-title"><div className="section-top"><span className="tag">THE CAMPAIGN</span><span className="status">{status}</span></div><h2 id="fund-title">Make room for possibility.</h2><div className="raised">{campaign ? formatEther(campaign.raised) : "—"}<span> ETH raised</span></div><div className="progress" role="progressbar" aria-label="Funding progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${progress}%` }} /></div><div className="metrics"><span>Goal <strong>{campaign ? formatEther(campaign.goal) : "—"} ETH</strong></span><span>{progress}% funded</span></div><dl><div><dt>Deadline</dt><dd>{campaign ? new Date(campaign.deadline * 1000).toLocaleString() : "Connect wallet to view"}</dd></div><div><dt>Your contribution</dt><dd>{campaign ? formatEther(campaign.contribution) : "—"} ETH</dd></div></dl>
            <form onSubmit={(e) => { e.preventDefault(); void transact("contribute"); }}><label htmlFor="amount">Your contribution</label><div className="amount-input"><input id="amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.01" required disabled={busy} /><span>ETH</span></div><div className="presets">{["0.01", "0.05", "0.1"].map((value) => <button type="button" key={value} disabled={busy} onClick={() => setAmount(value)} aria-pressed={amount === value}>{value} ETH</button>)}</div>{account ? <button className="primary" disabled={busy || !campaign || campaign.ended} type="submit">{busy ? "Transaction in progress…" : campaign?.ended ? "Campaign closed" : "Contribute to the campaign ↗"}</button> : <button type="button" className="primary" disabled={busy} onClick={connect}>{busy ? "Connecting…" : "Connect wallet to contribute ↗"}</button>}</form>
            {campaign?.ended && !funded && campaign.contribution > BigInt(0) && <button className="secondary" disabled={busy} onClick={() => transact("refund")}>Claim your refund</button>}
            {campaign?.ended && funded && !campaign.withdrawn && campaign.beneficiary.toLowerCase() === account.toLowerCase() && <button className="secondary" disabled={busy} onClick={() => transact("withdraw")}>Withdraw campaign funds</button>}
            <p className="fine-print">Test ETH only · MetaMask signs every transaction<br />Funds go directly to the campaign contract.</p>
          </section>
        </div>
        <div aria-live="polite">{message && <p className="notice">{message}</p>}{submittedHash && <p className="hash">Transaction: {chainId === 11155111 ? <a href={`https://sepolia.etherscan.io/tx/${submittedHash}`} target="_blank" rel="noreferrer">{submittedHash} ↗</a> : submittedHash}</p>}</div>{error && <p className="notice error" role="alert">{error}</p>}
        <section className="history card"><div className="history-heading"><div><span className="tag">EVERY CONTRIBUTION COUNTS</span><h2>Your transaction history</h2></div><button disabled={!account || busy} onClick={() => refreshHistory(account)}>Refresh history ↻</button></div>{historyError && <p className="notice" role="status">{historyError}</p>}{transactions.length ? <div className="table-wrap"><table><thead><tr><th>Transaction</th><th>Action</th><th>Sent ETH</th><th>Status</th><th>Recorded</th></tr></thead><tbody>{transactions.map((tx) => <tr key={tx.hash}><td>{chainId === 11155111 ? <a href={`https://sepolia.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noreferrer">{shortAddress(tx.hash)} ↗</a> : <span title={tx.hash}>{shortAddress(tx.hash)}</span>}</td><td>{tx.action}</td><td>{formatEther(tx.value_wei)}</td><td><span className={`tx-status ${tx.status}`}>{tx.status}</span></td><td>{new Date(tx.created_at).toLocaleString()}</td></tr>)}</tbody></table><p className="fine-print">Most recent 100 indexed transactions. Sent ETH excludes gas and incoming refund or withdrawal amounts.</p></div> : <div className="empty"><span>↗</span><h3>{account ? "Your first contribution starts here" : "Your wallet. Your impact."}</h3><p>{account ? "Transactions recorded for this wallet will appear here." : "Connect your wallet to see your campaign activity."}</p></div>}</section>
        <footer><span>Built on shared trust. Verified on-chain.</span><span title={address}>{configured ? `Contract ${shortAddress(address)}` : "Contract not configured"}</span></footer>
      </main>
    </div>
  );
}
