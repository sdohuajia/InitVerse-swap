const { ethers } = require("ethers");
const fs = require('fs');
const axios = require('axios'); // 用于请求代理服务
const HttpsProxyAgent = require('https-proxy-agent'); // 支持 HTTP 代理
const SocksProxyAgent = require('socks-proxy-agent'); // 支持 SOCKS5 代理

// 睡眠函数
async function sleep(minutes) {
    return new Promise(resolve => setTimeout(resolve, minutes * 60 * 1000));
}

// 倒计时显示
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

// 从proxy.txt文件获取代理列表
function getProxies() {
    return fs.readFileSync('proxy.txt', 'utf-8').split('\n').map(proxy => proxy.trim()).filter(Boolean);
}

// 从token.txt文件获取多钱包信息
function getWallets() {
    return fs.readFileSync('token.txt', 'utf-8')
        .split('\n')
        .map(line => {
            const [privateKey, walletAddress] = line.split(',').map(str => str.trim());
            return { privateKey, walletAddress };
        })
        .filter(wallet => wallet.privateKey && wallet.walletAddress);
}

// 创建代理Provider
function createProvider(proxy) {
    const providerUrl = "https://rpc-testnet.inichain.com"; // 这里可以替换为你的自定义Provider URL
    let agent;

    // 判断代理类型
    if (proxy && (proxy.startsWith('http://') || proxy.startsWith('https://'))) {
        // 如果是 HTTP 代理
        agent = new HttpsProxyAgent(proxy);
    } else if (proxy && proxy.startsWith('socks5://')) {
        // 如果是 SOCKS5 代理
        agent = new SocksProxyAgent(proxy);
    } else {
        // 如果没有代理，返回直连模式
        return new ethers.JsonRpcProvider(providerUrl);
    }

    // 使用代理创建自定义的 Provider
    const provider = new ethers.JsonRpcProvider(providerUrl);
    provider.send = async (method, params) => {
        try {
            const response = await axios.post(providerUrl, {
                jsonrpc: "2.0",
                id: 1,
                method,
                params
            }, {
                httpsAgent: agent // 配置代理
            });
            return response.data.result;
        } catch (error) {
            console.error("代理请求失败:", error);
            throw error;
        }
    };

    return provider;
}

async function swapExactETHForTokens() {
    const wallets = getWallets(); // 获取多个钱包
    const proxies = getProxies(); // 获取代理列表

    const routerAddress = "0x4ccB784744969D9B63C15cF07E622DDA65A88Ee7";
    const abi = [
        "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
        "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)"
    ];

    const path = [
        "0xfbecae21c91446f9c7b87e4e5869926998f99ffe",  // Token in
        "0xcf259bca0315c6d32e877793b6a10e97e7647fde"   // Token out
    ];

    const TOTAL_TRANSACTIONS = 144;
    const DELAY_MINUTES = 11;
    const SWAP_AMOUNT = "0.0001"; // 每次交换的ETH数量

    for (let i = 0; i < TOTAL_TRANSACTIONS; i++) {
        try {
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

            // 创建所有钱包的交易任务
            const transactionPromises = wallets.map((wallet, j) => {
                // 第一个钱包不使用代理，后续钱包使用对应的代理
                const proxy = j === 0 ? null : proxies[(j - 1) % proxies.length];

                // 显示使用的代理或直连模式
                if (proxy) {
                    console.log(`正在使用的代理: ${proxy}`);
                } else {
                    console.log("使用直连模式");
                }

                console.log(`正在使用的钱包地址: ${wallet.walletAddress}`);
                
                const provider = createProvider(proxy);
                const walletInstance = new ethers.Wallet(wallet.privateKey, provider);
                const contract = new ethers.Contract(routerAddress, abi, walletInstance);

                const swapAmountWei = ethers.parseEther(SWAP_AMOUNT);
                return contract.getAmountsOut(swapAmountWei, path).then(amountsOut => {
                    const amountOutMin = ((amountsOut[1] * 95n) / 100n).toString();
                    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

                    return contract.swapExactETHForTokens(
                        amountOutMin,
                        path,
                        wallet.walletAddress, // 使用每个钱包的地址
                        deadline,
                        {
                            value: swapAmountWei
                        }
                    );
                }).then(tx => {
                    console.log(`交易已发送：${tx.hash}`);
                    return tx.wait(); // 等待交易确认
                }).then(() => {
                    console.log("交易已确认");
                }).catch(error => {
                    console.error(`钱包地址 ${wallet.walletAddress} 交易失败:`, error);
                });
            });

            // 等待所有钱包的交易都完成
            await Promise.all(transactionPromises);

            // 如果不是最后一次交易，等待 DELAY_MINUTES 分钟
            if (i < TOTAL_TRANSACTIONS - 1) {
                console.log(`等待 ${DELAY_MINUTES} 分钟后继续下一次交易...\n`);
                await countdown(DELAY_MINUTES); // 使用倒计时显示
            }
        } catch (error) {
            console.error(`第 ${i + 1} 次交易失败:`, error);
            await sleep(1); // 错误后暂停1分钟
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
