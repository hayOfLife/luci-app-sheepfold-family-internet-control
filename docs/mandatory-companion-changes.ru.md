# Обязательные сопутствующие изменения

<!-- §cmpchg1 §docops1 §impact1 -->

## Цель

Точная документация является долговременной инженерной памятью Sheepfold. Она должна позволять
следующему разработчику или AI-агенту понять не только **что** изменить, но и **что обязано
измениться рядом, почему, как это проверить, какой результат ожидать и какие способы запуска
заведомо дадут ложную ошибку**. Чем точнее эта карта, тем меньше времени следующий агент тратит
на повторное расследование уже известных связей и тем ниже риск сломать роутер внешне небольшой
правкой.

Этот файл является нормативной матрицей. `review:impact` и `quality:plan` помогают найти строки,
но не заменяют их. Если строка подходит к изменению, перечисленные спутники обязательны. Если
конкретный пункт неприменим, это явно записывается в итог задачи или PR с причиной.

## Обязательный порядок

1. До правки найти все подходящие строки матрицы и связанные §-теги.
2. Назвать source of truth и сгенерированные/дублируемые представления.
3. Изменить production-код, обязательные спутники, профильный документ и regression test одним
   логическим набором.
4. Выполнить `npm.cmd run review:impact` и проверить, не обнаружил ли он дополнительную область.
5. Запустить direct test, объединённые предметные категории и ручные проверки из строки.
6. Записать фактические результаты, skipped/непроверенное и причины. Старый зелёный прогон не
   считается доказательством новой правки.
7. Если обнаружилась новая устойчивая связь, дополнить эту матрицу, §-карту и, когда связь можно
   определить по пути, `tools/quality/changeImpactRules.mjs` с regression test.

## Настройки, API и runtime

