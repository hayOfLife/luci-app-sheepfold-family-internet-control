# Архитектурные решения Sheepfold

<!-- §adrproc -->

ADR хранит контекст решения, а профильный документ хранит подробное текущее устройство. Номер ADR означает порядок записи, а не важность.

| ADR | Решение | Статус | Основные теги |
|---|---|---|---|
| [0001](0001-product-variants.ru.md) | Две редакции роутерного пакета и два общих Android APK | Принято | `§prodvar` |
| [0002](0002-router-owned-api-and-pairing.ru.md) | Роутер владеет API, ключами и защищённым сопряжением | Принято | `§k5rf0hb`, `§pairtx1`, `§tlspinv2` |
| [0003](0003-uci-persistence-and-command-boundaries.ru.md) | UCI хранит настройки, а немедленные команды применяются атомарно | Принято | `§m9qe4lk`, `§listnoref` |
| [0004](0004-device-passport-and-trust.ru.md) | MAC-карточка, классификация и доверие к устройству разделены | Принято | `§devpas1`, `§devident1` |
| [0005](0005-event-driven-device-analysis.ru.md) | Анализ устройств событийный и ограниченный по ресурсам | Принято | `§detlife1` |
| [0006](0006-access-policy-and-router-protection.ru.md) | Приоритет доступа отделён от безусловной защиты роутера | Принято | `§84azytj`, `§h6mxq4c` |
| [0007](0007-site-filtering-backends.ru.md) | Sheepfold выбирает AdGuard Home либо встроенную фильтрацию | Принято | `§dompol`, `§aghplan` |
| [0008](0008-logs-and-sensitive-export.ru.md) | Обычный журнал живёт в RAM, экспорт маскирует данные | Принято | `§b3nw8vp` |
| [0009](0009-optional-ai-boundary.ru.md) | ИИ необязателен и не участвует в решении firewall | Принято | `§prodvar`, `§aiexec1` |
| [0010](0010-native-luci-and-asset-versioning.ru.md) | LuCI остаётся нативным, модульным и версионирует assets из пакета | Принято | `§frontmod`, `§assetv1` |
| [0011](0011-local-quality-gates.ru.md) | Локальные детерминированные quality gates вместо внешнего AI-score | Принято | `§qassist`, `§impact1`, `§testcat` |
| [0012](0012-android-background-work.ru.md) | Периодическая сеть через WorkManager, точное окончание доступа через AlarmManager | Принято | `§andwork1` |
| [0013](0013-strict-ai-json-boundary.ru.md) | Строгий form-urlencoded и динамический JSON AI backend через общий helper и jshn | Принято | `§jsonio1` |
| [0014](0014-coalesced-luci-action-subscribers.ru.md) | Одна backend-команда сохраняет callbacks каждого UI-инициатора | Принято | `§actsub1` |
| [0015](0015-manual-agentic-security-audit.ru.md) | Агентный security-аудит остаётся ручным консультативным слоем | Принято | `§secaudit1` |
| [0016](0016-trusted-home-network-access.ru.md) | Sheepfold доступен из явно доверенных сегментов без дополнительного кода подтверждения | Принято | `§homen01`, `§pairux1` |
| [0017](0017-central-project-icon-catalog.ru.md) | Собственные значки LuCI и Android имеют единый именованный источник | Принято | `§iconcat1` |
| [0018](0018-maximum-and-selective-automation.ru.md) | Единый максимальный профиль и доступная выборочная автоматизация | Принято | `§autoact1` |
| [0019](0019-site-list-ingestion-safety.ru.md) | Внешние списки загружаются ограниченно и не вытесняют последнюю рабочую копию ошибкой | Принято | `§slstres`, `§dompol` |
| [0020](0020-isolated-ai-server-core-experiment.ru.md) | Серверное ядро ИИ исследуется отдельно от продуктовых сборок | Принято | `§aisrvexp1`, `§aiexec1` |
| [0021](0021-canonical-group-schedule-links.ru.md) | Группы связываются с расписаниями только через стабильные цели расписания | Принято | `§grpsch1` |
| [0022](0022-temporary-remote-support-access.ru.md) | Первоначальный FRP/SSH-проект временной техподдержки | Частично заменено ADR-0031 | `§rsup001` |
| [0023](0023-private-support-server-boundary.ru.md) | Закрытый серверный проект отделён от публичного router-side протокола | Принято | `§rsup001`, `§rsuppeer` |
| [0024](0024-manual-hybrid-android-test-lab.ru.md) | Android runtime проверяется ручным гибридным стендом | Принято | `§andlab1`, `§testwhy` |
| [0025](0025-parent-apk-encrypted-support-reports.ru.md) | Родительское APK шифрует баг-репорт до домашнего роутера | Принято | `§feedback`, `§srep001`, `§rsuppeer` |
| [0026](0026-signed-github-support-endpoint-discovery.ru.md) | Резервный адрес баг-репортов принимается только из подписанного manifest | Принято | `§srep001`, `§srepdisc1`, `§rsuppeer` |
| [0027](0027-local-first-family-message-relay.ru.md) | Необязательный local-first relay коротких сообщений родительского APK | Принято | `§mrelay1`, `§k5rf0hb`, `§q3nj8wd` |
| [0028](0028-opt-in-beta-updates.ru.md) | Явное участие в часовых обновлениях и узкий тестовый профиль | Принято | `§betatest1`, `§maintjob1`, `§updsafe` |
| [0029](0029-parent-apk-self-update.ru.md) | Ручное обновление APK с тем же signing key и системным подтверждением | Принято | `§apkupd1` |
| [0030](0030-resumable-parent-apk-installation.ru.md) | Скачивание и установка одной операцией с восстановлением после Settings | Принято | `§apkupd1` |
| [0031](0031-typed-https-remote-support.ru.md) | Исходящий HTTPS и подписанные типовые операции вместо FRP/SSH; OpenWrt-клиент отложен | Принято | `§rsup001`, `§rsuppeer` |

## Статусы

- `Предложено` — решение обсуждается и не является обязательным.
- `Принято` — действующий архитектурный контракт.
- `Заменено ADR-NNNN` — историческая запись; новое решение находится в указанном ADR.
- `Частично заменено ADR-NNNN` — перечисленная часть стала исторической; сохранённые условия явно названы в новом решении.
- `Отклонено` — вариант рассмотрен и не выбран.

## Правило сопровождения

При изменении решения создать новый ADR на основе [шаблона](template.ru.md). Старый ADR сохраняется и получает ссылку на новый. Одновременно обновляются профильная документация, §-теги и тест, который защищает изменившийся контракт.
