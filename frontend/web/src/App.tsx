import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface BlindDateProfile {
  id: string;
  name: string;
  age: number;
  interests: string;
  matchScore: number;
  intimacyLevel: number;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedValue: number;
  encryptedValueHandle?: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<BlindDateProfile[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newProfileData, setNewProfileData] = useState({ 
    name: "", 
    age: "", 
    interests: "",
    matchScore: "" 
  });
  const [selectedProfile, setSelectedProfile] = useState<BlindDateProfile | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredProfiles, setFilteredProfiles] = useState<BlindDateProfile[]>([]);
  const [operationHistory, setOperationHistory] = useState<string[]>([]);
  const [stats, setStats] = useState({
    totalProfiles: 0,
    verifiedProfiles: 0,
    avgIntimacy: 0,
    highMatches: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [contractAddress, setContractAddress] = useState("");

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

  useEffect(() => {
    const filtered = profiles.filter(profile =>
      profile.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      profile.interests.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredProfiles(filtered);
    
    updateStats(filtered);
  }, [profiles, searchTerm]);

  const updateStats = (profileList: BlindDateProfile[]) => {
    const total = profileList.length;
    const verified = profileList.filter(p => p.isVerified).length;
    const avgIntimacy = total > 0 ? profileList.reduce((sum, p) => sum + p.intimacyLevel, 0) / total : 0;
    const highMatches = profileList.filter(p => p.matchScore >= 80).length;
    
    setStats({ totalProfiles: total, verifiedProfiles: verified, avgIntimacy, highMatches });
  };

  const addToHistory = (operation: string) => {
    setOperationHistory(prev => [
      `${new Date().toLocaleTimeString()}: ${operation}`,
      ...prev.slice(0, 9)
    ]);
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const profilesList: BlindDateProfile[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          profilesList.push({
            id: businessId,
            name: businessData.name,
            age: Number(businessData.publicValue1) || 0,
            interests: businessData.description,
            matchScore: Number(businessData.publicValue2) || 0,
            intimacyLevel: Number(businessData.decryptedValue) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setProfiles(profilesList);
      addToHistory(`Loaded ${profilesList.length} profiles`);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createProfile = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingProfile(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating profile with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const matchScore = parseInt(newProfileData.matchScore) || 0;
      const businessId = `profile-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, matchScore);
      
      const tx = await contract.createBusinessData(
        businessId,
        newProfileData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newProfileData.age) || 0,
        matchScore,
        newProfileData.interests
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Profile created successfully!" });
      addToHistory(`Created profile: ${newProfileData.name}`);
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewProfileData({ name: "", age: "", interests: "", matchScore: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingProfile(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      addToHistory(`Decrypted intimacy level: ${clearValue}`);
      setTransactionStatus({ visible: true, status: "success", message: "Intimacy level decrypted!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
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
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const handleIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and working!" 
      });
      addToHistory("Checked contract availability");
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStatsChart = () => {
    return (
      <div className="stats-chart">
        <div className="chart-row">
          <div className="chart-label">Total Profiles</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${Math.min(100, stats.totalProfiles * 10)}%` }}
            >
              <span className="bar-value">{stats.totalProfiles}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Verified Profiles</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${stats.totalProfiles > 0 ? (stats.verifiedProfiles / stats.totalProfiles) * 100 : 0}%` }}
            >
              <span className="bar-value">{stats.verifiedProfiles}/{stats.totalProfiles}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Avg Intimacy</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${stats.avgIntimacy}%` }}
            >
              <span className="bar-value">{stats.avgIntimacy.toFixed(1)}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">High Matches (80+)</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${stats.totalProfiles > 0 ? (stats.highMatches / stats.totalProfiles) * 100 : 0}%` }}
            >
              <span className="bar-value">{stats.highMatches}</span>
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
            <h1>❤️ 隐私盲盒约会</h1>
            <p>FHE-based Blind Dating</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>连接钱包开始隐私约会</h2>
            <p>使用全同态加密技术保护您的约会资料，只有匹配成功才能解锁真实信息</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>连接您的加密钱包</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE系统自动初始化</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>开始安全的隐私约会体验</p>
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
        <p>初始化FHE加密系统...</p>
        <p className="loading-note">这可能需要一些时间</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加载加密约会系统...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>❤️ 隐私盲盒约会</h1>
          <p>FHE-based Blind Dating</p>
        </div>
        
        <div className="header-actions">
          <button onClick={handleIsAvailable} className="test-btn">
            🔍 测试合约
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            ✨ 创建资料
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-section">
          <h2>📊 约会数据统计</h2>
          {renderStatsChart()}
        </div>
        
        <div className="search-section">
          <div className="search-bar">
            <input
              type="text"
              placeholder="🔍 搜索姓名或兴趣..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "🔄 刷新中..." : "🔄 刷新"}
            </button>
          </div>
        </div>
        
        <div className="profiles-section">
          <h2>💫 匹配推荐</h2>
          <div className="profiles-grid">
            {filteredProfiles.length === 0 ? (
              <div className="no-profiles">
                <p>暂无匹配资料</p>
                <button className="create-btn" onClick={() => setShowCreateModal(true)}>
                  创建第一个资料
                </button>
              </div>
            ) : filteredProfiles.map((profile) => (
              <div 
                className={`profile-card ${profile.isVerified ? "verified" : ""}`}
                key={profile.id}
                onClick={() => setSelectedProfile(profile)}
              >
                <div className="card-header">
                  <h3>{profile.name}</h3>
                  <span className="age">{profile.age}岁</span>
                </div>
                <div className="card-content">
                  <p className="interests">兴趣: {profile.interests}</p>
                  <div className="match-score">
                    <span>匹配度: </span>
                    <div className="score-bar">
                      <div 
                        className="score-fill" 
                        style={{ width: `${profile.matchScore}%` }}
                      ></div>
                      <span className="score-text">{profile.matchScore}%</span>
                    </div>
                  </div>
                  <div className="intimacy-level">
                    <span>亲密度: </span>
                    <span className={`intimacy ${profile.isVerified ? "unlocked" : "locked"}`}>
                      {profile.isVerified ? `Lv.${profile.decryptedValue}` : "🔒 未解锁"}
                    </span>
                  </div>
                </div>
                <div className="card-footer">
                  <span className="creator">{profile.creator.substring(0, 6)}...{profile.creator.substring(38)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="history-section">
          <h3>📝 操作记录</h3>
          <div className="history-list">
            {operationHistory.length === 0 ? (
              <p>暂无操作记录</p>
            ) : (
              operationHistory.map((record, index) => (
                <div key={index} className="history-item">
                  {record}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateProfile 
          onSubmit={createProfile} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingProfile} 
          profileData={newProfileData} 
          setProfileData={setNewProfileData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedProfile && (
        <ProfileDetailModal 
          profile={selectedProfile} 
          onClose={() => setSelectedProfile(null)} 
          decryptData={() => decryptData(selectedProfile.id)}
          isDecrypting={fheIsDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateProfile: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  profileData: any;
  setProfileData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, profileData, setProfileData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setProfileData({ ...profileData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-profile-modal">
        <div className="modal-header">
          <h2>✨ 创建约会资料</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>🔐 FHE加密保护</strong>
            <p>匹配度将使用Zama FHE进行加密保护（仅限整数）</p>
          </div>
          
          <div className="form-group">
            <label>姓名 *</label>
            <input 
              type="text" 
              name="name" 
              value={profileData.name} 
              onChange={handleChange} 
              placeholder="输入您的姓名..." 
            />
          </div>
          
          <div className="form-group">
            <label>年龄 *</label>
            <input 
              type="number" 
              name="age" 
              value={profileData.age} 
              onChange={handleChange} 
              placeholder="输入年龄..." 
              min="18"
              max="100"
            />
          </div>
          
          <div className="form-group">
            <label>兴趣标签 *</label>
            <input 
              type="text" 
              name="interests" 
              value={profileData.interests} 
              onChange={handleChange} 
              placeholder="例如：旅行、音乐、编程..." 
            />
          </div>
          
          <div className="form-group">
            <label>初始匹配度 (0-100) *</label>
            <input 
              type="number" 
              name="matchScore" 
              value={profileData.matchScore} 
              onChange={handleChange} 
              placeholder="0-100之间的整数" 
              min="0"
              max="100"
            />
            <div className="data-type-label">🔐 FHE加密整数</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !profileData.name || !profileData.age || !profileData.interests || !profileData.matchScore} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "🔐 加密中..." : "创建资料"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ProfileDetailModal: React.FC<{
  profile: BlindDateProfile;
  onClose: () => void;
  decryptData: () => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ profile, onClose, decryptData, isDecrypting }) => {
  const [localIntimacy, setLocalIntimacy] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setLocalIntimacy(decrypted);
    }
  };

  const intimacyLevel = profile.isVerified ? profile.decryptedValue : localIntimacy;

  return (
    <div className="modal-overlay">
      <div className="profile-detail-modal">
        <div className="modal-header">
          <h2>💖 资料详情</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="profile-info">
            <div className="info-grid">
              <div className="info-item">
                <span>姓名:</span>
                <strong>{profile.name}</strong>
              </div>
              <div className="info-item">
                <span>年龄:</span>
                <strong>{profile.age}岁</strong>
              </div>
              <div className="info-item">
                <span>兴趣:</span>
                <strong>{profile.interests}</strong>
              </div>
              <div className="info-item">
                <span>匹配度:</span>
                <strong>{profile.matchScore}%</strong>
              </div>
              <div className="info-item">
                <span>亲密度:</span>
                <strong className={`intimacy ${profile.isVerified ? "unlocked" : "locked"}`}>
                  {intimacyLevel !== null ? `Lv.${intimacyLevel}` : "🔒 加密中"}
                </strong>
              </div>
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>🔐 同态加密状态</h3>
            <div className="encryption-status">
              <div className="status-item">
                <span>匹配度加密:</span>
                <span className="status-badge encrypted">🔐 已加密</span>
              </div>
              <div className="status-item">
                <span>亲密度验证:</span>
                <span className={`status-badge ${profile.isVerified ? "verified" : "pending"}`}>
                  {profile.isVerified ? "✅ 链上验证" : "⏳ 待验证"}
                </span>
              </div>
            </div>
            
            {!profile.isVerified && (
              <button 
                className={`decrypt-btn ${isDecrypting ? "decrypting" : ""}`}
                onClick={handleDecrypt}
                disabled={isDecrypting}
              >
                {isDecrypting ? "🔓 验证中..." : "🔓 验证亲密度"}
              </button>
            )}
          </div>
          
          {intimacyLevel !== null && (
            <div className="unlocked-content">
              <h3>🎉 解锁成功！</h3>
              <p>亲密度达到 Lv.{intimacyLevel}，可以开始聊天了！</p>
              <div className="chat-preview">
                <div className="message incoming">
                  <p>你好！很高兴匹配到你 😊</p>
                </div>
                <div className="message outgoing">
                  <p>我也很高兴！你的{profile.interests}很有趣！</p>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">关闭</button>
          {intimacyLevel !== null && (
            <button className="chat-btn">💬 开始聊天</button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

