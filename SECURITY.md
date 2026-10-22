# Security policy

Ovelo is a **hackathon demo that runs only on a test network with test money.** It is not a real product, it does not handle real funds, and it must not be used to make a real purchase decision. The escrow contract is **not audited**.

## Reporting a problem

Please report security problems privately. Do not open a public issue for anything that could be exploited.

- **Preferred:** use GitHub's private vulnerability reporting — open the **Security** tab of the repository and click **Report a vulnerability**.
- **Or:** send a message to the project's X page, [**@0velo_**](https://x.com/0velo_).

Please include what you found, the steps to reproduce it, and the impact you think it has. This is a small demo maintained by volunteers, so responses may take a while — but reports are welcome and appreciated.

## Scope

In scope:

- The Next.js app in this repository (`app/`, `agent/`, `lib/`, `components/`) and its API routes.
- The `OveloEscrow` contract in `escrow/contracts/` and the Hardhat scripts in `escrow/scripts/`.
- Leakage of a private key or API key through an API response, a log line, or the repository itself.

Out of scope:

- Anything about real tickets, real sellers, real issuers or real events — Ovelo only knows about six made-up demo tickets.
- The public Base Sepolia network, the public RPC endpoint, Basescan or any other third-party service.
- Findings that only apply to a real deployment with real funds. Ovelo is deliberately testnet-only.

## Test wallets only

**Every wallet used by this project is a throwaway test wallet.** This applies to the agent/buyer wallet, the demo scanner wallet and the demo seller.

- The keys behind these wallets are only ever meant for **Base Sepolia testnet**. They are worthless there and must **never** be reused on mainnet or anywhere else.
- The agent wallet may be created by the **Create wallet** button, which writes a key to a server-side file (`.agent-wallet.json`), or supplied through the `WALLET_PRIVATE_KEY` / `SCANNER_PRIVATE_KEY` environment variables. These are server-side only and are never returned to the browser or included in any API response.
- If you fork this project, generate brand-new keys. **Do not reuse the keys, addresses or deployment from the public demo.**

## The contract is not audited

`OveloEscrow` is a small demo contract written for a hackathon. It has **not** been audited and is **not** intended to hold real value. Its source **is** verified on Basescan ([`0xAAa0c9d296EfA3Df324d26D0757608cEB408bE8E#code`](https://sepolia.basescan.org/address/0xAAa0c9d296EfA3Df324d26D0757608cEB408bE8E#code)), which only means the published source matches the deployed bytecode — it is not a security audit. Do not send real assets to it and do not reuse it for anything of value.
