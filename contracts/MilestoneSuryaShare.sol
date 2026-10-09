// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Hackathon demo. Fictional asset, test ETH, no legal ownership rights.
// V2 remains frozen in SuryaShare.sol so its deployed bytecode stays reproducible.
contract MilestoneSuryaShare is ERC20, ReentrancyGuard, EIP712 {
    uint256 public constant PROJECT_SHARES = 1000;
    uint256 public constant WEI_PER_DEMO_IDR = 1 gwei;
    uint256 public constant SHARE_PRICE = 100000 * WEI_PER_DEMO_IDR;
    uint256 public constant TARIFF_IDR = 1500;
    uint256 public constant CONTRACT_VERSION = 4;
    uint256 public constant MAX_PROOF_LIFETIME = 1 hours;
    bytes32 public constant REPORT_TYPEHASH = keccak256("VerifiedReport(uint32 period,uint256 kwh,uint256 costsIdr,uint256 reserveIdr,uint256 incomeWei,uint8 operatingStatus,bytes32 evidenceHash,uint256 validUntil)");
    address public immutable trustedVerifier;
    bool public immutable demoVerification;
    mapping(uint32 => bytes32) public reportEvidence;
    uint8 public lastOperatingStatus;
    struct Proof { uint8 operatingStatus; bytes32 evidenceHash; uint256 validUntil; bytes signature; }
    uint256 public constant REPORT_GRACE = 7 days;
    address public immutable operator;
    uint256 public availableShares = PROJECT_SHARES;
    uint256 public saleProceeds;
    address public immutable milestoneReviewer;
    uint256 public totalSaleProceeds;
    uint256 public releasedSaleProceeds;
    uint8 public approvedMilestones;
    enum MilestoneStatus { Unsubmitted, Pending, ChangesRequested, Approved }
    struct Milestone {
        MilestoneStatus status;
        uint32 revision;
        bytes32 evidenceHash;
        string evidenceReference;
        string reviewNote;
    }
    mapping(uint8 => Milestone) public milestones;
    event MilestoneSubmitted(uint8 indexed stage, uint32 revision, bytes32 evidenceHash, string evidenceReference);
    event MilestoneReviewed(uint8 indexed stage, uint32 revision, bytes32 evidenceHash, bool approved, string note);

    // Approval unlocks a cumulative percentage of actual purchases, including later purchases.
    // It never transfers funds or includes monthly income in the release allowance.
    function availableSaleProceeds() public view returns (uint256) {
        uint256 percent = approvedMilestones == 0 ? 0 : approvedMilestones == 1 ? 30 : approvedMilestones == 2 ? 70 : 100;
        return totalSaleProceeds * percent / 100 - releasedSaleProceeds;
    }

    function submitMilestone(uint8 stage, bytes32 evidenceHash, string calldata evidenceReference) external onlyOperator {
        require(stage < 3 && stage == approvedMilestones, "Submit the next milestone");
        Milestone storage m = milestones[stage];
        require(m.status != MilestoneStatus.Pending, "Already awaiting review");
        require(evidenceHash != bytes32(0) && bytes(evidenceReference).length > 0 && bytes(evidenceReference).length <= 512, "Evidence required or too long");
        m.status = MilestoneStatus.Pending;
        m.revision++;
        m.evidenceHash = evidenceHash;
        m.evidenceReference = evidenceReference;
        m.reviewNote = "";
        emit MilestoneSubmitted(stage, m.revision, evidenceHash, evidenceReference);
    }

    function reviewMilestone(uint8 stage, uint32 revision, bytes32 evidenceHash, bool approve, string calldata note) external {
        require(msg.sender == milestoneReviewer, "Milestone reviewer only");
        require(stage < 3 && stage == approvedMilestones, "Review the next milestone");
        Milestone storage m = milestones[stage];
        require(m.status == MilestoneStatus.Pending, "No pending submission");
        require(m.revision == revision && m.evidenceHash == evidenceHash, "Submission changed; review again");
        require(bytes(note).length <= 280 && (approve || bytes(note).length > 0), "Explain requested changes");
        m.reviewNote = note;
        m.status = approve ? MilestoneStatus.Approved : MilestoneStatus.ChangesRequested;
        if (approve) approvedMilestones++;
        emit MilestoneReviewed(stage, revision, evidenceHash, approve, note);
    }
    uint256 public revenuePerShare;
    uint256 public totalRevenue;
    uint32 public lastPeriod;
    uint32 public nextReportingPeriod;
    uint256 public reportingOpensAt;
    uint256 public reportDueAt;
    bool public purchasesPaused;
    mapping(address => uint256) private checkpoint;
    mapping(address => uint256) private credit;
    mapping(address => uint256) public totalClaimed;

    event SharesPurchased(address indexed buyer, uint256 shares, uint256 paid);
    event ReportPublished(uint32 indexed period, uint256 kwh, uint256 costsIdr, uint256 reserveIdr, uint256 deposited);
    event RevenueClaimed(address indexed holder, uint256 amount);
    event ProceedsWithdrawn(uint256 amount);
    event PurchasesPauseChanged(bool paused);
    event ReportVerified(uint32 indexed period, bytes32 indexed evidenceHash, address indexed verifier, uint8 operatingStatus, bool demo);

    modifier onlyOperator() {
        require(msg.sender == operator, "Operator only");
        _;
    }

    constructor(address verifier, bool demo, address reviewer) ERC20("SuryaShare Cikarang Demo", "SURYA") EIP712("SolInvictusReports", "1") {
        require(block.chainid == 31337 || block.chainid == 11155111, "Test networks only");
        require(verifier != address(0) && verifier != msg.sender, "Separate verifier required");
        require(reviewer != address(0) && reviewer != msg.sender && reviewer != verifier, "Separate milestone reviewer required");
        milestoneReviewer = reviewer;
        trustedVerifier = verifier;
        demoVerification = demo;
        operator = msg.sender;
        // Start with the last completed UTC month and allow seven onboarding days.
        uint32 current = _periodAt(block.timestamp);
        nextReportingPeriod = current % 100 == 1 ? current - 89 : current - 1;
        reportingOpensAt = _monthStart(current);
        reportDueAt = block.timestamp + REPORT_GRACE;
        _mint(msg.sender, PROJECT_SHARES);
    }

    function decimals() public pure override returns (uint8) { return 0; }

    function buyShares(uint256 shares) external payable nonReentrant {
        require(purchasesAllowed(), "Purchases paused or reporting overdue");
        require(msg.sender != operator, "Use an investor wallet");
        require(shares > 0 && shares <= availableShares, "Invalid share quantity");
        require(msg.value == shares * SHARE_PRICE, "Incorrect payment");
        availableShares -= shares;
        saleProceeds += msg.value;
        totalSaleProceeds += msg.value;
        _transfer(operator, msg.sender, shares);
        emit SharesPurchased(msg.sender, shares, msg.value);
    }

    function publishReport(uint32 period, uint256 kwh, uint256 costsIdr, uint256 reserveIdr, Proof calldata proof)
        external payable onlyOperator nonReentrant
    {
        require(period / 100 >= 2000 && period / 100 <= 2100 && period % 100 >= 1 && period % 100 <= 12, "Invalid month");
        require(period == nextReportingPeriod, "Report the next required month");
        require(block.timestamp >= reportingOpensAt, "Reporting month has not ended");
        require(kwh <= 1000000, "Invalid generation");
        require(costsIdr <= 1500000000 && reserveIdr <= 1500000000, "Invalid costs or reserve");
        uint256 gross = kwh * TARIFF_IDR;
        uint256 deductions = costsIdr + reserveIdr;
        // Losses are recorded in the event; they create no negative holder credit or debt.
        uint256 net = gross > deductions ? gross - deductions : 0;
        require(msg.value == net * WEI_PER_DEMO_IDR, "Incorrect revenue deposit");
        require(proof.operatingStatus >= 1 && proof.operatingStatus <= 3, "Invalid operating status");
        require(proof.evidenceHash != bytes32(0), "Evidence required");
        require(proof.validUntil >= block.timestamp && proof.validUntil <= block.timestamp + MAX_PROOF_LIFETIME, "Proof expired or too long");
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(REPORT_TYPEHASH, period, kwh, costsIdr, reserveIdr,
            msg.value, proof.operatingStatus, proof.evidenceHash, proof.validUntil)));
        require(ECDSA.recover(digest, proof.signature) == trustedVerifier, "Untrusted verification");
        reportEvidence[period] = proof.evidenceHash;
        lastOperatingStatus = proof.operatingStatus;
        lastPeriod = period;
        nextReportingPeriod = _nextMonth(period);
        reportingOpensAt = _monthStart(_nextMonth(nextReportingPeriod));
        reportDueAt = reportingOpensAt + REPORT_GRACE;
        // Whole shares and a 1 gwei/demo-IDR scale make every deposit exactly divisible by 1000.
        revenuePerShare += msg.value / PROJECT_SHARES;
        totalRevenue += msg.value;
        emit ReportPublished(period, kwh, costsIdr, reserveIdr, msg.value);
        emit ReportVerified(period, proof.evidenceHash, trustedVerifier, proof.operatingStatus, demoVerification);
    }

    function isReportingOverdue() public view returns (bool) {
        return block.timestamp > reportDueAt;
    }

    function purchasesAllowed() public view returns (bool) {
        return !purchasesPaused && !isReportingOverdue();
    }

    function setPurchasesPaused(bool paused) external onlyOperator {
        require(paused != purchasesPaused, "Purchase pause unchanged");
        purchasesPaused = paused;
        emit PurchasesPauseChanged(paused);
    }

    function reportingStatus() external view returns (uint32, uint256, uint256, bool, bool, bool) {
        return (nextReportingPeriod, reportingOpensAt, reportDueAt, purchasesPaused, isReportingOverdue(), purchasesAllowed());
    }

    function _nextMonth(uint32 period) private pure returns (uint32) {
        return period % 100 == 12 ? period + 89 : period + 1;
    }

    function _leap(uint256 year) private pure returns (bool) {
        return year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    }

    function _monthDays(uint256 year, uint256 month) private pure returns (uint256) {
        if (month == 2) return _leap(year) ? 29 : 28;
        return month == 4 || month == 6 || month == 9 || month == 11 ? 30 : 31;
    }

    function _periodAt(uint256 timestamp) private pure returns (uint32) {
        uint256 daysLeft = timestamp / 1 days;
        uint256 year = 1970;
        while (daysLeft >= (_leap(year) ? 366 : 365)) {
            daysLeft -= _leap(year) ? 366 : 365;
            year++;
        }
        require(year >= 2000 && year <= 2100, "Unsupported deployment year");
        uint256 month = 1;
        while (daysLeft >= _monthDays(year, month)) {
            daysLeft -= _monthDays(year, month);
            month++;
        }
        return uint32(year * 100 + month);
    }

    function _monthStart(uint32 period) private pure returns (uint256) {
        uint256 year = period / 100;
        uint256 daysSinceEpoch = 365 * (year - 1970)
            + (year - 1) / 4 - uint256(1969) / 4
            - ((year - 1) / 100 - uint256(1969) / 100)
            + (year - 1) / 400 - uint256(1969) / 400;
        for (uint256 month = 1; month < period % 100; month++) {
            daysSinceEpoch += _monthDays(year, month);
        }
        return daysSinceEpoch * 1 days;
    }

    function claimable(address holder) public view returns (uint256) {
        return credit[holder] + balanceOf(holder) * (revenuePerShare - checkpoint[holder]);
    }

    function claimRevenue() external nonReentrant {
        _settle(msg.sender);
        uint256 amount = credit[msg.sender];
        require(amount > 0, "No income to claim");
        credit[msg.sender] = 0;
        totalClaimed[msg.sender] += amount;
        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "Payout failed");
        emit RevenueClaimed(msg.sender, amount);
    }

    function withdrawSaleProceeds() external onlyOperator nonReentrant {
        uint256 amount = availableSaleProceeds();
        require(amount > 0, "Funding locked until approval");
        saleProceeds -= amount;
        releasedSaleProceeds += amount;
        (bool success,) = operator.call{value: amount}("");
        require(success, "Withdrawal failed");
        emit ProceedsWithdrawn(amount);
    }

    function _settle(address holder) private {
        credit[holder] = claimable(holder);
        checkpoint[holder] = revenuePerShare;
    }

    function _update(address from, address to, uint256 value) internal override {
        // Reserve the operator's unissued inventory; ordinary transfers cannot spend it.
        if (from == operator) require(balanceOf(from) >= value + availableShares, "Sale inventory reserved");
        if (from != address(0)) _settle(from);
        if (to != address(0) && to != from) _settle(to);
        super._update(from, to, value);
    }
}
