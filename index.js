const { ethers } = require("ethers");
const fs = require('fs');
const axios = require('axios');
const HttpsProxyAgent = require('https-proxy-agent');
const SocksProxyAgent = require('socks-proxy-agent');

// 合约地址和ABI
const ROUTER_ADDRESS = "0x4ccB784744969D9B63C15cF07E622DDA65A88Ee7";
const DAILY_CHECKIN_CONTRACT = "0x4ccB784744969D9B63C15cF07E622DDA65A88Ee7"; // 替换为实际的签到合约地址
const ROUTER_ABI = [
    "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
    "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)"
];
const CHECKIN_ABI = ["function checkIn() external"];

// Token路径配置
const TOKEN_PATH = [
    "0xfbecae21c91446f9c7b87e4e5869926998f99ffe",  // Token in
    "0xcf259bca0315c6d32e877793b6a10e97e7647fde"   // Token out
];

// 交易配置
const CONFIG = {
    TOTAL_ROUNDS: 144,
    DELAY_MINUTES: 11,
    SWAP_AMOUNT: "0.0001",
    MAX_RETRIES: 3,
    RETRY_DELAY: 5,
    GAS_LIMIT: 300000n
};

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

// 工具函数
const sleep = (minutes) => new Promise(resolve => setTimeout(resolve, minutes * 60 * 1000));

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

// 文件读取函数
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

// Provider创建函数
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

    const provider = new ethers.JsonRpcProvider(providerUrl, undefined, {
        timeout: 30000,
    });

    if (agent) {
        provider.send = async (method, params) => {
            return await withRetry(async () => {
                const response = await axios.post(providerUrl, {
                    jsonrpc: "2.0",
                    id: 1,
                    method,
                    params
                }, {
                    httpsAgent: agent,
                    timeout: 30000
                });
                return response.data.result;
            });
        };
    }

    return provider;
}

// 重试函数
async function withRetry(fn, maxAttempts = CONFIG.MAX_RETRIES, delaySeconds = CONFIG.RETRY_DELAY) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxAttempts) throw error;
            logger.warning(`尝试第 ${attempt} 次失败，${delaySeconds} 秒后重试...`);
            await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        }
    }
}

// 签到功能
async function performDailyCheckin(wallet, proxy, index) {
    return await withRetry(async () => {
        try {
            const provider = createProvider(proxy);
            const signer = new ethers.Wallet(wallet.privateKey, provider);
            const contract = new ethers.Contract(DAILY_CHECKIN_CONTRACT, CHECKIN_ABI, signer);

            logger.info(`钱包 ${index + 1}: 开始每日签到`);

            const feeData = await provider.getFeeData();
            const gasPrice = feeData.gasPrice;

            const txParams = {
                gasLimit: CONFIG.GAS_LIMIT
            };

            const tx = await contract.checkIn(txParams);
            logger.tx(`钱包 ${index + 1} 签到交易哈希: ${tx.hash}`);
            
            const receipt = await tx.wait();
            logger.success(`钱包 ${index + 1} 签到成功 (Gas Used: ${receipt.gasUsed})`);

            return { success: true, hash: tx.hash };
        } catch (error) {
            logger.error(`钱包 ${index + 1} 签到失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
}

// 交易功能
async function processSingleWallet(wallet, proxy, index) {
    return await withRetry(async () => {
        try {
            const provider = createProvider(proxy);
            const signer = new ethers.Wallet(wallet.privateKey, provider);
            const contract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signer);

            logger.info(`钱包 ${index + 1}: ${wallet.walletAddress}`);
            logger.info(`代理状态: ${proxy ? colorize.magenta(proxy) : "直连模式"}`);

            const feeData = await provider.getFeeData();
            const gasPrice = feeData.gasPrice;

            const swapAmountWei = ethers.parseEther(CONFIG.SWAP_AMOUNT);
            const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

            const txParams = {
                value: swapAmountWei,
                gasLimit: CONFIG.GAS_LIMIT
            };

            const tx = await contract.swapExactETHForTokens(
                0,
                TOKEN_PATH,
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
    });
}

// 调度函数
function scheduleCheckin(wallets, proxies) {
    const scheduleNextCheckin = () => {
        const now = new Date();
        const nextCheckin = new Date();
        nextCheckin.setHours(10, 0, 0, 0);
        
        if (now >= nextCheckin) {
            nextCheckin.setDate(nextCheckin.getDate() + 1);
        }
        
        const timeUntilCheckin = nextCheckin.getTime() - now.getTime();
        
        setTimeout(async () => {
            logger.info("开始执行每日签到");
            
            const checkinResults = await Promise.all(
                wallets.map((wallet, index) => {
                    const proxy = proxies[index] || null;
                    return performDailyCheckin(wallet, proxy, index);
                })
            );
            
            const successful = checkinResults.filter(r => r.success).length;
            const failed = checkinResults.filter(r => !r.success).length;
            logger.info(`签到完成 - 成功: ${successful}，失败: ${failed}`);
            
            scheduleNextCheckin();
        }, timeUntilCheckin);
        
        logger.info(`下次签到时间: ${nextCheckin.toLocaleString()}`);
    };
    
    scheduleNextCheckin();
}

// 主函数
async function main() {
    const wallets = getWallets();
    const proxies = getProxies();

    if (wallets.length === 0) {
        logger.error('没有找到有效的钱包配置');
        process.exit(1);
    }

    // 启动签到调度
    scheduleCheckin(wallets, proxies);

    // 开始循环交易
    for (let round = 0; round < CONFIG.TOTAL_ROUNDS; round++) {
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
        logger.info(`执行第 ${round + 1}/${CONFIG.TOTAL_ROUNDS} 轮交易\n`);

        const transactions = wallets.map((wallet, index) => {
            const proxy = proxies[index] || null;
            return processSingleWallet(wallet, proxy, index);
        });

        const results = await Promise.all(transactions);

        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        logger.info(`成功交易: ${successful}，失败交易: ${failed}`);
        
        if (round < CONFIG.TOTAL_ROUNDS - 1) {
            logger.info(`等待 ${CONFIG.DELAY_MINUTES} 分钟，进入下一轮`);
            await countdown(CONFIG.DELAY_MINUTES);
        }
    }
}

// 启动程序
main().catch(error => {
    logger.error(`程序出错: ${error.message}`);
});
