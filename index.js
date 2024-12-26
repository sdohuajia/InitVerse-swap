const { ethers } = require("ethers");
const fs = require('fs');

async function sleep(minutes) {
    return new Promise(resolve => setTimeout(resolve, minutes * 60 * 1000));
}

async function countdown(minutes) {
    const totalSeconds = minutes * 60;
    for (let i = totalSeconds; i > 0; i--) {
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        const mins = Math.floor(i / 60);
        const secs = i % 60;
        process.stdout.write(`下一次交易倒计时: ${mins}分${secs}秒`);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log('\n');
}

async function swapExactETHForTokens() {
    // 读取 token.txt 文件
    const [privateKey, walletAddress] = fs.readFileSync('token.txt', 'utf-8').trim().split(',');
    
    const provider = new ethers.JsonRpcProvider("https://rpc-testnet.inichain.com");
    const wallet = new ethers.Wallet(privateKey, provider);

    const routerAddress = "0x4ccB784744969D9B63C15cF07E622DDA65A88Ee7";
    const abi = [
        "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
        "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)"
    ];
    const contract = new ethers.Contract(routerAddress, abi, wallet);

    const path = [
        "0xfbecae21c91446f9c7b87e4e5869926998f99ffe",
        "0xcf259bca0315c6d32e877793b6a10e97e7647fde"
    ];

    const TOTAL_TRANSACTIONS = 144;
    const DELAY_MINUTES = 11;
    const SWAP_AMOUNT = "0.0001"; // ETH数量

    for (let i = 0; i < TOTAL_TRANSACTIONS; i++) {
        try {
            // 添加当前时间显示
            const currentTime = new Date().toLocaleString('zh-CN', { 
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
            console.log(`\n当前时间: ${currentTime}`);
            console.log(`执行第 ${i + 1}/${TOTAL_TRANSACTIONS} 次交易`);
            
            const swapAmountWei = ethers.parseEther(SWAP_AMOUNT);
            const amountsOut = await contract.getAmountsOut(swapAmountWei, path);
            const amountOutMin = ((amountsOut[1] * 95n) / 100n).toString();

            const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

            const tx = await contract.swapExactETHForTokens(
                amountOutMin, 
                path, 
                walletAddress, // 使用读取的钱包地址
                deadline, 
                {
                    value: swapAmountWei
                }
            );

            console.log("交易已发送：", tx.hash);
            console.log("发送金额：", SWAP_AMOUNT, "ETH");

            await tx.wait();
            console.log("交易已确认");

            if (i < TOTAL_TRANSACTIONS - 1) {
                console.log(`等待 ${DELAY_MINUTES} 分钟后继续下一次交易...\n`);
                await countdown(DELAY_MINUTES); // 使用倒计时显示
            }
        } catch (error) {
            console.error(`第 ${i + 1} 次交易失败:`, error);
            await sleep(1);
        }
    }
}

swapExactETHForTokens()
    .then(() => {
        console.log("\n所有交易已完成");
        process.exit(0);
    })
    .catch(error => {
        console.error("脚本执行错误:", error);
        process.exit(1);
    });
