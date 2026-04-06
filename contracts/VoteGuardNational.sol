// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title VoteGuardNational
/// @notice Region-scoped voting with verified-voter gating and one-vote enforcement.
/// @dev "Verified" is an on-chain allowlist set by an off-chain verifier (KYC/ZKP/authority).
contract VoteGuardNational is AccessControl, Pausable {
    bytes32 public constant CANDIDATE_ADMIN_ROLE = keccak256("CANDIDATE_ADMIN_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    struct Candidate {
        string name;
        string party;
        uint256 voteCount;
        bool active;
    }

    struct ConstituencyMeta {
        bool created;
        bool votingOpen;
        uint64 createdAt;
        uint64 votingOpenedAt;
        uint64 votingClosedAt;
    }

    // KYC/Eligibility gate
    mapping(address => bool) public isVerifiedVoter;

    // regionKey => meta
    mapping(bytes32 => ConstituencyMeta) public constituencyMeta;

    // regionKey => candidateId => candidate
    mapping(bytes32 => mapping(uint256 => Candidate)) private _candidates;

    // regionKey => number of candidates
    mapping(bytes32 => uint256) public candidateCount;

    // regionKey => voter => hasVoted
    mapping(bytes32 => mapping(address => bool)) public hasVoted;

    event VoterVerified(address indexed voter, bool verified);
    event ConstituencyCreated(bytes32 indexed regionKey, bytes32 indexed stateId, bytes32 indexed constituencyId);
    event VotingOpened(bytes32 indexed regionKey);
    event VotingClosed(bytes32 indexed regionKey);

    event CandidateAdded(bytes32 indexed regionKey, uint256 indexed candidateId, string name, string party);
    event CandidateStatusChanged(bytes32 indexed regionKey, uint256 indexed candidateId, bool active);

    event VoteCast(bytes32 indexed regionKey, address indexed voter, uint256 indexed candidateId);

    error NotVerified();
    error AlreadyVoted();
    error VotingNotOpen();
    error VotingAlreadyClosed();
    error CandidateNotFound();
    error CandidateInactive();
    error ConstituencyNotCreated();
    error ConstituencyAlreadyCreated();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CANDIDATE_ADMIN_ROLE, admin);
        _grantRole(VERIFIER_ROLE, admin);
    }

    // -----------------------------
    // Helpers
    // -----------------------------

    /// @notice Hash human-readable strings into compact IDs (frontend can precompute too).
    function idFromString(string calldata value) public pure returns (bytes32) {
        return keccak256(bytes(value));
    }

    /// @notice Compute the regionKey for a (state, constituency) pair.
    function regionKey(bytes32 stateId, bytes32 constituencyId) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(stateId, constituencyId));
    }

    // -----------------------------
    // Admin: safety controls
    // -----------------------------

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // -----------------------------
    // Verifier (KYC/ZKP authority)
    // -----------------------------

    /// @notice Mark an address as eligible to vote.
    /// @dev Your backend/verifier calls this after Auth0/KYC/ZKP success.
    function setVerifiedVoter(address voter, bool verified) external onlyRole(VERIFIER_ROLE) {
        isVerifiedVoter[voter] = verified;
        emit VoterVerified(voter, verified);
    }

    /// @notice Batch version for scaling.
    function setVerifiedVoters(address[] calldata voters, bool verified) external onlyRole(VERIFIER_ROLE) {
        for (uint256 i = 0; i < voters.length; i++) {
            isVerifiedVoter[voters[i]] = verified;
            emit VoterVerified(voters[i], verified);
        }
    }

    // -----------------------------
    // Constituency lifecycle
    // -----------------------------

    function createConstituency(bytes32 stateId, bytes32 constituencyId) external onlyRole(CANDIDATE_ADMIN_ROLE) {
        bytes32 key = regionKey(stateId, constituencyId);
        if (constituencyMeta[key].created) revert ConstituencyAlreadyCreated();

        constituencyMeta[key] = ConstituencyMeta({
            created: true,
            votingOpen: false,
            createdAt: uint64(block.timestamp),
            votingOpenedAt: 0,
            votingClosedAt: 0
        });

        emit ConstituencyCreated(key, stateId, constituencyId);
    }

    function openVoting(bytes32 stateId, bytes32 constituencyId) external onlyRole(CANDIDATE_ADMIN_ROLE) {
        bytes32 key = regionKey(stateId, constituencyId);
        if (!constituencyMeta[key].created) revert ConstituencyNotCreated();
        if (constituencyMeta[key].votingClosedAt != 0) revert VotingAlreadyClosed();

        constituencyMeta[key].votingOpen = true;
        constituencyMeta[key].votingOpenedAt = uint64(block.timestamp);
        emit VotingOpened(key);
    }

    function closeVoting(bytes32 stateId, bytes32 constituencyId) external onlyRole(CANDIDATE_ADMIN_ROLE) {
        bytes32 key = regionKey(stateId, constituencyId);
        if (!constituencyMeta[key].created) revert ConstituencyNotCreated();

        constituencyMeta[key].votingOpen = false;
        constituencyMeta[key].votingClosedAt = uint64(block.timestamp);
        emit VotingClosed(key);
    }

    // -----------------------------
    // Candidate management
    // -----------------------------

    function addCandidate(
        bytes32 stateId,
        bytes32 constituencyId,
        string calldata name,
        string calldata party
    ) external onlyRole(CANDIDATE_ADMIN_ROLE) {
        bytes32 key = regionKey(stateId, constituencyId);
        if (!constituencyMeta[key].created) revert ConstituencyNotCreated();

        uint256 id = candidateCount[key];
        candidateCount[key] = id + 1;

        _candidates[key][id] = Candidate({name: name, party: party, voteCount: 0, active: true});
        emit CandidateAdded(key, id, name, party);
    }

    function setCandidateActive(
        bytes32 stateId,
        bytes32 constituencyId,
        uint256 candidateId,
        bool active
    ) external onlyRole(CANDIDATE_ADMIN_ROLE) {
        bytes32 key = regionKey(stateId, constituencyId);
        if (candidateId >= candidateCount[key]) revert CandidateNotFound();
        _candidates[key][candidateId].active = active;
        emit CandidateStatusChanged(key, candidateId, active);
    }

    function getCandidate(
        bytes32 stateId,
        bytes32 constituencyId,
        uint256 candidateId
    ) external view returns (Candidate memory) {
        bytes32 key = regionKey(stateId, constituencyId);
        if (candidateId >= candidateCount[key]) revert CandidateNotFound();
        return _candidates[key][candidateId];
    }

    // -----------------------------
    // Voting
    // -----------------------------

    function vote(bytes32 stateId, bytes32 constituencyId, uint256 candidateId) external whenNotPaused {
        if (!isVerifiedVoter[msg.sender]) revert NotVerified();

        bytes32 key = regionKey(stateId, constituencyId);
        ConstituencyMeta memory meta = constituencyMeta[key];
        if (!meta.created) revert ConstituencyNotCreated();
        if (!meta.votingOpen) revert VotingNotOpen();
        if (meta.votingClosedAt != 0) revert VotingAlreadyClosed();

        if (hasVoted[key][msg.sender]) revert AlreadyVoted();
        if (candidateId >= candidateCount[key]) revert CandidateNotFound();

        Candidate storage c = _candidates[key][candidateId];
        if (!c.active) revert CandidateInactive();

        hasVoted[key][msg.sender] = true;
        unchecked {
            c.voteCount += 1;
        }

        emit VoteCast(key, msg.sender, candidateId);
    }
}