| Если изменяется | Обязательно актуализировать или проверить | Минимальное доказательство | Почему |
|---|---|---|---|
| UCI option, тип секции или default | `sheepfold.uci.defaults`, Makefile postinst/recovery, test-IPK builder, migration старого конфига, backup/import/export, hidden settings, LuCI/Android read-model | `backendFast packaging security`, upgrade fixture | Новая установка и обновление не должны получать разные схемы |
| UCI option, видимая пользователю | профильный settings-модуль, обе кнопки Save, перевод, API capability, документация значения/default | `luci backendFast android` по фактическим клиентам | Поле без полного persistence-круга создаёт ложное «сохранено» |
| Бета-профиль или автоматическое обновление | точный список согласованных настроек, LuCI-подтверждение, defaults/postinst, общий updater/lock, часовой RAM-таймер, выключение участия, `maintenance-jobs.ru.md` и ADR-0028 | maintenance + persistence + updater behavior tests; Linux flock; live OpenWrt перед релизом | Сохранённое участие не разрешает новые чувствительные функции и не должно переустанавливать пакет каждый час |
| CGI/API endpoint или поле ответа | route dispatcher, auth/rate limit, parser, errorCode/status, Android clients/models, LuCI caller, `android-openwrt-api.ru.md`, backward compatibility | direct API test + `backendFast android security` | Клиенты обновляются не одновременно с роутером |
| Домашний API-доступ/endpoint fallback | изолированный root, UCI consent/restore, source guard, общий nft batch и fw4/iface/start/stop/prerm, Android session-bound list, запрет повтора записей, `home-network-access.ru.md` | shell/UI/JVM tests + live LAN/upstream/TLS + firewall reload | Новая доступность порта не должна открыть LuCI, обойти quarantine или повторить команду (§homen01) |
| Просьбы ребёнка о времени (`§child30`) | identity/opt-in, `sheepfold-device-id`, queue-lock/schema/TTL/helper exit, оба CGI-маршрута, child/parent клиенты и runtime hardening | `childAccessRequestRuntime.test.mjs`, `childRequestQueueRuntime.test.mjs`, `lockCommon.test.mjs` + существующие auth/rate/home-source и child contract; fixture → direct-test map | Настоящий ID и trace отказа важнее одного статического поиска имени функции; просьба не должна выдавать доступ |
| RAM-журнал и общий путь (`§logio1`) | writer, legacy API, rotator `sheepfold-maintenance`, Google Drive/Yandex snapshots, `sheepfold-log-common`, общий lock, postinst/hardening и оба пакета; fixture и direct consumers | `logWriterRuntime`, `legacyLogRuntime`, `maintenanceJobs`, `maintenanceRotationRuntime`, `googleDriveUploadRuntime`, `yandexEventsRuntime`, package hardening/IPK + trace и Linux flock | Права записи и чтения должны совпадать; cloud worker не владеет каналом ответа/lock caller. Остальные экспортёры требуют отдельного аудита |
| Общий shell helper | все callers, BusyBox portability, lock/temp/cleanup, logger без секретов, runtime hardening и package permissions | `sh -n`, direct behavior test, `backendFast packaging` | Desktop shell и OpenWrt BusyBox имеют разные возможности |
| Общий LuCI `core/persistence/uci.js` (`§persist1`) | все feature-adapters, backup-mask/previous snapshot, UI неопределённого результата, очередь, cleanup и карта прямых потребителей | `backupMutationConsistency`, `backupImportUiSafety`, adapter/frontend/overview runtime и `changeImpact`; отдельно native rpcd batching/unload | Синхронный вход в save не доказывает синхронной сериализации RPC; замечанный смешанный черновик нельзя сохранять или стирать как собственный |
| Общие Settings `draft.js` / `save-flow.js` (`§persist1`, `§ovfinal1`) | snapshot до confirmation, частичное acceptOptions, обе Save-кнопки, runtime и post-save, модели прямых потребителей | `settingsSaveLifecycle`, frontendDomainModels/frontendModules, overviewFinalRuntime/RefreshSemantics/Decomposition, auditCorrections/finalAuditHardening, countryProfiles/overviewLocalization, changeImpact | Поздний ввод не подтверждается ответом старого запроса; общий draft не равен UCI staging, special savers и page reload проверяются отдельно |
| Messenger `settings.js` / settings `controller.js` | actions.execute/ensureOk wiring, special saver subset/accept, поздний ввод, restart code, RU po/JSON, профиль Telegram | `messengerSettingsLifecycle`, `settingsSaveLifecycle`, `luciCommandActions`, frontend/overview extraction/decomposition/localization, `telegramCommandsSync`, category/impact; отдельно live Telegram | Тестовая кнопка не может сохранять настройки; успешный RPC не равен успешной службе; скрытый провайдер не входит в отправленный subset |
| Настройки времени / `sheepfold-time-control` | time saver/accept, action-wrapper, точный exit 4/5/6, snapshots/rollback/cleanup, logger, RU gettext/JSON, профиль времени | `timeTransactionRecovery`, `timeSettingsLifecycle`, `timeAndDetectionSetup`, `settingsSaveLifecycle`, `luciCommandActions`, `portableShellAndStatus`, overview runtime/extraction/localization, category/impact; отдельно native UCI/NTP | Успех commit не равен restart; ранний reject wrapper и поздний DOM нельзя скрывать упрощённой моделью |
| LuCI JS/CSS или layout | разделённые feature-модули, переводы, accessibility/hit area, mobile overflow, asset/package version при release | `lint:js`, `luci`, visual browser check | Кэш LuCI и малый экран могут скрыть исправление или сломать UI |
| Parent/child Android UI или route | capabilities роутера, обе локали, accessibility, theme contrast, lifecycle/session recovery, APK назначения | `lint:android`, `android`, нужный emulator/physical profile | Эмулятор не доказывает камеру, SIM, Wi-Fi и OEM lifecycle |
| Типы и фильтры устройств в родительском APK | `DeviceFilter`, все списки устройств, RAM-выбор, RU/EN, таблица в `android-config.ru.md`; не менять правила автоназначения групп из-за UI-категории | `DeviceFilterRulesTest`, `DeviceFiltersTest` | Носимые входят и в персональные, и в отдельный фильтр; изменение отображения не должно менять права устройства (§andpanel1) |
| Загрузка данных родительской панели | `RouterPanelLoader`, список вкладок, зависимости редактора, command read-back, отмена ожидания, независимый notification worker, `android-config.ru.md` | `RouterPanelLoaderTest`, `androidParentManagement.test.mjs`, физическая сверка HTTP по вкладкам | Общий refresh увеличивает нагрузку, а поздний ответ может подменить данные новой панели (§andpanel1) |
| Черновики и неизвестное состояние родительского APK | `ParentWorkspace`, `FormDraft`, сброс по auth/disconnect, исходная revision, все редакторы, RU/EN, `android-config.ru.md` | `ParentWorkspaceRulesTest`, `ParentWorkspaceTest`, `ParentControlsTest`, `ParentEditorsTest` | Поворот не должен терять ввод или повторять POST; отсутствие состояния не означает allow; секретные формы не переносить в открытое постоянное хранилище (§andpanel1) |
| Каналы и сохранение Wi-Fi Android | optional `wifiChannelsRead`, GET/auth route, `wifi_channel_list`, диапазон/лимиты, `RouterPanelLoader`, предупреждение, read-back, `android-openwrt-api.ru.md` | `wifiChannelSafety.test.mjs`, `ParentWifiTest`, `RouterPanelLoaderTest`, отдельный живой AP-тест | Чужой диапазон или неизвестный результат записи могут лишить родителя связи; capability не означает успешное включение радио (§apicon1) |
| Правило доступа/приоритет | единый evaluator, firewall apply/rollback, API/Telegram/APK read-model, журнальная причина, Podkop/AdGuard комбинации | `access sites security networkIntegration`, live router | Визуально верное правило может применяться иначе в nftables |
| Фильтрация сайтов/источник | HTTPS policy, лимиты, parser, dedup, last-known-good, retry/уведомление, AdGuard ownership, статус UI | `sites security networkIntegration`, malformed fixtures | Ошибка источника не должна уничтожить рабочий список |
| Детектор/паспорт устройства | evidence provenance, classification hash, identity HMAC, manual override, auto-group, quarantine, resource budget, уведомления | device categories + lifecycle fixtures + live sample | Тип устройства и физическая идентичность не равны |
| Pairing, token или TLS pin | LuCI QR payload, one-time backend transaction, Android scanner/session recovery, rate limits, SPKI replacement flow, журналы | pairing/security tests + physical phone/router | Успешный QR scan ещё не доказывает выданные права |
| Cron/hotplug/background job | init registration, lock, bounded retries, flash/RAM writes, status/log, uninstall cleanup | backend tests + reboot/live observation | Фоновая автоматика должна переживать reboot и не душить роутер |

