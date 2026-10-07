// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title OveloEscrow
/// @notice A tiny demo escrow for the Ovelo ticket-resale agent.
///
/// How it works:
/// 1. A buyer funds a deal with an ERC-20 token (test USDC, 6 decimals). The
///    tokens are pulled out of the buyer's wallet into this contract, proving
///    the buyer can pay, and held safely until one of two things happens.
/// 2. A trusted "scanner" (a verifier appointed at deployment) confirms the
///    buyer showed up / scanned in at the venue. It then releases the exact
///    amount to the seller.
/// 3. If the scanner never confirms before the deadline, the buyer can claim a
///    refund and the tokens go back to the buyer.
///
/// The same ticketId can never be funded twice while a deal is Funded or
/// Released (a ticket cannot be sold twice). A Refunded ticket can be funded
/// again. No features beyond that: there is no owner, no pausing and no
/// upgradeability.
contract OveloEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Lifecycle of a deal.
    enum DealStatus {
        None, // deal id is unused / unknown
        Funded, // buyer deposited, waiting for the scanner or the deadline
        Released, // scanner confirmed attendance, seller was paid
        Refunded // deadline passed without a check-in, buyer got their money back
    }

    /// @notice A single escrow deal. dealId 0 is reserved as "no deal".
    struct Deal {
        uint256 dealId;
        bytes32 ticketId;
        address buyer;
        address seller;
        uint256 amount;
        uint256 deadline; // Unix timestamp; the check-in window ends here
        DealStatus status;
    }

    /// The ERC-20 token used for funding (test USDC, 6 decimals).
    IERC20 public immutable token;

    /// The only address allowed to call checkIn().
    address public immutable trustedScanner;

    /// Upper bound for a single deal amount; bigger amounts are rejected.
    uint256 public immutable maxDealAmount;

    /// Monotonic deal id counter. Starts at 1 so 0 always means "no deal".
    uint256 private _nextDealId = 1;

    /// dealId => deal. Readable by anyone (public storage + getDeal() below).
    mapping(uint256 => Deal) public deals;

    /// ticketId => current dealId for that ticket (0 if never funded).
    mapping(bytes32 => uint256) public dealIdForTicket;

    event DealFunded(
        uint256 indexed dealId,
        bytes32 indexed ticketId,
        address indexed buyer,
        address seller,
        uint256 amount,
        uint256 deadline
    );
    event DealReleased(uint256 indexed dealId, bytes32 indexed ticketId);
    event DealRefunded(uint256 indexed dealId, bytes32 indexed ticketId);

    /// @param token_          The ERC-20 token address (test USDC, 6 decimals).
    /// @param scanner_        The trusted scanner who may call checkIn().
    /// @param maxDealAmount_  Maximum amount that can be locked in one deal.
    constructor(address token_, address scanner_, uint256 maxDealAmount_) {
        require(token_ != address(0), "OveloEscrow: token cannot be the zero address");
        require(scanner_ != address(0), "OveloEscrow: scanner cannot be the zero address");
        require(maxDealAmount_ > 0, "OveloEscrow: maxDealAmount must be greater than zero");

        token = IERC20(token_);
        trustedScanner = scanner_;
        maxDealAmount = maxDealAmount_;
    }

    /// @notice Lock `amount` of test USDC in escrow for a ticket.
    /// @dev The buyer (msg.sender) must have approved this contract to spend
    ///      `amount` first. The tokens are pulled in with transferFrom.
    /// @param ticketId The ticket being sold (bytes32, e.g. a hash of "OV-1001").
    /// @param seller   The seller who will be paid when the scanner checks in.
    /// @param amount   Amount of tokens (6 decimals) to lock in escrow.
    /// @param deadline Unix timestamp after which the deal can be refunded.
    /// @return dealId  The id of the new funded deal.
    function fund(
        bytes32 ticketId,
        address seller,
        uint256 amount,
        uint256 deadline
    ) external nonReentrant returns (uint256 dealId) {
        require(amount > 0, "OveloEscrow: amount must be greater than zero");
        require(amount <= maxDealAmount, "OveloEscrow: amount is above the max deal amount");
        require(seller != address(0), "OveloEscrow: seller cannot be the zero address");
        require(seller != msg.sender, "OveloEscrow: seller cannot be the buyer");
        require(deadline > block.timestamp, "OveloEscrow: deadline must be in the future");

        // A ticket can be funded again only after its previous deal was refunded.
        uint256 previous = dealIdForTicket[ticketId];
        if (previous != 0) {
            DealStatus previousStatus = deals[previous].status;
            require(previousStatus != DealStatus.Funded, "OveloEscrow: ticket already funded");
            require(previousStatus != DealStatus.Released, "OveloEscrow: ticket already sold");
        }

        dealId = _nextDealId++;

        // Pull the tokens out of the buyer's wallet and hold them here.
        token.safeTransferFrom(msg.sender, address(this), amount);

        deals[dealId] = Deal({
            dealId: dealId,
            ticketId: ticketId,
            buyer: msg.sender,
            seller: seller,
            amount: amount,
            deadline: deadline,
            status: DealStatus.Funded
        });
        dealIdForTicket[ticketId] = dealId;

        emit DealFunded(dealId, ticketId, msg.sender, seller, amount, deadline);
    }

    /// @notice Scanner confirms the ticket was checked in, paying the seller.
    /// @dev Only the `trustedScanner` may call this. A deal can only be checked
    ///      in once while it is Funded and before its deadline. A refunded deal
    ///      can never be checked in.
    /// @param dealId The deal to release.
    function checkIn(uint256 dealId) external nonReentrant {
        require(msg.sender == trustedScanner, "OveloEscrow: only the scanner can check in");

        Deal storage deal = deals[dealId];
        require(deal.status != DealStatus.None, "OveloEscrow: deal does not exist");
        require(
            deal.status != DealStatus.Released,
            "OveloEscrow: deal already checked in - rejected second scan"
        );
        require(deal.status != DealStatus.Refunded, "OveloEscrow: deal was already refunded");
        require(block.timestamp <= deal.deadline, "OveloEscrow: check-in window has passed");

        deal.status = DealStatus.Released;

        // Pay the seller exactly the locked amount.
        token.safeTransfer(deal.seller, deal.amount);

        emit DealReleased(dealId, deal.ticketId);
    }

    /// @notice Buyer recovers their tokens after the deadline.
    /// @dev Only the buyer, only after the deadline, and only while the deal is
    ///      still Funded (an already released or refunded deal cannot be refunded).
    /// @param dealId The deal to refund.
    function refund(uint256 dealId) external nonReentrant {
        Deal storage deal = deals[dealId];
        require(deal.status != DealStatus.None, "OveloEscrow: deal does not exist");
        require(msg.sender == deal.buyer, "OveloEscrow: only the buyer can refund");
        require(deal.status == DealStatus.Funded, "OveloEscrow: deal is not refundable");
        require(block.timestamp > deal.deadline, "OveloEscrow: deadline has not passed yet");

        deal.status = DealStatus.Refunded;

        // Give every locked token back to the buyer.
        token.safeTransfer(deal.buyer, deal.amount);

        emit DealRefunded(dealId, deal.ticketId);
    }

    /// @notice Read a deal by its id (the scanner is not required to own it).
    /// @param dealId The deal id.
    /// @return The full deal struct, reverts for unknown ids.
    function getDeal(uint256 dealId) external view returns (Deal memory) {
        require(deals[dealId].status != DealStatus.None, "OveloEscrow: deal does not exist");
        return deals[dealId];
    }

    /// @notice Find the current deal id for a ticket id (0 if never funded).
    /// @param ticketId The ticket id (bytes32).
    /// @return The dealId currently associated with the ticket, or 0.
    function getDealIdForTicket(bytes32 ticketId) external view returns (uint256) {
        return dealIdForTicket[ticketId];
    }
}