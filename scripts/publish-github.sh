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
# Только то, что под присмотром git, минус личное: рабочие записи Claude и
# ярлыки с заметками, которыми пользуется владелец у себя на компьютере —
# постороннему они не нужны, да ещё и кириллицей в списке файлов.
# data/, dist/ и node_modules в git не входят вовсе (.gitignore).
PRIVATE='^(CLAUDE\.md|ПЕРЕДАЧА-ПРОЕКТА\.md|КАК-ЗАПУСКАТЬ\.md|РАЗМЕЩЕНИЕ-В-ИНТЕРНЕТЕ\.md|Запустить QSO Log\.command|Открыть R2FEL-LOG \(приложение\)\.command|\.claude/)'
git ls-files -z | while IFS= read -r -d '' f; do
  [[ "$f" =~ $PRIVATE ]] && continue
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

# Заливка бывает срывается на полпути (GitHub отвечает 502), а при обновлении
# файл к этому моменту уже удалён — и релиз остаётся без установщика. Поэтому
# каждый файл кладётся отдельно, с тремя попытками, а в конце проверяется, что
# в релизе лежат все три.
put() {
  local try
  for try in 1 2 3; do
    gh release upload "$TAG" "$1" --repo "$REPO" --clobber && return 0
    echo "  не получилось ($try из 3): $(basename "$1") — пробую ещё раз"
    sleep 10
  done
  echo "НЕ ЗАЛИЛСЯ: $(basename "$1")"
  return 1
}

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  # Выпуск с таким номером уже есть — значит правим текст и перекладываем файлы,
  # а не падаем. (Так бывает, когда после выкладки поправили описание.)
  echo "Релиз $TAG уже есть — обновляю текст и файлы."
  gh release edit "$TAG" --repo "$REPO" --title "R2FEL HamLog $VERSION" --notes-file "$NOTES"
else
  gh release create "$TAG" --repo "$REPO" --title "R2FEL HamLog $VERSION" --notes-file "$NOTES"
fi

put "$DMG"
put "$WIN"
put "$WIN78"

have=$(gh release view "$TAG" --repo "$REPO" --json assets --jq '[.assets[] | select(.state == "uploaded")] | length')
if [ "$have" != "3" ]; then
  echo "ВНИМАНИЕ: в релизе $have файла(ов) из трёх — залейте недостающее ещё раз."
  exit 1
fi
echo "В релизе все три установщика."

echo
echo "Готово:"
echo "  https://github.com/$REPO"
echo "  https://github.com/$REPO/releases/latest"