## Пакет, варианты и релиз

Для ручного обновления APK дополнительно проверить фиксированный источник, release asset
и digest, package ID/versionCode/signers, приватный FileProvider, permission return,
отмену и UI-state. Для installer/permission переходов обязательны Activity Result,
восстановление проверенного кеша, потеря процесса, запрет повторов после отказа/отмены
и локальная блокировка. Канонические команды и границы: [Android updater](android-app-updates.ru.md).
Не распространять правила установки OpenWrt APK на Android APK (§apkupd1).

| Если изменяется | Обязательно актуализировать или проверить | Минимальное доказательство | Почему |
|---|---|---|---|
| Файл в OpenWrt rootfs или dependency | Makefile `LUCI_DEPENDS`, оба варианта, runtime hardening/executable mode, test-IPK builder, SDK feed | `testIpkPermissions`, `productVariants`, packaging | Файл может быть в checkout, но отсутствовать или не запускаться в пакете |
| Standard/AI boundary | variant source of truth, allow/deny payload paths, package metadata, обе Android capability-модели, docs | variants + OpenWrt feed tests | Варианты должны различаться только намеренно |
| Package name/version/release | asset version, updater comparison, artifact names, release manifest, README/status при публикации | packaging + updater tests + SDK build | Несогласованная версия ломает cache и обновление |
| Updater/install/uninstall | format IPK/APK, signature/hash, config preservation, rollback limit, package-manager adapter, error text | packaging/security + clean install/upgrade/live router | Тестовый архив не равен настоящему OpenWrt release |
| Переименование GitHub owner/repository | installer/updater URL allowlist, Android metadata/asset policy и соглашение, подписанный discovery URL, Telegram, README/runbook links, maintainer, оба peer manifests/vendor | буквальный новый URL и отказ старому в policy tests, updater/bootstrap path tests, актуальные API metadata; разовый переход установленного клиента отдельно | GitHub redirect не проходит строгий metadata-клиент, а новый asset URL может быть отвергнут старым префиксом; старое имя нельзя оставлять постоянным дополнительным источником |
| Localization source | `.po` source, generated JSON/LMO, точный регистр msgid, обе локали Android при общем тексте | localization/LuCI/package tests | PowerShell JSON и ручная копия могут объединить разные ключи |
| Project icon | `icons/catalog.json`, generator, LuCI registry, Android vectors, usage list, HTML catalog | `icons:check`, `luci android tooling`, визуальный просмотр | Один значок должен иметь один источник и одинаковый смысл |

