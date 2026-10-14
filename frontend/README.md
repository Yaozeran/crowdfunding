# Common Ground frontend

Next.js / React crowdfunding interface with MetaMask and ethers. See the [root README](../README.md) for contract deployment, environment configuration, Flask setup, and test instructions.

```bash
npm ci
# Copy .env.example to .env.local and configure the deployed campaign.
npm run dev
```

The frontend expects the Python API at `http://localhost:5001` unless `NEXT_PUBLIC_API_URL` is set. All transaction signing occurs in MetaMask. No private key belongs in frontend configuration.
