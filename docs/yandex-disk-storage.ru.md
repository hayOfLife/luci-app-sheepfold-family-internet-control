# Yandex Disk для журналов и бэкапов

## Статус реализации

<!-- §ydav001 -->

**Актуальная граница r318:** проверены подготовка локальных копий и подтверждение
одной отправки через PUT + HEAD, включая полный `archive-push` с моделями HTTP/UCI.
Реальный curl/TLS прошёл локальный HTTPS-стенд, **не испытание Яндекс Диска**.
Размер подтверждается только при HEAD 200 с единственным корректным Content-Length;
при отсутствии поля или неподдерживаемом HEAD локальный архив сохраняется.
Это проверка длины, не checksum. Не использовать документ как подтверждение
полной надёжности backup/restore: квоты, XML, журнал, параллельность и отдельные
команды ещё ограничены R15. См. [реестр](bug-register.ru.md) и
[протокол r318](audit-fixes-r318.ru.md). Ниже — интерфейс и назначение существующих
механизмов, не обещание полного успешного развёртывания.

`status` теперь только читает UCI: он не пишет `authorized` и не сохраняет чужую
очередь. Явный `archive-push` проверяет доступ отдельным probe вместо старого флага.
Проба требует завершения curl и HTTP 207, но не проверяет каждое свойство XML.
Redirect и технический отказ не дают успех; ошибка чтения квоты даёт `state=error`,
а не свободное место. Оставшийся XML-разбор требует самостоятельного исправления.


С r315 подготовка пути не раскрывает локальные файловые маски и не меняет IFS
вызывающего кода. MKCOL продолжает обход только после curl exit 0 и 201 либо
совместимого 405. 405 **не доказывает тип коллекции**: проверка DAV XML остаётся
открытой. 200/204, redirect, 409, 423 и остальные ошибки останавливают подготовку.
Созданные до отказа родительские папки не удаляются автоматически.

Невозможность прочитать выбранный `root_folder` не даёт права перейти к `/sheepfold`.
Default применяется при подтверждённом отсутствии опции. Снимки UCI сравниваются;
это не изоляция от всех параллельных изменений. Архивный preflight возвращает
`root_unavailable` либо `remote_prepare_failed` и не начинает PUT/подготовку копий.
В status отказ root даёт `state=error`, `free_pct=0`, без записи UCI.
Раннее объявление `push-events` и самостоятельный restore ещё не исправлены;
два теста его поздних отказов применяют явно помеченную поправку только в fixture.
С r316 логический путь отделён от URI: `#`, `?`, `%`, пробелы и другие специальные
байты кодируются, `/` остаётся разделителем. Значение `%2F` в настройке — буквальное
имя, поэтому в адресе будет `%252F`, а не слеш. Кириллица/эмодзи кодируются байтами
UTF-8 без изменения UCI. Вводить предварительно URL-кодированную настройку не нужно.
Отдельные `.`/`..` и управляющие байты запрещены до первого MKCOL; существующие
ошибочные папки автоматически не исправляются. Ошибка encoder прекращает запрос.

Эти правила не означают готовности list/download/restore. Старый parser href ещё
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

Журнал событий всегда пишется в RAM:

```text
/tmp/sheepfold/events.log
```

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
