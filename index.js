const { ethers } = require("ethers");
const fs = require('fs');
const axios = require('axios');
const HttpsProxyAgent = require('https-proxy-agent');
const SocksProxyAgent = require('socks-proxy-agent');

// 颜色输出函数
const colorize = {
    green: (text) => `\x1b[32m${text}\x1b[0m`,
    red: (text) => `\x1b[31m${text}\x1b[0m`,
    yellow: (text) => `\x1b[33m${text}\x1b[0m`,
    blue: (text) => `\x1b[34m${text}\x1b[0m`,
    cyan: (text) => `\x1b[36m${text}\x1b[0m`,
    magenta: (text) => `\x1b[35m${text}\x1b[0m`,
    white: (text) => `\x1b[37m${text}\x1b[0m`,
};

// 日志函数
const logger = {
    info: (message) => console.log(colorize.blue(message)),
    success: (message) => console.log(colorize.green(message)),
    error: (message) => console.log(colorize.red(message)),
    warning: (message) => console.log(colorize.yellow(message)),
    tx: (message) => console.log(colorize.cyan(message)),
};

// 睡眠函数
const sleep = (minutes) => new Promise(resolve => setTimeout(resolve, minutes * 60 * 1000));

// 倒计时显示
async function countdown(minutes) {
    const totalSeconds = minutes * 60;
    for (let i = totalSeconds; i > 0; i--) {
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        const mins = Math.floor(i / 60);
        const secs = i % 60;
        process.stdout.write(`下一轮交易倒计时: ${mins}分${secs}秒`);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log('\n');
}

// 读取钱包配置
function getWallets() {
    try {
        const content = fs.readFileSync('token.txt', 'utf-8');
        const wallets = content
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map((line, index) => {
                const [privateKey, walletAddress] = line.split(',').map(s => s.trim());
                if (!privateKey || !walletAddress) {
                    logger.warning(`第 ${index + 1} 行格式不正确: ${line}`);
                    return null;
                }
                return { privateKey, walletAddress };
            })
            .filter(wallet => wallet !== null);

        logger.info(`成功加载 ${wallets.length} 个钱包`);
        return wallets;
    } catch (error) {
        logger.error('读取钱包文件失败:', error.message);
        process.exit(1);
    }
}

// 读取代理配置
function getProxies() {
    try {
        const proxies = fs.readFileSync('proxy.txt', 'utf-8')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);
        logger.info(`成功加载 ${proxies.length} 个代理`);
        return proxies;
    } catch (error) {
        logger.warning('未找到代理文件或读取失败，将使用直连模式');
        return [];
    }
}

// 创建Provider
function createProvider(proxy) {
    const providerUrl = "https://rpc-testnet.inichain.com";
    let agent;

    if (proxy) {
        if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
            agent = new HttpsProxyAgent(proxy);
        } else if (proxy.startsWith('socks5://')) {
            agent = new SocksProxyAgent(proxy);
        }
    }

    if (agent) {
        const provider = new ethers.JsonRpcProvider(providerUrl);
        provider.send = async (method, params) => {
            try {
                const response = await axios.post(providerUrl, {
                    jsonrpc: "2.0",
                    id: 1,
                    method,
                    params
                }, {
                    httpsAgent: agent
                });
                return response.data.result;
            } catch (error) {
                logger.error(`代理请求失败: ${error.message}`);
                throw error;
            }
        };
        return provider;
    }

    return new ethers.JsonRpcProvider(providerUrl);
}

// 处理单个钱包的交易
async function processSingleWallet(wallet, proxy, index, routerAddress, path, swapAmount) {
    try {
        const provider = createProvider(proxy);
        const signer = new ethers.Wallet(wallet.privateKey, provider);

        const abi = [
            "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
            "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)"
        ];

        const contract = new ethers.Contract(routerAddress, abi, signer);

        logger.info(`钱包 ${index + 1}: ${wallet.walletAddress}`);
        logger.info(`代理状态: ${proxy ? colorize.magenta(proxy) : "直连模式"}`);

        // 获取gas价格
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice;

        // 准备交易参数
        const swapAmountWei = ethers.parseEther(swapAmount);
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

        const txParams = {
            value: swapAmountWei,
            gasLimit: 300000n
        };

        // 发送交易
        const tx = await contract.swapExactETHForTokens(
            0, // amountOutMin
            path,
            wallet.walletAddress,
            deadline,
            txParams
        );

        logger.tx(`钱包 ${index + 1} 交易哈希: ${tx.hash}`);
        logger.info(`Gas Price: ${ethers.formatUnits(gasPrice, 'gwei')} Gwei`);

        const receipt = await tx.wait();
        logger.success(`钱包 ${index + 1} 交易成功 (Gas Used: ${receipt.gasUsed})`);

        return {
            success: true,
            wallet: wallet.walletAddress,
            hash: tx.hash
        };
    } catch (error) {
        logger.error(`钱包 ${index + 1} 交易失败: ${error.message}`);
        return {
            success: false,
            wallet: wallet.walletAddress,
            error: error.message
        };
    }
}

// 计算距离下一个零点的时间间隔
function getTimeUntilMidnight() {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0); // 设置为第二天零点
    return nextMidnight.getTime() - now.getTime();
}

// 每天零点重置
function resetAtMidnight() {
    const timeUntilMidnight = getTimeUntilMidnight();
    setTimeout(() => {
        logger.info("到了零点，开始重置...");
        // 这里你可以进行重置操作，例如重新开始交易等
        main();  // 重新执行主函数或其他重置操作
        resetAtMidnight();  // 继续在未来的零点时刻执行此操作
    }, timeUntilMidnight);
}

// 主函数
async function main() {
    const wallets = getWallets();
    const proxies = getProxies();

    if (wallets.length === 0) {
        logger.error('没有找到有效的钱包配置');
        process.exit(1);
    }

    // 配置参数
    const TOTAL_ROUNDS = 144;  // 总轮数
    const DELAY_MINUTES = 11;  // 轮次间隔
    const SWAP_AMOUNT = "0.0001";  // 交易数量
    
    const routerAddress = "0x4ccB784744969D9B63C15cF07E622DDA65A88Ee7";
    const path = [
        "0xfbecae21c91446f9c7b87e4e5869926998f99ffe",  // Token in
        "0xcf259bca0315c6d32e877793b6a10e97e7647fde"   // Token out
    ];

    // 开始循环交易
    for (let round = 0; round < TOTAL_ROUNDS; round++) {
        const currentTime = new Date().toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });

        logger.info(`\n当前时间: ${currentTime}`);
        logger.info(`执行第 ${round + 1}/${TOTAL_ROUNDS} 轮交易\n`);

        // 并发处理所有钱包的交易
        const transactions = wallets.map((wallet, index) => {
            // 获取对应的代理（如果没有代理，使用 null 代表直连）
            const proxy = proxies[index] || null;
            return processSingleWallet(wallet, proxy, index, routerAddress, path, SWAP_AMOUNT);
        });

        // 等待所有交易完成
        const results = await Promise.all(transactions);

        // 显示交易统计
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        logger.info(`成功交易: ${successful}，失败交易: ${failed}`);
        
        // 每轮结束后休息指定时间
        if (round < TOTAL_ROUNDS - 1) {
            logger.info(`等待 ${DELAY_MINUTES} 分钟，进入下一轮`);
            await countdown(DELAY_MINUTES);
        }
    }
}

// 执行主函数并设置每天零点重置
main().catch(error => {
    logger.error(`程序出错: ${error.message}`);
});
resetAtMidnight(); // 每天零点进行重置
