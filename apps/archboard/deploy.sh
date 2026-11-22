#!/bin/zsh
# ArchBoard 部署脚本：提交本地更改并推送到 GitHub Pages
# 用法： ./deploy.sh "提交说明"

set -e
cd "$(dirname "$0")"

MSG="${1:-每日更新 $(date +%Y-%m-%d)}"

git add -A
if git diff --cached --quiet; then
  echo "没有需要提交的更改，跳过推送。"
  exit 0
fi

git commit -m "$MSG"
git push -u origin main
echo "推送完成，GitHub Pages 将在 1-2 分钟内自动更新。"
