<img src="docs/banner-en.jpg" width="300" align="right" alt="R2FEL HamLog — type a callsign, the program finds the rest">

**По-русски:** [что это и где скачать ↓](#по-русски)

# R2FEL HamLog

**Site: [r2fel.com](https://r2fel.com)** · [releases](../../releases/latest) · [questions & ideas](../../discussions)

**A ham radio logbook that looks up the station you're working.** Type a callsign and it fills in the
operator's name, country, town, grid square and RDA district, shows the distance, the weather and the
local time where they are, and tells you at once whether you've worked them before.

Free, no subscription, no cloud: the log lives on your own computer. macOS and Windows — Windows 7 and
8 included.

[**⬇ Download the latest version**](../../releases/latest)

<br clear="right">

![The program at work](docs/screenshot-en.webp)

<p align="center"><img src="docs/globe-en.webp" width="420" alt="The globe window: both stations and the arc between them"></p>

## What it does

- **Three callbooks at once.** QRZ.RU and HamQTH are asked together; QRZ.com fills in whatever neither
  of them knew. Russian stations come back with their names in Russian.
- **Weather and local time** at the other end, the distance along the great circle and the
  **bearing** — an arrow and degrees to point the antenna by.
- **Duplicates at a glance**: `WORKED BEFORE`, with every earlier contact one click away.
- **★ NEW COUNTRY / NEW RDA / NEW BAND** when a station, its district or the band is a first for you.
- **Pileups**: several stations in one entry — callsign, space, next callsign.
- **Contest mode**: serial numbers, `⟲ RESET`, and **Cabrillo** export.
- **The sun and the bands**: K, A and SFI in the header, and a window that says in plain words which bands are open
  right now (green — far stations can be heard, red — almost silence); the same colours as dots in the band list.
- **DX cluster** built in, in a window of its own: pick a node, click a spot and its callsign and frequency are in the form,
  each one marked `NEW` or `WORKED ×N` from your own log.
- **A Morse (CW) decoder**, in a window of its own with its own button: listens to the microphone or a cable from the receiver and writes the
  letters, finds the speed by itself, tells two stations apart, explains the abbreviations under the
  words (PSE, QTH, 73).
- **Send and check in one place** (the ✈ button): everything not sent yet goes to every service at once, then the confirmations are checked; the HAMLOG and QRZ.com files are saved into a folder you choose once. A **“What works from here”** page tries every outside service from your own computer — with a VPN and without — and says what to expect.
- **QSL confirmations** in one place: **LoTW** (through TQSL), **eQSL** (upload, and the cards you
  receive), **HAMLOG** (by file), **QRZ.com** (a file to upload), **award.srr.ru** and **RDA** awards, and **your own QSL card by
  e-mail** — your own picture with the fields placed on it, or a card the program draws from your
  details.
- **A log that fits you**: choose the columns, sort by any of them, three colour themes, and a full-screen
  window with the log in a tall column on the right. Tens of thousands of contacts without a stutter.
- **One log on several computers**: sync through a folder your cloud keeps in step (iCloud Drive,
  OneDrive, Yandex Disk, Dropbox) or by a file; nothing is deleted without asking. A **settings backup**
  brings a new computer to life in a minute.
- **What to say** (the speech-bubble icon): ready words for a general call and a typical contact from the call to
  goodbye — what you say is set apart from what they answer — with your callsign spelled out and the band in words;
  with POTA park fields on, a POTA call — and 📍 offers the parks nearest to you.
- **The other station's photo** from the callbook beside the name — several of them, with arrows, a bigger view
  and a ★ main one; fetched ahead in the background for the callsigns in your log, so it is there the moment you
  work that station again. Kept on your computer, in a folder you can choose.
- **A globe in a window of its own** (the 🌍 button): both stations, the great-circle arc, distance and bearing;
  always above the program's window, stretch it and the globe grows; + / − buttons, long path. Off by default.
- **Colour marks under the callsign**, as in JTDX: a new callsign is blue, a known one on a new band lime, a new
  country emerald, a known country on a new band pink.
- **Phonetic alphabet** under every field, the Russian way for RU, BY and KZ callsigns.
- **A manual in two languages**, with pictures and animations, inside the program (F1).
- **ADIF import and export**, an automatic copy of the log, and a repair for the mangled Cyrillic that
  other programs leave behind.

## Installing

Everything ready to run is on the [releases page](../../releases/latest):

| File | For |
|---|---|
| `R2FEL-LOG-<version>-arm64.dmg` | macOS (Apple Silicon) |
| `R2FEL-LOG-Setup-<version>.exe` | Windows 10 and 11 (64-bit) |
| `R2FEL-LOG-Setup-<version>-Windows7-8.exe` | Windows 7, 8, 8.1 and 32-bit |

The program isn't signed with a paid certificate, so your system will warn you that the developer is
unknown. On a Mac: **System Settings → Privacy & Security**, scroll down to the message about R2FEL-LOG and press **Open Anyway** (on newer macOS right-click → Open no longer helps). On Windows: **More info** → **Run anyway**. Once only.

Callsign lookup needs free XML API access at QRZ.RU and/or a HamQTH account — the manual inside the
program (F1, "Settings") explains how to get both.

## What leaves your computer

Nothing from your log. Ever.

- **Callsign lookups, weather, RDA** go to QRZ.RU / HamQTH / QRZ.com and Open-Meteo (met.no or wttr.in if that one can't be reached), and only while
  you are typing a callsign. Your logins stay on your computer — and in the settings backup, if you switch that on (a copy in a folder you choose; the logins are in it as plain text, so switch them off there if the folder goes to a cloud).
- **The sun and the bands** (K, A, SFI, band conditions) are fetched once an hour from NOAA and N0NBH (hamqsl.com); the
  request is the same for everyone — no callsign, no locator. Off in the settings.
- **LoTW, eQSL, HAMLOG, award.srr.ru, QSL by e-mail** — only when you press the button, and only what
  you send.
- **POTA parks near you** — only when you press 📍 with the park fields switched on: your coordinates go to
  api.pota.app to get the nearest parks. Nothing else, and never in the background.
- **DX cluster** — only when you press CONNECT: the node you pick sees your callsign, which is how
  clusters sign you in.
- **Microphone** (CW decoder) — switched on only by you; the sound is processed inside the program and
  goes nowhere.
- **Photos of the stations** — downloaded from the same callbooks (qrz.ru, hamqth.com) that answer a lookup; the
  background run asks them, one callsign at a time, about the callsigns in your log. Switch it off in settings
  (⚙ → Photos of the other station).
- **The globe** — off by default. Its map comes from OpenFreeMap (tiles.openfreemap.org), which sees which areas
  of the world are shown (the areas around both stations). No callsigns, no log. Asked before the first time.
- **What works from here** — only when you press it (⚙ → Internet connection): the program tries to reach each outside service it uses (callbooks, LoTW, eQSL, award.srr.ru, DX nodes, the map server, the mail servers and so on) from your computer, just to see whether it answers. A plain connection test — no callsign, no log, nothing about you is sent.
- **Update check** — once a day the program asks whether a newer version is out and checks itself in
  with the author: country, version, system, language. No callsign, no log, not one contact. You can
  switch it off in settings (⚙ → UPDATES). Where that service can't be reached (not from Russia without a VPN), the
  program just reads a small file with the newest version number from r2fel.com — an ordinary page request that
  carries nothing about you.

## Building from source

```bash
npm install                 # if Electron won't download: NODE_OPTIONS=--use-bundled-ca npm install
npm start                   # in a browser: http://localhost:4173
npm run electron            # the desktop version
npm run dist                # a DMG for macOS
npm run dist:win            # both Windows installers
```

Node.js 18 or newer. The whole program is plain HTML, CSS and JavaScript with no build step:
`public/index.html` (markup and styles), `public/app.js` (the logic), `server.js` (the callbook and
weather requests), `electron-main.js` (the desktop shell).

## Licence

MIT — do what you like with it, just keep the author's name. Author: Aleksei Aleksandrov, **R2FEL**.
Questions and ideas: [Discussions](../../discussions) or [r2fel@mail.ru](mailto:r2fel@mail.ru).

---

<a name="по-русски"></a>

<img src="docs/banner-ru.jpg" width="300" align="right" alt="R2FEL HamLog — набрали позывной, остальное программа найдёт сама">

# R2FEL HamLog — по-русски

**Сайт: [r2fel.com](https://r2fel.com)** · [релизы](../../releases/latest) · [вопросы и идеи](../../discussions)

**Журнал радиосвязей, который сам находит, с кем вы работаете.** Набираете позывной — программа
подставляет имя, страну, город, локатор и RDA, показывает расстояние, погоду и который час у
корреспондента, и сразу говорит, работали вы с ним раньше или нет.

Бесплатно, без подписок и без облака: журнал лежит на вашем компьютере. Mac и Windows, включая
Windows 7 и 8.

[**⬇ Скачать последнюю версию**](../../releases/latest)

<br clear="right">

![Окно программы](docs/screenshot-ru.webp)

<p align="center"><img src="docs/globe-ru.webp" width="420" alt="Окно глобуса: обе станции и дуга между ними"></p>

## Что она умеет

- **Три справочника сразу.** QRZ.RU и HamQTH спрашиваются одновременно, а чего нет у них — дописывает
  QRZ.com. Имена российских станций — по-русски.
- **Погода и местное время** у корреспондента, расстояние по дуге большого круга и **азимут** —
  стрелка и градусы, куда поворачивать антенну.
- **Повторы видны сразу**: `WORKED BEFORE` и все прошлые связи с этой станцией по щелчку.
- **★ NEW COUNTRY / NEW RDA / NEW BAND** — когда страна, район или диапазон встречаются вам впервые.
- **Пайлап**: несколько станций в одной записи — позывной, пробел, следующий позывной.
- **Контест**: серийные номера, `⟲ RESET`, экспорт **Cabrillo**.
- **Солнце и прохождение**: K, A и SFI в шапке и окно, где простыми словами сказано, какие диапазоны открыты прямо
  сейчас (зелёный — слышно далеко, красный — почти тишина); те же цвета точками в списке диапазонов.
- **DX-кластер** прямо в программе, в отдельном окне: выбрали узел, щёлкнули по споту — позывной и частота в форме,
  и у каждого отметка `NEW` или `WORKED ×N` по вашему журналу.
- **Декодер телеграфа (CW)** в отдельном окне и со своей кнопкой: слушает микрофон или кабель от приёмника и пишет буквами, скорость
  определяет сам, различает две станции, под словами объясняет сокращения (PSE, QTH, 73).
- **Отправка и проверка в одном месте** (кнопка ✈): всё неотправленное уходит во все службы сразу, потом проверяются подтверждения; файлы для HAMLOG и QRZ.com сохраняются в папку, которую выбираете один раз. Страница **«Что работает отсюда»** пробует все внешние службы с вашего компьютера — с VPN и без него — и говорит, чего ждать.
- **Подтверждения QSL** в одном месте: **LoTW** (через TQSL), **eQSL** (отправка и приём картинок),
  **HAMLOG** (файлом), **QRZ.com** (файлом для загрузки), дипломы **award.srr.ru** и **RDA**, и **своя QSL-карточка по e-mail** — своя
  картинка с разметкой или карточка, которую программа рисует сама.
- **Журнал под себя**: колонки выбираются, сортировка по любой, три цветовые темы, а окно на весь экран
  ставит журнал высокой колонкой справа. Десятки тысяч связей без задержек.
- **Один журнал на нескольких компьютерах**: синхронизация через папку, которую держит ваше облако
  (iCloud Drive, OneDrive, Яндекс.Диск, Dropbox), или через файл; ничего не удаляется без вопроса.
  **Копия настроек** поднимает новый компьютер за минуту.
- **Что сказать** (значок «вопрос в облачке»): готовые слова общего вызова и типового разговора от вызова до
  прощания — ваши слова выделены, ответы корреспондента отдельно — с вашим позывным по буквам и диапазоном
  словами; при включённых полях парков — вызов POTA, а 📍 предлагает ближайшие парки.
- **Фото корреспондента** из справочника рядом с именем — несколько, со стрелками, крупно и со ★ главной;
  заранее, в фоне, скачиваются для позывных вашего журнала, так что при следующей связи фото уже на месте.
  Хранятся на вашем компьютере, в папке, которую можно выбрать.
- **Глобус в отдельном окне** (кнопка 🌍): обе станции, дуга большого круга, расстояние и азимут; окно всегда
  поверх окна программы, растянете его — вырастет и глобус; кнопки + и −, длинный путь. По умолчанию выключен.
- **Цветные метки под позывным**, как в JTDX: новый позывной — голубая, известный на новом диапазоне — салатовая,
  новая страна — изумрудная, известная страна на новом диапазоне — розовая.
- **Фонетический алфавит** под каждым полем, с русским вариантом для RU, BY и KZ.
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
разработчик неизвестен. На Mac: **Системные настройки → Конфиденциальность и безопасность**, внизу
сообщение про R2FEL-LOG и кнопка **«Всё равно открыть»** (в новых macOS правый щелчок → «Открыть»
уже не помогает). На Windows: **«Подробнее»** → **«Выполнить в любом случае»**. Один раз.

Для поиска позывных нужен бесплатный доступ к XML API QRZ.RU и/или аккаунт HamQTH — как их получить,
написано в инструкции внутри программы (F1, раздел «Настройки»).

## Что программа отправляет наружу

Ничего из журнала. Совсем.

- **Поиск позывных, погода, RDA** — запросы уходят к QRZ.RU / HamQTH / QRZ.com и Open-Meteo (met.no или wttr.in, если он недоступен), только
  когда вы вводите позывной. Логины хранятся на вашем компьютере — и в копии настроек, если вы её включили (копия лежит в выбранной вами папке; логины в ней открытым текстом, поэтому если папка уходит в облако — выключите их там).
- **Солнце и прохождение** (K, A, SFI, состояние диапазонов) запрашиваются раз в час у NOAA и N0NBH (hamqsl.com);
  запрос одинаков для всех — без позывного и локатора. Выключается в настройках.
- **LoTW, eQSL, HAMLOG, award.srr.ru, QSL по e-mail** — только по нажатию кнопки и только то, что вы
  отправляете.
- **Парки POTA рядом** — только по нажатию 📍 при включённых полях парков: ваши координаты уходят на
  api.pota.app, чтобы получить ближайшие парки. Больше ничего и никогда в фоне.
- **DX-кластер** — только по кнопке CONNECT: узел, который вы выбрали, видит ваш позывной (так кластеры
  вас впускают).
- **Микрофон** (декодер CW) — включаете только вы; звук обрабатывается внутри программы и никуда не
  уходит.
- **Фото станций** — скачиваются с тех же справочников (qrz.ru, hamqth.com), что отвечают на поиск позывного;
  фоновый обход спрашивает у них, по одному позывному за раз, позывные вашего журнала. Выключается в настройках
  (⚙ → Фото корреспондентов).
- **Глобус** — по умолчанию выключен. Карта берётся с OpenFreeMap (tiles.openfreemap.org): сайт видит, какие
  места мира показаны (места обеих станций). Ни позывных, ни журнала. Перед первым включением программа спрашивает.
- **Что работает отсюда** — только по нажатию (⚙ → Связь с интернетом): программа пробует достучаться с вашего компьютера до каждой внешней службы, которой пользуется (справочники, LoTW, eQSL, award.srr.ru, DX-узлы, сервер карты, почтовые серверы и т. д.), чтобы увидеть, отвечает ли она. Обычная проверка связи — ни позывного, ни журнала, ничего о вас не отправляется.
- **Проверка обновлений** — раз в сутки программа проверяет, не вышла ли новая версия, и обезличенно
  отмечается у автора: страна, версия, система, язык. Ни позывного, ни журнала, ни одной связи.
  Выключается в настройках (⚙ → ОБНОВЛЕНИЯ). Там, где эта служба недоступна (из России без VPN), программа просто
  читает с r2fel.com маленький файл с номером последней версии — обычный запрос страницы, ничего о вас не несущий.

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
**R2FEL**. Вопросы и идеи — в [Discussions](../../discussions) или на [r2fel@mail.ru](mailto:r2fel@mail.ru).
