#!/bin/zsh
# ArchHub 一键发布到 GitHub Pages
# 用法：首次运行 ./publish.sh <用户名> <令牌>，之后直接 ./publish.sh "说明"

set -e
cd "$(dirname "$0")"

REPO_NAME="archhub"

if [ -n "$1" ] && [ -n "$2" ] && [[ "$2" == github_pat_* || "$2" == ghp_* ]]; then
  USER="$1"
  TOKEN="$2"
  echo "配置远程仓库..."
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://${USER}:${TOKEN}@github.com/${USER}/${REPO_NAME}.git"
  echo "远程仓库已配置：https://github.com/${USER}/${REPO_NAME}"
  echo "注意：请在 GitHub 上先创建名为 ${REPO_NAME} 的公开仓库（可留空，不要勾选 README）"
  exit 0
fi

MSG="${1:-更新 $(date +%Y-%m-%d)}"
git add -A
git commit -m "$MSG" || echo "（无新更改）"
git branch -M main
git push -u origin main
echo "✓ 已推送到 GitHub Pages"
echo "约 1-2 分钟后访问：https://$(git remote get-url origin | sed -E 's#.*github.com/([^/]+)/.*#\1#').github.io/${REPO_NAME}/"
