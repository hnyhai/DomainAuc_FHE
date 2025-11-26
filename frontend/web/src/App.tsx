import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface DomainAuction {
  id: string;
  name: string;
  encryptedBid: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  decryptedValue: number;
  isVerified: boolean;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [auctions, setAuctions] = useState<DomainAuction[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingAuction, setCreatingAuction] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newAuctionData, setNewAuctionData] = useState({ name: "", bid: "", description: "" });
  const [selectedAuction, setSelectedAuction] = useState<DomainAuction | null>(null);
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
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
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
      const auctionsList: DomainAuction[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          auctionsList.push({
            id: businessId,
            name: businessData.name,
            encryptedBid: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            decryptedValue: Number(businessData.decryptedValue) || 0,
            isVerified: businessData.isVerified
          });
        } catch (e) {
          console.error('Error loading auction data:', e);
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

  const updateStats = (auctions: DomainAuction[]) => {
    const total = auctions.length;
    const verified = auctions.filter(a => a.isVerified).length;
    const active = auctions.filter(a => a.timestamp > Date.now()/1000 - 86400).length;
    setStats({ total, verified, active });
  };

  const createAuction = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingAuction(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating auction with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const bidValue = parseInt(newAuctionData.bid) || 0;
      const businessId = `domain-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, bidValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newAuctionData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newAuctionData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
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

  const decryptBid = async (auctionId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const auctionData = await contractRead.getBusinessData(auctionId);
      if (auctionData.isVerified) {
        const storedValue = Number(auctionData.decryptedValue) || 0;
        setDecryptedBid(storedValue);
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Bid already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(auctionId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(auctionId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      const bidValue = Number(clearValue);
      
      await loadData();
      setDecryptedBid(bidValue);
      
      setTransactionStatus({ visible: true, status: "success", message: "Bid decrypted!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return bidValue;
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Bid already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      if (result) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredAuctions = auctions.filter(auction => 
    auction.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    auction.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Domain Auction</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Wallet to Start</h2>
            <p>Connect your wallet to access encrypted domain auctions.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system initialization</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Bid on domains privately</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption...</p>
        <p>Status: {fhevmInitializing ? "Initializing" : status}</p>
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
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <div className="search-container">
            <input 
              type="text" 
              placeholder="Search domains..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <button className="search-btn">🔍</button>
          </div>
          
          <div className="stats-panels">
            <div className="panel">
              <h3>Total Auctions</h3>
              <div className="stat-value">{stats.total}</div>
            </div>
            
            <div className="panel">
              <h3>Verified Bids</h3>
              <div className="stat-value">{stats.verified}</div>
            </div>
            
            <div className="panel">
              <h3>Active Now</h3>
              <div className="stat-value">{stats.active}</div>
            </div>
          </div>
        </div>
        
        <div className="auctions-section">
          <div className="section-header">
            <h2>Domain Auctions</h2>
            <div className="header-actions">
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
              <button 
                onClick={callIsAvailable} 
                className="check-btn"
              >
                Check Contract
              </button>
            </div>
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
                  <span>Created: {new Date(auction.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="auction-status">
                  {auction.isVerified ? 
                    `✅ Verified Bid: ${auction.decryptedValue}` : 
                    "🔓 Encrypted Bid"
                  }
                </div>
                <div className="auction-creator">Creator: {auction.creator.substring(0, 6)}...{auction.creator.substring(38)}</div>
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
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptBid={() => decryptBid(selectedAuction.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
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
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Your bid will be encrypted with Zama FHE</p>
          </div>
          
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
              placeholder="Enter starting bid..." 
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
              placeholder="Describe this domain..." 
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
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Auction"}
          </button>
        </div>
      </div>
    </div>
  );
};

const AuctionDetailModal: React.FC<{
  auction: DomainAuction;
  onClose: () => void;
  decryptedBid: number | null;
  isDecrypting: boolean;
  decryptBid: () => Promise<number | null>;
}> = ({ auction, onClose, decryptedBid, isDecrypting, decryptBid }) => {
  const handleDecrypt = async () => {
    if (decryptedBid !== null) { 
      setDecryptedBid(null); 
      return; 
    }
    
    await decryptBid();
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
              <span>Created:</span>
              <strong>{new Date(auction.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Bid Data</h3>
            
            <div className="data-row">
              <div className="data-label">Bid Amount:</div>
              <div className="data-value">
                {auction.isVerified ? 
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
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : auction.isVerified ? (
                  "✅ Verified"
                ) : decryptedBid !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Bid"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Bid Encryption</strong>
                <p>Your bid is encrypted on-chain using Zama FHE technology.</p>
              </div>
            </div>
          </div>
          
          <div className="chart-section">
            <h3>Bid Verification Process</h3>
            <div className="fhe-flow">
              <div className="flow-step">
                <div className="step-icon">1</div>
                <div className="step-content">
                  <h4>Encrypt Bid</h4>
                  <p>Bid encrypted with FHE before submission</p>
                </div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">2</div>
                <div className="step-content">
                  <h4>On-chain Storage</h4>
                  <p>Encrypted bid stored securely on blockchain</p>
                </div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">3</div>
                <div className="step-content">
                  <h4>Offline Decryption</h4>
                  <p>Client decrypts bid using relayer-sdk</p>
                </div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">4</div>
                <div className="step-content">
                  <h4>On-chain Verification</h4>
                  <p>Proof submitted for FHE signature validation</p>
                </div>
              </div>
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
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


