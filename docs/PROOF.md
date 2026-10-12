# On-chain proof

Ovelo's escrow is real, but it runs on a **test network with test money only**.
Every value on this page is copied from the public records in
[`escrow/deployments/`](../escrow/deployments/) — nothing here is add-libbed or
estimated.

- **Network:** Base Sepolia testnet (chain id **84532`)
- **Escrow contract:** [`0xAAa0c9d296EfA3Df324d26D0757608cEB408bE8E`](https://sepolia.basescan.org/address/0xAAa0c9d296EfA3Df324d26D0757608cEB408bE8E)
- **Test USDC (6 decimals):** [`0x036CbD53842c5426634e7929541eC2318f3dCF7e`](https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e)

## Transactions recorded in the deployments files

| # | Action | Basescan transaction | What it proves | Date |
| ---: | :--- | :--- | :--- | :--- |
| 1 | Deployment | [`0xd7ba8e63…8c18d`](https://sepolia.basescan.org/tx/0xd7ba8e63c03219d8dab813d76d4c4151f83ae4c922bc8b9c0cf5266a6928c18d) | `OveloEscrow` was deployed to Base Sepolia, its test-USDC token and trusted scanner baked in at deployment. | 2026-10-08 |
| 2 | Approve (deal 1) | [`0x6cef2889…331394`](https://sepolia.basescan.org/tx/0x6cef2889d07256fce2b17ea08ed591f21d6076b0f91bd4a8750cd4f7aa331394) | The buyer (agent) wallet approved the escrow contract to move 1 test USDC. | 2026-10-09 |
| 3 | Fund (deal 1) | [`0xc790845a…3d34a4`](https://sepolia.basescan.org/tx/0xc790845a09136b9b0bed18c0e901e969b6a4cf7e31f8042ac774ffaa073d34a4) | 1 test USDC left the buyer and was held by the contract; deal 1 became **Funded** (status `1`). | 2026-10-09 |
| 4 | Check-in (deal 1) | [`0x3511e438…c5ba33`](https://sepolia.basescan.org/tx/0x3511e438f4e174f60a2f469484ca6c9027eb4af480b342ab0322f95a2bc5ba33) | The trusted scanner confirmed the ticket, the contract released the 1 test USDC to the seller, and the seller balance went from `0` to `1000000` base units. | 2026-10-09 |
| 5 | Refund (deal 2) | [`0xa9cdac8b…70d77d`](https://sepolia.basescan.org/tx/0xa9cdac8b615b9e7e6509b6cbe9696d36519552b6ad158bc041da627a7370d77d) | After the deadline passed with no scan, the buyer refunded deal 2 and got its 1 test USDC back (status `3`). | 2026-10-09 |
| 6 | Refund (deal 4) | [`0xc5694103…dd93cb`](https://sepolia.basescan.org/tx/0xc5694103ed51cfa7e42deab4a7bc5f58d6772c54b7ed5f241ac0056b2ddd93cb) | Same deadline refund path, second stuck deal (deal 4, status `3`). | 2026-10-09 |
| 7 | Refund (deal 5) | [`0xe45c9993…78f716`](https://sepolia.basescan.org/tx/0xe45c99937b2a0f4ffa0ac3362e214cef67d6aef9456c900749cad6c45a78f716) | Same deadline refund path, third stuck deal (deal 5, status `3`). | 2026-10-09 |

The refunds are recorded together in `escrow/deployments/refund-baseSepolia.json` (blocks 47883398, 47883400 and 47883401). That file also records the escrow's test-USDC balance going from `3000000` to `0` and the agent wallet's balance going from `14000000` to `17000000` — the three 1 USDC refunds.

`escrow/deployments/smoke-test-baseSepolia.json` also records a **rejected second scan**: the contract reverted `checkIn` for deal 1 with `"OveloEscrow: deal already checked in - rejected second scan"`. Because it reverted, no transaction was sent — which is why there is no hash for it in the table.

## How to verify yourself

1. **Open the contract on Basescan.** Go to the [contract address](https://sepolia.basescan.org/address/0xAAa0c9d296EfA3Df324d26D0757608cEB408bE8E) and open the **Transactions** tab to see every deal that touched it.
2. **Open a transaction.** Click any link in the table above, for example the fund or the check-in for deal 1.
3. **Read the token transfers.** In the transaction page, open the **ERC-20 Tokens Transferred** section and confirm the test USDC (`0x036CbD…CF7e`) moving into the contract on `fund`, and out to the seller on the check-in.
