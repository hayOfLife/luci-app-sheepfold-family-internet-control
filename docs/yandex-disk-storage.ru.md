# Yandex Disk для журналов и бэкапов

## Статус реализации

<!-- §ydav001 -->

**Актуальная граница r321:** самостоятельный `download <remote> <local>` исправлен:
получатель остаётся внутри `/tmp`, ссылки и самостоятельные `.`/`..` отклоняются.
Скачивание идёт в закрытый временный файл рядом с получателем, не поверх прежней
копии. HEAD → GET → HEAD и сравнение размера предшествуют одной публикации; ошибка
сохраняет прежние байты в проверенных сценариях. Сверяется контекст UCI. Формат
успеха прежний: `ok`, `remote`, `local`, `bytes`. Новые ошибки и повторение проверок —
[протокол r321](audit-fixes-r321.ru.md), B125–B127 [реестра](bug-register.ru.md).
Совместимость HEAD с Яндексом не подтверждена; без длины отказ, не фиктивный успех.
Это не checksum, не готовое восстановление и не общая транзакция скачиваний.

**Сохранённая граница r320:** результат `push-events`/`archive-push` фиксируется
после завершения, включая охваченные ранние отказы. Ошибка служебной записи не
отменяет основной ответ. `sync-status` проверяет ограниченный JSON и отличается
от проверки реального состояния облака; см. [протокол r320](audit-fixes-r320.ru.md).
При недоступном хранилище статуса остаётся только предупреждение stderr, не
обещание гарантированного отображения последней неудачи. XML/quota/prune остаются R15.

**Сохранённая граница r319:** `push-events` и `archive-push` отправляют снимок
именно выбранного административного журнала, подготовленный под общей блокировкой
writer/API/rotator. Блокировка освобождается до HTTP; новые события остаются для
следующей копии. Ранний отказ запуска push-events исправлен. Модель PUT/HEAD
подтверждает локальный контракт, **не работу настоящего Яндекс Диска**.

Из r318 сохранена проверка размера через HEAD 200 с единственным Content-Length;
без подтверждения локальный архив не удаляется. Размер не является checksum.
Полный XML/quota/prune, list/restore и общая конкурентность остаются R15;
самостоятельное скачивание имеет узкую границу r321, описанную выше.
См. [реестр](bug-register.ru.md), [r318](audit-fixes-r318.ru.md) и
[протокол r319](audit-fixes-r319.ru.md).

`status` теперь только читает UCI: он не пишет `authorized` и не сохраняет чужую
очередь. Явный `archive-push` проверяет доступ отдельным probe вместо старого флага.
Проба требует завершения curl и HTTP 207, но не проверяет каждое свойство XML.
Redirect и технический отказ probe не дают успех; явный транспортный отказ чтения
объёма даёт `state=error`. Это не исправляет весь расчёт квоты: `quota_mb()` ещё
может подставлять default после ошибки UCI; XML/квота требуют отдельного аудита.


С r315 подготовка пути не раскрывает локальные файловые маски и не меняет IFS
вызывающего кода. MKCOL продолжает обход только после curl exit 0 и 201 либо
совместимого 405. 405 **не доказывает тип коллекции**: проверка DAV XML остаётся
открытой. 200/204, redirect, 409, 423 и остальные ошибки останавливают подготовку.
Созданные до отказа родительские папки не удаляются автоматически.

Невозможность прочитать выбранный `root_folder` не даёт права перейти к `/sheepfold`.
Default применяется при подтверждённом отсутствии опции. Снимки UCI сравниваются;
это не изоляция от всех параллельных изменений. Архивный preflight возвращает
`root_unavailable` либо `remote_prepare_failed` и не начинает PUT; локальная подготовка могла уже выполниться.
В status отказ root даёт `state=error`, `free_pct=0`, без записи UCI.
С r319 preflight-тесты `push-events` исполняют production без поправки объявления.
Самостоятельный restore не включён и остаётся непроверенным изменяющим путём.
С r316 логический путь отделён от URI: `#`, `?`, `%`, пробелы и другие специальные
байты кодируются, `/` остаётся разделителем. Значение `%2F` в настройке — буквальное
имя, поэтому в адресе будет `%252F`, а не слеш. Кириллица/эмодзи кодируются байтами
UTF-8 без изменения UCI. Вводить предварительно URL-кодированную настройку не нужно.
Отдельные `.`/`..` и управляющие байты запрещены до первого MKCOL; существующие
ошибочные папки автоматически не исправляются. Ошибка encoder прекращает запрос.

