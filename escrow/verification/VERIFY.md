# Verify `OveloEscrow` on Basescan (Solidity Standard-Json-Input)

This is a manual-upload verification checklist. It sends **no transaction** and
changes nothing on-chain — it only asks Basescan to recompile the uploaded source
and compare it with the bytecode already deployed.

Everything below comes from the Hardhat build-info that produced the deployed
bytecode (`escrow/artifacts/build-info/solc-0_8_31-*.json`) and from
[`escrow/deployments/baseSepolia.json`](../deployments/baseSepolia.json).

## Values to type on the "Verify and Publish" page

| Field | Exact value |
| :--- | :--- |
| Contract address | `0xAAa0c9d296EfA3Df324d26D0757608cEB408bE8E` |
| Compiler type | `Solidity (Standard-Json-Input)` |
| Compiler version | `v0.8.31+commit.fd3a2265` |
| License type | `MIT` (the SPDX in the source is `MIT License (MIT)`) |
| Contract name | `project/contracts/OveloEscrow.sol:OveloEscrow` |
| Optimization | **No** (the optimizer was disabled) |
| Constructor arguments (ABI-encoded) | see the hex string below |
| File to upload | `verification/standard-json-input.json` |

The contract is at [`https://sepolia.basescan.org/address/0xAAa0c9d296EfA3Df324d26D0757608cEB408bE8E#code`](https://sepolia.basescan.org/address/0xAAa0c9d296EfA3Df324d26D0757608cEB408bE8E#code). `escrow/deployments/baseSepolia.json` stores the address in lowercase (`0xaaa0c9d296efa3df324d26d0757608ceb408be8e`); it is the same address.

## Constructor arguments (hex, no `0x`)

The constructor is `constructor(address token_, address scanner_, uint256 maxDealAmount_)`. Encoded as three 32-byte words:

```
token_       000000000000000000000000036cbd53842c5426634e7929541ec2318f3dcf7e
scanner_     000000000000000000000000dcbe6c7861cb7cb29bec1682d6ae701c6b4cb2b6
maxDealAmount 00000000000000000000000000000000000000000000000000000000004c4b40
```

Combined (paste this into the constructor-arguments field):

```
000000000000000000000000036cbd53842c5426634e7929541ec2318f3dcf7e000000000000000000000000dcbe6c7861cb7cb29bec1682d6ae701c6b4cb2b600000000000000000000000000000000000000000000000000000000004c4b40
```

These three values come straight from `baseSepolia.json`: `token` = `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, `scanner` = `0xdcBe6C7861cB7cB29BEc1682d6aE701c6B4cB2b6`, `maxDealAmount` = `5000000`.

## Steps

1. Open the contract on Basescan and click **Verify and Publish** (link above).
2. Choose **Compiler type** = `Solidity (Standard-Json-Input)`.
3. Choose **Compiler version** = `v0.8.31+commit.fd3a2265`.
4. Choose **License type** = `MIT`.
5. Upload `verification/standard-json-input.json`.
6. For **Contract name**, enter `project/contracts/OveloEscrow.sol:OveloEscrow` (that is the `path:name` key used inside the uploaded input).
7. Paste the combined constructor-arguments hex from above.
8. Submit. Basescan recompiles the input with the same compiler and compares the result to the deployed bytecode.

## Why these values

- **Compiler `v0.8.31+commit.fd3a2265`** is the `solcLongVersion` recorded in the build-info that produced this deployment.
- **Optimizer off, EVM version `osaka`** are the exact settings in the uploaded input (the input has no `optimizer` block, which means disabled).
- The uploaded file is the **exact Standard-Json-Input** the compiler used: all 14 sources are inlined, including the OpenZeppelin 5.6.1 files, under the same `project/…` and `npm/@openzeppelin/contracts@5.6.1/…` keys. Nothing was edited.
- The deployed bytecode matches the compiled bytecode once the trailing metadata hash is removed, apart from the constructor-set immutables (`token`, `scanner`, `maxDealAmount`) that the compiler embeds at deployment — the same thing Basescan accounts for automatically. See [notes](#verification-notes) below.

## Verification notes

- The contract is a demo on **Base Sepolia testnet** only. No transaction is sent by verification.
- Constructor arguments were confirmed against the live contract: the three immutable values stored in the deployed bytecode are exactly `0x…036cbd53…cf7e` (token), `0x…dcbe6c78…b2b6` (scanner) and `0x4c4b40` (= `5000000`, max deal amount).
