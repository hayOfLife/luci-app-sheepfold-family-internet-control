# Задача разработчика — Sheepfold

> **Точка входа для нового разработчика и AI-агента.**
> Читайте этот файл первым, затем переходите по ссылкам на детальные документы.
>
> План разделения одного общего кода на `Sheepfold` и `Sheepfold - AI Support`: [`product-variants.ru.md`](product-variants.ru.md). Прямое задание и боевой промпт: [`product-variants-implementation-task.ru.md`](product-variants-implementation-task.ru.md) (§prodvar).

---

## Что такое Sheepfold

Sheepfold — OpenWRT-пакет для семейного управления доступом в интернет. Родитель управляет через веб-интерфейс LuCI и Android-приложение. Управление включает: расписания, группы устройств, белый и чёрный списки устройств, отдельные списки сайтов, аварийно-полезные сайты, интеграции с Telegram/VK, AI-ассистент.

---

## Порядок чтения документации

1. [`docs/agent-fast-start.ru.md`](agent-fast-start.ru.md) — короткий маршрут нового чата: что проверить и читать, не загружая весь проект в контекст. (§fastagt)
2. [`docs/architecture/decisions/README.ru.md`](architecture/decisions/README.ru.md) — почему приняты ключевые архитектурные решения и когда их пересматривать (§adrproc).
3. [`docs/owner-communication-profile.ru.md`](owner-communication-profile.ru.md) — как понимать итеративные требования владельца, различать виды списков и сообщать результат (§usrcomm).
4. **Этот файл** — общая ориентация и карта детальных документов.
5. [`docs/agent-environment.ru.md`](agent-environment.ru.md) — локальное окружение Codex Desktop на Windows, нужные программы, сборка IPK/APK и команды проверок.
6. [`docs/github-actions-openwrt-build.ru.md`](github-actions-openwrt-build.ru.md) — каноническая сборка Standard/AI Support: IPK для 24.10, настоящий OpenWrt APK для 25.12, артефакты и Release (§owrtci1).
7. [`docs/agent-gotchas.ru.md`](agent-gotchas.ru.md) — реестр неочевидных мелочей (i18n, группы, детектор, IPK); **обязательно дополнять** при новых находках.
8. [`docs/troubleshooting.ru.md`](troubleshooting.ru.md) — практический справочник ошибок: симптомы, причины, проверки и безопасные исправления для Windows, тестов, Android, OpenWRT и LuCI. (§trouble)
9. [`docs/agent-playbook.ru.md`](agent-playbook.ru.md) — детальный плейбук для AI: продуктовые решения, архитектурные ограничения, правила реализации.
10. [`docs/product-requirements.md`](product-requirements.md) — полные требования к продукту.
11. [`docs/ai-assistant-development/README.md`](ai-assistant-development/README.md) — точка входа для памяти, модулей, БД и политики диалога ИИ-помощника (§aiarch1).
12. [`docs/backend-design.ru.md`](backend-design.ru.md) — архитектура бэкенда роутера, API-эндпоинты, UCI-структура.
13. [`docs/uci-config-migration.ru.md`](uci-config-migration.ru.md) — шаблон UCI, `postinst`, миграции при обновлении роутерного пакета IPK/OpenWrt APK (обязательно при изменении `/etc/config/sheepfold`).
14. [`docs/default-groups.ru.md`](default-groups.ru.md) — группы `no_restrictions` / `child_1`, язык при установке, миграция алиасов.
15. [`docs/hidden-settings.ru.md`](hidden-settings.ru.md) — UCI-параметры без поля в LuCI; обновлять при появлении/удалении полей.
16. [`docs/localization.ru.md`](localization.ru.md) — LuCI gettext, `.lmo`, два параметра языка.
17. [`docs/android-config.ru.md`](android-config.ru.md) — конфигурация Android-клиента, сопряжение, детский APK.
18. [`docs/android-router-message-relay.ru.md`](android-router-message-relay.ru.md) — точный контракт и текущий частичный статус local-first обмена короткими сообщениями (§mrelay1).
19. [`docs/android-openwrt-api.ru.md`](android-openwrt-api.ru.md) — полный справочник API.
20. [`docs/home-network-access.ru.md`](home-network-access.ru.md) — принятый план доступа Android к Sheepfold через разные домашние роутеры, границы firewall/discovery и отложенная поддержка NAT.
21. [`docs/android-test-lab.ru.md`](android-test-lab.ru.md) — ручной гибридный стенд API 28/35, физические телефоны, живой роутер и пределы доказательства (§andlab1).
22. [`docs/child-wifi-network-notifications.ru.md`](child-wifi-network-notifications.ru.md) — уведомления о новых Wi-Fi-сетях детского устройства, геолокация, приватность и границы доверия (§childwifi1).
23. [`docs/testing-cases.ru.md`](testing-cases.ru.md) — каталог ручных тест-кейсов; перед PR выбираются только затронутые сценарии.
24. [`docs/test-strategy.ru.md`](test-strategy.ru.md) — категории автоматических тестов, быстрые команды и условия обязательного полного прогона. (§testcat)
25. [`AGENTS.md`](../AGENTS.md) — правила для AI-агентов: именование, стиль, ограничения, фиксация gotchas.
26. [`CODING_RULES.md`](../CODING_RULES.md) — обязательные правила кодинга и ревью (раздел 22 объясняет, куда писать мелочи).
27. [`docs/debugging-and-verification.ru.md`](debugging-and-verification.ru.md), [`docs/change-impact-review.ru.md`](change-impact-review.ru.md), [`docs/api-contracts.ru.md`](api-contracts.ru.md) и [`docs/ui-review-contract.ru.md`](ui-review-contract.ru.md) — доказательная диагностика и рабочие контракты ревью (§debug01, §impact1, §apicon1, §uxrev01).
28. [`docs/quality-assistants/README.ru.md`](quality-assistants/README.ru.md) — единая точка входа в карту влияния, быстрый/строгий gate, документационный и структурный аудит, all-pairs и read-only LuCI (§qassist).
29. [`docs/documentation-writing-standard.ru.md`](documentation-writing-standard.ru.md) — стандарт ясной и доказательной документации и проектный skill для её создания или ревью (§docwrit).
30. [`docs/owner-open-questions.ru.md`](owner-open-questions.ru.md) — ещё не принятые продуктовые и архитектурные решения с рекомендуемыми вариантами (§ownques).
31. [`docs/icon-catalog.ru.md`](icon-catalog.ru.md) — единый источник собственных значков LuCI/Android, визуальная страница и команды генерации (§iconcat1).
32. [`utilities/README.ru.md`](../utilities/README.ru.md) — граница для полезных сопутствующих материалов, которые стоит сохранить, но нельзя выдавать за действующий контракт или рабочий инструмент (§utils1).
33. [Обновление родительского APK](android-app-updates.ru.md) — ручная кнопка, подпись, публикация assets, тесты и независимость от роутера (§apkupd1).