Эти правила не означают готовности list/restore. Самостоятельный download
проверен отдельно в r321, без разбора XML или применения конфигурации. Старый parser href ещё
не декодирует URI надёжно; prune отклоняет href с `%` до удаления, вместо ошибочной
интерпретации его как буквального имени. Полная работа XML, серверная нормализация,
обратное кодирование имён и квоты остаются R15. Протоколы request-target получены
на loopback HTTPS настоящим curl, не на Яндекс Диске.

CLI backend:

```text
/usr/libexec/sheepfold/sheepfold-yandex-disk
```

Диспетчер выбранного backend хранения:

```text
/usr/libexec/sheepfold/sheepfold-log-storage
```

LuCI: **Настройки → Управление памятью роутера** (`overview.js`, вкладка `storage`).

Подключение — **WebDAV** (`https://webdav.yandex.ru`) с логином Яндекса и **паролем приложения** (Яндекс ID). REST OAuth API Яндекса.Диска **не используется**.

Зависимость пакета: **curl** (нужен для PROPFIND/PUT/MKCOL).

## Модель хранения

Журнал событий пишется в RAM. Путь по умолчанию:

```text
/tmp/sheepfold/events.log
```

`sheepfold.global.log_cache_path` выбирает другой обычный файл внутри `/tmp/sheepfold`.
Ссылки, выход из каталога и неправильный тип отклоняются. При ошибке чтения настройки
старый default не подставляется. Если выбранного файла действительно нет, прямая
отправка ничего не делает, а архивный проход продолжает без этого журнала.
При отказе снимка возвращается `events_snapshot_failed` до MKCOL/PUT и удаления
ожидающих архивов. `archive-push` может выполнить авторизационную пробу до снимка.

Новый снимок имеет 0600 внутри уникального каталога 0700. Lock ожидается до пяти
секунд; под ним выполняются только локальное копирование и проверка. Снимок занимает
RAM; ограничение его объёма/времени и очистка после SIGKILL пока не реализованы.
Переименование облачных файлов этим не выполняется.

Параметр `sheepfold.global.log_storage` задаёт, куда **дополнительно** зеркалировать и архивировать данные:

| Значение | Поведение |
| --- | --- |
| `ram` (по умолчанию) | Только RAM; после перезагрузки журнал пуст |
| `usb` | Зеркалирование + `archive-push` на USB (см. [`docs/usb-storage-design.ru.md`](usb-storage-design.ru.md)) |
| `yandex_disk` | Зеркалирование + выгрузка на Yandex Disk |

RAM остаётся основным местом для быстрого просмотра в LuCI. USB и Yandex Disk — долговременный архив и резервные копии настроек.

### Структура на диске

Корневая папка по умолчанию: `/sheepfold` (настраивается в UCI `root_folder`).

```text
/sheepfold/logs/events.log          # актуальная копия журнала (push-events)
/sheepfold/logs/<timestamp>-*.tar.gz
/sheepfold/logs/events-*.log        # снимки при archive-push
/sheepfold/backups/sheepfold-config-YYYYMMDD-HHMMSS.tar.gz
```

Для превышения квоты предусмотрен `prune_remote_logs` с WebDAV DELETE. Его старый
XML-reader и обработка отказов ещё не исправлены: соблюдение лимита и безопасная
очистка не подтверждены. Успех одной отправки не закрывает эту границу.

## Зеркалирование и cron

### Живые события (`push-events`)

`sheepfold-log` после каждой записи в журнал вызывает `schedule_yandex_push`, если `log_storage=yandex_disk`.

- Интервал debounce: **300 секунд** (`YANDEX_PUSH_INTERVAL` в `sheepfold-log`).
- Загрузка: `sheepfold-yandex-disk push-events`.
- После загрузки: внутренняя **`upload_and_verify`** (сравнение размеров local/remote).
- Статус последней операции: `/tmp/sheepfold/.yandex-sync-status.json`.

### Архивы и бэкап конфига (`archive-push`)

Cron (маркеры Sheepfold в `/etc/crontabs/root`) вызывает:

```text
sheepfold-log-storage archive-push
```

Для Yandex Disk это делегируется в `sheepfold-yandex-disk archive-push`:

1. Архивы из `/tmp/sheepfold/.private/archive/`.
2. Копия `events.log` с меткой времени.
3. Бэкап `/etc/config/sheepfold` в `backups/`.
4. Ротация `logs/` при переполнении квоты.

Расписание совпадает с USB: ротация в **02:05** и **04:55**, push в **02:10** и **05:00** (см. [`docs/usb-storage-design.ru.md`](usb-storage-design.ru.md)).

## UCI

```uci
config global 'global'
    option log_storage 'ram'          # ram | usb | yandex_disk

config yandex_disk 'cloud'
    option login ''                   # login@yandex.ru
    option password ''                # пароль приложения, не основной пароль
    option root_folder '/sheepfold'
    option quota_mb '500'             # 50 | 100 | 250 | 500 | 1024
    option authorized '0'             # историческое поле; status больше не записывает его
```

