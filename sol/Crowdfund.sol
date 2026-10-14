// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice One all-or-nothing campaign. Only use test ETH for this demonstration.
contract Crowdfund {
    address payable public immutable beneficiary;
    uint256 public immutable goal;
    uint256 public immutable deadline;
    uint256 public totalRaised;
    bool public withdrawn;
    bool public cancelled;
    event Cancelled(address indexed creator);
    mapping(address => uint256) public contributions;

    event Contributed(address indexed contributor, uint256 amount);
    event Refunded(address indexed contributor, uint256 amount);
    event Withdrawn(address indexed beneficiary, uint256 amount);

    constructor(address payable recipient, uint256 target, uint256 duration) {
        require(recipient != address(0) && target > 0 && duration > 0, "Invalid campaign");
        beneficiary = recipient;
        goal = target;
        deadline = block.timestamp + duration;
    }

    function contribute() external payable {
        require(!cancelled, "Campaign cancelled");
        require(block.timestamp < deadline, "Campaign ended");
        require(msg.value > 0, "Amount must be positive");
        contributions[msg.sender] += msg.value;
        totalRaised += msg.value;
        emit Contributed(msg.sender, msg.value);
    }

    function withdraw() external {
        require(!cancelled, "Campaign cancelled");
        require(msg.sender == beneficiary, "Only beneficiary");
        require(block.timestamp >= deadline && totalRaised >= goal, "Goal not settled");
        require(!withdrawn, "Already withdrawn");
        withdrawn = true;
        uint256 amount = address(this).balance;
        (bool ok,) = beneficiary.call{value: amount}("");
        require(ok, "Transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    function cancel() external {
        require(msg.sender == beneficiary, "Only beneficiary");
        require(!cancelled && block.timestamp < deadline, "Cancellation unavailable");
        cancelled = true;
        emit Cancelled(msg.sender);
    }

    function refund() external {
        require(cancelled || (block.timestamp >= deadline && totalRaised < goal), "Refund unavailable");
        uint256 amount = contributions[msg.sender];
        require(amount > 0, "Nothing to refund");
        contributions[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "Transfer failed");
        emit Refunded(msg.sender, amount);
    }
}
