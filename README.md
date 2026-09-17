<img src="public/icons/icon-512.png" width="96" align="right" alt="">

# R2FEL HamLog

**Журнал радиосвязей, который сам находит, с кем вы работаете.** Набираете позывной — программа
подставляет имя, страну, город, локатор и RDA, показывает расстояние, погоду и который час у
корреспондента, и сразу говорит, работали вы с ним раньше или нет.

Бесплатно, без подписок и без облака: журнал лежит на вашем компьютере. Mac и Windows, включая
Windows 7 и 8.

[**⬇ Скачать последнюю версию**](../../releases/latest) · [English below](#english)

![Окно программы](docs/screenshot.webp)

## Что она умеет

- **Три справочника сразу.** QRZ.RU и HamQTH спрашиваются одновременно, а чего нет у них — дописывает
  QRZ.com. Имена российских станций — по-русски.
- **Погода и местное время** у корреспондента, расстояние по дуге большого круга.
- **Повторы видны сразу**: `WORKED BEFORE` и все прошлые связи с этой станцией по щелчку.
- **★ NEW COUNTRY / NEW RDA / NEW BAND** — когда станция или её район встречаются вам впервые.
- **Пайлап**: несколько станций в одной записи — позывной, пробел, следующий позывной.
- **Контест**: серийные номера, `⟲ RESET`, экспорт **Cabrillo**.
- **Подтверждения QSL** в одном месте: **LoTW** (через TQSL), **eQSL** (отправка и приём картинок),
  **HAMLOG** (файлом), и **своя QSL-карточка по e-mail** — своя картинка с разметкой или карточка,
  которую программа рисует сама.
- **Фонетический алфавит** под каждым полем, с русским вариантом для RU/BY/KZ.
- **Инструкция на двух языках** — с картинками и анимациями, прямо в программе (F1).
- **Импорт и экспорт ADIF**, автоматическая копия журнала, чинит «кракозябры» в чужих файлах.

## Установка

Всё готовое — на [странице релизов](../../releases/latest):

| Файл | Для чего |
|---|---|
| `R2FEL-LOG-<версия>-arm64.dmg` | macOS (Apple Silicon) |
| `R2FEL-LOG-Setup-<версия>.exe` | Windows 10 и 11 (64 бит) |
| `R2FEL-LOG-Setup-<версия>-Windows7-8.exe` | Windows 7, 8, 8.1 и 32-битные |

Программа не подписана платным сертификатом, поэтому при первом запуске система предупредит, что
разработчик неизвестен: на Mac — правый щелчок по значку → «Открыть», на Windows — «Подробнее» →
«Выполнить в любом случае».

Для поиска позывных нужен бесплатный доступ к XML API QRZ.RU и/или аккаунт HamQTH — как их получить,
написано в инструкции внутри программы (F1, раздел «Настройки»).

## Что программа отправляет наружу

Ничего из журнала. Совсем.

- **Поиск позывных, погода, RDA** — запросы уходят к QRZ.RU / HamQTH / QRZ.com и Open-Meteo, только
  когда вы вводите позывной. Логины хранятся на вашем компьютере.
- **LoTW, eQSL, HAMLOG, QSL по e-mail** — только по нажатию кнопки и только то, что вы отправляете.
- **Проверка обновлений** — раз в сутки программа спрашивает, не вышла ли новая версия, и обезличенно
  отмечается у автора: страна, версия, система, язык. Ни позывного, ни журнала, ни одной связи.
  Выключается в настройках (⚙ → ОБНОВЛЕНИЯ).

## Собрать из исходников

```bash
npm install                 # если Electron не качается: NODE_OPTIONS=--use-bundled-ca npm install
npm start                   # в браузере: http://localhost:4173
npm run electron            # настольная версия
npm run dist                # DMG для macOS
npm run dist:win            # два установщика Windows
```

Нужен Node.js 18 или новее. Вся программа — обычный HTML, CSS и JavaScript без сборщиков:
`public/index.html` (разметка и стили), `public/app.js` (логика), `server.js` (запросы к справочникам),
`electron-main.js` (оболочка настольной версии).

## Лицензия

MIT — делайте с этим что хотите, только оставьте упоминание автора. Автор — Алексей Александров,
**R2FEL**. Пишите: [r2fel@mail.ru](mailto:r2fel@mail.ru).

---

<a name="english"></a>

# R2FEL HamLog — in English

**A ham radio logbook that looks up the station you're working.** Type a callsign and it fills in the
operator's name, country, town, grid and RDA district, shows the distance, the weather and the local
time where they are, and tells you at once whether you've worked them before.

Free, no subscription, no cloud: the log lives on your own computer. macOS and Windows, Windows 7 and 8
included.

[**⬇ Download the latest version**](../../releases/latest)

- **Three callbooks at once**: QRZ.RU and HamQTH are asked together, QRZ.com fills in what neither knew.
- **Weather and local time** at the other end, distance along the great circle.
- **Duplicates at a glance**: `WORKED BEFORE`, with every earlier contact one click away.
- **★ NEW COUNTRY / NEW RDA / NEW BAND** when a station or its district is a first for you.
- **Pileups**: several stations in one entry — callsign, space, next callsign.
- **Contest mode** with serial numbers and **Cabrillo** export.
- **QSL confirmations** in one place: **LoTW** (through TQSL), **eQSL** (upload and card pictures),
  **HAMLOG** (by file), and **your own QSL card by e-mail** — your picture with the fields placed on it,
  or a card the program draws itself.
- **Phonetic alphabet** under every field, Russian style for RU/BY/KZ callsigns.
- **A manual in two languages**, with pictures and animations, inside the program (F1).
- **ADIF import and export**, an automatic copy of the log, and a repair for the mangled Cyrillic other
  programs leave behind.

**What leaves your computer:** nothing from the log. Callbook and weather lookups go out as you type;
LoTW, eQSL, HAMLOG and QSL e-mail only when you press the button. Once a day the program checks whether
a newer version is out and checks itself in with the author — country, version, system, language, and
nothing else. You can switch that off in settings.

Licence: MIT. Author: Aleksei Aleksandrov, **R2FEL** — [r2fel@mail.ru](mailto:r2fel@mail.ru).