Секция `cloud` — каноническое имя; в Makefile/postinst: `ensure_named_section cloud yandex_disk`.

Пароль приложения создаётся в [Яндекс ID → Безопасность → Пароли приложений](https://id.yandex.ru/security/app-passwords). В журнал, `router-info`, QR и экспорт без секретов пароль **не попадает**.

## LuCI

### Поля настроек (при `log_storage = Yandex Disk`)

- Логин Yandex Disk
- Пароль (пароль приложения)
- Корневая папка (по умолчанию `/sheepfold`)
- Лимит хранения Sheepfold: 50 / 100 / 250 / 500 МБ / 1 ГБ

Справа от выбора места хранения — **лампочка** и текст статуса (`log-storage-status` → `sheepfold-log-storage status`).

### Панель обслуживания Yandex Disk

| Кнопка | Команда router-control | Назначение |
| --- | --- | --- |
| Проверить вход | `yandex-disk-test` | Быстрая проверка логина (PROPFIND) |
| Показать файлы на диске | `yandex-disk-list` | JSON: файлы в `logs/` и `backups/` |
| Обновить статус синхронизации | `yandex-disk-sync-status` | Последний push-events / archive-push |
| Восстановить бэкап настроек | `yandex-disk-restore-config [имя]` | Восстановление `/etc/config/sheepfold` |

Выпадающий список бэкапов заполняется после «Показать файлы на диске». Пустое значение — **последний** бэкап по имени файла.

Восстановление:

1. Скачивает архив во временный каталог `/tmp/sheepfold/.yandex-backup-staging/`.
2. Создаёт **safety backup** текущего конфига в `/tmp/sheepfold/`.
3. Распаковывает `sheepfold` в `/etc/config/sheepfold`.
4. Перезапускает `/etc/init.d/sheepfold`.
5. LuCI перезагружает страницу после успеха.

Опасное действие требует `window.confirm`.

## CLI `sheepfold-yandex-disk`

```bash
sheepfold-yandex-disk status
sheepfold-yandex-disk test
sheepfold-yandex-disk list
sheepfold-yandex-disk download <remote> <local>
sheepfold-yandex-disk restore-config [file]
sheepfold-yandex-disk sync-status
sheepfold-yandex-disk verify <local> <remote>
sheepfold-yandex-disk push-events
sheepfold-yandex-disk archive-push
```

### Форматы аргументов `download` / `restore-config`

`remote` для `download`:

- `logs/<имя>` или `backups/<имя>` — относительно `root_folder`;
- полный путь внутри разрешённых префиксов `{root}/logs/` и `{root}/backups/`.

Локальный путь для `download` — только `/tmp/...`.

`restore-config` без аргумента берёт последний `sheepfold-config-*.tar*` из `backups/`.

### JSON-ответы (примеры)

`test` (успех):

```json
{"ok":true,"message":"Yandex Disk login works"}
```

`list`:

```json
{"ok":true,"root":"/sheepfold","logs":[...],"backups":[...]}
```

`sync-status` (после успешного push):

```json
{"command":"push-events","ok":true,"message":"events.log uploaded","at":"2026-07-10T12:30:45+0300"}
```

`restore-config` (успех):

```json
{"ok":true,"restored":"sheepfold-config-20260710-120000.tar.gz","safety_backup":"/tmp/sheepfold/sheepfold-config-before-restore-..."}
```

## Обёртки `sheepfold-router-control`

LuCI и rpcd вызывают только:

```text
/usr/libexec/sheepfold/sheepfold-router-control <команда> [аргументы...]
```

| Команда | Делегирование |
| --- | --- |
| `log-storage-status` | `sheepfold-log-storage status` |
| `yandex-disk-test` | `sheepfold-yandex-disk test` |
| `yandex-disk-list` | `sheepfold-yandex-disk list` |
| `yandex-disk-download` | `sheepfold-yandex-disk download $2 $3` |
| `yandex-disk-restore-config` | `sheepfold-yandex-disk restore-config $2` |
| `yandex-disk-sync-status` | `sheepfold-yandex-disk sync-status` |

ACL: `root/usr/share/rpcd/acl.d/luci-app-sheepfold-family-internet-control.json` — exec `sheepfold-yandex-disk`, `sheepfold-log-storage`.

## Безопасность

- Доступ к удалённым путям ограничен префиксами `logs/` и `backups/` под `root_folder`; `..` запрещён.
- Пароль хранится только в UCI `sheepfold.cloud.password` (chmod 600 на `/etc/config/sheepfold`).
- `authorized` выставляется backend'ом после успешной проверки; не редактируется в LuCI.
- Восстановление конфига — деструктивная операция: confirm в UI + safety backup на роутере.

## Что сознательно не реализовано

| Функция | Причина |
| --- | --- |
| REST OAuth API Яндекса.Диска | Сложнее на OpenWrt (refresh token, двухшаговая загрузка) |
| `publish-export` (публичная ссылка) | Только REST API |
| `prune --dry-run` | Можно добавить позже |
| `delta-sync` журнала | Полная перезаливка раз в 5 мин достаточна для MVP |
| YandexGPT | Отдельный API, не связан с WebDAV Диска |

## Тесты в репозитории

- `tests/logStorage.test.mjs` — маршрутизация, команды backend
- `tests/settingsSecondLevelTabs.test.mjs` — UI storage, yandex panel
- `tests/overviewUi148.test.mjs` — push-events, интервал 300 с

## Связанные документы

- [`docs/usb-storage-design.ru.md`](usb-storage-design.ru.md) — USB backend, ротация, cron
- [`docs/log-events.ru.md`](log-events.ru.md) — формат и типы событий журнала
- [`docs/hidden-settings.ru.md`](hidden-settings.ru.md) — скрытые UCI-поля
- [`docs/backend-design.ru.md`](backend-design.ru.md) — `router-control`, диагностика
- [`docs/testing-cases.ru.md`](testing-cases.ru.md) — TC-STORAGE-YANDEX-*
## Проверка одной отправки: r318

`upload_and_verify` работает с собственной копией исходника (каталог 0700, файл
0600), проверяет cp/cmp/wc до сети, PUT exit/200/201/204, затем отдельный HEAD.
Перед успехом исходник сравнивается со снимком, секция cloud — с начальной.
Исходник удаляет архивный caller только после успеха helper. Смена источника,
ошибка чтения или неоднозначные метаданные не дают разрешения на удаление.

HEAD использует HTTP/1.1, identity, no-cache, один HTTPS URL, без curlrc и redirect.
Reader принимает последний завершённый блок с единственным Content-Length;
проверяемый ответ ограничен 64 КиБ заголовков и 18 цифрами. Предел проверяется после
приёма, не является потоковым RAM-лимитом. Семантика HEAD/Content-Length:
[RFC 9110, §8.6](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6).

`verify <local> <remote>` возвращает `local_read_failed`,
`remote_metadata_unavailable` либо `size_mismatch` вместо неподтверждённых чисел.
Пустой файл допустим при подтверждённом нуле. PUT имеет `upload_failed`, подготовка
— `snapshot_failed`, изменение источника — `source_changed`. Невозможность получить
снимок cloud даёт `settings_unavailable`; обнаруженная смена во время HTTP может
отразиться как отказ соответствующего PUT/HEAD, не как успешная новая сессия.

Настройки не блокируются для других процессов; сравнение не исключает ABA и гонку
после последней проверки. Уже выполненный PUT не откатывается. Имена облачных
файлов параллельных отправителей, расход RAM, снятие stale-флагов, проверка типа
collection при 405, выбранный журнал/его блокировка и safe restore остаются R15.

## Последний результат синхронизации: r320

`sync-status` возвращает прежние поля `command`, `ok` (boolean), `message`, `at`.
Истинное отсутствие файла — `{"ok":false,"message":"no sync yet"}`, exit 0.
Ссылка, неправильный тип/схема, недоступность reader/jshn или запись более 8192 байт
дают `{"ok":false,"error":"sync_status_unavailable"}` и exit 1. Неуспешный частичный
вывод не выдаётся как результат. UI уже различает ненулевой exit и показывает
ошибку чтения; менять его тексты или автоматически повторять отправку не требуется.

Запись готовится в собственном `.yandex-sync.XXXXXX`: каталог 0700, JSON 0600,
публикация одной заменой. Старые неизвестные файлы автоматически не удаляются.
Другой выбранный backend и отсутствие журнала — пропуск, не новый успех.
Отказ чтения существующего выбора backend даёт `storage_unavailable`, до сети.
Результат основной команды не отменяется невозможностью записать эту диагностику.

Это последняя **успешно опубликованная** отметка завершения, не аудит всех запусков.
При конкуренции не обещается порядок начала операций; при SIGKILL/power loss запись
и cleanup не гарантированы. Подавленные внутри старого XML/prune ошибки не становятся
видимыми только из-за новой записи статуса. Нативный jshn/реальный Яндекс не проверены.
Полное воспроизведение — `tests/yandexSyncRuntime.test.mjs`, [runbook r320](audit-fixes-r320.ru.md).
