import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import { network } from "hardhat";

// One shared in-process blockchain for the whole run. loadFixture below gives
// every test a fresh snapshot, so tests cannot interfere with each other.
const { viem, networkHelpers } = await network.create();

// ---- Test constants ---------------------------------------------------------
/// Mock USDC uses 6 decimals like real USDC, so amounts are scaled by 1e6.
const AMOUNT = 10n * 10n ** 6n; // 10.00 USDC
const MAX_AMOUNT = 50n * 10n ** 6n; // 50.00 USDC maximum per deal
const HOUR = 3600n;

/// Two distinct tickets as bytes32 values (like hashes of "OV-1001").
const TICKET_A = "0x" + "aa".repeat(32);
const TICKET_B = "0x" + "bb".repeat(32);

/// Mirrors DealStatus in the contract.
const Status = { None: 0, Funded: 1, Released: 2, Refunded: 3 };

/// Typed views of the raw contract reads (hardhat-viem returns unknown).
type Deal = {
  dealId: bigint;
  ticketId: string;
  buyer: string;
  seller: string;
  amount: bigint;
  deadline: bigint;
  status: number;
};

async function readDeal(escrow: any, dealId: bigint) {
  return (await escrow.read.getDeal([dealId])) as Deal;
}

async function balanceOf(token: any, address: string) {
  return (await token.read.balanceOf([address])) as bigint;
}

// ---- Fixture ----------------------------------------------------------------
/// Deploys the escrow plus a fresh MockUSDC and mints the buyer a supply.
/// The scanner role is given to the third local account.
async function deployFixture() {
  const [deployer, buyer, seller, scanner, stranger] = await viem.getWalletClients();

  const token = await viem.deployContract("MockUSDC");
  const escrow = await viem.deployContract("OveloEscrow", [
    token.address,
    scanner.account.address,
    MAX_AMOUNT,
  ]);

  const buyerSupply = 1_000_000_000n; // 1000 USDC
  await token.write.mint([buyer.account.address, buyerSupply], { account: deployer.account });

  const latest = await networkHelpers.time.latest();
  const deadline = BigInt(latest) + HOUR; // check-in window: 1 hour

  return { token, escrow, deployer, buyer, seller, scanner, stranger, deadline };
}

/// Approves the escrow and calls fund() as the buyer. Returns the tx promise.
async function fundDeal(
  c: Awaited<ReturnType<typeof deployFixture>>,
  overrides: Partial<{ ticketId: string; seller: any; amount: bigint; deadline: bigint }> = {}
) {
  const ticketId = overrides.ticketId ?? TICKET_A;
  const seller = overrides.seller ?? c.seller;
  const amount = overrides.amount ?? AMOUNT;
  const deadline = overrides.deadline ?? c.deadline;

  // The buyer must approve the escrow before funding.
  await c.token.write.approve([c.escrow.address, amount], { account: c.buyer.account });
  return c.escrow.write.fund(
    [ticketId, seller.account.address, amount, deadline],
    { account: c.buyer.account }
  );
}

