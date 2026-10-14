"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, Contract, ContractFactory, formatEther } from "ethers";
import { api, chainId, network } from "@/lib/config";
import { connectWallet, type Wallet } from "@/lib/wallet";
import { contributionWei, friendlyError, shortAddress } from "@/lib/campaign";
import artifact from "@/lib/contract-artifact.json";

type Campaign = { address: string; creator: string; title: string; description: string; category: string; image: string; goal: string; raised: string; deadline: number; status: string; cancelled: number; withdrawn: number; flagged: number; hidden: number };
type Record = { hash: string; wallet: string; action: string; value_wei: string; status: string; created_at: string };
function progress(c: Campaign) { return Math.min(100, Number(BigInt(c.raised) * BigInt(10000) / BigInt(c.goal)) / 100); }
const empty = { title: "", description: "", category: "Community", image: "", target: "", deadline: "" };
const wallet = () => (window as unknown as { ethereum?: Wallet }).ethereum;

export default function Home() {
  const [account, setAccount] = useState("");
  const [token, setToken] = useState("");
  const [admin, setAdmin] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [records, setRecords] = useState<Record[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("created_at");
  const [form, setForm] = useState(empty);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("0.01");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [fee, setFee] = useState("");
  const [paused, setPaused] = useState(false);
  const [mine, setMine] = useState(false);
  const [moderating, setModerating] = useState(false);
  const [deployment, setDeployment] = useState("");

  const request = useCallback(async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${api}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Request failed");
    return result;
  }, [token]);
  const load = useCallback(async () => {
    const result = await request(moderating && admin ? "/api/admin/campaigns" : `/api/campaigns?q=${encodeURIComponent(q)}&status=${status}&sort=${sort}`);
    setCampaigns(result.campaigns);
    const settings = await request("/api/settings"); setPaused(settings.creation_paused);
  }, [request, q, status, sort, moderating, admin]);
  useEffect(() => {
    const timer = setTimeout(() => { load().catch(e => setError(friendlyError(e))); }, 200);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    let stopped = false;
    const sync = async () => {
      const catalog = await request("/api/campaigns");
      for (const campaign of catalog.campaigns) {
        if (stopped) return;
        await request(`/api/campaigns/${campaign.address}/sync`, "POST");
      }
      if (!stopped) await load();
    };
    const timer = setTimeout(() => { sync().catch(e => setError(friendlyError(e))); }, 500);
    const interval = setInterval(() => { sync().catch(e => setError(friendlyError(e))); }, 30000);
    return () => { stopped = true; clearTimeout(timer); clearInterval(interval); };
  }, [request, load]);
  useEffect(() => {
    const injected = wallet();
    const reset = () => { setAccount(""); setToken(""); setAdmin(false); setModerating(false); setRecords([]); setMessage("Wallet changed. Connect and sign in again."); };
    injected?.on?.("accountsChanged", reset); injected?.on?.("chainChanged", reset);
    return () => { injected?.removeListener?.("accountsChanged", reset); injected?.removeListener?.("chainChanged", reset); };
  }, []);
  async function run(fn: () => Promise<void>) { setBusy(true); setError(""); try { await fn(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); } }
  async function signer() {
    const current = await connectWallet(wallet(), chainId);
    if (account && current.toLowerCase() !== account.toLowerCase()) throw new Error("Wallet changed. Sign in again.");
    return new BrowserProvider(wallet()!).getSigner();
  }
  async function connect() {
    const address = await connectWallet(wallet(), chainId); setAccount(address);
    const challenge = await request("/api/auth/challenge", "POST", { wallet: address });
    const signature = await (await signer()).signMessage(challenge.message);
    const session = await request("/api/auth/verify", "POST", { nonce: challenge.nonce, signature });
    setToken(session.token); setAdmin(session.admin); setMessage("Signed in for one hour.");
  }
  async function disconnect() { if (token) await request("/api/auth/logout", "POST"); setToken(""); setAccount(""); setAdmin(false); setModerating(false); setRecords([]); }
  async function open(c: Campaign) {
    setSelected(c); setFee("");
    const sync = await request(`/api/campaigns/${c.address}/sync`, "POST");
    if (sync.indexed_block < sync.latest_block) setMessage("History indexing is in progress. Refresh to load the next batch.");
    const catalog = await request("/api/campaigns");
    const fresh = catalog.campaigns.find((x: Campaign) => x.address === c.address); if (fresh) setSelected(fresh);
    const history = await request(`/api/transactions?campaign=${c.address}${mine && account ? `&wallet=${account}` : ""}`); setRecords(history.transactions);
    await load();
  }
  async function save() {
    if (!token) throw new Error("Connect and sign in first.");
    if (!form.title.trim() || !form.description.trim() || !form.category.trim() || !/^https:\/\//.test(form.image)) throw new Error("Provide a title, description, category and HTTPS image URL.");
    if (editing && selected) { await request(`/api/campaigns/${selected.address}`, "PATCH", form); setEditing(false); setCreating(false); await load(); return; }
    if (paused) throw new Error("Campaign creation is paused.");
    const target = contributionWei(form.target);
    const deadline = Math.floor(new Date(form.deadline).getTime() / 1000);
    if (!Number.isSafeInteger(deadline) || deadline <= Date.now() / 1000 + 60) throw new Error("Choose a deadline at least one minute in the future.");
    let hash = deployment;
    if (!hash) {
      const owner = await signer();
      const provider = owner.provider!;
      const block = await provider.getBlock("latest");
      const factory = new ContractFactory(artifact.abi, artifact.bytecode, owner);
      const contract = await factory.deploy(await owner.getAddress(), target, deadline - block!.timestamp);
      hash = contract.deploymentTransaction()!.hash; setDeployment(hash); setMessage(`Campaign deployment pending: ${hash}`);
      await contract.waitForDeployment();
    }
    await request("/api/campaigns", "POST", { ...form, deployment_hash: hash });
    setDeployment(""); setCreating(false); setForm(empty); setMessage("Campaign registered. Your funds and settlement rules are on-chain."); await load();
  }
  async function estimate() {
    if (!selected) return;
    const owner = await signer(); const contract = new Contract(selected.address, artifact.abi, owner);
    const gas = await contract.contribute.estimateGas({ value: contributionWei(amount) });
    const data = await owner.provider!.getFeeData();
    setFee(`${formatEther(gas * (data.maxFeePerGas ?? data.gasPrice ?? BigInt(0)))} ETH estimated maximum fee`);
  }
  async function transact(action: string) {
    if (!selected) return;
    const owner = await signer(); const contract = new Contract(selected.address, artifact.abi, owner);
    const tx = await contract[action](...(action === "contribute" ? [{ value: contributionWei(amount) }] : []));
    setMessage(`Transaction pending: ${tx.hash}`);
    // Keep hashes until the RPC index accepts them, including after a reload.
    const key = `platform-pending:${chainId}`;
    const pending = JSON.parse(localStorage.getItem(key) || "[]");
    pending.push({ hash: tx.hash, campaign: selected.address }); localStorage.setItem(key, JSON.stringify(pending));
    try { await request("/api/transactions", "POST", { hash: tx.hash, campaign: selected.address }); } catch { /* retry below */ }
    const receipt = await tx.wait(); setMessage(receipt?.status === 1 ? `Transaction confirmed: ${tx.hash}` : `Transaction failed: ${tx.hash}`);
    await request("/api/transactions", "POST", { hash: tx.hash, campaign: selected.address });
    localStorage.setItem(key, JSON.stringify(pending.filter((x: {hash: string}) => x.hash !== tx.hash)));
    await open(selected);
  }
  useEffect(() => {
    const reconcile = async () => {
      const key = `platform-pending:${chainId}`;
      const pending = JSON.parse(localStorage.getItem(key) || "[]"); const remaining = [];
      for (const item of pending) { try { const result = await request("/api/transactions", "POST", item); if (result.status === "pending") remaining.push(item); } catch { remaining.push(item); } }
      localStorage.setItem(key, JSON.stringify(remaining));
    };
    reconcile().catch(() => {}); const interval = setInterval(() => { reconcile().catch(() => {}); }, 12000);
    return () => clearInterval(interval);
  }, [request]);
  const explorer = chainId === 11155111 ? "https://sepolia.etherscan.io" : chainId === 1 ? "https://etherscan.io" : "";
  const owner = selected?.creator.toLowerCase() === account.toLowerCase();
  const displayed = campaigns;
  return <div className="shell">
    <header><Link className="brand" href="/">↗ Common Ground</Link><div className="wallet"><span>{network}</span><button disabled={busy} onClick={() => run(connect)}>{token ? shortAddress(account) : "Connect & sign in"}</button>{account && <button disabled={busy} onClick={() => run(disconnect)}>Disconnect</button>}</div></header>
    <main><div className="eyebrow">DECENTRALIZED CROWDFUNDING PLATFORM</div><h1>Shared ideas.<br/><span>Funded together.</span></h1><p className="intro">Discover campaigns, contribute ETH, and follow transparent all-or-nothing funding. Creators can cancel before the deadline; backers can then claim refunds.</p>
      <div className="platform-toolbar"><input aria-label="Search title or category" placeholder="Search title or category" value={q} onChange={e => setQ(e.target.value)}/><select aria-label="Campaign status" value={status} onChange={e => setStatus(e.target.value)}><option value="">All campaigns</option>{["active","successful","failed","cancelled"].map(s => <option key={s}>{s}</option>)}</select><select aria-label="Sort campaigns" value={sort} onChange={e => setSort(e.target.value)}><option value="created_at">Newest first</option><option value="deadline">Deadline</option><option value="raised">Amount raised</option></select><button disabled={busy || !token || paused} onClick={() => { setCreating(true); setEditing(false); setForm(empty); }}>Create campaign</button>{admin && <button onClick={() => setModerating(!moderating)}>{moderating ? "Browse" : "Administration"}</button>}</div>
      {paused && <p className="notice">New campaign creation is currently paused.</p>}
      {moderating && admin && <div className="notice"><p>Hiding a listing does not alter its blockchain contract or prevent direct interaction.</p><button disabled={busy} onClick={() => run(async () => { await request("/api/settings", "PATCH", { creation_paused: !paused }); await load(); })}>{paused ? "Resume campaign creation" : "Pause campaign creation"}</button></div>}
      {creating && <form className="platform-panel" onSubmit={e => { e.preventDefault(); run(save); }}><h2>{editing ? "Edit campaign details" : "Create a campaign"}</h2>{(["title","category","image"] as const).map(k => <label key={k}>{k}<input required maxLength={k === "title" ? 120 : k === "category" ? 60 : 2000} type={k === "image" ? "url" : "text"} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })}/></label>)}<label>Description<textarea required maxLength={6000} value={form.description} onChange={e => setForm({...form, description: e.target.value})}/></label>{!editing && <><label>Target (ETH)<input required inputMode="decimal" value={form.target} onChange={e => setForm({...form,target:e.target.value})}/></label><label>Deadline<input required type="datetime-local" value={form.deadline} onChange={e => setForm({...form,deadline:e.target.value})}/></label></>}<p>Targets and deadlines cannot be edited after deployment. Contributions continue until the deadline, even after the target is reached.</p>{deployment && <p>Deployed transaction {deployment}. Retry registration without deploying again.</p>}<button disabled={busy} type="submit">{editing ? "Save details" : deployment ? "Retry registration" : "Deploy & register"}</button><button type="button" onClick={() => setCreating(false)}>Close</button></form>}
      <div aria-live="polite">{message && <p className="notice">{message}</p>}</div>{error && <p role="alert" className="notice error">{error}</p>}
      <div className="platform-cards">{displayed.map(c => <article className="platform-panel" key={c.address}><div className="campaign-image" style={{backgroundImage:`url(${JSON.stringify(c.image)})`}} role="img" aria-label={c.title}/><p className="eyebrow">{c.category} · {c.status || "Listing"}{c.flagged ? " · Flagged for review" : ""}{c.hidden ? " · Hidden" : ""}</p><h2>{c.title}</h2><p>{c.description.slice(0,160)}</p><progress max={100} value={progress(c)}/><p>{formatEther(c.raised)} / {formatEther(c.goal)} ETH</p><p>Deadline: {new Date(c.deadline*1000).toLocaleString()}</p><p>Creator: {shortAddress(c.creator)}</p><button disabled={busy} onClick={() => run(() => open(c))}>View campaign</button>{moderating && admin && <><button disabled={busy} onClick={() => run(async () => { await request(`/api/admin/campaigns/${c.address}`, "PATCH", { hidden: !c.hidden, flagged: !!c.flagged }); await load(); })}>{c.hidden ? "Restore" : "Hide"}</button><button disabled={busy} onClick={() => run(async () => { await request(`/api/admin/campaigns/${c.address}`, "PATCH", { hidden: !!c.hidden, flagged: !c.flagged }); await load(); })}>{c.flagged ? "Clear flag" : "Flag"}</button></>}</article>)}</div>
      {!campaigns.length && <p className="notice">No matching campaigns. Connect your wallet to create the first one.</p>}
      {selected && <section className="platform-panel"><h2>{selected.title}</h2><p style={{whiteSpace:"pre-wrap"}}>{selected.description}</p><p>Creator: {selected.creator}</p><p>Contract: {explorer ? <a href={`${explorer}/address/${selected.address}`} target="_blank" rel="noreferrer">{selected.address}</a> : selected.address}</p><p>{selected.status} · {formatEther(selected.raised)} ETH raised · target {formatEther(selected.goal)} ETH</p><p>Deadline: {new Date(selected.deadline*1000).toLocaleString()}</p>{(owner || admin) && <button disabled={!token || busy} onClick={() => { setForm({...empty,title:selected.title,description:selected.description,category:selected.category,image:selected.image}); setEditing(true); setCreating(true); }}>Edit details</button>}{selected.status === "active" && <><label>Contribution (ETH)<input value={amount} onChange={e => {setAmount(e.target.value);setFee("");}} inputMode="decimal"/></label><button disabled={busy || !account} onClick={() => run(estimate)}>Estimate fee</button>{fee && <p>{fee}. Your wallet shows the final fee before approval.</p>}<button disabled={busy || !account} onClick={() => run(() => transact("contribute"))}>Contribute ETH</button>{owner && <button disabled={busy} onClick={() => run(() => transact("cancel"))}>Cancel campaign & enable refunds</button>}</>}{selected.status === "successful" && owner && !selected.withdrawn && <button disabled={busy} onClick={() => run(() => transact("withdraw"))}>Withdraw funds</button>}{["failed","cancelled"].includes(selected.status) && account && <button disabled={busy} onClick={() => run(() => transact("refund"))}>Claim my refund</button>}{!!selected.withdrawn && <p>Funds withdrawn by creator.</p>}<h3>Transaction history</h3><label><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)}/>Only my transactions</label><button disabled={busy} onClick={() => run(() => open(selected))}>Refresh state & history</button><div className="platform-table"><table><thead><tr><th>Action</th><th>Wallet</th><th>ETH</th><th>Status</th><th>Time</th><th>Transaction</th></tr></thead><tbody>{records.map(r => <tr key={r.hash}><td>{r.action}</td><td title={r.wallet}>{shortAddress(r.wallet)}</td><td>{formatEther(r.value_wei)}</td><td>{r.status}</td><td>{new Date(r.created_at).toLocaleString()}</td><td>{explorer ? <a target="_blank" rel="noreferrer" href={`${explorer}/tx/${r.hash}`}>{shortAddress(r.hash)} ↗</a> : r.hash}</td></tr>)}</tbody></table></div>{!records.length && <p>No indexed transactions yet.</p>}</section>}
      <footer><span>Common Ground · ETH crowdfunding</span><span>Wallet signatures. Transparent settlement.</span></footer>
    </main></div>;
}
