# On-chain proof

Ovelo's escrow is real, but it runs on a **test network with test money only**.
Every value on this page is copied from the public records in
[`escrow/deployments/`](../escrow/deployments/) — nothing here is add-libbed or
estimated. The [x402 settlement](#x402-settlement-paid-api-call) below is read back
from the chain by Ovelo's own verifier (`agent/x402-verify.ts`), which is the same
check the app runs before it calls a payment "settled on-chain".

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

## x402 settlement (paid API call)

The paid demo APIs (`/api/weather`, `/api/ticket-report`) charge 0.01 test USDC per
request. The agent signs an EIP-3009 authorization and the **public `x402.org`
facilitator** submits the transaction that settles it on Base Sepolia. Ovelo then
**verifies the settlement itself**: `agent/x402-verify.ts` reads the transaction's
receipt back from the chain and checks the USDC `Transfer` log (token
`0x036CbD…CF7e`, sender the agent wallet, receiver `0xDc672f03…5559`, amount
`10000` base units). The demo only says "settled on-chain" when that check passes.

The most recent real call was made on 2026-10-21 and read back from the chain
(the same check the app performs):

| Action | Basescan transaction | What it proves | Date |
| :--- | :--- | :--- | :--- |
| x402 settlement (0.01 USDC) | [`0x51148c49…24b76`](https://sepolia.basescan.org/tx/0x51148c491faabafa22965265735947c5152efcdd47e5bbe4e69c8d329f624b76) | The facilitator submitted the agent wallet's EIP-3009 authorization: a `Transfer` of `10000` base units (0.01 test USDC) from the agent wallet `0x865b…7683` to the payee `0xDc672f03…5559`, in **block 48411594** with status success. | 2026-10-21 |

Earlier verified settlements include the first one, in block 48404488
([`0xb79eab05…1f7763`](https://sepolia.basescan.org/tx/0xb79eab05b4442f0a1678dc57eca889bdf2a16151b247a38def68889a231f7763)).
For that first call the token balances moved exactly as expected: the agent wallet
went from `3` to `2.99` USDC and the payee from `0` to `0.01` USDC. The transaction
was submitted by the facilitator's relayer (`0xd407…f1bf`); the payer only signed
the authorization.

**Honest limits.** The transaction is submitted by the public `x402.org`
facilitator — a third party — so Ovelo's check confirms what happened *after* the
fact; it does not control or prevent the payment. The paid routes have **no spend
limit or rate limit yet** (every call spends a real 0.01 test USDC), and both
wallets — the agent/buyer wallet and the receiver `0xDc672f03…5559` — are
**throwaway test wallets**. It is all Base Sepolia test money.

## How to verify yourself

1. **Open the contract on Basescan.** Go to the [contract address](https://sepolia.basescan.org/address/0xAAa0c9d296EfA3Df324d26D0757608cEB408bE8E) and open the **Transactions** tab to see every deal that touched it.
2. **Open a transaction.** Click any link in the table above, for example the fund or the check-in for deal 1.
3. **Read the token transfers.** In the transaction page, open the **ERC-20 Tokens Transferred** section and confirm the test USDC (`0x036CbD…CF7e`) moving into the contract on `fund`, and out to the seller on the check-in.
