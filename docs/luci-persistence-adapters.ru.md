# Узкие persistence-адаптеры LuCI

<!-- §persist1 -->

Архитектурная основа — проход `0.1.0-r247` от 22 июля 2026 года.
Текущее поведение ниже уточнено 14 сентября 2026 года по незакоммиченному кандидату
после ревью r323. Старые протоколы сохраняют значение только для своих снимков.
[Проверки B142–B143](review-r323-persistence-followup.ru.md).
[Жизненный цикл Settings B144–B146](review-r323-settings-lifecycle.ru.md) расположен
выше core-адаптера и не меняет его RPC/rollback.

## Цель

Persistence-слой отделяет три разные стадии изменяющего действия:

1. подготовку UCI-изменений;
2. сохранение и применение конфигурации;
3. применение runtime-состояния — firewall, DNS policy, Wi-Fi reload или service refresh.

DOM, модальные окна, тексты кнопок и toast не входят в этот слой. Иначе ошибка третьей стадии легко превращается в ложное сообщение «настройка не сохранена», хотя конфигурация уже записана.

## Модули

### `core/persistence/uci.js`

Общий низкоуровневый адаптер:

- получает или создаёт именованную секцию;
- заменяет UCI-list одним массивом;
- дедуплицирует список конфигов;
- сериализует операции своего экземпляра через `mutate` и проверяет общую локальную/удалённую очередь;
- вызывает **один `uci.save()` без аргументов**, затем прямые `callApply` и `callConfirm`;
- фиксирует отпечаток сразу после синхронного stage; при замечанном последующем смешении отказывает до save и не стирает общий черновик;
- явно перечитывает или отбрасывает локальный UCI-кэш.

Он не запускает router-команды и не знает о Sheepfold-политиках.

### `features/devices/persistence.js`

Владеет совместной записью Sheepfold/DHCP для карточки устройства:

- постоянная device-секция;
- статус и семейная группа;
- взаимное исключение allowlist/blocklist;
- ручной тип и источник имени;
- optional static DHCP lease;
- запрет детских ограничений для admin device;
- AI-only `activity_log_enabled` только внутри variant-маркеров;
- ordered runtime `schedule-sync → site-lists-apply → status refresh`.

Если UCI уже сохранён, а runtime не применился, ошибка получает `persisted=true`. UI обязан перечитать фактический UCI и сообщить о частичном результате, а не изображать rollback.

### `features/wifi/persistence.js`

Владеет только wireless UCI и reload:

- один commit/apply для `wireless`;
- сначала `/sbin/wifi reload`;
- совместимый fallback `/sbin/wifi`;
- `persisted=true`, если reload не прошёл после успешного сохранения;
- editor принимает уже записанный draft, показывает отдельное предупреждение и не оставляет unhandled Promise rejection.

### `features/settings/backup-persistence.js`

Владеет подготовкой импорта и передачей его общей очереди:

- подготавливает полный Sheepfold/DHCP/Wi-Fi payload;
- сохраняет один фиксированный набор конфигов;
- сверяет переданный текущий снимок с управляемой частью загруженного LuCI-кэша внутри очереди до staging;
- не подставляет старые секреты после замечанного изменения, а возвращает `backup_current_settings_changed`;
- общая обработка ошибки пытается очистить принадлежащие операции изменения, но **не является повторным применением полного предыдущего backup**;
- исходная ошибка может получить `cleanupError`; флаг `uciCleanupAttempted` не доказывает успешного восстановления;
- не откатывает уже сохранённый импорт только потому, что последующий refresh сервисов не прошёл.

### `features/pairing/persistence.js`

Владеет:

- именованными administrator-секциями;
- `allow_child_access_requests`;
- активацией одноразового кода и чтением статуса pairing;
- переводом выбранного устройства в admin state;
- удалением обычной группы, расписаний и activity journal;
- allowlist/blocklist-инвариантом;
- снятием старой admin-привязки.

QR, таймер polling и отображение временного кода остаются UI-задачами.

## Отдельный UI-слой общего Settings save

`features/settings/draft.js` и `save-flow.js` не являются ещё одной реализацией
UCI-транзакции. Они управляют снимком общих строковых опций, подтверждением и кнопками.
Снимок фиксируется до диалога автоматического выключения Wi-Fi и остаётся тем же
для validation, persistence, runtime и post-save. После подтверждённого сохранения
`acceptOptions(snapshot)` убирает только ключи, чьи текущие значения совпадают со
снимком. Более поздний ввод остаётся несохранённым; его не принимает повторно
последующий runtime-failure. Special-only save не владеет общим новым вводом.

Busy-состояние устанавливается внутри общей Promise-цепочки: синхронный отказ
первого callback также попадает в обработку и завершение. Второе нажатие возвращает
существующий Promise, автоматический повтор команды не добавлен.

`settingsSaveLifecycle.test.mjs` выполняет настоящие два модуля с управляемыми
Promise-барьерами. Это не нативный rpcd и не замена испытанию страницы. Отдельные
special-saver drafts, полный render/reset и page reload (в том числе после смены
языка) могут иметь свои пути потери ввода. Эти границы не закрываются сравнением
общих опций; подробности в [B144–B146](review-r323-settings-lifecycle.ru.md).

## Инварианты

- Ни один persistence-модуль не использует `document`, `window`, `E()` или `ui.showModal()`.
- Один модуль не выполняет скрытый page reload.
- Post-commit runtime failure не называется ошибкой сохранения.
- Backup save/apply failure не доказывает rollback; неопределённый результат требует проверки состояния.
- Pairing не может назначить blocklisted-устройство администраторским.
- Static DHCP и Sheepfold device config сохраняются одним пользовательским действием.
- Wi-Fi UCI считается сохранённым даже тогда, когда отдельный reload требует повторной попытки.

## Проверки

Focused-тест `tests/luciPersistenceAdapters.test.mjs` проверяет:

- дедупликацию списка конфигов, один общий UCI-save и единственную apply-точку;
- device/DHCP/list staging;
- порядок firewall/domain runtime;
- `persisted=true` после post-commit ошибки;
- Wi-Fi fallback и reload-only failure;
- сохранение masked secrets при импорте;
- путь обработки ошибки backup и честное сообщение при неопределённом результате;
- admin binding и ранний отказ для blocklist;
- отсутствие DOM-зависимостей.

`backupMutationConsistency.test.mjs` проверяет окно до save и устаревший current snapshot;
`backupImportUiSafety.test.mjs` — отказ, подтверждённый результат и сбои интерфейса.
Сериализация RPC может быть отложена, а последующий unload удалять локальные данные.
Изменения уже после финальной проверки, другие экземпляры adapter, вкладки, rpcd
sessions и CLI не охвачены общей атомарностью. Для нативного LuCI нужен отдельный gate.

Focused-тесты не заменяют живой проход `LuCI → rpcd → UCI → fw4/Wi-Fi`.

## Финальная coordinator-граница (`r248`)

После `§coordclean1` `overview.js` не содержит локальных alias-функций для
`save`, `ensureSection`, device/list staging, pairing status или backup staging.
Координатор вызывает предметные adapters напрямую. Удаление устройства из allowlist
или blocklist также выполняет `features/devices/persistence.js::removeFromList()`;
страница оставляет у себя только confirmation, action key, уведомление и local refresh.