---

## Текущий статус реализации

См. [`docs/current-implementation-status.md`](current-implementation-status.md).

**Кратко:** LuCI, router backend, API и оба Android-приложения уже содержат рабочие части и незавершённые экраны. Не поддерживайте здесь второй быстро устаревающий перечень: доказательный статус, границы реализации и нужные живые проверки находятся в [`current-implementation-status.md`](current-implementation-status.md) и [`implementation-audit-2026-07-16.ru.md`](implementation-audit-2026-07-16.ru.md) (§implaudit).

---

## Ключевые архитектурные решения

### 1. Хранение данных
- Все настройки — на роутере в `/etc/config/sheepfold`.
- Android хранит только адрес роутера, порт, логин администратора и кэш последнего снимка.
- Секреты (токены, AI-ключи) — только на роутере, никогда в Android и никогда в QR.

### 2. Приоритеты правил доступа (от высшего к низшему)
1. Группа «Без ограничений» — выше чёрного списка устройств для обычного интернета (решение владельца от 07.09.2026).
2. Чёрный список устройств.
3. Админские устройства.
4. Белый список устройств.
5. Глобальная блокировка.
6. Временный доступ.
7. Расписание устройства.
8. Расписание группы.
9. По умолчанию (`new_device_policy`).

Карантин идентичности перекрывает сохранённые исключения отдельным защитным слоем. Чёрный список всегда закрывает LuCI/SSH/API, даже если группа разрешает интернет. Аварийно-полезные сайты — отдельное доменное исключение.

Расчёт firewall и child status использует `sheepfold-lib-access-policy`; редактирование порядка пока не реализовано. Текущий проход исправлений: [аудит r287](audit-fixes-2026-09-07.ru.md).

### 3. API-слой
- Эндпоинт: `/cgi-bin/sheepfold-api/*`
- LuCI вызывает только `/usr/libexec/sheepfold/sheepfold-router-control` — без динамических shell-команд.
- Опасные действия требуют confirm-токена.

### 4. Android
- Первая настройка: соглашение → домашняя сеть → MAC-проверка → QR → PIN.
- Продолжение по мобильным данным заблокировано.
- Детский APK — отдельная сборка без авторизации.
- Тема по умолчанию: «следовать системе».

