// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Hackathon demo. Fictional asset, test ETH, no legal ownership rights.
contract SuryaShare is ERC20, ReentrancyGuard {
    uint256 public constant PROJECT_SHARES = 1000;
    uint256 public constant WEI_PER_DEMO_IDR = 1 gwei;
    uint256 public constant SHARE_PRICE = 100000 * WEI_PER_DEMO_IDR;
    uint256 public constant TARIFF_IDR = 1500;
    address public immutable operator;
    uint256 public availableShares = PROJECT_SHARES;
    uint256 public saleProceeds;
    uint256 public revenuePerShare;
    uint256 public totalRevenue;
    uint32 public lastPeriod;
    mapping(address => uint256) private checkpoint;
    mapping(address => uint256) private credit;
    mapping(address => uint256) public totalClaimed;

    event SharesPurchased(address indexed buyer, uint256 shares, uint256 paid);
    event ReportPublished(uint32 indexed period, uint256 kwh, uint256 costsIdr, uint256 reserveIdr, uint256 deposited);
    event RevenueClaimed(address indexed holder, uint256 amount);
    event ProceedsWithdrawn(uint256 amount);

    modifier onlyOperator() {
        require(msg.sender == operator, "Operator only");
        _;
    }

    constructor() ERC20("SuryaShare Cikarang Demo", "SURYA") {
        require(block.chainid == 31337 || block.chainid == 11155111, "Test networks only");
        operator = msg.sender;
        _mint(msg.sender, PROJECT_SHARES);
    }

    function decimals() public pure override returns (uint8) { return 0; }

    function buyShares(uint256 shares) external payable nonReentrant {
        require(msg.sender != operator, "Use an investor wallet");
        require(shares > 0 && shares <= availableShares, "Invalid share quantity");
        require(msg.value == shares * SHARE_PRICE, "Incorrect payment");
        availableShares -= shares;
        saleProceeds += msg.value;
        _transfer(operator, msg.sender, shares);
        emit SharesPurchased(msg.sender, shares, msg.value);
    }

    function publishReport(uint32 period, uint256 kwh, uint256 costsIdr, uint256 reserveIdr)
        external payable onlyOperator nonReentrant
    {
        require(period / 100 >= 2000 && period / 100 <= 2100 && period % 100 >= 1 && period % 100 <= 12, "Invalid month");
        require(period > lastPeriod, "Period already reported or out of order");
        require(kwh > 0 && kwh <= 1000000, "Invalid generation");
        uint256 gross = kwh * TARIFF_IDR;
        require(costsIdr + reserveIdr < gross, "No distributable income");
        require(msg.value == (gross - costsIdr - reserveIdr) * WEI_PER_DEMO_IDR, "Incorrect revenue deposit");
        lastPeriod = period;
        // Whole shares and a 1 gwei/demo-IDR scale make every deposit exactly divisible by 1000.
        revenuePerShare += msg.value / PROJECT_SHARES;
        totalRevenue += msg.value;
        emit ReportPublished(period, kwh, costsIdr, reserveIdr, msg.value);
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
        uint256 amount = saleProceeds;
        require(amount > 0, "No proceeds");
        saleProceeds = 0;
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
