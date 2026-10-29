# Операционные мелочи (agent gotchas)

- Новая установка AGH из «Интеграции» требует отдельного подтверждения; не перезаписывает старый AGH и не расширяет права `adguard_auto_manage`. Ограничения профиля, общий начальный пароль, snapshots и незакрытый OpenWrt gate: [§aghinst](adguard-home-installation.ru.md).
- При откате AGH проверять файл `dhcp`, пустую читаемую очередь `uci changes` и применение dnsmasq: конфликт DHCP запрещает restart, конфликт `sheepfold` не прерывает безопасный возврат DNS; неполный откат остаётся `recovery_required` ([B170](bug-register.ru.md#b170-откат-agh-возвращал-файл-dhcp-но-не-работающий-dns), §aghinst).

> Точка 15.09.2026: [выборочное принятие r323 и review-time-confirmation в r324](review-r323-acceptance.ru.md). Автоматический сырой облачный архив заблокирован; аппаратные и облачные ограничения не закрыты локальными тестами.

> Проверка 10.10.2026: [B160–B162](bug-register.ru.md) исправляют локальные GitHub URLs
> после `kva4991` → `hayOfLife` и обход release path. Старым установленным updater/APK
> нужен отдельный переход, `update.sh` сам их не исправляет; latest всё ещё r58.
> [Граница и команды](update-safety.ru.md) (§updsafe, §apkupd1).

Этот документ — **индекс** неочевидных продуктовых и эксплуатационных деталей Sheepfold, которые легко забыть при следующей сессии разработки или у нового агента.

Правила кодинга, стиль и ревью — в [`CODING_RULES.md`](../CODING_RULES.md). Здесь только то, что не помещается в комментарий кода, но влияет на поведение продукта, сборку или отладку.

Причины устойчивых архитектурных решений находятся в [`docs/architecture/decisions/`](architecture/decisions/README.ru.md), порядок расследования дефекта и автоматическая карта соседних проверок — в [`debugging-and-verification.ru.md`](debugging-and-verification.ru.md) и [`change-impact-review.ru.md`](change-impact-review.ru.md), а обязательная матрица сопутствующих изменений — в [`mandatory-companion-changes.ru.md`](mandatory-companion-changes.ru.md) (§adrproc, §debug01, §impact1, §cmpchg1).

- Две редакции роутерного пакета не означают два репозитория или четыре Android-сборки: Standard физически не содержит AI/activity-backend, а два единых Android APK скрывают ИИ до положительной capability роутера. Каждая редакция отдельно собирается в IPK для 24.10 и apk-tools v3 APK для 25.12 (§prodvar, §owrtci1).

## Обязательное правило для агентов

- Экспериментальный Podkop 0.8 поставляется как `podkop-exp` со встроенным движком:
  отсутствие отдельного `sing-box` не доказывает отказ; проверять Podkop, DNS и трафик.
  [Совместимость и границы](integrations.md) (§routerharness).

- Podkop TPROXY обходит обычный `forward`: общий запрет и `restricted` требуют
  раннего Sheepfold guard (`prerouting -160`), а не только правильных sets/status.
  [Живой packet-level сценарий](live-router-testing.ru.md#проверка-трафика-телефона-24102026)
  использует Wi-Fi-bound TCP/HTTP/HTTPS и отдельно проверяет работоспособность proxy (§v7x2k9p, §routerharness).

- Git push после передачи объектов может завершиться `curl 28`, но вывести `Everything up-to-date`: сверять удалённый SHA; проверенный процессный helper `gh` описан в [окружении](agent-environment.ru.md#push-зависает-после-передачи-объектов) (§toolwin).

- Экспорт настроек: `wps_pin`, `r0kh`, `r1kh` требуют маскирования, а лимит 5 МиБ относится к итоговому UTF-8 файлу с шифрованной оболочкой, не к числу символов или открытому JSON; [контракт backup](settings-backup.ru.md) (§cfgbak1).

- Ручное обновление APK не использует updater роутера: нужны публичный parent release asset,
  digest и тот же signing key. CI artifact/debug APK не заменяет публикацию; описание
  и причины ограничений в [Android updater](android-app-updates.ru.md) (§apkupd1).
- Переход в разрешение источника APK может уничтожить процесс: ViewModel недостаточно.
  Сохранять и перепроверять готовый файл, регистрировать Activity Result вне вкладки;
  отказ и ошибка открытия installer не требуют новой загрузки (§apkupd1).
- «Мои устройства» в APK определяются по парному ID и backend `adminLogin`, не по имени.
  На старом роутере неизвестный владелец не угадывается; см. [настройки Android](android-config.ru.md).

При обнаружении **неочевидной** находки (баг, ловушка окружения, два разных «языка», дубли в UI, неверная интерпретация `*-legacy` и т.п.) агент **обязан** вести реестр в документации в **той же сессии**, что и исправление кода:

1. **Добавить** — новая находка → строка в «Зафиксированные мелочи» + подробности в тематическом `docs/*.ru.md`.
2. **Обновить** — поведение изменилось → поправить тематический документ и формулировку в индексе (не оставлять устаревший текст).
3. **Удалить** — ловушка устранена в продукте (кнопка возвращена, поле появилось в UI, баг исправлен) → убрать пункт из индекса и из тематического документа; если настройка стала видимой в LuCI — убрать из [`docs/hidden-settings.ru.md`](hidden-settings.ru.md).

Маршрутизация по типу находки:

1. **Не программирование** (продукт, установка, LuCI-поведение, роутер, i18n, группы, детектор, скрытые UCI) → соответствующий файл в `docs/` (см. таблицу ниже) **и** краткая строка в разделе «Зафиксированные мелочи» этого файла.
2. **Программирование** (стиль JS/shell, `_()` vs `T()`, обёртки LuCI-view, chmod в `postinst`, deprecate-маршруты в `*-legacy`) → [`CODING_RULES.md`](../CODING_RULES.md), при необходимости со ссылкой из этого индекса.
3. Не дублировать длинные объяснения: в индексе — **одна строка + ссылка**; подробности — в тематическом документе.
4. Не писать в README длинные технические заметки; README остаётся для пользователя, детали — в `docs/`.

Если подходящего документа нет, создать новый focused-файл в `docs/` и добавить ссылку в [`docs/developer-task.ru.md`](developer-task.ru.md).

## Куда что писать

- Отсутствующее `globalBlocked` не равно разрешённому интернету; RAM-черновик хранит исходную revision, а не последнюю полученную: [панели Android](android-config.ru.md#неизвестное-состояние-интернета) (§andpanel1).
- Каналы Wi-Fi читаются только для Wi-Fi и только при capability; без iwinfo сохраняются текущий канал и `auto`, а транспортная ошибка POST не доказывает отмену записи: [контракт каналов](android-openwrt-api.ru.md#каналы-радиомодулей) (§apicon1).

| Тема | Куда |
| --- | --- |
| LuCI gettext, `.lmo`, два параметра языка | [`docs/localization.ru.md`](localization.ru.md) |
| Группы по умолчанию, дубли «Без ограничений» | [`docs/default-groups.ru.md`](default-groups.ru.md) |
| Детектор, ARP, автогруппа | [`docs/device-detection.ru.md`](device-detection.ru.md) |
| Сборка IPK, `po2lmo`, явный экспорт артефактов | [`docs/agent-environment.ru.md`](agent-environment.ru.md) |
| Смена SIM в детском APK: номер может отсутствовать, а устройство определяет только роутер | [`docs/sim-change-notifications.ru.md`](sim-change-notifications.ru.md) (§simchg1) |
| Новые Wi-Fi-сети детского APK: BSSID не передаётся, а координаты описывают телефон, не точку доступа | [`docs/child-wifi-network-notifications.ru.md`](child-wifi-network-notifications.ru.md) (§childwifi1) |
| Версия ассетов LuCI, cache-busting | [`docs/luci-cache.ru.md`](luci-cache.ru.md) |
| Единые имена, SVG-геометрия и визуальный каталог значков | [`docs/icon-catalog.ru.md`](icon-catalog.ru.md) (§iconcat1) |
| Имена `*-legacy`, deprecate HTTP | [`CODING_RULES.md`](../CODING_RULES.md) §8.4, [`docs/apps/router-app-ru.md`](apps/router-app-ru.md) |
| UCI, `postinst`, миграции | [`docs/uci-config-migration.ru.md`](uci-config-migration.ru.md) |
| Скрытые / неотображаемые UCI-опции | [`docs/hidden-settings.ru.md`](hidden-settings.ru.md) |
| Yandex Disk, зеркалирование журнала, бэкапы | [`docs/yandex-disk-storage.ru.md`](yandex-disk-storage.ru.md) |
| Продуктовые решения, scope | [`docs/agent-playbook.ru.md`](agent-playbook.ru.md) |
| Стиль кода, тесты, ревью | [`CODING_RULES.md`](../CODING_RULES.md) |
| Временная удалённая техподдержка, claim, relay, серверный проект и порты | [`docs/remote-support-access-plan.ru.md`](remote-support-access-plan.ru.md), [`docs/remote-support-threat-model.ru.md`](remote-support-threat-model.ru.md), [`docs/remote-support-protocol.ru.md`](remote-support-protocol.ru.md), [`docs/remote-support-server-integration.ru.md`](remote-support-server-integration.ru.md) (§rsup001, §rsuppeer) |
| Local-first сообщения родительского APK через отдельный relay | [`docs/android-router-message-relay.ru.md`](android-router-message-relay.ru.md) (§mrelay1) |
| Категории автотестов и условия полного прогона | [`docs/test-strategy.ru.md`](test-strategy.ru.md) (§testcat) |
| Обязательные изменения кода, документации и тестов рядом с правкой | [`docs/mandatory-companion-changes.ru.md`](mandatory-companion-changes.ru.md) (§cmpchg1) |
| Точный прогон резервного адреса баг-репортов и известные ложные ошибки | [`docs/testing-support-endpoint-discovery.ru.md`](testing-support-endpoint-discovery.ru.md) (§srepdisc1, §docops1) |
| Быстрый вход нового агента без повторного чтения всего проекта | [`docs/agent-fast-start.ru.md`](agent-fast-start.ru.md) |
| Как понимать владельца и формулировать ответы | [`docs/owner-communication-profile.ru.md`](owner-communication-profile.ru.md) (§usrcomm) |
| Архитектура памяти, БД, модулей и диалога ИИ-помощника | [`docs/ai-assistant-development/README.md`](ai-assistant-development/README.md) (§aiarch1) |
| Ошибки Windows, тестов, Android, IPK, UCI, LuCI, Git и сети | [`docs/troubleshooting.ru.md`](troubleshooting.ru.md) |
| Внешние белые/чёрные списки сайтов, кэш и повторы | [`docs/site-list-sources.ru.md`](site-list-sources.ru.md) (§slstres) |
| Безопасное обновление IPK и восстановление конфига | [`docs/update-safety.ru.md`](update-safety.ru.md) (§updsafe) |
| Решения, которые ещё должен принять владелец | [`docs/owner-open-questions.ru.md`](owner-open-questions.ru.md) (§ownques) |

## Зафиксированные мелочи

- При отказе восстановления updater сохраняет доступный снимок/маркер и блокирует следующую установку; стандартная копия в RAM не переживает reboot. Не удалять маркер автоматически: [восстановление](update-safety.ru.md#восстановление-после-файлового-отказа) (§updsafe).

- Общие настройки LuCI: поздний ввод после Save остаётся отдельным черновиком; принимать нужно точный snapshot, а не очищать всё после ответа. Диалог Wi-Fi использует тот же снимок; special savers и page reload остаются отдельными границами — [жизненный цикл Settings](review-r323-settings-lifecycle.ru.md) (§persist1, §ovfinal1).

- Проверять явные коды внутри функций, вызываемых через `if`/`!`/`||`; успешный последний
  элемент pipeline не подтверждает чтение случайности. Pairing использует общий form
  reader и exclusive publication, а cleanup удаляет только свою запись: [B31–B34](audit-fixes-r291.ru.md).
  Эти меры не заменяют общий протокол конкурентных UCI/token writers (R03/R08).

- Повторное сравнение UCI не является snapshot; failed stdout, conflict logging и home rules имеют отдельные границы отказа. Periodic firewall не должен считать прогноз недели: [B22–B26 и их ограничения](audit-fixes-r289.ru.md).

- Runtime-матрица требует совпадающий nftables drop-in; backup всех helpers заканчивается до замены первого файла: [аудит стенда r287](audit-fixes-2026-09-07.ru.md#дополнительная-защита-стенда).

- `exit` из `$(...)` завершает только подстановку: CGI валидирует тело в основном процессе и читает формы общим helper; см. [API r287](android-openwrt-api.ru.md#исправления-cgi-r287).
- «Без ограничений» выше чёрного списка для интернета; карантин и запрет управления независимы, status/firewall используют общий расчёт: [архитектура](backend-design.ru.md#приоритеты-правил-доступа-84azytj).
- Запоздалый `401` не удаляет новую сессию, SPKI-only привязка не наследует старый leaf pin: [восстановление Android](android-config.ru.md#потеря-сохранённой-привязки).

- Transport grant и его signed replay содержат token: только RAM, не HMAC snapshot; `X509Certificate.ca=false` недостаточно для точного CA:FALSE, поэтому Node-клиент проверяет DER BasicConstraints отдельно. Это эксперимент, не SSH-ready: [transport-профиль](remote-support-protocol.ru.md#экспериментальный-transport-профиль) (§rsup001).

Краткий реестр. Подробности — по ссылкам.

### Локализация LuCI

- Строки в JS — только `_('English msgid')`; локальный словарь `T()` **не использовать** (см. [`CODING_RULES.md`](../CODING_RULES.md) §8.2).
- Русский UI требует бинарного каталога **`/usr/lib/lua/luci/i18n/sheepfold.ru.lmo`** на роутере; без `.lmo` LuCI покажет английские msgid даже при русском языке браузера.
- Тестовый IPK собирает `.lmo` через `scripts/po2lmo.py` (см. [`docs/agent-environment.ru.md`](agent-environment.ru.md)); тест `tests/testIpkI18n.test.mjs`.
- Для русского UI Sheepfold нужны `sheepfold.global.language=ru` и `sheepfold/i18n/ru.json` (модуль `sheepfold/i18n.js`). `luci.main.lang` меняется только при установке (`install.sh` / `postinst`), не из настроек приложения (см. [`docs/localization.ru.md`](localization.ru.md)).
- Windows PowerShell 5 `ConvertFrom-Json` считает ключи без учёта регистра и может молча уничтожить один из переводов `Clear log` / `clear log`. Файлы `sheepfold/i18n/*.json` не редактировать этим конвертером: источник истины — `.po`, JSON создаётся только командой `python scripts/po2json.py <input.po> <output.json>`. Автотест проверяет сохранение обоих ключей. (§i18ncase)
- В Windows sandbox прямой `python --version` может работать, а `spawnSync('python')` из Node завершаться `EPERM`: это запрет дочернего процесса до выполнения Python, не отсутствующая установка. Git Bash в той же среде может создавать относительный `.build/...`, но отклонять эквивалентный абсолютный `/c/Users/User/...`. Используйте канонические test-runner с `.build/test-tmp`; полный runner теперь делает раннюю проверку, а при настоящем `EPERM` неизменный gate запускается вне песочницы. (§testenv1)
- Windows `PATH` с fixture-bin не гарантирует подмену команды внутри Git Bash: MSYS может снова поставить `/usr/bin` первым. Fault-injection helper обязан выставить `PATH` внутри `sh -c`, передавать пути относительно shell-`cwd` только в пределах явно разрешённого корня fixture и запускать Python-модель в UTF-8. Абсолютный `/c/...` внутри sandbox может получить `Permission denied`. Native NTFS не выдавать за проверку `0600/0700`, symlink или kernel `flock`; эти узкие сценарии остаются обязательными в Linux CI. (§testenv1)
- Репозиторий объявлен как ESM через `package.json`. Поэтому синтетический LuCI-файл, записанный в локальный `.build` с расширением `.js`, `node --check` разбирает как ES module и ложно отвергает допустимый для LuCI loader верхнеуровневый `return`. Для таких временных syntax-fixture использовать `.cjs`; переносить production LuCI-файлы на CommonJS не требуется. (§testenv1)
- В длинном Windows workspace `po2json.py` может получить `OSError 22` из-за `MAX_PATH`, хотя файл существует. Передавайте входной и выходной путь в расширенном виде `\\?\C:\...`; это ограничение пути, а не повреждение `.po`. `xgettext.sh` дополнительно требует GNU `find`/`sort` и установленный `gettext` (`xgettext`, `msgmerge`), поэтому отсутствие `msgmerge` нельзя выдавать за ошибку переводов.

### Группы по умолчанию

- Канонические UCI-секции: `no_restrictions`, `child_1` — **singleton**, не создавать вторую группу через `_('No restrictions')` в UI (см. [`docs/default-groups.ru.md`](default-groups.ru.md)).
- Отображаемое имя группы — **пользовательская сущность** в `sheepfold.<section>.name`, не gettext-строка из JS.
- Имена по языку задаются **один раз** при первой установке (`install.sh` → `/etc/sheepfold/install.language` → `sheepfold-default-groups`); `postinst` при обновлении **не перезаписывает** уже заданные имена.
- Выбор **English** в `install.sh` бесполезен, если не синхронизировать `luci.main.lang` — с 0.1.0-157 `sheepfold-default-groups` и `postinst` делают это автоматически; тест `tests/installLanguage.test.mjs`.
- Старые алиасы RU/EN в `device.group` мигрируются скриптом `sheepfold-default-groups`; в LuCI — `LEGACY_GROUP_ALIASES` в `overview.js`.

### Детектор устройств

- Метка источника **`arp`** в сырых данных — не имя устройства; имена `arp`/`dhcp`/`static` в UCI очищаются (см. [`docs/device-detection.ru.md`](device-detection.ru.md)).
- Старое `device_type=unknown` не должно перекрывать свежий `detected_type`: `device_type` имеет приоритет только при `manual_device_type=1`. Иначе backend распознаёт `Умный дом`, а LuCI продолжает показывать неизвестный тип (§devpas1).
- Источники `arp`, `dhcp`, `static` — технические сигналы присутствия, не имена устройств. Их нельзя использовать как пользовательское имя в UI; старые записи и stale data не должны превращаться в ложный “Неизвестное устройство” только потому, что один из технических источников попал в поле имени (§devpas1, §devinv).
- Массовая ре-классификация старых записей пока не делается до релиза. Мы не перезаписываем исторические device sections ради нового fingerprint, чтобы не потерять пользовательские настройки, legacy group names и manually fixed device types; исправляем только текущую видимость и текущую логику до явного релизного migration pass (§devpas1).
- Автоназначение в «Без ограничений» сравнивает группу с **каноническим именем из UCI** (`sheepfold-default-groups name`), а не с фиксированной английской строкой.
- При объединении DHCP leases, ARP и постоянных аренд сохранять `host['.name']` в модели устройства. Потеря имени секции заставляет редактор создать вторую постоянную аренду вместо изменения существующей; это проверяет `frontendDomainModels.test.mjs`. (§devinv)
- BusyBox `ash` динамически наследует переменные функций. Перебор `for section ...` без `local` уже записывал автогруппу устройства в `allowlist`/`domain_allowlist` и ломал устранение повторяющихся ID; правило и регрессионный тест описаны в [`CODING_RULES.md`](../CODING_RULES.md) и [`docs/device-detection.ru.md`](device-detection.ru.md) (§shscope1).
- BusyBox `tr` на тестовом роутере нельзя считать эквивалентом GNU coreutils для операндов `[:lower:]`, `[:upper:]` и `[:alnum:]`: наблюдалось, что `Tuya Smart Inc.` превращалось в `Tlya Smart Inc.`, а нижний регистр MAC не переводился в верхний. Для ASCII MAC, доменов и служебных идентификаторов использовать только `tr 'a-z' 'A-Z'`, обратный диапазон и `tr -cd 'A-Za-z0-9'`. Регрессионный тест сканирует весь поставляемый rootfs (§bbxtr01).
- BusyBox `sort` на тестовом OpenWrt 25.12 не поддерживает GNU-ключ `-o`. Конструкция `sort -u "$file" -o "$file"` при этом печатает домены в stdout, не удаляет дубли в исходном файле и может испортить машинный `key=value`-ответ без явного падения. Используйте соседний временный файл и атомарный `mv`; статический тест запрещает `sort ... -o` во всём поставляемом rootfs (§bbxsort1).
- Ubuntu CI часто запускает `mawk`, а OpenWrt — BusyBox `awk`. Интервальные regexp
  вида `{2,63}` или `{3,20}` внутри `awk` могут дать разные результаты без syntax
  error. Валидацию доменов выполнять через `grep -E`, а длину телефона проверять
  через `length()` и простое `[0-9]+`. Одного `sh -n` для этой ошибки недостаточно:
  нужен поведенческий либо статический тест границы (§awkport1).
- Совпадение сильного UUID/serial либо двух слабых семейств создаёт только подсказку родителю о похожем прежнем устройстве. Автоматически связывать MAC и переносить белый/чёрный список устройств, админские права, группы, расписания или временный доступ нельзя: DHCP, mDNS, SSDP/UPnP и WS-Discovery можно подделать (§devident1).
- Один UUID у двух online-MAC не означает автоматически «два интерфейса одного прибора». Прежнюю карточку с меньшим `#ID` не менять, более новую помещать в identity-карантин, а решение оставлять родителю. Иначе поддельное объявление сможет получить старые права (§devident1, §detlife1).
- `LOCATION` и `XAddrs` сообщаются недоверенным устройством. UPnP XML разрешено читать только у точного числового IP отправителя в LAN с запретом DNS/redirect/router-self, лимитом времени и размера; WS-Discovery `XAddrs` не открывать вообще. Простая проверка `адрес похож на локальный` не защищает от SSRF (§devident1).
- Даже безопасно загруженный UPnP XML остаётся самоописанием клиента. Он не может один выдать белый список устройств, `Без ограничений` или админское право. Явное объединение двух карточек выполняется целиком, сохраняет меньший `#ID` и оставляет поглощённый ID как вечный audit-alias; частичные флажки создадут две противоречащие версии одного устройства (§merge01).
- Домен Google/Яндекса в трафике не раскрывает аккаунт. Не строить login/e-mail из DNS/SNI/IP, не добавлять TLS MITM и не сохранять догадку как паспорт устройства (§devident1).
- Не смешивать `detection_fingerprint` и `trusted_identity_keys`: первый hash инвалидирует кэш классификации, второй является неизменяемой автоматически многофакторной базой для обнаружения подмены прежнего MAC. Identity-компоненты версии 2 используют HMAC-SHA-256 с отдельным сохраняемым при sysupgrade секретом; pairing/Bearer-токен APK остаётся отдельной API-аутентификацией (§detlife1).
- HT/VHT/HE и текущая скорость из `hostapd` полезны только как слабая подсказка типа. Не добавлять их в trusted baseline, не считать отдельным evidence и не выдавать по ним `Без ограничений`: возможности чипсета повторяются у разных приборов, а rate меняется от сигнала. Сырые rate держать в `/tmp`, в UCI сохранять только короткий монотонный класс (§detlife1).
- Краткое исчезновение online-сигнала удерживается 90 секунд. Без grace-периода сон Wi-Fi и roaming 2,4/5 ГГц превращаются в ложные новые подключения, повторные тяжёлые проверки и уведомления (§detlife1).
- Строка `/tmp/dhcp.leases` или постоянная аренда не доказывает online. Событийный анализ запускается только по текущему LAN ARP/neighbour, hostapd association или свежему DHCP hotplug; startup и суточный проходы также фильтруются по текущему снимку (§detlife1).
- Подозрительный прежний MAC нельзя добавлять в постоянный чёрный список устройств: это лишит прав и настоящее устройство. Используется отдельный block/restrict overlay, который firewall проверяет раньше прежних исключений и снимает только при положительном совпадении либо явном доверии родителя (§detlife1).
- Ucode на OpenWrt 25.12 не принимает оператор `!~` и диапазон `\x00-\x1f` внутри regexp так же, как JavaScript. Сетевые строки очищаются явным проходом через `ord()`, а новый ucode-файл до слияния компилируется на живом тестовом роутере (§devident1).

### Сборка и пакет

- `sheepfold-runtime-hardening <staged-root>` проверяет содержимое будущего пакета и не должен требовать системные команды от Windows/Git Bash-хоста. Наличие runtime-команд (`flock`, `openssl`) проверяется при запуске без `ROOT`, а staged-проверка защищается тестом зависимостей Makefile (§owrtci1).

- Процесс Codex может не видеть `winget` в `PATH` и одновременно видеть временный встроенный `rg`. Установщик находит `winget` через Microsoft App Installer и не принимает Codex-копию `rg` за пользовательскую установку (см. [`tools/README.ru.md`](../tools/README.ru.md)). (§toolwin)
- После установки Windows toolchain текущий PowerShell/Codex-процесс может не видеть уже установленные `git`, `node`, `python`, `java`, `adb` и `sdkmanager`; один раз перечитать Machine/User `PATH` или открыть новый shell (см. [`docs/agent-environment.ru.md`](agent-environment.ru.md)). (§toolwin)
- Windows `setup.ps1` прогревает Gradle Wrapper запуском `gradlew.bat --version`: wrapper-файлы остаются в Git, а скачанный Gradle distribution живёт только в `%USERPROFILE%\.gradle\wrapper\dists` и не коммитится (см. [`tools/README.ru.md`](../tools/README.ru.md)). (§toolwin)
- Fallback-поиск Windows toolchain выбирает одну наиболее новую установку Python и только JDK 17; повтор `sdkmanager` удаляет лишь неполный компонент, а не уже исправные Android SDK-пакеты. (§toolwin)
- В PowerShell нельзя называть параметр функции `$Home`: имена переменных нечувствительны к регистру, а `$HOME` является встроенной read-only переменной. Для пути JDK используется `$JavaHomePath`; это закреплено тестом Windows toolchain. (§toolwin)
- В Windows PowerShell 5 не распаковывать Android command-line tools через `Expand-Archive`: официальный ZIP способен вызвать внутреннюю ошибку `Remove-Item`. Установщик использует `.NET ZipFile` и короткий `%TEMP%`-путь; тест не даёт вернуть проблемную реализацию (см. [`tools/README.ru.md`](../tools/README.ru.md)). (§zipps51)
- Windows PowerShell 5 требует UTF-8 BOM для `.ps1` с русским текстом, удаляет настоящий пустой аргумент `ssh-keygen -N ''` и не разрешает `Export-ModuleMember` из обычного `.ps1`. Live-router scripts защищены BOM-тестом, используют `-N '""'` и dot-source; подробности в [`troubleshooting.ru.md`](troubleshooting.ru.md). (§routerharness)
- Не подставляйте защищённый адрес API вместо адреса LuCI. На текущем тестовом роутере веб-интерфейс открывается по `http://<IP>:80/cgi-bin/luci/...`, а Android/pairing API отдельно работает по `https://<IP>:5201`. В профиле это разные поля `luciScheme`/`luciPort` и `appPort`; старое общее поле `httpsPort` для запуска браузерных тестов запрещено. (§routerharness)
- На компьютере владельца Kaspersky Endpoint Security может удалить именно запускаемый `runRouterTests.ps1` как `PDM:Trojan.Win32.Generic` из-за сочетания backup, SSH/SCP и package install. До живого прогона сохраняйте незакоммиченный diff и исполняйте копию `tools\router-testing` из `C:\Users\User\Documents\pesochnica\sheepfold-router-harness`, не исходник в Git. Папка `pesochnica` сама по себе не является исключением антивируса: 19 июля Kaspersky удалил и эту копию после создания backup, но до `apk add`. Не маскируйте сценарий и не отключайте защиту; используйте только подтверждённое владельцем исключение либо короткие проверяемые `ssh`/`scp` команды с backup, SHA-256 и последующим read-only прогоном. (§winsbx1)
- После изменения LuCI JS/CSS поднимать **`PKG_RELEASE`** и синхронный **`ui_asset_version`** (см. [`docs/luci-cache.ru.md`](luci-cache.ru.md), тест `tests/luciAssetVersioning.test.mjs`).
- Собственные значки не рисовать внутри LuCI/Kotlin-экрана и не заменять символами `⚙`, `×` или `↻`: добавить английское имя и геометрию в `icons/catalog.json`, выполнить `npm run icons:generate` и проверить `icons/catalog.html` (§iconcat1).
- Локальный тестовый `.ipk` — gzip-tar с `debian-binary` / `data.tar.gz` / `control.tar.gz`; по умолчанию пишется в `.build/ipk-output`. На текущем компьютере явно запрошенные артефакты копировать в `C:\Users\User\Documents\pesochnica`, не в Downloads (см. [`docs/agent-environment.ru.md`](agent-environment.ru.md)).
- `scripts/build-test-ipk.py` получает `Depends:` из `LUCI_DEPENDS` Makefile. Не возвращать второй ручной список: он уже терял `openssl-util` и `ucode-mod-socket`, хотя официальный OpenWrt package объявлял их правильно.
- Тестовый IPK: все `usr/libexec/sheepfold/*` — **0755** в архиве + `find … chmod 0755` в `postinst`; иначе `router-control-legacy: Permission denied` (тест `tests/testIpkPermissions.test.mjs`).

### `*-legacy` и deprecate

- `sheepfold-router-control-legacy` и `sheepfold-api-legacy` — **текущий рабочий монолит** за фасадом, не «совместимость со старым релизом» (см. [`CODING_RULES.md`](../CODING_RULES.md) §8.4).
- Устаревшие маршруты (`/pair-token`, `/settings/save`, `token=` в query) должны отдавать **404/410/400**, а не оставаться рабочими.
- Временный доступ не должен превращаться в постоянный allowlist или `sheepfold_exempt_macs`: активный `temp_access` просто не попадает в `restricted`, глобальная блокировка остаётся сильнее, а `expire-temp-access` восстанавливает прежний статус. Чёрный список устройств/`status=blocked` остаётся сильнее временного доступа и WPS allowlist-режима. Live-тест обязан проверять все три nftables-набора и отсутствие MAC в белом списке устройств, а не только UCI (см. [`docs/backend-design.ru.md`](backend-design.ru.md) §84azytj, §uirunfx).

### UCI-list в LuCI

- `uci.set(config, section, option, values)` принимает UCI-list одним массивом. Не вызывать `uci.set()` по одному разу для каждого элемента: каждый следующий вызов перезапишет предыдущий, и после сохранения останется только последний MAC, день недели или объект расписания.
- При полной замене списка сначала использовать `uci.unset()`, затем один `uci.set(..., values)`, только если массив не пуст. Это закреплено тестами `allowlistUi.test.mjs` и `schedulePriorityUi.test.mjs`.

### Интерфейс выглядит правильно, но runtime-контракт разорван

<!-- §uirunfx -->

Это как раз тот класс ошибок, который визуально выглядит нормально, а на роутере ломает правила. Статическая разметка, перевод и даже всплывающее сообщение могут работать, хотя отсутствует JS-адаптер после выноса модуля, UCI не применён, backend не прочитал новую опцию либо firewall не пересчитан.

- После переноса функции в модуль искать все старые вызовы и определения символа; либо менять всех потребителей атомарно, либо оставлять проверенный тонкий адаптер.
- Для каждой настройки проверять не только DOM, но и полный контракт: черновик → `Сохранить` → UCI после apply → backend → фактическое правило → повторное чтение → журнал.
- Тест интерфейсного текста не заменяет тест backend-контракта. Для правил доступа нужен целевой тест вычислителя/firewall и, перед релизом, сценарий на живом роутере.
- Живой write-тест списков устройств не имеет права считать одну запись UCI успехом: он проверяет фактический nftables-набор и отсутствие тестового MAC после restore. Ошибка `cksum: not found` уже показала, что pipeline может вернуть `0` по последней команде и скрыть неприменённый firewall.
- Ошибка особенно опасна для расписаний, списков устройств, глобальной блокировки и административного доступа: UI может показать ожидаемое состояние, пока nftables продолжает применять старое.
- Редактор группы обязан различать два результата: UCI-конфиг группы сохранён и runtime-правила применены. Сбой второго шага нельзя показывать как «группа не сохранена»; нужно обновить UI по сохранённому UCI и отдельно показать настоящую backend-ошибку (§uirunfx).
- Не хешируйте несколько смысловых файлов простой конкатенацией. Если один MAC переместился из `block` в `restricted`, последовательность байтов может не измениться, хотя политика изменилась полностью. В fingerprint должны входить стабильные маркеры границ и назначения каждого набора (§fwlock1, §uirunfx).
- Все команды, меняющие общие firewall state-файлы или nft batch, обязаны удерживать один kernel `flock`. Лок отдельного вызывающего скрипта не защищает от фонового `sheepfold-service`. На OpenWrt используйте POSIX-цикл с `flock -n`: BusyBox `flock` не знает util-linux ключ `-w` (§fwlock1).

### Хранение журналов и Yandex Disk

- r301: `/log` и `/log/clear` должны брать общий `log-maintenance.flock`, проверять
  путь и результат чтения/маскирования до успешного ответа. Ошибка UCI не является
  разрешением очистить default-файл. `program_log_context` внутри legacy — не
  текущий публичный AI-handler; не переносить его проверку на другие consumers.
  См. [контракт журнала](log-events.ru.md), [B72–B75](bug-register.ru.md) и R13.

- Журнал всегда в RAM (`/tmp/sheepfold/events.log`); `log_storage` задаёт **дополнительное** зеркалирование (`ram` / `usb` / `yandex_disk`).
- Yandex Disk — **WebDAV** + пароль приложения, не OAuth REST; helper: `sheepfold-yandex-disk`, диспетчер: `sheepfold-log-storage`.
- r314 (§ydav001): передавать Depth отдельным числом helper, а целый заголовок —
  одним аргументом curl; `status` не должен писать UCI. 207 без разбора propstat
  не доказывает всю XML-модель. В R15 остаются известные ошибки quota/readers/restore;
  наличие кнопки восстановления ниже не означает проверенный безопасный runtime.
- r315: не делить удалённый путь через `set -- $(...)`: локальное раскрытие масок
  меняет назначение. Не объявлять 409/423 успешным MKCOL; 405 не доказывает collection.
  Ошибка root UCI не равна отсутствующей опции. Проверки поздней ветви push-events
  с исправленным только тестовым объявлением не подтверждают весь рабочий entry.
- r316: кавычки shell и `-g` не делают имя безопасным URI. `webdav_url` принимает
  логический путь, кодирует `%` ровно один раз и отказывает при отдельных `.`/`..`
  до MKCOL. Не передавать этому builder сырой href из XML как имя. Проверять
  результат assignment отдельно; полный XML/prune/upload/restore остаётся R15.
- Debounce выгрузки живых событий: **300 с** (`YANDEX_PUSH_INTERVAL` в `sheepfold-log`).
- Восстановление конфига с диска — `yandex-disk-restore-config`; в UI есть выбор бэкапа и confirm; safety backup в `/tmp/sheepfold/`.
- Подробности: [`docs/yandex-disk-storage.ru.md`](yandex-disk-storage.ru.md).

### LuCI: списки и администраторы

- Добавление в белый/чёрный список из модалки LuCI: `updateMacList` сбрасывает `list mac` через `uci.unset`, затем одним `uci.set` передаёт весь массив MAC; отдельные вызовы на каждый MAC перезаписывают предыдущие значения (см. `persistDeviceListMembership` в `overview.js`).
- Белый и чёрный списки устройств взаимоисключающие, но конфликт нельзя «исправлять» скрытым переносом MAC: LuCI и backend отклоняют операцию, пока родитель явно не удалит устройство из прежнего списка. (§lstxcl1)
- Не переносить `/etc/sheepfold/.device-identity-hmac` и не применять старые `trusted_identity_keys` на новом роутере. Browser backup сравнивает несекретный `router_install_id`: при несовпадении сохраняет постоянные `#ID` и семейные правила, но удаляет router-bound identity/quarantine и привязки админских телефонов. Одноразовый pairing code не входит даже в encrypted backup (§cfgbak1).
- Кнопка «Привязать устройства» в таблице администраторов не должна удаляться в `overview-secure.js`; запрещена только выдача прав из общего списка устройств.
- Модалка «Добавить в белый список» — две панели «Сохранить» (сверху и снизу таблицы), как у привязки администратора.
- Внутреннюю ширину системной модалки LuCI нельзя вычислять от viewport: даже на широком экране контейнер может дать около 570 px. Для grid внутри модалки нужны `minmax(0, 1fr)` и `min-width: 0`; иначе сумма минимальных колонок незаметно обрежет правый текст (§frontmod).
- После добавления или удаления устройства из белого/чёрного списка обновлять только три таблицы и счётчики; полный `window.location.reload()` закрывает контекст пользователя и не нужен.
- Полный перечень UCI без полей в UI: [`docs/hidden-settings.ru.md`](hidden-settings.ru.md).

### Android: автопоиск и QR-сопряжение

- Зелёный эмуляторный тест не доказывает камеру, private MAC, SIM, OEM background
  behavior или связь с OpenWrt. Использовать ручные профили из
  [`android-test-lab.ru.md`](android-test-lab.ru.md); тяжёлый стенд не добавлять в
  обычный CI (§andlab1).
- В Windows PowerShell 5 `sdkmanager` и `emulator` могут писать обычные warnings
  в stderr при exit code 0. Android lab сохраняет этот поток, но определяет
  неуспех native-команды по exit code; не возвращать автоматическое падение на
  любой `NativeCommandError` (§andlab1).
- Для `adb shell am instrument` финальный `INSTRUMENTATION_CODE: -1` означает
  успешный AndroidJUnitRunner protocol report. На Windows host exit code может
  отличаться; принимать результат можно только при одновременных свежих `OK (N
  tests)`, `N > 0`, code `-1` и отсутствии `FAILURES`/`INSTRUMENTATION_FAILED`
  (§andlab1).

- Служебный `sheepfold-hash-common` предназначен только для состояния, кэша и дедупликации. Не подключать его к QR/pairing: `sheepfold-pair-common` сохраняет отдельный `pair_sha256`, а Android обязан URL-кодировать временный код, особенно символ `+`. Замена алгоритма или form-кодирования на одной стороне снова сделает правильный QR недействительным. (§dscqr01)
- В публичном CGI не разбирайте `application/x-www-form-urlencoded` через `tr | while read`: поведение цикла в конвейере различается между shell и версиями BusyBox `ash`. Разбирайте пары `&`/`=` параметрическим раскрытием POSIX shell и проверяйте реальным POST через `uhttpd`; иначе непустое тело превращается в отсутствующие `login`/`code`. (§dscqr01)

- Автопоиск сначала читает `/.well-known/sheepfold.json` через штатный HTTPS роутера, затем проверяет объявленный порт через отдельный `/cgi-bin/sheepfold-api/ping`; проверка корня API попадает в общий лимит команд и может ложно показать «сервер не найден». Детский APK ищет шлюз до 30 секунд и лишь затем показывает ручной IP (§dscqr01).
- Внешняя HTTP-квота с r293 использует общий bucket-lock; не удалять lock-файл при reset и не возвращать разрешение после отказа reader/writer. Exit 1 означает квоту, технический отказ — 503. Внутренний pairing-счётчик не заменён этим механизмом; подробности [B39–B42 и R09](bug-register.ru.md) (§dscqr01).
- QR нельзя отображать до успешной backend-активации кода. Новый QR сбрасывает старые pairing-счётчики; ошибки определения телефона в DHCP/neighbour/ARP не расходуют лимит неверных кодов (§dscqr01).
- Android-сканер не должен навсегда закрываться после первого распознанного кадра. Во время запроса анализ блокируется, после ошибки постоянно видимый payload остаётся защищён от циклической повторной отправки, новый QR принимается без выхода со страницы, а тот же код разрешается повторить только после нескольких пустых кадров. Один вечный флаг `delivered` ломает вторую попытку (§dscqr01).
- В LuCI нельзя помечать QR использованным по клиентскому событию сканирования: телефон мог распознать изображение, но не завершить запрос. Плашка «QR-код использован» включается только после `admin-pairing-status` с `paired=1`; этот статус подтверждает атомарную привязку и сжигание кода backend (§dscqr01).
- Новые QR выпускаются только как `SF2` с `spki=<64 hex>`. Это SHA-256 от DER SubjectPublicKeyInfo активного `/etc/uhttpd.crt`, а не hash PEM-файла и не hash полного X.509 certificate. Android проверяет SPKI до POST `/pair`; при несовпадении нельзя делать fallback на TOFU/HTTP. Старые certificate pins и `SF1` оставлены только для совместимости (§tlspinv2).
- Не проверяйте QR-рендерер короткой строкой вроде `test`: боевой `SF2` содержит IP, порт, логин, десятисимвольный код и 64 hex-символа SPKI. В `r218` фиксированная версия 5 принимала только 106 байт, поэтому backend активировал код, модалка открывалась, а вместо QR возвращалась ошибка переполнения. Минимальный регрессионный тест обязан рендерить полную боевую строку и проверять размер матрицы (§qrcap1).
- Не передавайте сохранённый hostname прямо в `URL.openConnection()`. Только подписанный `SF2` родительского APK может разрешить имя один раз; успешный локальный IP становится единственным сохранённым endpoint. Границы `RouterHttps` и `ChildRouterHttps` обязаны отклонять hostname, loopback, multicast и публичные IP для команд, ИИ, виджетов, детских отчётов и восстановления порта. Иначе отдельный клиент легко вернёт DNS rebinding незаметно для остальных (§dnsbind1).
- `RouterConnectionRequest` намеренно является обычным `class`, а не `data class`: токен, device identity и TLS-отпечатки живут в слабой карте по идентичности экземпляра. Структурное равенство позволяло временному результату первого `read()` стать ключом второй сессии, после чего GC удалял действующие секреты и APK при повторном входе ошибочно требовал новое сопряжение. Корневой экран и фоновые worker-ы читают подключение один раз и проверяют именно этот объект (§authrs1).

### Android: геометрия меню и снимки тестов

- Patch `Move to` с изменением только регистра на Windows может удалить файл при успешном ответе. Использовать промежуточное отличающееся имя и проверять наличие/хеш; [подробности окружения](agent-environment.ru.md#смена-регистра-имени-файла-на-windows).

- Для Wi-Fi QR обязательно задавать ZXing `CHARACTER_SET=UTF-8`: без этого не-латинские SSID/пароли превращаются в `?`. Проверять декодирование нарисованного QR, а не только строку payload; при снятии QR после ввода закрывать клавиатуру тестовой Activity (§andlab1).
- `INSTALL_FAILED_UPDATE_INCOMPATIBLE` в Codex может быть следствием другого Java `user.home`: Gradle берёт debug key sandbox-пользователя. Сверить сертификаты и `:app:signingReport`, задать `ANDROID_USER_HOME` на существующий каталог владельца, не удалять приложение и не заменять ключ. Команда: [рабочие панели Android](android-test-lab.ru.md#рабочие-панели-родительского-приложения) (§andlab1).

- `GetTextLayoutResult` может вернуть параграф шире фактического `Text`, хотя строка полностью видна. Не считать один `hasVisualOverflow` доказательством обрезания: проверять ширины строк, высоту, многоточие и границы слов; подробности в [Android-стенде](android-test-lab.ru.md#меню-переносы-подписей) (§andlab1).
- Синтетические PNG хранить в app-private `cacheDir`, читать у debug APK через `exec-out run-as` и проверять PNG-сигнатуру. На OEM `/sdcard/Android/data` может быть закрыт даже для `run-as`, а ADB вернуть код 0 с `Permission denied` вместо картинки; не расширять ради снимка права телефона (§andlab1).

### Android: новые Wi-Fi-сети детского устройства

- Отчёт выключен по умолчанию и разрешается детскому APK только флагами аутентифицированного для устройства `/client-status`; одного наличия Android-разрешения недостаточно.
- Открытый BSSID не отправлять и не хранить на роутере: телефон передаёт SHA-256-отпечаток `SSID+BSSID`, а устройство backend определяет только по адресу соединения и DHCP/ARP.
- Чужая Wi-Fi-сеть не видит локальный домашний роутер. Детский APK хранит не больше 100 уже обезличенных отчётов и передаёт их после возвращения; выключение настройки удаляет очередь, а режим без геолокации очищает координаты до отправки.
- Координаты называть последним доступным местоположением телефона, а не адресом Wi-Fi-точки. Router backend повторно проверяет свежесть времени, ограничивает историю и предоставляет явную очистку (§childwifi1).
- Минимальная прошивка OpenWrt может иметь `sha256sum`, но не иметь отдельной утилиты `od`. Секрет pairing генерируется из `/dev/urandom` через SHA-256 с прежним 40-символьным hex-форматом; не возвращайте безусловный вызов `od`, иначе Android получает `token_generation_failed` уже после правильного распознавания QR (§pairrng1).
- Сопряжение не должно вызывать обычный `sheepfold-device-id ensure`: он коммитит UCI и разрушает атомарность операции. Pairing использует общий для `pair-device` и `ensure-staged` private savedir через `uci -t <savedir> -p <savedir>`; `uci -P <savedir>` здесь запрещён, потому что на реальном OpenWrt даже успешный `commit` оставляет изменения во временном каталоге. Токен, числовой ID, белый список устройств, админский флаг и сжигание кода считаются одной операцией. После final commit backend обязан перечитать эти поля обычным `uci` из основного `/etc/config/sheepfold` и только затем вернуть токен Android. Иначе APK откроет главное окно, а устройство не появится у администратора. При добавлении нового поля расширяйте fault-injection и live-router тесты (§pairtx1).
- Не стройте аутентификацию CGI на `HTTP_X_SHEEPFOLD_DEVICE_ID` или `HTTP_X_SHEEPFOLD_DEVICE_MAC`: uhttpd на части OpenWrt-сборок не экспортирует нестандартные заголовки. Bearer выбирает серверный bound-token, а ID/MAC читаются только из его файла и сверяются с UCI и MAC, который роутер наблюдает у `REMOTE_ADDR`. Иначе роутер успевает привязать телефон, но первый `/router-info` получает `401`, и APK ошибочно сообщает о неподтверждённой привязке (§pairtx1, §authrs1).
- В BusyBox `ash` объявляйте набор локальных переменных как `local token_file hash now`, а не строкой `token_file hash now`. Второй вариант проходит `sh -n`, но в runtime пытается запустить команду `token_file`; поэтому security-контур обязан содержать поведенческий shell-тест, а не только синтаксическую проверку.
- Число `device.id` является постоянной пользовательской и аудиторской ссылкой. Не ищите минимальный свободный номер, не переиспользуйте ID удалённой карточки и не уплотняйте последовательность при обновлении: старые журналы, расписания и токены должны продолжать означать то же устройство. Формат `D-0012` можно нормализовать в `12` с MAC-привязанным `legacy_ids`, но валидный числовой ID не меняется (§deviceid2).
- Ошибка QR-сопряжения должна различать «API недоступен», «телефон ещё не найден в DHCP/neighbour/ARP», использованный код и blocklist; пустые `null`/`undefined` пользователю не показываются.
- При определении MAC по IP сначала используйте DHCP lease, затем `ip neigh`, затем `/proc/net/arp`: на современных OpenWrt neighbour-запись может появиться раньше старой ARP-таблицы.
- Домашний доступ v1 включается явным Save в интеграции: отдельный API-root, только подтверждённый прямой `wan`, два pinned HTTPS-адреса для parent APK. Сначала открыть APK на Wi-Fi Sheepfold; не ждать от первичного gateway discovery поиска по всей сети. Изменение адреса/шлюза закрывает допуск, POST не повторяется после сбоя. [Контракт и границы живой проверки](home-network-access.ru.md#что-действительно-работает-сейчас) (§homen01).

### Временная удалённая техподдержка

- Experimental control-клиент объявляет только `claimV1/localRevokeV1`; требовать FRP уже для
  `claimOpen` нельзя. Transport capabilities проверяются при `prepare`, не заменяя реальный
  broker. `sessionPreparing` не означает подключившегося сотрудника.
- При потере ответа на отзыв повторяется та же подпись/sequence. Новый ответ на тот же запрос
  создавал `sequenceGap`; regression есть в public/private support tests. Replay сравнивает
  все подписанные bytes, а не только одинаковые ID.
- Недостоверные часы необратимо закрывают test-only control-клиент: восстановление времени не возвращает код, pending request или доступ; точный контракт `clockUntrusted` описан в [протоколе](remote-support-protocol.ru.md) (§rsup001).
- [Ручной control peer-стенд](../tools/remoteSupport/README.ru.md) открывает только synthetic
  loopback HTTPS и проверяет настоящий private handler/MFA. Это не установленный OpenWrt
  manager и не доказательство FRP. Потеря неподтверждённого запроса до истечения срока требует
  будущего signed status-sync; сбрасывать sequence или повторно создавать claim запрещено.

- Случайный или отдельный порт не является шифром: сканирование его обнаружит, а связь порта с продиктованным кодом ослабит оба значения. У каждого роутера нужна отдельная криптографическая identity, transport использует короткоживущий mTLS credential, а случайный `sessionRoutePort` существует только внутри закрытого relay/bastion и не кодируется в 12-значном номере (§rsup001).
- `tools/remoteSupport/` нельзя подключать к LuCI или пакету: это Node.js reference-контракт для тестов. Он фиксирует точные байты и общие инварианты; production router/server обязан реализовать тот же протокол своими адаптерами и пройти cross-runtime golden vectors (§rsup001).
- Закрытый `sheepfold-support-server` не добавляется submodule и не является runtime-зависимостью установки Sheepfold. Общая граница сверяется через два `peer-project.json`; router protocol и golden vectors изменяются сначала здесь, а server queue/operator/Codex bridge - в закрытом репозитории (§rsuppeer).

### Family message relay

- Durable public-attempt marker пишется до HTTP body; generic/чужой 404 не является доказательством отсутствия команды. Не разрешать indirect `INDETERMINATE`/public retry → `READY`; см. [continuation plan](family-message-relay-continuation-plan.ru.md) (§mrelay1).
- 400/401/403/410 на повторном public enqueue не опровергает выполнение первой попытки с потерянным ответом; сохранять неопределённый итог, а не предлагать новую команду: [continuation plan](family-message-relay-continuation-plan.ru.md) (§mrelay1).
- Физический Android `OK (N tests)` включает assumption-skips; instrumentation не должен очищать рабочий Keystore, а `am start -W` может зависнуть после фактического старта. Команды/изоляция fixtures: [parent-router stand](../tools/android-testing/parent-router-integration/README.ru.md) (§andlab1).
- `LeftCompositionCancellationException` после `/pair` может означать поворот Activity, а не сетевой timeout: операция принадлежит Activity ViewModel, шаг сохраняется отдельно без секретов. Граница process death и свежего QR: [Android-конфигурация](android-config.ru.md) (§pairtx1).
- Timeout уже привязанного APK проверять отдельно от QR: allocator и UCI commit на каждую строку вызывали и `list_devices`, и общая `token_device_is_admin_paired` до отбора нужного MAC. Быстрый helper `router-info` не доказывает быстрый HTTP с авторизацией. Не увеличивать timeout вместо устранения причины; fast path и repair повреждённого ID: [паспорт устройства](device-passport-and-control.ru.md) (§deviceid2).
- «Обновить» родительского управления не является синхронизацией всех вкладок: набор запросов централизован в `RouterPanelLoader`, журнал не имеет второго entry-load, фоновые уведомления независимы. Возвращение полного reload или применение отменённого ответа нарушит [контракт панелей](android-config.ru.md#обновление-данных-открытой-панели) (§andpanel1).
- Круглая кнопка «Далее» является концом scroll-content, не экранным overlay. Использовать `actionNext` из каталога, проверять обе темы и disabled state: [каталог](icon-catalog.ru.md), [UI/lifecycle stand](../tools/android-testing/parent-router-integration/README.ru.md) (§iconcat1, §uicontrast).
- Перед ручным Gradle проверить `GRADLE_USER_HOME`: унаследованный путь может принадлежать другому проекту. `npm.cmd run lint:android` сам использует `.build/gradle-user-home`, `--no-daemon` и Kotlin in-process; доверенный кеш можно передать только процессной переменной `SHEEPFOLD_GRADLE_USER_HOME`. Если sandbox запрещает чтение `gradle-core-api-*.jar`, повторить неизменный Node-runner вне sandbox. Не очищать кеш и не чинить его ACL (§testenv1, §andlab1).
- Native Linux golden-vector/sanitizer gate не доказывает OpenWrt ABI или рабочий relay; SDK, ledger и dispatcher остаются отдельными gates: [helper README](../package/sheepfold-message-relay-crypto/README.ru.md) (§mrelay1).
- SDK уже задаёт `_FORTIFY_SOURCE`: сначала `-U`, затем своё `-D`, не отключать `-Werror`. SDK хранить на диске, переиспользовать cache и проверять живой `make` после обрыва SSH: [helper README](../package/sheepfold-message-relay-crypto/README.ru.md) (§mrelay1).
- Лимит событий detector считает попытки, включая отказ lock; счётчик только успешных запусков допускает неограниченный обход очереди при ошибке: [device-detection.ru.md](device-detection.ru.md) (§detload).
- В detector TSV нужны placeholders и для IP, и для hostname; `/regex/i` не является case-insensitive синтаксисом awk. Старый DHCP IP не должен вытеснять live LAN IP: [автоопределение](device-detection.ru.md) (§devpas1, §detload).
- Отображаемое имя карточки устройства и `dhcp host.name` имеют разные контракты: русское имя с пробелом допустимо в Sheepfold, но может остановить `dnsmasq`, если попасть в постоянную аренду. Сохраняйте безопасный ASCII hostname отдельно либо оставляйте его пустым; при импорте резервной копии отклоняйте некорректное имя до изменения UCI (B171).

- Не пытайтесь проксировать через VPS существующий `/api/v1/*` или передавать туда local Android Bearer. Для `§mrelay1` нужны отдельные router/phone identities, AES-GCM-authenticated E2E envelopes, bounded TTL/deduplication и политика `local_preferred`; недоступность сервера дома должна оставлять локальный pinned HTTPS рабочим. Точные параметры и частичный статус реализации хранятся в [`docs/android-router-message-relay.ru.md`](android-router-message-relay.ru.md).

### Telegram: опасные команды

- `/internet_off`, `/wifi_off`, `/clear_logs`, `/update`, `/reboot`, `/grant_time`, `/block_device`, `/unblock_device`, `/allowlist_add` и `/blocklist_add` не выполняются первым сообщением. Бот создаёт один pending action для разрешённого ID и требует отдельный 6-значный код; новый запрос заменяет старый. В pending для устройства хранить только проверенный числовой ID и ограниченное число минут, но не исходную строку пользователя и не shell-команду.
- Код берётся только из `/dev/urandom` через SHA-256 либо `openssl rand`. Не возвращайте fallback по времени/PID: если безопасной случайности нет, действие должно отказать. Pending-файл создаётся с `umask 077`, атомарно заменяется и удаляется до запуска команды, чтобы повтор сообщения не повторил действие (§tgconfirm).
- Генератор и parser обязаны принимать одинаковую длину кода. В `r215` генератор был переведён на 6 цифр, а старое регулярное выражение ожидало 4 и делало любое подтверждение невозможным; поведенческий тест должен проходить через `handle_confirmation`, а не проверять только генератор (§tgconfirm).

### OpenWrt release-сборка

- Одинаковое расширение `.apk` используется и apk-tools v3 на OpenWrt 25.12, и Android. OpenWrt APK собирается только официальным SDK; переименование IPK создаёт повреждённый пакет, даже если имя выглядит правильно (§owrtci1).
- Быстрый `scripts/build-test-ipk.py` доказывает состав/права тестового архива, но не совместимость Makefile с feeds/luci и package format целевой версии. Перед Release обязателен Actions matrix и живой роутер (§owrtci1).
- OpenWrt `apk` при обновлении может автоматически вызвать `init.d` сразу после распаковки, до завершения пользовательского `postinst`. Нельзя в этом промежуточном старте применять firewall, LED и DNS-политику: файлы, права и UCI-миграции ещё не образуют завершённую версию. `pre-install`/`pre-upgrade` при этом запускается **без позиционного аргумента**, поэтому `preinst` не должен ждать `$1=install|upgrade`: он безусловно ставит краткоживущий `/tmp/sheepfold/package-installing`, init откладывает старт, а `postinst` снимает маркер перед единственным финальным restart; устаревший маркер init удаляет сам (§pkgstart1).
- Standard/AI-фильтрацию нельзя копировать в YAML: один источник истины — `scripts/sheepfold_variants.py`. Иначе тестовый IPK и SDK release могут незаметно получить разный payload (§prodvar, §owrtci1).

### Многоступенчатые пакеты обновлений от внешнего агента

- До применения сверяйте SHA-256 каждого архива и распаковывайте его в отдельный временный каталог. ZIP и `tar.gz` с одинаковым содержимым не обязаны иметь одинаковый хеш.
- Проверяйте cumulative overlay на чистом клоне базового коммита. Установщик нельзя считать источником истины только потому, что он завершает ранние стадии: в r252 один слой проверял файлы, которые появлялись лишь в следующем слое, а ранний валидатор ожидал уже изменённый хвост backend-файла.
- Обычный `node --check` неприменим к LuCI-модулям с верхнеуровневым `return`. Используйте LuCI-aware loader или временную функцию-обёртку, иначе корректный модуль будет объявлен синтаксически ошибочным.
- На русской Windows Python-валидатор архива запускайте с UTF-8 (`PYTHONUTF8=1` или `python -X utf8`), если он печатает кириллицу. Ошибка кодировки консоли не доказывает ошибку payload.
- После ручного восстановления слоёв обязательны проверки финального дерева, а не только тесты из архива: `git diff --check`, проектные категории тестов, ESLint, Android Lint, сборка вариантов пакета и проверка документации. (§patchov1)

### Внешние списки сайтов

- URL страницы проекта не является URL списка. Заводские значения должны вести на plain/hosts/Adblock/archive-файл; HTML-ответ никогда не заменяет рабочий кэш (§slstres).
- Один источник обновляется независимо от остальных. Сначала ограниченно скачать и распаковать, затем нормализовать и дедуплицировать во временный файл, и лишь потом атомарно заменить его кэш.
- Ограничения нужны на всех уровнях: время запроса, размер скачанного и распакованного файла, строки одного источника, число источников и суммарные строки до сортировки. Иначе каждый файл по отдельности безопасен, но их объединение всё равно может исчерпать RAM.
- Непустая, но полностью некорректная настройка URL не равна команде «очистить список». Иначе одна опечатка родителя незаметно снимает защиту.
- Git Bash на Windows может вызвать `C:\Windows\System32\sort.exe` вместо GNU `sort`; поведенческий тест передаёт `/usr/bin/sort` через `SHEEPFOLD_SITE_LIST_SORT_HELPER`.
- Скачанный кэш ещё не доказывает фильтрацию. До проверки потребителя `allowlist.domains` / `blocklist.domains` нельзя помечать белый/чёрный список сайтов как работающий runtime (§uirunfx).

### AdGuard Home API

- В POSIX `sh` переменные функций глобальны. Парсер не должен использовать имя вроде `current_url`, если вызывающая функция хранит в нём адрес управляемого фильтра: вложенный вызов незаметно перезапишет значение. Для сложных shell-модулей использовать префиксы функции (`pf_*`, `sync_*`) и защищать такие коллизии поведенческим тестом (§aghplan).
- При смене приватного feed token старый URL не исчезает из AdGuard Home сам. Хранить последний принадлежащий Sheepfold URL в файле `0600`, строго проверять локальный формат, подтверждённо отключать прежний URL и никогда не считать совпадение имени фильтра доказательством владения (§aghplan).
- `check_host` может подтвердить старое правило из кэша, даже если `uhttpd` уже не отдаёт ленту. Перед refresh локально скачать собственный feed без токена в argv и сравнить содержимое с активным файлом (§aghplan).
- Ответ `POST /control/filtering/refresh` со значением `updated: 0` корректен. Не превращать его в ошибку: после него проверяются собственный URL, состояние фильтра и контрольные правила.

- Перед каждым HTTP-запросом удалять прежний response-файл. Иначе сетевой сбой может оставить старый успешный JSON, который следующий шаг ошибочно примет за свежий ответ (§aghplan).
- Любой helper, которому передаются `method` и `path`, обязан сам проверять allowlist endpoints. Недостаточно считать пути безопасными только потому, что текущие callers используют строковые константы.
- Не вставлять буквальные управляющие символы CR/LF внутрь многострочного shell-pattern `case`: на Git Bash такой шаблон уже превратил проверку credentials в срабатывающую для пустой строки. Сравнивать исходное значение с вариантом после `tr -d '\r\n'` и защищать сценарий поведенческим тестом.
- На Windows одного `* text=auto` недостаточно для OpenWrt-файлов с нестандартными расширениями: `.nft`, `.uc`, `.defaults` и `.pot` могут получить смешанные окончания строк. Для них закреплён `eol=lf` в `.gitattributes`; перед коммитом использовать `git add --renormalize .` и затем проверить staged diff, а не переписывать shell/package-файлы в CRLF вручную (§winsbx1).
- Успешный `HTTP 200` недостаточен: проверять ограничение размера, JSON-синтаксис, обязательные поля и допустимые типы до изменения runtime-состояния.
- `/control/dns_info` нужен для диагностики, но не должен ломать уже подтверждённый собственный фильтр при отсутствии endpoint или повреждённом ответе. `/control/status` с `running=0` или `protection_enabled=0`, напротив, доказывает, что фильтр сейчас не исполняется, и требует fallback.
- Не сохранять сами upstream/fallback/bootstrap адреса в status, журнал или LuCI: для диагностики достаточно количества. Реальный DNS-путь LAN-клиентов хранить отдельным полем и не подменять его фактом доступности API.
- Windows-тест `adguardIntegration.test.mjs` эмулирует каждую операцию `jshn.sh` отдельным Node-процессом и на текущем стенде может идти 6–7 минут. Это стоимость тестового harness-а; production OpenWrt использует нативный `jshn.sh`. Давайте `networkIntegration` не меньше 15 минут. Если внешний runner оборвал родителя, сначала найдите дочерний процесс по полной командной строке теста и завершите только его; не убивайте все `node.exe`. Увеличивать тайм-аут допустимо, ослаблять проверку схемы production-кода нельзя (§testcat).
- `filtering/check_host` разрешён только для фиксированных контрольных доменов Sheepfold в зарезервированной зоне `.test`; query-параметры проверяет тот же HTTP-helper, который проверяет method/path. Не превращать endpoint в прокси для произвольного домена или клиента.
- Подтверждение контрольного правила требует одновременно точного `rules[].text` и `rules[].filter_list_id` собственного фильтра. Устаревшие верхнеуровневые поля `rule`/`filter_id` не использовать. Тип `rules` и тип элементов проверять явно: строка в JSON не должна выглядеть как массив и превращаться в обычное несовпадение правила.
- Контрольная проверка движка и сквозной DNS-путь — разные факты. `check_host` не доказывает, что телефон отправляет DNS-запросы через AdGuard Home; до отдельного клиентского теста LuCI обязан оставлять жёлтый статус.

### Обновление IPK

- В shell нельзя рассчитывать только на `set -e`, если функция вызывается внутри `cmd || code=$?`: в таком контексте некоторые ошибки внутри функции не остановят выполнение. Критические шаги updater проверяются явным `if ! ...; then return` (§updsafe).
- Сообщение `opkg: Malformed package file` приходит слишком поздно. Updater до `opkg` обязан проверить официальный URL asset, `debian-binary`, единственные `control.tar.gz`/`data.tar.gz`, безопасные пути, имя пакета, версию и `Architecture: all`.
- `postinst` не удаляет временную копию `/tmp/sheepfold/update/sheepfold-config-before-update`: updater удаляет её только после получения и проверки результата `opkg`. Иначе ошибка `postinst` уничтожит единственную оперативную копию до попытки восстановления.
- Восстановление UCI-конфига не равно откату бинарного пакета. Updater не должен обещать полный rollback, пока предыдущий IPK действительно не сохранён и не проверен.
- `§maintjob1`: фоновые задания запускаются только через `sheepfold-maintenance`; обычный режим лишь уведомляет, а `start-beta` допускается раз в час только при сохранённом `beta_testing=1` (§betatest1). Нельзя удалять offline-карточку без проверки списков, DHCP, расписаний, группы, административной привязки и `user_configured`.
- `§betatest1`: бета-профиль не разрешает новые виды сбора данных. Его изменение требует обновления подтверждения LuCI, тестов и [контракта обслуживания](maintenance-jobs.ru.md). Не снимайте flock в родителе после передачи worker и не наследуйте его в перезапускаемые init-службы.
- `§updsafe`: exit-коды сетевых утилит могут совпасть с внутренними кодами «нет новой версии»/«отменено». Фоновый updater различает их по `update_outcome`, иначе ошибка wget с кодом 4 выглядит как добровольная отмена и скрывает уведомление.
- `§country1`: country profile не имеет права молча заменять уже настроенный `system.@system[0].zonename`; внешняя IP-геолокация запрещена.
- `§devpas1`: выбор полного режима не устанавливает `nmap`; optional package action всегда отдельный, подтверждённый и ограниченный именованным пакетом.
- `§apicon1`: изменяющая LuCI-команда не должна вручную дублировать `button.disabled`, toast и reload. Составная UCI/runtime-операция получает стабильный action key; после post-commit runtime failure UI перечитывает фактический UCI, а не откатывает интерфейс предположением.
- `§persist1`: ошибка runtime после успешного UCI commit не является rollback. Адаптер ставит `persisted=true`, UI перечитывает фактический конфиг и сообщает о частичном результате. DOM и toast запрещены внутри persistence-модулей.
- `§coordclean1`: schedule/group persistence и settings side effects не возвращать в `overview.js`. Coordinator может подтверждать действие и обновлять DOM, но UCI-list, membership staging, runtime ordering и discovery payload принадлежат отдельным модулям.
- `§settingview1`: поля Settings, Misc/Storage/AI composition и device-type listbox не возвращать в `overview.js`. Presentation-модуль получает draft callbacks; UCI/backend/runtime остаются отдельными adapters.

## Уточнения r295: admin-config и pairing hardening

- `revision` подтверждает только успешное чтение и SHA-256, не атомарность всех последующих UCI-полей; HTTP 503 после записи требует повторного чтения, а не слепого повторения POST. Подробности [B50](bug-register.ru.md) (§apicon1).
- В admin-config `set -f` обязателен: `for value in $list` не должен подставлять файлы текущего каталога вместо ID/дней. JSON-control экранируются, не заменяются пробелами. [B51–B52](bug-register.ru.md) (§apicon1).
- После переноса pairing-счётчика hardener должен проверять attempts library, import/reserve/lock/write/reset и её синтаксис, а не удалённое `record_failed_attempt`. [B53](bug-register.ru.md) (§dscqr01).


## Уточнения r296: Wi-Fi и rollback

- SSID — точный идентификатор в байтах, не обрезаемая подпись. Краевые пробелы значимы;
  предел 32 проверяется в C locale. WPA-PSK и SAE не должны получать одну произвольную
  проверку длины пароля. Для OWE ключ не обязателен (§apicon1).
- При отказе восстановления сохранять имеющийся snapshot, а не безусловно удалять TX_DIR.
  Не писать восстановление поверх действующего файла до проверки полной копии.
  Коды cleanup 72/73 должны иметь приоритет над первой строкой исходной ошибки в CGI.
  Файл восстановлен и Wi-Fi работает — разные утверждения. Не переносить эту гарантию
  на pending UCI, общую конкуренцию, reboot или fsync; см. [B57/R10](bug-register.ru.md).

## Просьба ребёнка и область переменных shell (§child30)

`requests_enabled` вызывается внутри `create_request` без подоболочки: локальная
переменная `section` обязательна, иначе цикл администраторов заменяет ребёнка.
Не лечить ошибку отключением проверки типа в `sheepfold-device-id`. Полученный
до неуспешного commit ID также нельзя считать подтверждённым. Обычный журнал не
пишет в JSON-канал; GET отправляет 200 только после успешного выхода list-helper.
B65–B67 в r299 закрывают обнаруженные read errors и согласуют queue-helper.
Остаток R11 — RAM-лимиты, crash cleanup, часы и UCI/opt-in; не считать queue-lock
транзакцией всех writers. Lock-файл не удаляется; после публикации lock освобождается
до журнала. Повреждённая запись сохраняется, а не обнуляется ради 200.
Подробности: [r299](audit-fixes-r299.ru.md).
Проверки и причины решений: [аудит r298](audit-fixes-r298.ru.md).


## Google Drive: загрузка и сохранность исходного архива (r304)

См. [профиль Google Drive](google-drive-storage.ru.md) и [отчёт r304](audit-fixes-r304.ru.md).
Не считать локальный `wc` удалённой проверкой и не скрывать `not found` через
`|| true`. Ранний отказ исходной r303 и последующие дефекты после исправления
объявлений имеют разные уровни доказательства. Восстановление из облака,
OAuth/квоты, native jshn и реальная доставка не подтверждены этим проходом.


## Google Drive: контекст нельзя обновлять посреди старой загрузки (r307)

Привязка TOKEN_CACHE к реквизитам сама по себе не согласует поиск ID и последующую
запись: следующий access_token мог уже перейти на новый refresh token. Поддерживаемые
загрузки теперь наследуют snapshot одного вызова; не заменять его новым во вложенном
helper ради продолжения после конфликта. Folder cache сравнивает собственный
context_key и root_name; сохранённый после отказа старый файл не означает допустимость
его ID. Проверять reached-маркер смены UCI и HTTP после него, а не только exit.
Настоящее Google ACL модель не доказывает. [B91–B92](bug-register.ru.md),
[команды r307](audit-fixes-r307.ru.md). Полная транзакция UCI/HTTP остаётся открытой.


## Google Drive: неизвестный расход не разрешает очистку (r308)

size в Drive — строка; regex числа без кавычек давал ноль, жадный regex — лишь
последний объект. Очистка обязана получить целый проверенный список обеих папок
до DELETE и остановиться после первого неуспеха. 200 элементов/256 КиБ — предел
обработки, не доказательство полноты без проверки nextPageToken. Backups не
удаляются ради квоты. Подробности — [B93–B94](bug-register.ru.md),
[воспроизведение r308](audit-fixes-r308.ru.md). Успех модели не доказывает Google ACL.


## Google Drive: исправный список не означает безопасный restore (r310)

Пользовательский list использовал отдельный построчный JSON-reader, поэтому
прежние исправления точного поиска и квот автоматически его не охватывали.
Нужно проверить весь ответ двух папок и отсутствие неполной страницы до ok=true.
Имена сериализуются jshn, а не склеиваются из строк сырого HTTP. Получение списка
не включает старый latest/restore с непроверенной распаковкой. Для wc-fault нужен
маркер достигнутого чтения: файл подаётся через stdin и отсутствует в argv.
См. (§gdlst01), [B98–B99](bug-register.ru.md), [отчёт r310](audit-fixes-r310.ru.md).


## Google Drive: status не является сохранением (r311)

Не возвращать set/commit `gdrive.authorized` в `cmd_status`: общий commit сохранял
чужую pending-очередь. Не вызывать из status ensure/cache-подготовку папок — она
создаёт объекты. `drive_status_bytes` использует только проверяемый поиск и чтение.
Явная отправка проверяет текущие реквизиты, не постоянный authorized; OAuth-кэш
в RAM по-прежнему обновляется. [B100–B101](bug-register.ru.md),
[команды и ограничения](audit-fixes-r311.ru.md).

- **Yandex sync-status, r320:** status — последняя успешно опубликованная отметка,
  не доказательство всех внутренних этапов облачного прохода. Ранний отказ не должен
  оставлять прежний успех при доступном хранилище, а сбой записи не отменяет результат
  PUT. Не подставлять «no sync yet» после ошибки чтения; см. [§ydav001](yandex-disk-storage.ru.md)
  и [B122–B124](bug-register.ru.md).


## Яндекс Диск: download и сохранность прежнего файла (r321)

Не исправлять только `remote_path code`: за ранним отказом скрывалась запись
curl поверх получателя и его удаление при HTTP-ошибке. `download` требует два
аргумента, готовит закрытый файл рядом с получателем и публикует после HEAD/GET/HEAD.
Старые `list`/`restore-config` остаются отдельно непроверенными. `yandex_sync_quote`
экранирует содержимое строки, **не добавляет внешние кавычки JSON**.
В fault-стенде нельзя нормализовать `..`/`//` до передачи исходной строкой в shell;
а прочитанный для выбора wc-fault stdin нужно передать исправной реальной утилите.
См. [§ydav001](yandex-disk-storage.ru.md) и [протокол r321](audit-fixes-r321.ru.md).

## Яндекс Диск: контекст команды не равен контексту одного файла (r322)

- Не переопределять `transferSettings` внутри uploader, когда внешний caller уже
  прочитал root/квоту. `yandex_transfer_begin` наследует контекст или начинает его
  для самостоятельного вызова; иначе новый пароль смешивается со старым путём.
- Отказ `quota_mb` проверять до арифметики. Частичный stdout с fallback не есть
  значение, выбранное владельцем. Default 500 применяется только к отсутствующей опции.
- При позднем отказе не утверждать откат предыдущих PUT/удалений. `cloud` snapshot
  не охватывает `global.log_storage` и не заменяет общий lock UCI/WebDAV.
- В новом fixture `uci show sheepfold` нужен reader выбранного журнала. Его отсутствие
  не доказывает баг экспортёра: это ошибка подготовки модели, исправляемая в тесте.

См. [§ydav001](yandex-disk-storage.ru.md) и [протокол r322](audit-fixes-r322.ru.md).

## Импорт: исключение из Promise и результат уже выполненного сохранения

В backup-panel недостаточно `deps.apply(...).then(success, failure)`: снимок
контроллера может бросить до создания Promise, а исключение внутри success
не попадает в failure того же then. Нужна охватывающая цепочка и конечный catch.
После `persisted:true` нельзя включать старую кнопку повторной мутации или
утверждать, что прежние настройки сохранены. При failed confirm/rollback
истинное состояние неизвестно. Текст ошибки надо проверять в реально показанном
модальном окне, а не в произвольном созданном E-узле.

В VM-тестах ждать завершения реальной WebCrypto, а не единственного setImmediate:
прежний event handler может не возвращать Promise. Глобально подавлять
unhandledRejection нельзя; отброшенное продолжение наблюдается в конкретной
тестовой обёртке, и его ошибка проверяется утверждением.
См. [контракт backup](settings-backup.ru.md) и [B139–B141](review-r323-import-followup.ru.md).


## Messenger: тестовая кнопка не является Save

Проверять настоящий `controller.renderBot`, а не только settingsBox с идеальными
callbacks: отсутствующий actions.execute скрывал следующий неявный save. Special
saver принимает только отправленное подмножество полей, не collectOptions() после
await. fs.exec(restart) проверяется по числовому exit; persisted не равен успешной
службе. Локальный test-lock не транзакция всех UCI-writers. См.
[протокол B147–B150](review-r323-messenger-lifecycle.ru.md).


## Сохранение времени: результат команды не равен синхронизации (§country1)

С r326 `recover` использует uptime и две попытки, общий time-lock и GNU timeout;
не включать выключенный NTP и не считать `syncing` исправлением часов. Ошибочная дата
не должна возрастной очисткой удалять очередь уведомлений. Контракт, зависимость
и команды проверки — [настройка времени](time-and-detection-setup.ru.md).

В отдельном query-only тесте `ntpd -w` код 124 означает окончание окна timeout,
а не сетевой успех: нужны строки `reply from`; не убирать `-w` и не переносить
такое толкование exit 124 на time-save. [Безопасный NTP-запрос](time-and-detection-setup.ru.md#запрос-ntp-без-изменения-часов).

Time-saver принимает только отправленные поля, не поздний DOM. `sheepfold-time-control`
после подтверждённой записи может вернуть exit5 `ntp_restart_failed` с persisted=1
и runtime_applied=0. Общий action-wrapper отклоняет exit до `.then`; классификация
должна стоять на действительном catch и требовать точный контракт, не принимать
частичные поля exit124 за доказательство. Ошибка журнала не заменяет результат.
Rollback time-helper ещё не подтверждён как надёжный. [B151–B153 и стенд](review-r323-time-lifecycle.ru.md).


## Аварийные копии времени после review-r323 (§country1)

`time-control` больше не удаляет чужой transaction.PID и не очищает исходные снимки
после неудачного rollback. Exit 6 / `time_rollback_failed` означает неполное файловое
восстановление, не подтверждённую запись. Уборка после успешного save не отменяет NTP
restart. Общая UCI-очередь и параллельные writers остаются вне этой гарантии.
[Протокол и ограничения](review-r323-time-recovery.ru.md).