// ---- Tests ------------------------------------------------------------------
describe("OveloEscrow", () => {
  describe("fund", () => {
    it("moves tokens into the contract and records the deal as Funded", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      const buyerBefore = await balanceOf(c.token, c.buyer.account.address);

      await viem.assertions.emitWithArgs(
        fundDeal(c),
        c.escrow,
        "DealFunded",
        [1n, TICKET_A, c.buyer.account.address, c.seller.account.address, AMOUNT, c.deadline]
      );

      // Tokens left the buyer and are held in escrow.
      assert.equal(await balanceOf(c.token, c.buyer.account.address), buyerBefore - AMOUNT);
      assert.equal(await balanceOf(c.token, c.escrow.address), AMOUNT);

      // The deal is stored correctly and findable by ticket.
      const deal = await readDeal(c.escrow, 1n);
      assert.equal(deal.dealId, 1n);
      assert.equal(deal.ticketId, TICKET_A);
      assert.equal(deal.buyer, getAddress(c.buyer.account.address));
      assert.equal(deal.seller, getAddress(c.seller.account.address));
      assert.equal(deal.amount, AMOUNT);
      assert.equal(deal.deadline, c.deadline);
      assert.equal(Number(deal.status), Status.Funded);
      assert.equal(await c.escrow.read.getDealIdForTicket([TICKET_A]), 1n);
    });

    it("reverts if the buyer has not approved the escrow", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      // No approve() call on purpose -> the ERC20 transferFrom must reject it.
      await assert.rejects(
        c.escrow.write.fund([TICKET_A, c.seller.account.address, AMOUNT, c.deadline], {
          account: c.buyer.account,
        }),
        (err: any) => {
          const text = `${err?.shortMessage ?? ""} ${err?.message ?? ""} ${err?.cause ?? ""}`;
          return /ERC20InsufficientAllowance|insufficient allow/i.test(text);
        }
      );
    });

    it("reverts with a zero amount", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      await viem.assertions.revertWith(
        fundDeal(c, { amount: 0n }),
        "OveloEscrow: amount must be greater than zero"
      );
    });

    it("reverts when the amount is above the maximum deal amount", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      await viem.assertions.revertWith(
        fundDeal(c, { amount: MAX_AMOUNT + 1n }),
        "OveloEscrow: amount is above the max deal amount"
      );
    });

    it("reverts when the seller is the zero address", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      const zeroAddress = "0x0000000000000000000000000000000000000000";
      await viem.assertions.revertWith(
        fundDeal(c, { seller: { account: { address: zeroAddress } } }),
        "OveloEscrow: seller cannot be the zero address"
      );
    });

    it("reverts when the seller is the buyer", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      await viem.assertions.revertWith(
        fundDeal(c, { seller: c.buyer }),
        "OveloEscrow: seller cannot be the buyer"
      );
    });

    it("reverts when the deadline is not in the future", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      const pastDeadline = BigInt(await networkHelpers.time.latest()) - 60n;
      await viem.assertions.revertWith(
        fundDeal(c, { deadline: pastDeadline }),
        "OveloEscrow: deadline must be in the future"
      );
    });

    it("reverts when the same ticket is funded twice while Funded", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      await fundDeal(c);
      await viem.assertions.revertWith(
        fundDeal(c),
        "OveloEscrow: ticket already funded"
      );
    });

    it("reverts when the same ticket is funded again after it was Released", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      await fundDeal(c);
      await c.escrow.write.checkIn([1n], { account: c.scanner.account });

      await viem.assertions.revertWith(
        fundDeal(c),
        "OveloEscrow: ticket already sold"
      );
    });

    it("allows the same ticket to be funded again after a refund", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      await fundDeal(c);
      await networkHelpers.time.increase(HOUR * 2n);
      await c.escrow.write.refund([1n], { account: c.buyer.account });

      // A fresh, larger deal on the same ticket is now allowed. The old deadline
      // is long gone (we moved past it to refund), so use a new future one.
      const newDeadline = BigInt(await networkHelpers.time.latest()) + HOUR;
      const newAmount = 20n * 10n ** 6n; // 20 USDC
      await fundDeal(c, { amount: newAmount, deadline: newDeadline });

      assert.equal(await c.escrow.read.getDealIdForTicket([TICKET_A]), 2n);
      assert.equal(await balanceOf(c.token, c.escrow.address), newAmount);
      const deal = await readDeal(c.escrow, 2n);
      assert.equal(Number(deal.status), Status.Funded);
      assert.equal(deal.ticketId, TICKET_A);
    });
  });

  describe("checkIn (scanner)", () => {
    it("pays the seller exactly the amount and marks the deal Released", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      await fundDeal(c);
      const sellerBefore = await balanceOf(c.token, c.seller.account.address);

      await viem.assertions.emitWithArgs(
        c.escrow.write.checkIn([1n], { account: c.scanner.account }),
        c.escrow,
        "DealReleased",
        [1n, TICKET_A]
      );

      // Seller got the full amount; escrow is left empty.
      assert.equal(
        await balanceOf(c.token, c.seller.account.address),
        sellerBefore + AMOUNT
      );
      assert.equal(await balanceOf(c.token, c.escrow.address), 0n);
      assert.equal(Number((await readDeal(c.escrow, 1n)).status), Status.Released);
    });

    it("reverts when called by anyone other than the scanner", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      await fundDeal(c);
      await viem.assertions.revertWith(
        c.escrow.write.checkIn([1n], { account: c.stranger.account }),
        "OveloEscrow: only the scanner can check in"
      );
      // Even the buyer cannot check in.
      await viem.assertions.revertWith(
        c.escrow.write.checkIn([1n], { account: c.buyer.account }),
        "OveloEscrow: only the scanner can check in"
      );
    });

    it("reverts on a second check-in (rejected second scan)", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      await fundDeal(c);
      await c.escrow.write.checkIn([1n], { account: c.scanner.account });
      await viem.assertions.revertWith(
        c.escrow.write.checkIn([1n], { account: c.scanner.account }),
        "OveloEscrow: deal already checked in - rejected second scan"
      );
    });

    it("reverts after the deadline", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      await fundDeal(c);
      await networkHelpers.time.increase(HOUR * 2n); // move past the 1h window
      await viem.assertions.revertWith(
        c.escrow.write.checkIn([1n], { account: c.scanner.account }),
        "OveloEscrow: check-in window has passed"
      );
    });

    it("reverts for an unknown deal id", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      await viem.assertions.revertWith(
        c.escrow.write.checkIn([99n], { account: c.scanner.account }),
        "OveloEscrow: deal does not exist"
      );
    });

    it("reverts for a refunded deal", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      await fundDeal(c);
      await networkHelpers.time.increase(HOUR * 2n);
      await c.escrow.write.refund([1n], { account: c.buyer.account });
      await viem.assertions.revertWith(
        c.escrow.write.checkIn([1n], { account: c.scanner.account }),
        "OveloEscrow: deal was already refunded"
      );
    });
  });

  describe("refund", () => {
    it("reverts before the deadline", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      await fundDeal(c);
      await viem.assertions.revertWith(
        c.escrow.write.refund([1n], { account: c.buyer.account }),
        "OveloEscrow: deadline has not passed yet"
      );
    });

    it("reverts when called by someone other than the buyer", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      await fundDeal(c);
      await networkHelpers.time.increase(HOUR * 2n);
      await viem.assertions.revertWith(
        c.escrow.write.refund([1n], { account: c.stranger.account }),
        "OveloEscrow: only the buyer can refund"
      );
    });

    it("returns the tokens after the deadline and marks the deal Refunded", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      await fundDeal(c);
      const buyerBefore = await balanceOf(c.token, c.buyer.account.address);

      await networkHelpers.time.increase(HOUR * 2n);
      await viem.assertions.emitWithArgs(
        c.escrow.write.refund([1n], { account: c.buyer.account }),
        c.escrow,
        "DealRefunded",
        [1n, TICKET_A]
      );

      // The full amount went back to the buyer; escrow is empty.
      assert.equal(
        await balanceOf(c.token, c.buyer.account.address),
        buyerBefore + AMOUNT
      );
      assert.equal(await balanceOf(c.token, c.escrow.address), 0n);
      assert.equal(Number((await readDeal(c.escrow, 1n)).status), Status.Refunded);
    });

    it("reverts when the deal was already released", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      await fundDeal(c);
      await c.escrow.write.checkIn([1n], { account: c.scanner.account });
      await networkHelpers.time.increase(HOUR * 2n);
      await viem.assertions.revertWith(
        c.escrow.write.refund([1n], { account: c.buyer.account }),
        "OveloEscrow: deal is not refundable"
      );
    });
  });

  describe("read functions", () => {
    it("getDeal exposes a deal to the app and reverts for unknown ids", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      await fundDeal(c);
      const deal = await readDeal(c.escrow, 1n);
      assert.equal(deal.ticketId, TICKET_A);
      assert.equal(deal.buyer, getAddress(c.buyer.account.address));
      await viem.assertions.revertWith(
        c.escrow.read.getDeal([123n]),
        "OveloEscrow: deal does not exist"
      );
    });

    it("getDealIdForTicket is 0 for unknown tickets and maps funded ones", async () => {
      const c = await networkHelpers.loadFixture(deployFixture);
      assert.equal(await c.escrow.read.getDealIdForTicket([TICKET_B]), 0n);
      await fundDeal(c);
      assert.equal(await c.escrow.read.getDealIdForTicket([TICKET_A]), 1n);
    });
  });
});