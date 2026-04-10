#!/usr/bin/env bash
# ============================================================
# free-code CLI 重置工具 (Linux/macOS 版本)
# ============================================================
# 用法:
#   ./reset-cli.sh         - 交互式重置
#   ./reset-cli.sh -f      - 强制重置，跳过确认
#   ./reset-cli.sh -b      - 重置前备份配置
#   ./reset-cli.sh -k      - 保留环境变量
#   ./reset-cli.sh -h      - 显示帮助
# ============================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

# 变量初始化
FORCE=false
BACKUP=false
KEEPENV=false

# 显示帮助
show_help() {
    cat << EOF
free-code CLI 重置工具

用法: $0 [选项]

选项:
  -f, --force     跳过确认提示，直接执行重置
  -b, --backup    在删除前备份配置文件
  -k, --keep-env  保留环境变量设置
  -h, --help      显示此帮助信息

示例:
  $0              # 交互式重置
  $0 -f           # 强制重置
  $0 -fb          # 强制重置并备份
  $0 -b           # 备份后重置

EOF
    exit 0
}

# 解析参数
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -f|--force)
                FORCE=true
                shift
                ;;
            -b|--backup)
                BACKUP=true
                shift
                ;;
            -k|--keep-env)
                KEEPENV=true
                shift
                ;;
            -h|--help)
                show_help
                ;;
            *)
                echo -e "${RED}未知选项: $1${NC}"
                echo "使用 -h 查看帮助"
                exit 1
                ;;
        esac
    done
}

# 打印带颜色的文本
print_color() {
    local color=$1
    shift
    echo -e "${color}$*${NC}"
}

# 打印状态
print_status() {
    local status=$1
    local message=$2
    
    case $status in
        ok)
            echo -e "  ${GREEN}[OK]${NC}   $message"
            ;;
        warn)
            echo -e "  ${YELLOW}[WARN]${NC} $message"
            ;;
        err)
            echo -e "  ${RED}[ERR]${NC}  $message"
            ;;
        skip)
            echo -e "  ${GRAY}[SKIP]${NC} $message"
            ;;
        info)
            echo -e "  ${CYAN}[INFO]${NC} $message"
            ;;
    esac
}

# 打印标题
print_header() {
    echo ""
    print_color $MAGENTA "============================================================="
    print_color $MAGENTA "  $1"
    print_color $MAGENTA "============================================================="
    echo ""
}

# 获取配置路径
get_config_paths() {
    local paths=()
    
    # 主目录
    local home_dir="$HOME"
    
    # 配置文件
    if [[ -n "$CLAUDE_CONFIG_DIR" ]]; then
        paths+=("$CLAUDE_CONFIG_DIR/.claude.json")
    else
        paths+=("$home_dir/.claude.json")
    fi
    
    # 旧版配置文件
    paths+=("$home_dir/.config.json")
    
    # 配置目录
    paths+=("$home_dir/.claude")
    
    echo "${paths[@]}"
}

# 检查文件是否存在
check_exists() {
    [[ -e "$1" ]]
}

