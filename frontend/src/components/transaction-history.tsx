import type { CampaignState } from "@/hooks/use-campaign";
import { formatEther } from "ethers";
import { chainId } from "@/lib/config";
import { shortAddress } from "@/lib/campaign";

export default function TransactionHistory({ account, busy, refreshHistory, historyError, transactions }: Pick<CampaignState, "account" | "busy" | "refreshHistory" | "historyError" | "transactions">) {
  return (
    <section className="history card"><div className="history-heading"><div><span className="tag">EVERY CONTRIBUTION COUNTS</span><h2>Your transaction history</h2></div><button disabled={!account || busy} onClick={() => refreshHistory(account)}>Refresh history ↻</button></div>{historyError && <p className="notice" role="status">{historyError}</p>}{transactions.length ? <div className="table-wrap"><table><thead><tr><th>Transaction</th><th>Action</th><th>Sent ETH</th><th>Status</th><th>Recorded</th></tr></thead><tbody>{transactions.map((tx) => <tr key={tx.hash}><td>{chainId === 11155111 ? <a href={`https://sepolia.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noreferrer">{shortAddress(tx.hash)} ↗</a> : <span title={tx.hash}>{shortAddress(tx.hash)}</span>}</td><td>{tx.action}</td><td>{formatEther(tx.value_wei)}</td><td><span className={`tx-status ${tx.status}`}>{tx.status}</span></td><td>{new Date(tx.created_at).toLocaleString()}</td></tr>)}</tbody></table><p className="fine-print">Most recent 100 indexed transactions. Sent ETH excludes gas and incoming refund or withdrawal amounts.</p></div> : <div className="empty"><span>↗</span><h3>{account ? "Your first contribution starts here" : "Your wallet. Your impact."}</h3><p>{account ? "Transactions recorded for this wallet will appear here." : "Connect your wallet to see your campaign activity."}</p></div>}</section>
  );
}
