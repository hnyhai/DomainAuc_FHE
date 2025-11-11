pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DomainAuc_FHE is ZamaEthereumConfig {
    
    struct Auction {
        string domainName;                    
        euint32 encryptedBid;        
        uint256 startTime;          
        uint256 endTime;          
        address currentLeader;            
        address owner;               
        bool isActive;             
        uint32 decryptedBid; 
        bool isVerified; 
    }
    
    mapping(string => Auction) public auctions;
    mapping(string => mapping(address => bool)) public hasBid;
    
    string[] public auctionIds;
    
    event AuctionCreated(string indexed domainName, address indexed owner);
    event BidPlaced(string indexed domainName, address indexed bidder);
    event BidRevealed(string indexed domainName, address indexed bidder, uint32 decryptedBid);
    event AuctionConcluded(string indexed domainName, address indexed winner);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createAuction(
        string calldata domainName,
        uint256 startTime,
        uint256 endTime
    ) external {
        require(bytes(auctions[domainName].domainName).length == 0, "Auction already exists");
        require(startTime > block.timestamp, "Start time must be in future");
        require(endTime > startTime, "End time must be after start time");
        
        auctions[domainName] = Auction({
            domainName: domainName,
            encryptedBid: euint32.wrap(0),
            startTime: startTime,
            endTime: endTime,
            currentLeader: address(0),
            owner: msg.sender,
            isActive: true,
            decryptedBid: 0,
            isVerified: false
        });
        
        auctionIds.push(domainName);
        
        emit AuctionCreated(domainName, msg.sender);
    }
    
    function placeBid(
        string calldata domainName,
        externalEuint32 encryptedBid,
        bytes calldata inputProof
    ) external {
        require(bytes(auctions[domainName].domainName).length > 0, "Auction does not exist");
        require(block.timestamp >= auctions[domainName].startTime, "Auction not started");
        require(block.timestamp <= auctions[domainName].endTime, "Auction ended");
        require(!hasBid[domainName][msg.sender], "Already bid");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedBid, inputProof)), "Invalid encrypted bid");
        
        euint32 currentBid = auctions[domainName].encryptedBid;
        euint32 newBid = FHE.fromExternal(encryptedBid, inputProof);
        
        if (FHE.gt(newBid, currentBid)) {
            auctions[domainName].encryptedBid = newBid;
            auctions[domainName].currentLeader = msg.sender;
        }
        
        FHE.allowThis(auctions[domainName].encryptedBid);
        FHE.makePubliclyDecryptable(auctions[domainName].encryptedBid);
        
        hasBid[domainName][msg.sender] = true;
        
        emit BidPlaced(domainName, msg.sender);
    }
    
    function revealBid(
        string calldata domainName, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(auctions[domainName].domainName).length > 0, "Auction does not exist");
        require(block.timestamp > auctions[domainName].endTime, "Auction not ended");
        require(!auctions[domainName].isVerified, "Bid already revealed");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(auctions[domainName].encryptedBid);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        
        auctions[domainName].decryptedBid = decodedValue;
        auctions[domainName].isVerified = true;
        
        emit BidRevealed(domainName, auctions[domainName].currentLeader, decodedValue);
    }
    
    function concludeAuction(string calldata domainName) external {
        require(bytes(auctions[domainName].domainName).length > 0, "Auction does not exist");
        require(block.timestamp > auctions[domainName].endTime, "Auction not ended");
        require(auctions[domainName].isVerified, "Bid not revealed");
        require(auctions[domainName].isActive, "Auction already concluded");
        
        auctions[domainName].isActive = false;
        
        emit AuctionConcluded(domainName, auctions[domainName].currentLeader);
    }
    
    function getAuction(string calldata domainName) external view returns (
        string memory domain,
        uint256 startTime,
        uint256 endTime,
        address currentLeader,
        address owner,
        bool isActive,
        bool isVerified,
        uint32 decryptedBid
    ) {
        require(bytes(auctions[domainName].domainName).length > 0, "Auction does not exist");
        Auction storage auction = auctions[domainName];
        
        return (
            auction.domainName,
            auction.startTime,
            auction.endTime,
            auction.currentLeader,
            auction.owner,
            auction.isActive,
            auction.isVerified,
            auction.decryptedBid
        );
    }
    
    function getAllAuctionIds() external view returns (string[] memory) {
        return auctionIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}


