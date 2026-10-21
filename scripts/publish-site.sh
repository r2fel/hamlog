#!/bin/bash
# Выкладывает сайт r2fel.com (папка site/) на GitHub Pages.
#
#   bash scripts/publish-site.sh
#
# Сайт живёт в отдельном публичном репозитории r2fel/r2fel.com. Как и с
# программой, туда едет копия: папка site/ целиком, один коммит на выкладку,
# --force push. GitHub Pages пересобирает сайт сам за минуту-две.
# Нужен вход: gh auth login --web и gh auth setup-git.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${REPO:-r2fel/r2fel.com}"
MIRROR="${MIRROR:-$HOME/Library/Caches/R2FEL-site-public}"

if ! gh repo view "$REPO" >/dev/null 2>&1; then
  gh repo create "$REPO" --public \
    --description "r2fel.com — home page of R2FEL HamLog, a free ham radio logbook" \
    --homepage "https://r2fel.com"
fi

node scripts/build-site.js          # русская страница /ru/ строится из английской
rm -rf "$MIRROR"
mkdir -p "$MIRROR"
cp -R site/. "$MIRROR/"
touch "$MIRROR/.nojekyll"          # отдавать файлы как есть, без Jekyll
chmod -R u+rwX,go+rX "$MIRROR"

cd "$MIRROR"
git init -q -b main
git add -A
git -c user.name="Aleksei Aleksandrov" -c user.email="r2fel@mail.ru" \
  commit -q -m "r2fel.com $(date -u +%Y-%m-%d)"
git remote add origin "https://github.com/$REPO.git"
git push -q --force origin main

# Pages из ветки main, корень; свой домен — из файла CNAME.
if ! gh api "repos/$REPO/pages" >/dev/null 2>&1; then
  gh api -X POST "repos/$REPO/pages" -f 'source[branch]=main' -f 'source[path]=/' >/dev/null
fi
gh api -X PUT "repos/$REPO/pages" -f cname="$(cat CNAME)" >/dev/null || true
echo "Готово: https://github.com/$REPO"
gh api "repos/$REPO/pages" --jq '"Pages: " + .html_url + "  (статус: " + (.status // "строится") + ")"'