# 主程序
main() {
    parse_args "$@"
    
    clear
    print_header "free-code CLI 重置工具"
    
    # 获取路径
    local paths=($(get_config_paths))
    local config_file="${paths[0]}"
    local legacy_config="${paths[1]}"
    local claude_dir="${paths[2]}"
    
    # 检查要删除的内容
    print_color $YELLOW "以下文件/目录将被删除:"
    echo ""
    
    local has_something=false
    local items_to_delete=()
    
    if check_exists "$config_file"; then
        echo -e "  [配置文件] ${GRAY}$config_file${NC}"
        items_to_delete+=("$config_file")
        has_something=true
    fi
    
    if check_exists "$legacy_config"; then
        echo -e "  [旧版配置] ${GRAY}$legacy_config${NC}"
        items_to_delete+=("$legacy_config")
        has_something=true
    fi
    
    if check_exists "$claude_dir"; then
        echo -e "  [配置目录] ${GRAY}$claude_dir${NC}"
        items_to_delete+=("$claude_dir")
        has_something=true
    fi
    
    # 检查环境变量
    local env_vars=("LATTE_API_KEY" "LATTE_BASE_URL" "LATTE_MODEL" 
                    "ANTHROPIC_API_KEY" "ANTHROPIC_MODEL"
                    "CLAUDE_CODE_USE_OPENAI" "CLAUDE_CONFIG_DIR")
    local active_env_vars=()
    
    for var in "${env_vars[@]}"; do
        if [[ -n "${!var}" ]]; then
            active_env_vars+=("$var")
        fi
    done
    
    if [[ ${#active_env_vars[@]} -gt 0 && "$KEEPENV" == false ]]; then
        echo ""
        print_color $YELLOW "以下环境变量将被清除:"
        for var in "${active_env_vars[@]}"; do
            echo -e "  [环境变量] ${GRAY}$var=${!var}${NC}"
        done
    fi
    
    if [[ "$has_something" == false && ${#active_env_vars[@]} -eq 0 ]]; then
        print_color $GREEN "没有发现需要重置的配置！"
        exit 0
    fi
    
    # 确认提示
    echo ""
    if [[ "$FORCE" == false ]]; then
        read -p "确定要继续吗？这将清除所有 CLI 配置和数据 [y/N]: " confirm
        if [[ ! "$confirm" =~ ^[Yy]([Ee][Ss])?$ ]]; then
            print_color $YELLOW "操作已取消"
            exit 0
        fi
    fi
    
    # 备份
    if [[ "$BACKUP" == true ]]; then
        local backup_dir="$HOME/.claude-backup-$(date +%Y%m%d-%H%M%S)"
        mkdir -p "$backup_dir"
        
        print_header "备份配置"
        
        for item in "${items_to_delete[@]}"; do
            if check_exists "$item"; then
                local dest="$backup_dir/$(basename "$item")"
                if cp -r "$item" "$dest" 2>/dev/null; then
                    print_status ok "已备份: $item"
                else
                    print_status err "备份失败: $item"
                fi
            fi
        done
        
        echo ""
        print_color $CYAN "备份位置: $backup_dir"
    fi
    
    # 执行重置
    print_header "执行重置"
    
    local success_count=0
    local fail_count=0
    local skip_count=0
    
    # 删除文件
    for path in "$config_file" "$legacy_config"; do
        if check_exists "$path"; then
            if rm -f "$path" 2>/dev/null; then
                print_status ok "已删除: $path"
                ((success_count++))
            else
                print_status err "删除失败: $path"
                ((fail_count++))
            fi
        else
            print_status skip "不存在: $path"
            ((skip_count++))
        fi
    done
    
    # 删除目录
    if check_exists "$claude_dir"; then
        if rm -rf "$claude_dir" 2>/dev/null; then
            print_status ok "已删除: $claude_dir"
            ((success_count++))
        else
            print_status err "删除失败: $claude_dir (可能需要 sudo)"
            ((fail_count++))
        fi
    else
        print_status skip "不存在: $claude_dir"
        ((skip_count++))
    fi
    
    # 清除环境变量
    if [[ "$KEEPENV" == false && ${#active_env_vars[@]} -gt 0 ]]; then
        echo ""
        print_color $CYAN "清除环境变量:"
        for var in "${active_env_vars[@]}"; do
            unset "$var"
            print_status ok "已清除: $var"
            ((success_count++))
        done
        
        # 提示用户添加到 shell 配置中
        echo ""
        print_color $YELLOW "注意: 环境变量已从当前会话中清除，"
        print_color $YELLOW "      如果它们在 shell 配置文件中定义，请手动删除。"
    fi
    
    # 显示结果
    print_header "重置完成"
    
    print_color $MAGENTA "统计:"
    print_status ok "成功: $success_count"
    if [[ $fail_count -gt 0 ]]; then
        print_status err "失败: $fail_count"
    fi
    if [[ $skip_count -gt 0 ]]; then
        print_status skip "跳过: $skip_count"
    fi
    
    echo ""
    print_color $GREEN "✓ CLI 已重置为初始状态"
    echo ""
    print_color $CYAN "下次启动时将需要:"
    echo "  1. 重新登录或配置 API Key"
    echo "  2. 重新确认项目信任"
    echo "  3. 重新选择主题和设置"
    
    if [[ "$BACKUP" == true ]]; then
        echo ""
        print_color $YELLOW "如需恢复配置，可以从以下位置复制备份:"
        print_color $CYAN "  $backup_dir"
    fi
    
    echo ""
}

# 运行主程序
main "$@"
