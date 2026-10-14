import { BrowserProvider, type Eip1193Provider } from "ethers";

export type Wallet = Eip1193Provider & {
  on?: (event: string, listener: () => void) => void;
  removeListener?: (event: string, listener: () => void) => void;
};

export async function connectWallet(wallet: Wallet | undefined, chainId: number): Promise<string> {
  if (!wallet) throw new Error("Install MetaMask to connect your wallet, then reload this page.");
  await wallet.request({ method: "eth_requestAccounts" });
  const current = await wallet.request({ method: "eth_chainId" });
  if (Number(current) !== chainId) {
    await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chainId.toString(16)}` }] });
  }
  const provider = new BrowserProvider(wallet);
  if (Number((await provider.getNetwork()).chainId) !== chainId) throw new Error("Wallet network does not match the campaign.");
  return (await provider.getSigner()).getAddress();
}
