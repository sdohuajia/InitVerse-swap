#!/bin/bash

# 脚本保存路径
SCRIPT_PATH="$HOME/InitVerse.sh"

# 主菜单函数
function main_menu() {
    while true; do
        clear
        echo "脚本由大赌社区哈哈哈哈编写，推特 @ferdie_jhovie，免费开源，请勿相信收费"
        echo "如有问题，可联系推特，仅此只有一个号"
        echo "================================================================"
        echo "退出脚本，请按键盘 ctrl + C 退出即可"
        echo "请选择要执行的操作:"
        echo "1. 运行 InitVerse 交互"
        echo "2. 退出脚本"

        read -p "请输入数字（1-2）选择操作: " option

        case $option in
            1)
                run_initverse_interactive
                ;;
            2)
                echo "退出脚本..."
                exit 0
                ;;
            *)
                echo "无效选项，请重新选择！"
                read -n 1 -s -r -p "按任意键继续..."
                ;;
        esac
    done
}

# 整合命令：克隆仓库，安装依赖，设置私钥和钱包地址，启动项目
function run_initverse_interactive() {
    # 检查是否以 root 用户运行
    if [ "$(id -u)" -ne 0 ]; then
        echo "错误：请以 root 用户身份运行此脚本！"
        exit 1
    fi

    echo "以 root 用户身份运行，继续执行..."

    # 设置仓库 URL 和目标目录名
    REPO_URL="https://github.com/sdohuajia/InitVerse-swap.git"
    DEST_DIR="InitVerse-swap"

    # 检查目标目录是否已存在，若存在则删除
    if [ -d "$DEST_DIR" ]; then
        echo "目录 $DEST_DIR 已存在，正在删除..."
        rm -rf "$DEST_DIR"
    fi

    # 克隆 GitHub 仓库
    echo "正在克隆仓库 $REPO_URL 到 $DEST_DIR..."
    git clone "$REPO_URL"

    # 进入目录
    cd "$DEST_DIR" || exit

    # 执行 npm install
    echo "正在安装依赖，请稍候..."
    npm install

    echo "依赖安装完成！"

    # 获取用户输入的私钥和钱包地址
    echo "请输入您的私钥："
    read -s PRIVATE_KEY  # 使用 -s 参数让输入隐藏

    echo "请输入您的钱包地址："
    read WALLET_ADDRESS

    # 检查输入是否为空
    if [ -z "$PRIVATE_KEY" ] || [ -z "$WALLET_ADDRESS" ]; then
        echo "错误：私钥或钱包地址不能为空！"
        return 1
    fi

    # 创建或写入到 token 文件
    TOKEN_FILE="token"
    echo "$PRIVATE_KEY,$WALLET_ADDRESS" > "$TOKEN_FILE"

    echo "私钥和钱包地址已成功写入到 token 文件。"

    # 使用 screen 启动 npm start，后台运行项目
    echo "正在启动项目（后台运行）..."
    screen -S Initverse -d -m npm start

    # 提示用户如何查看日志
    echo "项目已在后台启动。您可以使用以下命令查看日志："
    echo "  screen -r Initverse"
    echo "若要分离当前的 screen 会话，按下 Ctrl + A + D"
    echo "若要关闭后台运行的项目，请使用 'screen -S Initverse -X quit' 命令退出 screen 会话。"

    # 提示用户按任意键返回主菜单
    read -n 1 -s -r -p "按任意键返回主菜单..."
    main_menu
}

# 启动主菜单
main_menu
