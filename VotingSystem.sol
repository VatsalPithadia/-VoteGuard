// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract VotingSystem {
    address public owner;

    // Define the different phases of the election lifecycle
    enum ElectionState { Registration, Voting, Ended }
    ElectionState public state;

    struct Candidate {
        uint256 id;
        string name;
        uint256 voteCount;
    }

    struct Voter {
        bool isRegistered;
        bool hasVoted;
        bytes32 biometricHash;
        uint256 votedCandidateId;
    }

    // Storage for candidates
    mapping(uint256 => Candidate) public candidates;
    uint256 public candidateCount;

    // Storage for voters
    mapping(address => Voter) public voters;

    uint256 public totalVotes;

    // Events
    event VoterRegistered(address indexed voterAddress);
    event CandidateRegistered(uint256 indexed candidateId, string name);
    event VoteCasted(address indexed voterAddress, uint256 indexed candidateId);
    event ElectionStateChanged(ElectionState newState);
    event ElectionEnded(uint256 winningCandidateId, string winningCandidateName, uint256 voteCount);

    // Access control modifier
    modifier onlyOwner() {
        require(msg.sender == owner, "Only the owner can perform this action");
        _;
    }

    // State control modifier
    modifier inState(ElectionState _state) {
        require(state == _state, "Invalid election state for this action");
        _;
    }

    constructor() {
        owner = msg.sender;
        state = ElectionState.Registration;
        emit ElectionStateChanged(state);
    }

    /**
     * @dev Register a new candidate. Only accessible during Registration phase by the admin.
     * @param _name Name of the candidate
     */
    function registerCandidate(string memory _name) external onlyOwner inState(ElectionState.Registration) {
        bytes memory tempName = bytes(_name);
        require(tempName.length > 0, "Candidate name cannot be empty");

        candidateCount++;
        candidates[candidateCount] = Candidate(candidateCount, _name, 0);
        
        emit CandidateRegistered(candidateCount, _name);
    }

    /**
     * @dev Register a new voter with their simulated biometric hash. Only accessible during Registration phase by admin.
     * @param _voterAddress Wallet address of the voter
     * @param _biometricHash A Keccak256 hash (or similar) representing the voter's biometric data
     */
    function registerVoter(address _voterAddress, bytes32 _biometricHash) external onlyOwner inState(ElectionState.Registration) {
        require(_voterAddress != address(0), "Invalid voter address");
        require(!voters[_voterAddress].isRegistered, "Voter is already registered");
        require(_biometricHash != bytes32(0), "Invalid biometric hash");
        
        voters[_voterAddress] = Voter({
            isRegistered: true,
            hasVoted: false,
            biometricHash: _biometricHash,
            votedCandidateId: 0
        });

        emit VoterRegistered(_voterAddress);
    }

    /**
     * @dev Transition the election state to Voting mode. Only owner.
     */
    function startVoting() external onlyOwner inState(ElectionState.Registration) {
        require(candidateCount > 0, "Cannot start voting without candidates");
        state = ElectionState.Voting;
        emit ElectionStateChanged(state);
    }

    /**
     * @dev Cast a vote for a candidate. Requires a valid biometric hash verification.
     * @param _candidateId ID of the candidate being voted for
     * @param _biometricHash The biometric hash to authenticate the voter
     */
    function castVote(uint256 _candidateId, bytes32 _biometricHash) external inState(ElectionState.Voting) {
        Voter storage sender = voters[msg.sender];
        
        require(sender.isRegistered, "Voter is not registered");
        require(!sender.hasVoted, "Voter has already voted");
        require(sender.biometricHash == _biometricHash, "Biometric verification failed");
        require(_candidateId > 0 && _candidateId <= candidateCount, "Invalid candidate ID");

        // Mark as voted BEFORE updating candidate count to prevent re-entrancy (though not strictly making external calls, it's best practice)
        sender.hasVoted = true;
        sender.votedCandidateId = _candidateId;
        
        candidates[_candidateId].voteCount++;
        totalVotes++;

        emit VoteCasted(msg.sender, _candidateId);
    }

    /**
     * @dev End the election. Only accessible by owner.
     */
    function endVoting() external onlyOwner inState(ElectionState.Voting) {
        state = ElectionState.Ended;
        emit ElectionStateChanged(state);
        
        // Optionally emit the winner upon finishing
        (uint256 winningId, string memory winningName, uint256 winningVotes) = _calculateWinner();
        emit ElectionEnded(winningId, winningName, winningVotes);
    }

    /**
     * @dev View function to fetch current vote counts for a specific candidate.
     * @param _candidateId ID of the candidate
     */
    function getCandidateVoteCount(uint256 _candidateId) external view returns (uint256) {
        require(_candidateId > 0 && _candidateId <= candidateCount, "Invalid candidate ID");
        return candidates[_candidateId].voteCount;
    }

    /**
     * @dev Declare the winner. Only callable after the election has ended.
     */
    function declareWinner() external view inState(ElectionState.Ended) returns (uint256 winningId, string memory winningName, uint256 winningVotes) {
        return _calculateWinner();
    }

    /**
     * @dev Internal function to tally up the winner.
     */
    function _calculateWinner() internal view returns (uint256 winningId, string memory winningName, uint256 winningVotes) {
        uint256 highestVoteCount = 0;
        uint256 currentWinnerId = 0;

        for (uint256 i = 1; i <= candidateCount; i++) {
            if (candidates[i].voteCount > highestVoteCount) {
                highestVoteCount = candidates[i].voteCount;
                currentWinnerId = i;
            }
        }

        if (currentWinnerId != 0) {
            return (currentWinnerId, candidates[currentWinnerId].name, highestVoteCount);
        } else {
            return (0, "No votes cast", 0);
        }
    }
}