### 5. Уведомление за 5 минут до ограничения
API `/cgi-bin/sheepfold-api/client-status` возвращает `warning_before_minutes: 5`. Android и детский APK должны показывать уведомление заблаговременно.

### 6. Диагностика (router-info)
В ответе **запрещены**: пароли Wi-Fi, токены, MAC-адреса клиентов, имена детей, списки устройств.
Для диагностики интернета — страновая цепочка (для России: `ya.ru`, `gosuslugi.ru`, `ntp1.vniiftri.ru`).

---

## Структура репозитория

```
/
├── android/                  # Android-приложение (Kotlin)
│   └── app/                  # Единственный app-модуль
├── package/
│   └── luci-app-sheepfold-family-internet-control/
│       ├── htdocs/luci-static/resources/view/sheepfold/
│       │   └── overview.js   # Маршрут и композиция предметных LuCI-модулей
│       ├── htdocs/luci-static/resources/sheepfold/features/
│       │   └── ...           # Устройства, настройки, хранение, журнал и другие области
│       └── Makefile
├── docs/                     # Документация
│   ├── agent-playbook.ru.md  # Плейбук для AI
│   ├── agent-environment.ru.md # Codex Desktop на Windows: окружение и команды
│   ├── backend-design.ru.md  # Архитектура бэкенда ← читать обязательно
│   ├── ai-assistant-development/ # Модули, БД и dialogue policy ИИ-помощника
│   ├── yandex-disk-storage.ru.md  # Yandex Disk: WebDAV, журнал, бэкапы
│   ├── android-config.ru.md  # Android-конфигурация ← читать обязательно
│   ├── testing-cases.ru.md   # Тест-кейсы ← выбрать затронутые перед PR
│   └── ...
├── utilities/                # Сопутствующие полезные материалы, не являющиеся контрактом или частью сборки
├── AGENTS.md                 # Правила для AI-агентов ← читать обязательно
└── README.md
```

---

## Фокус следующего этапа реализации

Рабочие backend-команды, CGI/API, firewall4, редакторы расписаний и групп, сопряжение Android и отдельный детский APK уже существуют. Не реализовывать их повторно по старому чеклисту.

### Приоритет 1 — доказать поведение на реальном оборудовании
- [ ] Закрыть оставшуюся матрицу live-router для чёрного списка устройств, глобального отключения, восстановления firewall и четырёх сочетаний AdGuard Home/Podkop.
- [ ] Проверить сопряжение, отзыв токена, TLS-отпечаток и восстановление после временной недоступности на физических телефонах.
- [ ] Проверить реальные переходы расписаний по времени, включая ночные интервалы и конфликты.

### Приоритет 2 — точечная надёжность и UX
- [ ] Исправлять только подтверждённые заглушки и неполные операции из [`current-implementation-status.md`](current-implementation-status.md).
- [ ] Продолжать мобильную проверку LuCI без повторного широкого разбиения уже выделенных модулей.
- [ ] При изменении собственных значков править `icons/catalog.json`, запускать генерацию и визуально проверять общий каталог (§iconcat1).

### Приоритет 3 — Android и API
- [ ] Проверять и расширять существующие Android-редакторы только поверх действующих авторизованных API-контрактов; не возвращать локальные заглушки и дубли LuCI-логики.
- [ ] Подтвердить Android Lint, сборку, поведение фоновых задач и уведомлений на поддерживаемых версиях Android.
- [ ] Не считать модельные тесты заменой физическому телефону и установленному роутеру.

---

## Важные ограничения для AI-агентов

- Не добавлять `yandex.ru` или `ya.ru` в заводские аварийно-полезные сайты: оба адреса открывают доступ к слишком широкой поверхности Яндекса. Будущий отдельный opt-in для поиска требует самостоятельного решения и предупреждения.
- Не реализовывать VPN/WireGuard туннели.
- Не показывать селектор роли в MVP.
- Не добавлять скрытые детские интерфейсы.
- Бэкенд-ожидания (long poll, update, cron) закреплены в `docs/backend-design.ru.md` — не переносить их в UI-комментарии.
- Не хранить секреты в QR, `router-info`, журнале.
- Не использовать `1.1.1.1` / `google.com` как единственные цели диагностики.

---

## Контрольные точки (Definition of Done)

Перед тем как считать задачу выполненной:

