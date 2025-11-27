import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface DomainAuctionData {
  id: string;
  name: string;
  encryptedBid: string;
  currentPrice: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [auctions, setAuctions] = useState<DomainAuctionData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingAuction, setCreatingAuction] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newAuctionData, setNewAuctionData] = useState({ name: "", bid: "", description: "" });
  const [selectedAuction, setSelectedAuction] = useState<DomainAuctionData | null>(null);
  const [decryptedBid, setDecryptedBid] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [stats, setStats] = useState({ total: 0, verified: 0, active: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ visible: true, status: "error", message: "FHEVM initialization failed" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const auctionsList: DomainAuctionData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          auctionsList.push({
            id: businessId,
            name: businessData.name,
            encryptedBid: businessId,
            currentPrice: Number(businessData.publicValue1) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setAuctions(auctionsList);
      updateStats(auctionsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (data: DomainAuctionData[]) => {
    setStats({
      total: data.length,
      verified: data.filter(a => a.isVerified).length,
      active: data.filter(a => Date.now()/1000 - a.timestamp < 60 * 60 * 24).length
    });
  };

  const createAuction = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingAuction(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating auction with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const bidValue = parseInt(newAuctionData.bid) || 0;
      const businessId = `domain-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, bidValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newAuctionData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        bidValue,
        0,
        newAuctionData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Auction created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewAuctionData({ name: "", bid: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingAuction(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const filteredAuctions = auctions.filter(auction => 
    auction.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStats = () => {
    return (
      <div className="stats-panel">
        <div className="stat-item">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total Auctions</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{stats.verified}</div>
          <div className="stat-label">Verified</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{stats.active}</div>
          <div className="stat-label">Active</div>
        </div>
      </div>
    );
  };

  const renderFeatures = () => {
    return (
      <div className="features-panel">
        <h3>FHE Domain Auction Features</h3>
        <div className="feature-list">
          <div className="feature-item">
            <div className="feature-icon">🔒</div>
            <div className="feature-content">
              <h4>Encrypted Bidding</h4>
              <p>All bids are encrypted using FHE to prevent front-running</p>
            </div>
          </div>
          <div className="feature-item">
            <div className="feature-icon">⚖️</div>
            <div className="feature-content">
              <h4>Vickrey Auction</h4>
              <p>Second-price auction mechanism for fair pricing</p>
            </div>
          </div>
          <div className="feature-item">
            <div className="feature-icon">🔄</div>
            <div className="feature-content">
              <h4>Auto Transfer</h4>
              <p>Domain ownership automatically transferred to winner</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Domain Auction</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <h2>Connect Your Wallet</h2>
            <p>Connect your wallet to participate in encrypted domain auctions</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted auctions...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE Domain Auction</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Auction
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="left-panel">
          {renderStats()}
          {renderFeatures()}
        </div>
        
        <div className="right-panel">
          <div className="search-section">
            <input
              type="text"
              placeholder="Search domains..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <button 
              onClick={loadData} 
              className="refresh-btn" 
              disabled={isRefreshing}
            >
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          
          <div className="auctions-list">
            {filteredAuctions.length === 0 ? (
              <div className="no-auctions">
                <p>No domain auctions found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Auction
                </button>
              </div>
            ) : filteredAuctions.map((auction, index) => (
              <div 
                className={`auction-item ${selectedAuction?.id === auction.id ? "selected" : ""} ${auction.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedAuction(auction)}
              >
                <div className="auction-title">{auction.name}</div>
                <div className="auction-meta">
                  <span>Current Price: {auction.currentPrice}</span>
                  <span>Created: {new Date(auction.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="auction-status">
                  Status: {auction.isVerified ? "✅ Verified" : "🔓 Pending"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateAuction 
          onSubmit={createAuction} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingAuction} 
          auctionData={newAuctionData} 
          setAuctionData={setNewAuctionData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedAuction && (
        <AuctionDetailModal 
          auction={selectedAuction} 
          onClose={() => { 
            setSelectedAuction(null); 
            setDecryptedBid(null); 
          }} 
          decryptedBid={decryptedBid} 
          setDecryptedBid={setDecryptedBid} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedAuction.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-message">{transactionStatus.message}</div>
        </div>
      )}
    </div>
  );
};

const ModalCreateAuction: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  auctionData: any;
  setAuctionData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, auctionData, setAuctionData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'bid') {
      const intValue = value.replace(/[^\d]/g, '');
      setAuctionData({ ...auctionData, [name]: intValue });
    } else {
      setAuctionData({ ...auctionData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-auction-modal">
        <div className="modal-header">
          <h2>New Domain Auction</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="form-group">
            <label>Domain Name *</label>
            <input 
              type="text" 
              name="name" 
              value={auctionData.name} 
              onChange={handleChange} 
              placeholder="Enter domain name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Starting Bid (ETH) *</label>
            <input 
              type="number" 
              name="bid" 
              value={auctionData.bid} 
              onChange={handleChange} 
              placeholder="Enter bid amount..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={auctionData.description} 
              onChange={handleChange} 
              placeholder="Enter description..." 
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !auctionData.name || !auctionData.bid} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Auction"}
          </button>
        </div>
      </div>
    </div>
  );
};

const AuctionDetailModal: React.FC<{
  auction: DomainAuctionData;
  onClose: () => void;
  decryptedBid: number | null;
  setDecryptedBid: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ auction, onClose, decryptedBid, setDecryptedBid, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedBid !== null) { 
      setDecryptedBid(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedBid(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="auction-detail-modal">
        <div className="modal-header">
          <h2>Auction Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="auction-info">
            <div className="info-item">
              <span>Domain:</span>
              <strong>{auction.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{auction.creator.substring(0, 6)}...{auction.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Current Price:</span>
              <strong>{auction.currentPrice} ETH</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Bid Data</h3>
            
            <div className="data-row">
              <div className="data-label">Bid Amount:</div>
              <div className="data-value">
                {auction.isVerified && auction.decryptedValue ? 
                  `${auction.decryptedValue} ETH (Verified)` : 
                  decryptedBid !== null ? 
                  `${decryptedBid} ETH (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(auction.isVerified || decryptedBid !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : auction.isVerified ? "Verified" : decryptedBid !== null ? "Re-verify" : "Decrypt"}
              </button>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!auction.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              Verify on-chain
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;