## Техподдержка, обратная связь и два репозитория

| Если изменяется | Обязательно актуализировать или проверить | Минимальное доказательство | Почему |
|---|---|---|---|
| `support-report-v1` plaintext | exact APK preview, privacy whitelist/consent, HPKE context, public schemas/docs, private validator/vendor hashes | Android crypto + public/private contract tests | Шифроваться должны именно показанные пользователю байты |
| `report-envelope-v1` | router canonical signer, private verifier/queue, key ID policy, golden vector, peer manifest | cross-runtime and peer/vendor checks | Одинаковые поля в другом порядке дают другую подпись |
| Резервный report endpoint | public verifier/helper/UCI defaults, fixed GitHub path, ADR-0026, runtime manifest docs, private offline signer, sequence/key ceremony | весь `testing-support-endpoint-discovery.ru.md` | GitHub является транспортом, но не корнем доверия |
| Любой общий public/private contract | оба peer documents, source-of-truth ownership, pinned revision/hashes, backward-compatible server first | обе peer checks и tests обоих repos | Private submodule запрещён, дрейф ловится только явной сверкой |
| Support control payload, capabilities или replay | `experimentalPayload/controlClient`, схемы, private `supportProtocol/supportControlService`, согласованность status/deadline, исходные bytes при retry и transport gate | `remoteSupportControl*.test.mjs`, private `test:support`, ручной `runControlPeer.mjs` | Принятие заявки не означает SSH; успешный JSON без подписи и согласованного sequence не подтверждает действие (§rsup001) |
| Experimental transport CSR/grant | `transportPayload/transportClient`, common message enum и отдельная schema, opt-in capability, private CSR issuer/RAM replay/tombstone, vendor pin и оба peer docs | `remoteSupportTransport.test.mjs`, старые protocol/control tests, private synthetic credential/FRP gate | Token-bearing replay не хранится в HMAC snapshot; grant не означает SSH, endpoint/CA не приходят по wire (§rsup001) |
| Native SFMR1 helper или executable wire model | Jansson/OpenSSL parsing, C/Node/Android vector, Makefile ABI/link set, companion README, impact map и выключенный runtime | `nativeMessageRelayCrypto.test.mjs`, ручной `runNativeCryptoTests.sh --sanitize`, официальный target SDK и vector на роутере | Static source check не исполняет C и не доказывает совместимость musl/BusyBox; секреты не попадают в fixtures (§mrelay1) |
| Google Drive: загрузка/проверка архива | shell uploader, выбор backend до и во время sender, storage caller, writer scheduler, штатная jshn, обе редакции пакета, сохранность исходника | `googleDriveUploadRuntime`, `logStorage`, `logWriterRuntime`, hardening/IPK; HTTP trace обязателен | Отдельно обозначить baseline с ранним отказом; размер не равен checksum, HTTP-модель не равна Drive |
| Yandex WebDAV transport/status/root/MKCOL/PUT/HEAD | PROPFIND collections, HEAD reader, probe, archive preflight, storage dispatcher, writer, обе редакции пакета | `yandexDiskRuntime`, `yandexBackupRuntime`, `yandexUploadRuntime`, `yandexEventsRuntime`, `yandexSyncRuntime`, `yandexDownloadRuntime`, `yandexContextRuntime`, `logStorage`, `logWriterRuntime`, portable shell/hardening/IPK; argv и UCI saved/pending trace | HEAD проверяет один размер, не checksum или полный XML; при отсутствии Content-Length запрещён фиктивный успех; MKCOL не раскрывает маски; URI отдельно кодирует логический путь, dot-segments отказывают до первого MKCOL; сбой root не выбирает default; 405 и restore отдельно ограничены; вложенный uploader наследует cloud-контекст и проверку выбранного backend команды, quota-reader не превращает отказ в default (§ydav001) |
| Новый внешний сервис/cloud | ADR, default off, consent/preview, privacy/agreement, timeout/retry, data minimization, отключение/удаление | security/privacy review + failure tests | Удобство не разрешает скрытую передачу семейных данных |