- [ ] Пройдены все затронутые 🔴 критические тест-кейсы из `docs/testing-cases.ru.md`; спорные `N/A` объяснены
- [ ] `router-info` не содержит секретов (TC-API-01)
- [ ] Сохранение настроек только по явному «Сохранить» (TC-UI-02)
- [ ] «Без ограничений» выше blocklist для интернета; запрет управления роутером независим (TC-API-05, TC-EDGE-07)
- [ ] QR не содержит секретов (TC-SEC-02)
- [ ] Обновлён `AGENTS.md` при изменении продуктовых решений

---

## Связанные документы

| Документ | Назначение |
|---|---|
| [`AGENTS.md`](../AGENTS.md) | Правила для AI-агентов |
| [`docs/agent-fast-start.ru.md`](agent-fast-start.ru.md) | Короткий маршрут нового агента и экономный порядок проверок |
| [`docs/agent-environment.ru.md`](agent-environment.ru.md) | Локальное окружение Codex Desktop на Windows и команды проверок |
| [`docs/agent-playbook.ru.md`](agent-playbook.ru.md) | Детальный плейбук |
| [`docs/product-requirements.md`](product-requirements.md) | Полные требования |
| [`docs/backend-design.ru.md`](backend-design.ru.md) | Архитектура бэкенда |
| [`docs/android-config.ru.md`](android-config.ru.md) | Android-конфигурация |
| [`docs/android-openwrt-api.ru.md`](android-openwrt-api.ru.md) | Справочник API |
| [`docs/testing-cases.ru.md`](testing-cases.ru.md) | Тест-кейсы |
| [`docs/live-router-testing.ru.md`](live-router-testing.ru.md) | Тестирование на роутере |
| [`docs/messaging.ru.md`](messaging.ru.md) | Интеграция мессенджеров |
| [`docs/android-router-message-relay.ru.md`](android-router-message-relay.ru.md) | Точные параметры local-first обмена родительского APK с роутером через необязательный relay (§mrelay1) |
| [`docs/remote-support-access-plan.ru.md`](remote-support-access-plan.ru.md) | Архитектура временного доступа техподдержки, FRP, Podkop bypass и отзыв (§rsup001) |
| [`docs/remote-support-threat-model.ru.md`](remote-support-threat-model.ru.md) | Активы, угрозы, fail-closed controls и блокирующие условия выпуска техподдержки (§rsup001) |
| [`docs/remote-support-protocol.ru.md`](remote-support-protocol.ru.md) | Проектный protocol `v1`: identity, подписи, сроки, порты, replay, состояния и error codes (§rsup001) |
| [`docs/remote-support-server-integration.ru.md`](remote-support-server-integration.ru.md) | Граница публичного router client и закрытого server/operator проекта, владение контрактами и cross-repo проверка (§rsuppeer) |
| [`tools/remoteSupport/README.ru.md`](../tools/remoteSupport/README.ru.md) | Исполняемый control-клиент, предметные проверки и ручной HTTPS/MFA peer-стенд; не OpenWrt/FRP runtime (§rsup001) |
| [`docs/privacy.ru.md`](privacy.ru.md) | Политика конфиденциальности |
| [`docs/ai-assistant-development/README.md`](ai-assistant-development/README.md) | Архитектура будущего ИИ-помощника и карта модулей |
- [Фоновые задания обслуживания](maintenance-jobs.ru.md) — ротация RAM-журнала, консервативная очистка offline-карточек, обычные уведомления об обновлении и явно включаемый часовой бета-режим (§maintjob1, §betatest1).
- [Время и необязательный nmap](time-and-detection-setup.ru.md) — сохранение системного timezone, country recommendations без IP-геолокации и явная optional-tool граница (§country1, §devpas1).
- [Единый запуск LuCI-команд](luci-command-actions.ru.md) — stable action key, duplicate-click coalescing, structured errorCode и локальная перерисовка (§apicon1).
- [Persistence-адаптеры LuCI](luci-persistence-adapters.ru.md) — UCI apply, device/DHCP/runtime, Wi-Fi reload, backup rollback и pairing (§persist1).
- [Финальная зачистка LuCI coordinator](luci-coordinator-cleanup.ru.md) — удалённые forwarding helpers и допустимая оставшаяся orchestration-граница (§coordclean1).

## Продолжение аудита принятой r297

[r298: просьбы ребёнка](audit-fixes-r298.ru.md) продолжает принятую владельцем
`bdb3a92`, сохраняет доработки runner/CI и добавляет B61–B64.
[r299: очередь просьб](audit-fixes-r299.ru.md) добавляет B65–B67: чтение без потери
записей, единый queue-lock и приватная подготовка/публикация. Остаток R11 — RAM-лимиты,
аварийная уборка и согласование с UCI/opt-in, не изменение правил выдачи доступа. Общая карта причин — [реестр ошибок](bug-register.ru.md).
