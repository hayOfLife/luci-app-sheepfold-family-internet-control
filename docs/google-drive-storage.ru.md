# Google Drive для журналов и бэкапов

## Статус реализации

CLI backend:

```text
/usr/libexec/sheepfold/sheepfold-google-drive
```

Диспетчер: `sheepfold-log-storage` (значение `log_storage=google_drive`).

Авторизация: **OAuth2 refresh token** + Google Drive API v3 (через `curl`).

## UCI

```uci
config global 'global'
    option log_storage 'google_drive'

config google_drive 'gdrive'
    option client_id ''
    option client_secret ''
    option refresh_token ''
    option root_folder '/sheepfold'
    option quota_mb '500'
    option authorized '0'
```

## Подключение (MVP)

1. Создайте проект в [Google Cloud Console](https://console.cloud.google.com/).
2. Включите **Google Drive API**.
3. Создайте OAuth client типа **Desktop app**.
4. Получите **refresh token** на ПК (OAuth Playground или свой скрипт) с scope `https://www.googleapis.com/auth/drive.file`.
5. В LuCI: **Настройки → Управление памятью роутера** → **Google Drive** → вставьте client ID, client secret и refresh token.

## Структура на диске

```text
/sheepfold/logs/events.log
/sheepfold/logs/<timestamp>-*.tar.gz
/sheepfold/backups/sheepfold-config-YYYYMMDD-HHMMSS.tar.gz
```

## Команды

```text
sheepfold-google-drive status|test|list|download|restore-config|sync-status|push-events|archive-push
```

LuCI вызывает через `sheepfold-router-control`: `google-drive-test`, `google-drive-list`, `google-drive-restore-config`, `google-drive-sync-status`.

## Граница проверенной загрузки r304

В r304 исправлены `push-events`, загрузка существующих архивов из `archive-push`
и используемые ими функции. Сначала подготавливается закрытый снимок файла,
затем отправка, затем отдельный запрос метаданных `files.get` с `fields=id,size`.
Только соответствующий ID и совпадающий нормализованный размер позволяют
считать эту проверку успешной. У исходного файла проверяется отсутствие
наблюдаемого изменения относительно снимка. Ошибка оставляет исходный архив.

Это проверка размера, не контрольной суммы; ошибку ответа после записи нельзя
считать доказательством отсутствия изменений на Drive. `verify <local> <bytes>`
остаётся локальной проверкой переданного размера. Для JSON-метаданных используется
штатная зависимость `jshn`, не AI-only библиотека.

Самостоятельные list/download/restore и остальные старые readers не объявлены
работающими после этой правки: в них остаются известные или непроверенные проблемы.
Подключение к настоящему аккаунту, OAuth refresh, libubox на роутере, квоты,
пагинация, конкурентные отправители и восстановление конфигурации требуют отдельного
проверочного прохода. Закрытый снимок увеличивает потребление RAM.

Подробности: [B82–B84 и R14](bug-register.ru.md),
[команды и доказательства r304](audit-fixes-r304.ru.md).