## Тесты, скрипты и документация

| Если изменяется | Обязательно актуализировать или проверить | Минимальное доказательство | Почему |
|---|---|---|---|
| Новый или существенно изменённый test | purpose header, `tests/categories.mjs` для Node; для Android `src/test` или `src/androidTest` и явный безопасный набор классов в runbook; direct command, ожидаемый результат, limits и common failures | direct test + `testCategories.test.mjs` для Node; Gradle/JUnit и выбранный runtime-профиль для Android | Зелёный тест без понятной границы создаёт ложную уверенность; instrumentation всего пакета может включить destructive first-launch |
| Исполняемый script/helper | комментарий purpose/input/output/state/limitations, точная команда с cwd/prerequisites, expected exit/output, cleanup, запрещённые запуски | syntax/lint + focused behavior test | Следующий агент иначе повторяет опасный или заведомо ошибочный запуск |
| ADR/архитектурное решение | новый ADR или статус замены, ADR index, focused current-state doc, §-tag, contract test | architecture/docs quality | ADR хранит причину, профильный документ — текущее поведение |
| §-tag или его смысл | все вхождения, строка tag map, дерево связей, связанные docs/tests | `quality:docs:all` + targeted search | Устаревший тег быстрее вводит агента в заблуждение, чем отсутствие тега |
| Test/npm command в Markdown | реальный `package.json`, cwd, prerequisites, expected result, common errors, anti-patterns | documentation audit + пробный запуск | Непроверенная команда расходует время каждого следующего агента |
| Test runner, temp-root или child-process boundary | `testEnvironment.mjs`, Windows/sandbox runbook, прямой и runner-запуск, Linux/Windows поведение | direct contract test + затронутый shell fixture; полный внешний gate только при изменении отбора/изоляции, способном пропустить test-файл | Нельзя путать запрет среды с дефектом Python/Git Bash или запускать чужие подсистемы после правки только timeout/диагностики |
| Правило или skill технической документации | `documentation-writing-standard.ru.md`, project skill, `AGENTS.md`, fast-start, §-tag и только объективные machine-checks | `qualityAssistants.test.mjs`, `documentationOperations.test.mjs`, `quality:docs:all` | Редакционное правило бесполезно, если агент его не находит, а regex не должен выдавать мнение о тексте за доказанный дефект |
| Новый устойчивый coupling | эта матрица, impact rules при path-detectable связи, regression test, fast-start navigation | tooling/docs checks | Знание не должно оставаться только в истории чата |

## Что не считается выполнением матрицы

- `review:impact` без чтения его вопросов и этой таблицы;
- обновление только одного из дублируемых defaults;
- зелёный static test вместо runtime-границы, которую он не исполняет;
- фраза «тесты прошли» без команды, времени запуска, exit code и skipped/ограничений;
- команда в документации без рабочего каталога и ожидаемого результата;
- копирование production secret в fixture ради удобства;
- массовый несвязанный рефакторинг под видом сопутствующего изменения.

## Самопроверка документационного контракта

Из корня публичного репозитория:

```powershell
node --test tests/documentationOperations.test.mjs tests/testCategories.test.mjs
npm.cmd run quality:docs:all
git diff --check
```

Ожидается `fail 0`, отсутствие неизвестного test-файла в карте категорий, исправные ссылки/теги
и пустой вывод `git diff --check`. Ошибка этого набора исправляется в документации, карте или
тесте; удалять обязательную связь ради зелёного результата нельзя.
