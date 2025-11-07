pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedMatchingSystem is ZamaEthereumConfig {
    struct Profile {
        address owner;
        euint32 encryptedInterests;
        uint256 publicProfileData;
        uint256 intimacyScore;
        bool isUnlocked;
    }

    mapping(address => Profile) public profiles;
    mapping(address => mapping(address => bool)) public matches;

    event ProfileCreated(address indexed owner);
    event MatchAttempted(address indexed user1, address indexed user2);
    event IntimacyIncreased(address indexed user1, address indexed user2, uint256 amount);
    event ProfileUnlocked(address indexed owner);

    constructor() ZamaEthereumConfig() {}

    function createProfile(
        externalEuint32 encryptedInterests,
        bytes calldata inputProof,
        uint256 publicProfileData
    ) external {
        require(profiles[msg.sender].owner == address(0), "Profile already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedInterests, inputProof)), "Invalid encrypted input");

        euint32 encryptedInterestsValue = FHE.fromExternal(encryptedInterests, inputProof);
        FHE.allowThis(encryptedInterestsValue);
        FHE.makePubliclyDecryptable(encryptedInterestsValue);

        profiles[msg.sender] = Profile({
            owner: msg.sender,
            encryptedInterests: encryptedInterestsValue,
            publicProfileData: publicProfileData,
            intimacyScore: 0,
            isUnlocked: false
        });

        emit ProfileCreated(msg.sender);
    }

    function attemptMatch(address user) external {
        require(profiles[msg.sender].owner != address(0), "Your profile does not exist");
        require(profiles[user].owner != address(0), "Target profile does not exist");
        require(!matches[msg.sender][user], "Already matched");

        euint32 user1Interests = profiles[msg.sender].encryptedInterests;
        euint32 user2Interests = profiles[user].encryptedInterests;

        euint32 matchScore = FHE.add(user1Interests, user2Interests);

        FHE.allowThis(matchScore);
        FHE.makePubliclyDecryptable(matchScore);

        matches[msg.sender][user] = true;
        matches[user][msg.sender] = true;

        emit MatchAttempted(msg.sender, user);
    }

    function increaseIntimacy(address user, uint256 amount) external {
        require(matches[msg.sender][user], "No match exists");
        require(amount > 0, "Invalid amount");

        profiles[msg.sender].intimacyScore += amount;
        profiles[user].intimacyScore += amount;

        if (profiles[msg.sender].intimacyScore >= 100) {
            profiles[msg.sender].isUnlocked = true;
            emit ProfileUnlocked(msg.sender);
        }

        if (profiles[user].intimacyScore >= 100) {
            profiles[user].isUnlocked = true;
            emit ProfileUnlocked(user);
        }

        emit IntimacyIncreased(msg.sender, user, amount);
    }

    function getEncryptedInterests(address user) external view returns (euint32) {
        require(profiles[user].owner != address(0), "Profile does not exist");
        return profiles[user].encryptedInterests;
    }

    function getProfileData(address user) external view returns (
        uint256 publicProfileData,
        uint256 intimacyScore,
        bool isUnlocked
    ) {
        require(profiles[user].owner != address(0), "Profile does not exist");
        return (
            profiles[user].publicProfileData,
            profiles[user].intimacyScore,
            profiles[user].isUnlocked
        );
    }

    function getMatchStatus(address user1, address user2) external view returns (bool) {
        return matches[user1][user2];
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

