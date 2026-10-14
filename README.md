# Common Ground — Decentralized Crowdfunding Platform

## Task 2: multi-campaign platform

The current home page is a multi-campaign ETH crowdfunding platform. Visitors can browse, search by title/category, filter by status, and sort by deadline, amount raised, or creation date. Wallet holders can create campaigns, contribute, manage descriptive metadata, cancel active campaigns, withdraw eligible funds, and claim refunds. Creators can also back other campaigns.

### Run the current platform

Use the installation and local/Docker service commands below. Configure the same `CHAIN_ID` in the frontend and backend, a reachable backend `RPC_URL`, and the browser's exact origin in `WEB_ORIGIN`. **A predeployed `CONTRACT_ADDRESS` is no longer required for the home page**; that setting supports the legacy transaction API only. The browser deploys each campaign through the connected wallet and registers its deployment hash with the API. Use a dedicated SQLite database per configured chain; changing networks requires changing the database path as well.

1. Start the local chain with `cd frontend && npm run chain`, or use Sepolia RPC and test ETH.
2. Start the backend and frontend using the service commands below. For local development use chain ID `1337`; for Sepolia use `11155111`.
3. Click **Connect & sign in**. The app requests a [Sign-In with Ethereum](https://eips.ethereum.org/EIPS/eip-4361) signature containing the configured domain, URI, chain, one-use nonce, and five-minute expiry. Sessions last one hour; disconnect revokes the server session. Account/network changes clear local authentication. This MVP supports EOA signatures through injected EIP-1193 wallets (MetaMask and compatible wallets); contract-wallet SIWE verification is not implemented.
4. Select **Create campaign**, enter title, description, category, an HTTPS image URL, positive ETH target, and a future deadline. Approve deployment in the wallet. If registration fails after deployment, **Retry registration** reuses the hash during the current page session. After a reload, an existing deployment can be registered via the API with its transaction hash and metadata; avoid deploying again unnecessarily.
5. Open a campaign, estimate contribution gas, then contribute ETH. The wallet displays the final fee before confirmation. Pending hashes persist in browser storage and are retried every 12 seconds. Campaign events are indexed in batches of 2,000 blocks when refreshed and every 30 seconds while the website is open, including transactions submitted directly outside the website. History is limited to the latest 100 records. No background worker runs when the website is closed; call the sync API repeatedly to catch up.
6. Contributions remain open until the deadline even if the goal is met. After the deadline, only the creator can withdraw if the target was met; otherwise backers can refund once. Creators can cancel before the deadline, immediately enabling refunds and blocking further contributions/withdrawal. The new contract must be deployed for cancellation support; old contracts are not upgraded automatically.

No wallet private keys or seed phrases are stored. ETH is the supported MVP currency; ERC-20 support is outside this implementation. State and history can be stale while RPC access is unavailable or indexing is catching up. Blockchain timestamps determine settlement eligibility.

### Administration

Set `ADMIN_WALLETS` to comma-separated administrator wallet addresses in the backend environment (root `.env` for Compose). Restart the backend after changing the allowlist. Sign in with an allowlisted wallet and open **Administration** to flag, hide/restore listings, edit inappropriate descriptive content/images, and pause/resume campaign registration. Hiding does not delete blockchain data or prevent direct contract interaction. Hidden campaigns remain available to administrators; creators need administrator review to edit hidden listings. Admin privileges come only from the server allowlist, never from client-provided role fields.

### Platform API

Authenticated endpoints accept `Authorization: Bearer <token>`; tokens are held in page memory, expire after one hour, and are stored as hashes server-side.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/challenge` | `{wallet}` → server-issued nonce and exact SIWE message |
| `POST /api/auth/verify` | `{nonce, signature}` → session token and role |
| `POST /api/auth/logout` | Revoke the current session |
| `GET /api/campaigns?q=&status=&sort=` | Public visible campaign catalog |
| `POST /api/campaigns` | Signed-in creator registers `{deployment_hash,title,description,category,image}`; API verifies supported creation bytecode, deployer, beneficiary, positive goal and future deadline |
| `PATCH /api/campaigns/<address>` | Creator/admin edits all four descriptive fields |
| `POST /api/campaigns/<address>/sync` | Index events and refresh chain state; repeat until `indexed_block == latest_block` |
| `GET /api/transactions?campaign=<address>&wallet=<optional address>` | Campaign history, optionally filtered by wallet |
| `POST /api/transactions` | `{hash,campaign}` verifies and records pending/confirmed/failed transactions |
| `GET /api/admin/campaigns` | Admin catalog including hidden listings |
| `PATCH /api/admin/campaigns/<address>` | Admin sets boolean `{hidden,flagged}` |
| `GET /api/settings` | Read campaign-registration pause setting |
| `PATCH /api/settings` | Admin sets boolean `{creation_paused}` |

Run `npm run contract:compile` from `frontend/` after contract changes: it regenerates and synchronizes the tracked frontend and backend ABI/creation-bytecode artifacts. Keep those artifacts in sync before building either service.

The sections below retain the original single-campaign deployment walkthrough and project infrastructure reference. Their static community story, global contract address, and manual predeployment steps describe the earlier UI. For the current UI, use **Create campaign** and the per-campaign workflow above.


The original single-campaign Ethereum DApp for the assignment in `doc/assignment.docx`. The Next.js interface connects MetaMask, reads live campaign state, submits ETH contributions, and displays transaction status/history. Flask verifies submitted transaction hashes against its RPC provider and stores the resulting public blockchain records in SQLite.

## Project layout

```text
frontend/                       Next.js / React / TypeScript frontend
  src/app/                 Page composition and responsive styles
  src/components/          Campaign story, funding panel, transaction history
  src/hooks/               Wallet and campaign state management
  src/lib/                 Contract ABI, wallet connection, amount validation
  scripts/                 Solidity compilation and local deployment
  tests/                   Wallet, validation, and contract tests
sol/                       Solidity contracts
  Crowdfund.sol            All-or-nothing crowdfunding contract
  artifacts/               Generated ABI and bytecode (gitignored)
backend/
  src/app.py               Flask application factory
  src/config.py            Environment configuration
  src/database.py          SQLite connections and schema
  src/blockchain.py        On-chain transaction verification
  src/routes.py            Health and transaction endpoints
  tests/                   API validation and persistence tests
  .env.example             Backend configuration template
```

## Campaign rules

- The deployer chooses a beneficiary, a positive goal in wei, and a positive duration in seconds. These cannot be changed afterward.
- Anyone may call `contribute()` with a positive ETH value before the deadline. Overfunding is permitted.
- After the deadline, only the beneficiary may withdraw, once, if cumulative contributions met the goal.
- If the goal was missed, each contributor may reclaim their own contribution once. Gas fees are not refunded.
- Contract state is updated before outgoing ETH transfers. Failed transfers revert their state changes. Direct ETH transfers without calling `contribute()` are rejected.
- `totalRaised` tracks historical contributions, not the remaining contract balance after refunds or withdrawal.

All signing happens in MetaMask. Neither server nor frontend needs a private key. Use test ETH; this educational contract has not been independently audited.

## Install

Use Node.js 22.13+ (or a compatible newer LTS), npm, Python 3.11+, and MetaMask.

```bash
cd frontend
npm ci
cd ../backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cd ..
```

## Run with Docker Compose

From the repository root:

```bash
cp .env.example .env
# Configure CONTRACT_ADDRESS, CHAIN_ID, and RPC_URL for your deployed contract.
docker compose up --build -d --wait
```

Open **http://localhost:3000**. The Flask API is available at **http://localhost:5001/api/health**. Docker builds the production Next.js app and runs Flask with Gunicorn. Containers run as non-root users. SQLite persists in the `crowdfunding_transactions` named volume across container replacements and `docker compose down`.

Without a configured contract address, the web and API can start, but the UI shows setup instructions and contributions are unavailable. Docker starts the application services; it does not deploy the Solidity contract. Use the local-chain or Sepolia deployment instructions below, then put the deployed address into the root `.env`.

Compose reads **root `.env`**, not `frontend/.env.local` or `backend/.env`. Build contexts exclude local environment files and databases. The root template targets Sepolia; replace its RPC placeholder with your HTTPS Sepolia RPC endpoint. For a local chain instead, set `CHAIN_ID=1337` and `RPC_URL=http://host.docker.internal:8545`. On Docker Desktop, use `host.docker.internal` to reach that RPC. On Linux, the host RPC must listen on an address reachable from the Docker bridge; loopback-only host listeners are not reachable. Alternatively, point `RPC_URL` to an external provider. For Sepolia, set `CHAIN_ID=11155111` and its RPC endpoint.

`API_PUBLIC_URL` must be reachable by the **browser**, so use `http://localhost:5001` for local Docker deployment, not the Compose service name `backend`. If you change ports, update `WEB_ORIGIN` and `API_PUBLIC_URL` to match. Public frontend settings are embedded at build time; rerun `docker compose up --build -d --wait` after changing the contract, chain, or API URL. RPC provider credentials remain in the backend environment.

```bash
docker compose ps
docker compose logs -f
docker compose down
```

`down` preserves the database volume; `down --volumes` deletes it. Existing host-side SQLite files are not automatically imported. Ports bind to localhost by default. For remote hosting, configure public origins, HTTPS, and the desired ingress separately. Health checks establish application liveness, not blockchain availability.

## Deploy to Render

The root `render.yaml` defines two Docker web services: a free-plan Next.js frontend and a **paid Starter backend with a 1 GB persistent disk** for SQLite. Review Render's displayed charges before creating the Blueprint. A free backend without a disk loses its indexed history on redeploy/restart. The contract remains on Sepolia and is deployed separately through Remix.

### Blueprint deployment

1. Push the repository, including `render.yaml`, both Dockerfiles, and `frontend/package-lock.json`, to a Git provider supported by Render. Do not commit `.env` files, RPC credentials, or private keys.
2. In the Render dashboard, select **New → Blueprint**, connect the repository, and select `render.yaml`.
3. Supply the prompted environment values:

   | Service | Variable | Value |
   | --- | --- | --- |
   | `crowdfunding-api` | `CONTRACT_ADDRESS` | Deployed Sepolia contract address |
   | `crowdfunding-api` | `RPC_URL` | Your provider's HTTPS Sepolia JSON-RPC endpoint |
   | `crowdfunding-api` | `WEB_ORIGIN` | Frontend's full public HTTPS origin, no trailing slash |
   | `crowdfunding-web` | `NEXT_PUBLIC_API_URL` | Backend's full public HTTPS URL, no trailing slash or `/api` suffix |

   Expected URLs might be `https://crowdfunding-web.onrender.com` and `https://crowdfunding-api.onrender.com`, but **use the actual URLs Render assigns**. If these are not available before creation, enter the expected URLs initially, then correct them after the services are created as described below. Names can receive suffixes when already taken.

4. Review and create the Blueprint. Render builds each Dockerfile; it does not use `compose.yaml`. Both services already bind to `0.0.0.0`, and the Blueprint sets their matching `PORT` values.
5. Open the API service's assigned URL plus `/api/health`. It should return `{"status":"ok"}`. This confirms application liveness, not RPC connectivity.
6. Confirm the frontend's `NEXT_PUBLIC_API_URL` equals the API's actual HTTPS URL. If you change it, select **Save, rebuild, and deploy**. Render exposes service environment variables to Docker as build arguments, which the frontend Dockerfile consumes. A restart alone cannot update public frontend settings.
7. Confirm the API's `WEB_ORIGIN` equals the frontend's actual HTTPS origin. Save and redeploy the API if necessary. This is the CORS allowlist for browser requests.
8. Open the frontend URL, connect MetaMask on Sepolia, and follow the campaign walkthrough below. Use a fresh campaign or a sufficiently long deadline if the earlier contract has already expired.

`CHAIN_ID` and `NEXT_PUBLIC_CHAIN_ID` are set to `11155111`. The Blueprint copies the backend's contract address into the frontend's build settings. When deploying a new campaign, update the backend `CONTRACT_ADDRESS` and rebuild the frontend too; confirm its referenced environment value reflects the new address before building.

The frontend API URL must be the public `https://…onrender.com` endpoint, not `localhost`, a Docker service name, or Render's internal hostname: calls originate from the user's browser. The RPC URL belongs only on the backend, and no wallet keys are required by Render.

### Creating services manually instead

If you prefer **New → Web Service**, use Docker for both services and leave Root Directory empty. Configure:

| Setting | Backend | Frontend |
| --- | --- | --- |
| Dockerfile path | `./backend/Dockerfile` | `./frontend/Dockerfile` |
| Docker build context | `./backend` | `./frontend` |
| Docker command | Leave blank (uses Dockerfile CMD) | Leave blank |
| Health check path | `/api/health` | `/` |
| `PORT` | `5001` | `3000` |
| Persistent disk | Mount `/data`, 1 GB, paid service | None |

Set all environment variables listed in `render.yaml`. For manual creation, set `NEXT_PUBLIC_CONTRACT_ADDRESS` directly to the same address as the backend. Deploy the backend first to obtain its API URL, then deploy the frontend and update backend `WEB_ORIGIN` with the assigned frontend origin.

SQLite is created on the Render disk; local Docker history is not automatically copied. Keep the disk-backed backend at one instance. Render's free frontend can sleep while idle, and disk-backed backend redeploys can have a brief interruption. No Render resources have been created by adding this configuration.

References: [Blueprint specification](https://render.com/docs/blueprint-spec), [Docker build arguments](https://render.com/docs/docker-secrets), [persistent disks](https://render.com/docs/disks).

## Run locally

1. Start a local blockchain in one terminal:

   ```bash
   cd frontend
   npm run chain
   ```

   This development chain listens on `127.0.0.1:8545`, uses chain ID `1337`, and prints funded test accounts. Its deterministic keys are public development keys: use them only on this local chain.

2. In another terminal, deploy the campaign:

   ```bash
   cd frontend
   npm run contract:deploy:local
   ```

   The script compiles and deploys a campaign with a **1 ETH goal** and **one-hour duration**, with the first local account as beneficiary. Copy the printed contract address. The chain is ephemeral; restarting it requires redeployment. To change the local goal or duration, edit `frontend/scripts/deploy-local.mjs` before deploying.

3. Copy `backend/.env.example` to `backend/.env` and set:

   ```dotenv
   RPC_URL=http://127.0.0.1:8545
   CHAIN_ID=1337
   CONTRACT_ADDRESS=<deployed address>
   WEB_ORIGIN=http://localhost:3000
   ```

   Start Flask from `backend/`:

   ```bash
   source .venv/bin/activate
   set -a
   source .env
   set +a
   flask --app src.app:create_app run --host 127.0.0.1 --port 5001
   ```

   SQLite is created automatically at `backend/transactions.sqlite3`. Set `DATABASE` to change its path.

4. Copy `frontend/.env.example` to `frontend/.env.local` and set:

   ```dotenv
   NEXT_PUBLIC_CONTRACT_ADDRESS=<same deployed address>
   NEXT_PUBLIC_CHAIN_ID=1337
   NEXT_PUBLIC_API_URL=http://localhost:5001
   ```

   Start the frontend from `frontend/`:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000`. Add a MetaMask network with RPC `http://127.0.0.1:8545`, chain ID `1337`, and symbol `ETH`. Import one of the local development accounts, connect, and contribute. Use the first account for beneficiary withdrawal or another account to demonstrate donor behavior.

Frontend environment changes require restarting Next.js. Both services must point to the same chain and contract. The UI deliberately shows a setup message instead of simulated blockchain data until configured.

## Manual Sepolia walkthrough: Remix + MetaMask + Docker

No local blockchain is needed for this workflow. Docker runs the website and transaction-history API; Sepolia runs the Solidity contract. MetaMask signs deployment and campaign transactions.

### 1. Prepare two MetaMask accounts

Enable test networks in MetaMask and select **Ethereum Sepolia** (chain ID `11155111`). Use account A as the beneficiary/organizer and account B as a contributor. Fund both with Sepolia test ETH: A needs gas for deployment and withdrawal, and B needs the contribution amount plus transaction gas. You can obtain test ETH using the faucets listed in [MetaMask's testnet guide](https://support.metamask.io/develop/blockchain-networks/testnets/). Faucet eligibility and limits vary.

### 2. Deploy in Remix

1. Open [Remix](https://remix.ethereum.org/) and create `Crowdfund.sol` using the contents of `sol/Crowdfund.sol`.
2. In Solidity Compiler, select **0.8.30**, optimization **200 runs**, and EVM target **Shanghai**. Compile.
3. In Deploy & Run Transactions, use **Injected Provider – MetaMask** (or the browser-wallet Sepolia option), connect account A, and verify that the selected network is Sepolia. See [Remix's deployment guide](https://remix-ide.readthedocs.io/en/latest/run.html).
4. Select the `Crowdfund` contract. Keep the deployment **Value at 0**: the constructor is not payable.
5. Expand the constructor fields and enter:

   | Parameter | Example | Meaning |
   | --- | --- | --- |
   | `recipient` | Account A's `0x…` address | Beneficiary allowed to withdraw |
   | `target` | `2000000000000000` | Goal of **0.002 ETH**, expressed in wei |
   | `duration` | `600` | **10 minutes**, measured from deployment |

6. Click Deploy and confirm in MetaMask. After confirmation, copy the address from Deployed Contracts. This must be the **contract address**, not the deployment transaction hash or an account address.

The deadline starts immediately at deployment. If you need more time to configure Docker or demonstrate the UI, use `1800` seconds instead. The goal and deadline cannot be edited on an existing campaign.

### 3. Connect the Docker app to your contract

Copy `.env.example` to `.env` in the **repository root**. Enter:

```dotenv
CONTRACT_ADDRESS=0xYOUR_DEPLOYED_CONTRACT_ADDRESS
CHAIN_ID=11155111
RPC_URL=https://YOUR_SEPOLIA_RPC_ENDPOINT
WEB_ORIGIN=http://localhost:3000
API_PUBLIC_URL=http://localhost:5001
WEB_PORT=3000
API_PORT=5001
```

Use an HTTPS Ethereum Sepolia JSON-RPC endpoint from your RPC provider for `RPC_URL`, including its API key if required. This is not a block explorer URL. The server needs its own RPC access to verify transactions; the browser's MetaMask connection is separate. No wallet private key or seed phrase is needed in configuration.

Rebuild and restart from the repository root:

```bash
docker compose up --build -d --wait
```

Changing the contract address requires rebuilding the frontend because public settings are embedded in its JavaScript bundle. An ordinary container restart does not change them.

### 4. Demonstrate a successful campaign

1. Open `http://localhost:3000`, switch MetaMask to account B, and connect it to the site. If switching accounts later, reconnect using the app's wallet button.
2. Check that the app shows Sepolia, the deployed campaign, its goal, and deadline.
3. Enter **0.002 ETH** manually, click Contribute, and approve the transaction in MetaMask. The initial UI amount is 0.01 ETH, so change it for this example.
4. Wait for confirmation; verify the raised amount, your contribution, history row, and Sepolia explorer link.
5. Wait until the on-chain deadline. Even if the goal is already met, withdrawal is not allowed before the deadline.
6. Switch to account A and reconnect. Click **Withdraw campaign funds**, then approve in MetaMask. The beneficiary receives the contract balance, while gas is charged separately.

### 5. Demonstrate a refund

Deploy a **new** contract with the same 0.002 ETH goal and a fresh deadline. Replace `CONTRACT_ADDRESS` in root `.env` and rebuild Docker. Contribute only **0.001 ETH** from B, leaving the goal unmet. Once the deadline passes, reconnect B and click **Claim your refund**. The contribution is returned; gas fees are not refunded. A second refund is prevented by the contract.

These are separate campaigns: a campaign that met its goal cannot also demonstrate the failed-goal refund path. History is filtered by the configured contract; older campaign rows remain in SQLite but do not appear for the new campaign.

### Observations and troubleshooting

- The contract's deadline follows blockchain timestamps. The UI polls every 12 seconds, so settlement buttons can appear shortly after a new block passes the deadline.
- Use the app's Contribute action, which invokes `contribute()`. Sending ETH directly to the contract address with MetaMask's Send button is rejected.
- Interactions made directly in Remix affect on-chain state, but do not automatically enter this app's SQLite history. Use the app for the demonstration, or POST a Remix transaction hash to `/api/transactions` to index it.
- A history-service error does not mean the contribution failed. Check the explorer receipt and fix the server's RPC configuration before sending another contribution.
- Save screenshots of the deployed contract, MetaMask confirmation, funded campaign/history, and withdrawal/refund receipts for the assignment.

For running outside Docker, use the same address and Sepolia chain ID in `backend/.env` and `frontend/.env.local` as described above.

## API

| Endpoint | Behavior |
| --- | --- |
| `GET /api/health` | Service liveness; does not check blockchain connectivity. |
| `GET /api/transactions?wallet=0x…` | Up to 100 most recent indexed transactions for that wallet and configured campaign/network. |
| `POST /api/transactions` | JSON `{ "hash": "0x…" }`; verifies target and recognized method, fetches sender/value/receipt from RPC, and inserts or refreshes the record. |

The backend ignores client-provided sender, amount, or status. It returns `pending`, `confirmed` (receipt status 1), or `failed` (receipt status 0). An unknown hash returns 404 so clients can retry after RPC propagation; malformed requests or unrelated transactions return 400; configuration/RPC failures return 503. Writes are idempotent. CORS allows the configured frontend origin.

Transactions are indexed by submitted hash, not by scanning the full blockchain. While connected, the UI refreshes every 12 seconds and retries pending hashes saved in browser storage. The history endpoint itself does not refresh receipts; POST the hash to reconcile a record. If the history service is unavailable, the blockchain transaction still stands. Preserve its hash and re-submit it to the API if browser storage was unavailable or cleared. Do not send a second contribution merely because history indexing failed.

## Tests and checks for you to run

```bash
# From repository root
backend/.venv/bin/python -m pytest backend/tests -q

# From frontend/
npm test
npm run lint
npm run build
npm run contract:compile
```

The JavaScript tests cover precise wei parsing, invalid amounts, missing/rejected wallets, network switching, contract deployment validation, successful contributions, beneficiary authorization, settlement deadlines, and repeat withdrawal/refund prevention. Contract tests run against an in-process local EVM without needing a running chain. Backend tests use an isolated temporary SQLite database and mocked RPC responses.

Further test execution was left to the user as requested. Browser/MetaMask interaction and Sepolia deployment have not been verified. The production frontend build completed successfully during Docker deployment. Ganache may emit a native µWS compatibility warning on newer Node releases and fall back to its JavaScript implementation. Its development dependencies also have npm audit findings; do not expose the local test chain publicly or include it in a production runtime.

Manual acceptance checklist:

- Connect MetaMask; decline a connection; switch account/network and reconnect.
- Submit a contribution and check its receipt, on-chain balance, and SQLite history; restart Flask to verify history persists.
- Enter zero, a negative value, excess decimal places, and an unaffordable amount; decline a transaction in MetaMask.
- After a successful campaign deadline, withdraw as beneficiary and verify another account cannot withdraw.
- After an unsuccessful campaign deadline, refund as contributor and verify a second refund fails.
- Stop Flask during a contribution, restart it, and verify history indexing recovers without sending another payment.
- Capture desktop/mobile views, wallet confirmation, transaction history, and the block explorer receipt for the assignment screenshots.

## Architecture and limitations

```text
React UI ── MetaMask ── Ethereum RPC ── Crowdfund contract
    │
    └── Flask API ── independent RPC verification
            └── SQLite transaction history
```

The contract enforces authorization using `msg.sender`. The API stores only public blockchain data and intentionally requires no login: anyone can index an existing campaign transaction. Wallet addresses and hashes are public identifiers, not private account information. The frontend never handles seed phrases or private keys.

This is a single-campaign educational application. One mined receipt is shown as confirmed, not finalized; chain reorganizations and replacement/dropped transactions need manual reconciliation by hash. History is limited to indexed transactions and 100 rows. There is no background chain indexer, account authentication, rate limiting, or public HTTPS ingress configuration. Use HTTPS, a production WSGI server, durable database backups, and appropriate RPC/API limits before hosting a public instance. The Flask development server is for local use.

The assignment's final 5–8 page PDF report, screenshots, and 5–8 minute demonstration video remain separate submission artifacts. This repository supplies the implementation, test sources, and instructions for collecting those results.

References: [Solidity security considerations](https://docs.soliditylang.org/en/latest/security-considerations.html), [Web3.py transaction APIs](https://web3py.readthedocs.io/en/stable/web3.eth.html).
