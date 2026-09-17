#!/bin/bash
# Выкладывает программу на GitHub: исходники и релиз с тремя установщиками.
#
#   bash scripts/publish-github.sh            # показать, что будет сделано
#   bash scripts/publish-github.sh --go       # сделать
#
# Публичный репозиторий — ЗЕРКАЛО, а не этот каталог: здесь в истории лежит
# CLAUDE.md (рабочие записи, переписка с автором, номера аккаунтов), и туда
# он не едет. Зеркало живёт в ~/Library/Caches/R2FEL-HamLog-public, у него
# своя короткая история: один коммит на выпуск.
#
# Нужен вход: gh auth login (без пароля, через браузер).
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${REPO:-r2fel/hamlog}"
MIRROR="${MIRROR:-$HOME/Library/Caches/R2FEL-HamLog-public}"
VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
GO="${1:-}"

DMG="dist/R2FEL-LOG-$VERSION-arm64.dmg"
WIN="dist/R2FEL-LOG-Setup-$VERSION.exe"
WIN78="dist/R2FEL-LOG-Setup-$VERSION-Windows7-8.exe"

echo "Репозиторий: $REPO"
echo "Версия:      $VERSION  (тег $TAG)"
echo "Зеркало:     $MIRROR"
echo

for f in "$DMG" "$WIN" "$WIN78"; do
  [ -f "$f" ] || { echo "НЕТ ФАЙЛА: $f — сначала npm run dist и npm run dist:win"; exit 1; }
  printf "  %-46s %s\n" "$(basename "$f")" "$(du -h "$f" | cut -f1)"
done
echo

if [ "$GO" != "--go" ]; then
  echo "Это был показ. Чтобы сделать по-настоящему: bash scripts/publish-github.sh --go"
  exit 0
fi

# ---- 1. Зеркало: файлы проекта без рабочих записей ------------------------
rm -rf "$MIRROR"
mkdir -p "$MIRROR"
# Только то, что под присмотром git, минус личное. data/, dist/ и node_modules
# в git не входят вовсе (.gitignore), поэтому сюда не попадут.
git ls-files -z | grep -zv '^CLAUDE\.md$' | while IFS= read -r -d '' f; do
  mkdir -p "$MIRROR/$(dirname "$f")"
  cp "$f" "$MIRROR/$f"
done

cd "$MIRROR"
git init -q -b main
git add -A
git -c user.name="Aleksei Aleksandrov" -c user.email="r2fel@mail.ru" \
  commit -q -m "R2FEL HamLog $VERSION

Журнал радиосвязей с поиском позывных, подтверждениями QSL и QSL-карточками
по e-mail. Mac и Windows, включая 7/8. Лицензия MIT."

# ---- 2. Репозиторий на GitHub --------------------------------------------
if gh repo view "$REPO" >/dev/null 2>&1; then
  echo "Репозиторий уже есть — обновляю."
else
  gh repo create "$REPO" --public \
    --description "Журнал радиосвязей с поиском позывных (QRZ.RU, HamQTH, QRZ.com), QSL и карточками по e-mail. Mac и Windows." \
    --homepage "https://github.com/$REPO/releases/latest"
fi

git remote add origin "https://github.com/$REPO.git" 2>/dev/null || true
git push -q --force origin main
echo "Исходники выложены."

# ---- 3. Релиз с установщиками --------------------------------------------
NOTES="${NOTES:-$(pwd)/../R2FEL-HamLog-release-notes.md}"
if [ ! -f "$NOTES" ]; then
  NOTES="$(mktemp)"
  printf 'R2FEL HamLog %s\n' "$VERSION" > "$NOTES"
fi

cd - >/dev/null
gh release create "$TAG" "$DMG" "$WIN" "$WIN78" \
  --repo "$REPO" --title "R2FEL HamLog $VERSION" --notes-file "$NOTES"

echo
echo "Готово:"
echo "  https://github.com/$REPO"
echo "  https://github.com/$REPO/releases/latest"
