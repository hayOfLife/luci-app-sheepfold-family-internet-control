# Решения по пакету r323 review-time-confirmation

Дата проверки: 15.09.2026. Документ предназначен владельцу и следующему агенту.
Это отчёт о выборочном принятии исходников, не акт испытаний готового роутера.

## Базы и границы работы

Принятый main до работы: `bdb3a92c699618dee229b145039d0811b642a7b1`
(`test: keep POSIX fault injection deterministic`). Проверенный origin/main
указывал на тот же коммит. Входной r323: `1e9c43bfea54aba15d7020fbdbe84ad5dc23b7c0`.
Между ними 26 коммитов r298–r323. Поверх r323 применён полный review-патч.
Поэтому ниже учтены как B61–B131 из его базы, так и новые B132–B159.
Карточки B01–B60 уже находились в принятой базе и повторно не принимались.

Изменения приняты в локальный main с `PKG_RELEASE=324`: новая версия
нужна для обновления кеша LuCI. Это не публикация r324. Push, GitHub Release,
сборка пользовательских APK/IPK, установка, обращения к роутеру и настоящим облачным
аккаунтам в этой работе не выполняются. Тест упаковки создаёт отдельный временный
IPK в `.build/review-ipk`; это не сборка для установки или публикации.

Слова «принято» ниже означают решение по исходникам. Они не превращают модели
UCI, HTTP и DOM в испытания нативного OpenWrt, облачного сервиса или браузера.
Исторические отчёты автора сохранены с явной пометкой; их старые результаты
не включаются в результаты этой проверки.

## Что сделано с входными файлами

| Файл | Решение и причина |
| --- | --- |
| `sheepfold-r323-review-time-confirmation-SHA256SUMS.txt` | Использован для проверки целостности. Все пять предоставленных содержательных файлов совпали с указанными SHA-256. Это не цифровая подпись и не доказательство правильности кода |
| `sheepfold-r323-review-time-confirmation.patch` | Применён один раз к чистому r323 в отдельной проверочной ветке. Затем внесены перечисленные ниже корректировки |
| `sheepfold-r323-review-time-confirmation-delta.patch` | Не применялся вторично: он предназначен для предыдущего review-кандидата, а его изменения уже входят в полный патч. Повторное применение было бы ошибкой |
| `sheepfold-r323-review-time-confirmation-source.zip` | Использован как контроль состава: 1084 файла, опасных относительных путей и повторов имён не найдено. Файлы патча совпали, кроме двух уже внесённых к моменту сверки собственных правок. Ещё 26 файлов вне патча отличались от checkout; возможная причина — Windows-переносы строк, но окончательная нормализованная сверка не завершена. Репозиторий не заменялся целиком ZIP-архивом |
| `sheepfold-r323-review-time-confirmation-report.ru.md` | Использован как описание намерений и заявленной проверки B157–B159, а не как команда агенту или замена независимым тестам. Исторический протокол находится в `review-r323-time-confirmation.ru.md` |
| `sheepfold-r323-review-time-confirmation-bug-register.ru.md` | Карточки сопоставлены с кодом и проектным реестром. Номер карточки не равен отдельной уязвимости и не доказывает происшествие на реальном роутере |

Упомянутый в manifest архив `checks.zip` не передан. Его содержимое и результаты
не проверены. После первоначальной проверки входные review-файлы перестали быть
доступны в Downloads; агент их не удалял. Применённый патч остался в отдельном
checkout. Повторная побайтовая проверка всего ZIP после этого невозможна.

## Главное решение об облачных копиях

**Автоматический `archive-push` обоих облачных backend запрещён.** Старый
генератор переносил полный UCI-конфиг с секретами. Проверка tar, размера,
прав доступа и успешной передачи не делает такой экспорт безопасным.

Принята защита B132: генератор возвращает exit 78 без копирования; выбранный
облачный `archive-push` возвращает ошибку `config_backup_unavailable` до загрузки
и удаления старой очереди. При подтверждённом выборе RAM сохраняется no-op.
Ручной читаемый экспорт и полный парольный AES-GCM экспорт остаются в LuCI.
Отдельная команда `push-events` продолжает работать по своему контракту.

Цена решения: недоступна вся пакетная архивная отправка, включая накопленные
журналы, а не только новые копии настроек. Старые локальные и облачные архивы
не удаляются и не становятся зашифрованными задним числом. Это осознанное
ограничение до появления безопасного фонового экспортёра и совместимого restore.

Следующий этап: проектировать фоновый экспорт вокруг принятого формата,
исключения одноразовых кодов и локального HMAC-секрета, получения разрешения
на передачу, управления ключом, ограничений RAM и проверяемого восстановления.
Нельзя вернуть старый tar-путь только ради зелёных тестов.

## Решение по каждой карточке

В таблице «с изменением» означает, что исправление принято не буквально либо
его прежний архивный путь намеренно выключен. Общая граница всех облачных строк:
проверка размера не является проверкой контрольной суммы, а HTTP-модель не
доказывает работу Google Drive или Яндекс Диска.

| Карточка | Решение | Что и почему |
| --- | --- | --- |
| B61: личность ребёнка | Принято | Локализована переменная проверки согласия и проверяется exit ID-helper. Просьба остаётся связанной с ребёнком, а технический отказ не выдаётся за отсутствие устройства |
| B62: журнал после просьбы | Принято | Ошибка диагностической записи не отменяет уже созданную просьбу и не провоцирует лишний повтор |
| B63: неполный список просьб | Принято | HTTP 200 выдаётся после успешного чтения всего результата; отказ helper возвращается как 503 |
| B64: JSON очереди | Принято | Управляющие символы экранируются до формирования JSON; имена не должны повреждать ответ |
| B65: сохранность просьбы | Принято | Проверяется целая запись и результат чтения; временная ошибка не считается основанием удалить просьбу |
| B66: дедупликация просьб | Принято | Чтение и публикация согласованы блокировкой. Повторное нажатие не создаёт две независимые просьбы |
| B67: подготовка очереди | Принято | Проверяются права и создание временных файлов; уборка ограничена принадлежащими операции файлами |
| B68: сохранность уведомления | Принято | Отказ чтения не превращается в удаление постоянного уведомления |
| B69: список уведомлений | Принято | Полный результат проверяется до HTTP-успеха, строки корректно сериализуются |
| B70: квота уведомлений | Принято | Публикация и дедупликация сериализуются; предел составляет 100, а не 101 запись |
| B71: публикация уведомления | Принято | Проверяются приватные права и владение временной записью; коллизия не разрешает заменить чужую запись |
| B72: чтение журнала | Принято | Ошибки чтения и маскирования не выдаются за успешный пустой или частичный журнал |
| B73: путь журнала | Принято | Отвергаются выход через `..` и символические ссылки, а не только проверяется строковый префикс |
| B74: legacy JSON | Принято | Исправлено экранирование текста без изменения его смыслового значения |
| B75: блокировка журнала | Принято | Чтение и очистка используют общий lock; создаваемый журнал получает приватные права |
| B76: общий RAM-путь | Принято | Writer и API используют один проверяющий helper. Разные пути доверия не должны обходить друг друга |
| B77: ошибка записи | Принято | Последующие успешные команды больше не маскируют отказ добавления события |
| B78: фоновые дескрипторы | Принято | Облачная работа отделена от канала ответа и блокировки writer; сетевой запрос не удерживает их после записи |
| B79: путь при ротации | Принято | Ротатор использует ту же границу RAM-пути и не подставляет default при ошибке чтения настройки |
| B80: подготовка ротации | Принято | Отказ статистики или подготовки не считается успешным обслуживанием |
| B81: границы строк | Принято | Ротация сохраняет целые строки; размер с ведущими нулями трактуется как десятичный |
| B82: переменные Drive | Принято | Исправлены shell-объявления: имя переменной не исполняется как команда |
| B83: подтверждение Drive | С изменением | Независимое чтение удалённого размера сохранено для транспортного helper; архивный caller выключен B132 |
| B84: multipart Drive | С изменением | Приватная подготовка и проверка чтения остаются полезными для разрешённых отправок. Старые проверки через сырой архив не приняты как действующие |
| B85: OAuth | Принято | Успех обмена определяется кодом процесса и корректным типизированным ответом, не наличием похожего на токен текста |
| B86: владелец OAuth-кеша | Принято | Кеш привязан к реквизитам; смена аккаунта не должна использовать прежний токен |
| B87: публикация OAuth-кеша | Принято | Проверенная приватная временная запись публикуется вместо прямой перезаписи целевого файла |
| B88: поиск Drive | Принято | Ошибка или неполный поиск не разрешает создание или перезапись файла |
| B89: имена Drive | Принято | Литерал поискового выражения и URL кодируются по разным правилам, чтобы имя оставалось данными |
| B90: кеш папок | Принято | Отказы чтения и публикации не маскируются, чужая цель не заменяется |
| B91: контекст папок | Принято | Идентификаторы папок связаны с реквизитами и корнем облачного назначения |
| B92: контекст передачи | С изменением | Helper проверяет настройки в пределах одной передачи; архивная оркестрация не активируется |
| B93: квота Drive | Принято | Невалидный/неполный ответ не считается нулевым использованием; сохраняется типизированный разбор размера |
| B94: очистка Drive | Принято с ограничением | Проверка плана удаления и каждого ответа сохранена в helper. Выключенный archive-push не вызывает эту очистку автоматически |
| B95: запуск download | Принято | Исправлен самостоятельный вызов; отказ поиска не выдается за отсутствие копии |
| B96: локальная цель download | Принято | Существующий файл сохраняется до подтверждения новой копии; путь проверяется перед заменой |
| B97: подтверждение download | Принято | HTTP 200 недостаточно: проверяются размер и неизменность контекста. Это не checksum |
| B98: запуск list | Принято | Исправлены объявления, из-за которых команда просмотра не доходила до выполнения |
| B99: полнота list | Принято | Повреждённый, ограниченный или неполный ответ не объявляется достоверным списком |
| B100: наблюдение без UCI-записи | Принято | Просмотр статуса не сохраняет чужой pending UCI и не использует записанный флаг как доказательство авторизации |
| B101: status без создания папок | Принято | Команда наблюдения не должна незаметно менять облачное хранилище |
| B102: подготовка сырой копии Drive | Заменено B132 | Проверка tar не решает утечку секретов. Генератор отключён; возвращать его прежний формат нельзя |
| B103: staging сырой копии Drive | Заменено B132 | Прежний архивный проход не принят как работающая функция. Требования владения временными файлами нужны будущему безопасному экспорту |
| B104: выбранный журнал Drive | С изменением | Разрешённый push-events берёт выбранный журнал. Старый архивный вариант того же сценария исключён |
| B105: рост журнала во время HTTP | С изменением | Проверяется отправленный снимок, а не изменившийся живой журнал; архивный caller остаётся выключенным |
| B106: WebDAV Depth | Принято | Значение заголовка не превращается в дополнительный URL запроса |
| B107: WebDAV probe | Принято | Redirect и ошибка curl не считаются успешной проверкой подключения; ответ остаётся корректным JSON |
| B108: status Яндекса | Принято | Наблюдение не применяет чужую очередь UCI |
| B109: компоненты папок | Принято | Маски в имени не раскрываются в имена локальных файлов shell |
| B110: результат MKCOL | С изменением | Проверка создания папок остаётся для разрешённых операций; архивный preflight не исполняется из-за B132 |
| B111: чтение root_folder | Принято | Ошибка настроенного корня не разрешает выбрать другое назначение по умолчанию |
| B112: URL папки Яндекса | Принято | Логические компоненты отдельно кодируются как URI path, а не меняют структуру URL |
| B113: dot-segments | Принято | Недопустимый путь отвергается до первого изменения облачных папок |
| B114: подготовка сырой копии Яндекса | Заменено B132 | Контроль tar полезен технически, но формат нарушает правило экспорта секретов. Генератор отключён |
| B115: staging копии Яндекса | Заменено B132 | Не включён прежний архивный проход; сохранность старых файлов проверяется уже на границе запрета |
| B116: shell uploader Яндекса | Принято | Исправлены объявления переменных, мешавшие реальной передаче и проверке |
| B117: PUT/HEAD Яндекса | Принято | Разделены exit транспорта, HTTP и корректный размер; строка от отказавшей команды не подтверждает успех |
| B118: привязка проверки к данным | Принято | Проверяется неизменяемый снимок и контекст реквизитов одной передачи; исходник не удаляется при неоднозначности |
| B119: запуск push-events | Принято | Команда доходит до проверки настроек и передачи, а не останавливается на ошибочном shell-объявлении |
| B120: выбранный журнал Яндекса | С изменением | Отправляется явно выбранный журнал; архивная ветвь исключена из действующих проверок |
| B121: lock и снимок | С изменением | Копирование согласуется с writer, а HTTP выполняется после освобождения блокировки; проверяется снимок, не растущий оригинал |
| B122: итог синхронизации | Принято | Ранний отказ обновляет результат Яндекса, а сбой диагностического кеша не меняет уже выполненную операцию |
| B123: файл статуса | Принято | Приватная проверенная публикация сохраняет прежний файл при ошибке и не следует чужой ссылке |
| B124: чтение статуса | Принято | Неправильные типы и повреждённое содержимое не считаются достоверным результатом синхронизации |
| B125: запуск download Яндекса | Принято | Проверяются аргументы и корректный самостоятельный запуск команды |
| B126: сохранность download | Принято | Новая копия заменяет локальную цель только после проверки; отказ не уничтожает старую |
| B127: размер download Яндекса | Принято | HTTP 200 дополняется проверкой размера и контекста; неполный файл не публикуется |
| B128: квота Яндекса | С изменением | Чтение квоты проверяется независимо. Отсутствие опции допускает default, ошибка чтения нет; архивный guard срабатывает раньше квоты |
| B129: контекст всей команды | С изменением | Согласование реквизитов сохранено в разрешённом journal-пути и helpers. Нельзя объявлять выключенный архивный сценарий проверенной загрузкой |
| B130: смена backend | С изменением | Разрешённый sender прекращает новые запросы после обнаруженной смены хранилища. Это не отменяет уже выполненный HTTP-запрос |
| B131: неизвестный выбор Drive | Принято | Ошибка чтения выбора хранилища не выдаётся за успешный пропуск отправителя |
| B132: запрет сырого экспорта | Принято | Риск раскрытия секретов закрыт до копирования, передачи и удаления старой очереди. Безопасный фоновый экспорт не выдуман |
| B133: отсутствующий flock | Принято | POSIX требует реальный flock; Windows-модель явно последовательная. Она не доказывает конкуренцию или права Linux |
| B134: cwd стенда | Дополнено | Помимо Yandex context согласованы пути Sync, Upload, Download и Disk. Для Disk сохранён рабочий каталог с контрольными файлами, чтобы не потерять тест shell-glob |
| B135: тайм-ауты стенда | Дополнено | Сохранены POSIX-бюджеты, расширен только Windows-бюджет затронутых fixture. Ошибка запуска не маскируется ошибкой JSON; обновлены связи карты влияния |
| B136: Wi-Fi-секреты | Принято | wps_pin, r0kh и r1kh маскируются по точным именам. Полный секретный экспорт остаётся только шифрованным |
| B137: размер экспорта | Принято | Проверяется размер окончательного UTF-8 файла, включая Base64 оболочку, а не только исходного объекта |
| B138: ошибки экспорта | Принято | Синхронная подготовка включена в обработку ошибок; кнопка освобождается, ложного успеха нет |
| B139: ошибки импорта | Принято | Ошибки подготовки и расшифровки не оставляют недоступной кнопку; повтор остаётся явным действием пользователя |
| B140: неподтверждённый откат | Принято | Интерфейс больше не обещает сохранность прежних настроек, когда результат apply/rollback неизвестен |
| B141: UI после записи | Принято | Ошибка интерфейса после подтверждённой записи не выдаётся за несостоявшийся импорт и не разрешает незаметно повторить запись |
| B142: чужие локальные правки | Принято | Отпечаток собственного staging фиксируется до передачи управления; замечанный конфликт останавливает save без очистки чужого черновика |
| B143: старый секрет в импорте | Принято | Перед staging повторно сверяется текущий снимок; ожидающий импорт не возвращает устаревший пароль поверх более новой настройки |
| B144: поздний общий черновик | Принято | Принимаются только отправленные и всё ещё совпадающие значения; новый ввод остаётся несохранённым |
| B145: синхронный отказ Save | Принято | Обработчики ошибок и освобождения кнопок установлены до изменяющих callback |
| B146: подтверждение Wi-Fi | Принято | Подтверждение относится к показанному времени выключения Wi-Fi, а не к изменившимся во время диалога полям |
| B147: обработчик теста Telegram | Дополнено | Подключены command/ensureOk; дополнительно сохранён currentTarget до микрозадачи, чтобы блокировка и индикация оставались на нажатой кнопке |
| B148: тест не является Save | Принято | Тестовое сообщение не сохраняет черновик и не переключает VK на Telegram. Сначала требуется явное сохранение |
| B149: принятие messenger-полей | Принято | Подтверждаются только отправленные поля выбранного адаптера, не поздний ввод или скрытые реквизиты другого мессенджера |
| B150: restart мессенджера | Принято | Подтверждённая запись отделена от ошибки restart/readback; повторное сохранение не имитирует необходимый откат |
| B151: принятие time-полей | Принято | Исходным состоянием становится отправленный снимок, а новые значения во время ожидания остаются черновиком |
| B152: restart NTP | Принято | Точный exit 5 с маркерами записи превращается в предупреждение о сохранённых, но не применённых настройках; timeout таким доказательством не является |
| B153: журнал time-save | Принято | Диагностика не загрязняет stdout команды и не отменяет результат сохранения |
| B154: снимки времени | Принято | Проверяются пути, копирование и совпадение байтов до первого изменения; каталог транзакции уникален |
| B155: неудачное восстановление | Принято | Последняя исходная копия не удаляется после отказа restore; возвращается exit 6 с требованием ручной проверки |
| B156: уборка времени | Принято | Ошибка удаления собственного временного каталога не отменяет запись и не пропускает перезапуск NTP |
| B157: все поля time-save | Дополнено | Проверяются 16 значений и успешный exit каждого чтения, включая полный упорядоченный NTP-список. Windows-модель исправлена на LF без ослабления сравнений |
| B158: значения после lock | Принято | Отсутствующие аргументы разрешаются после получения блокировки, чтобы ожидающая команда не возвращала устаревшие настройки |
| B159: неисправные часы | Принято | Результат date проверяется до первого uci set. Допускается ноль как метаданные, но он не объявляется синхронизированным временем |

## Дополнительные исправления при принятии

1. Исправлен browser-lifecycle `event.currentTarget` в тесте Telegram. Регрессия
   теперь очищает currentTarget сразу после обработчика, как браузер, и проверяет
   disabled до ответа и восстановление после него.
2. Python-модель time-save записывает LF явно. Изначальные два Windows-отказа
   воспроизведены: ожидаемое `system` сравнивалось с `system\r`. Код роутера ради
   этого не менялся.
3. Устранены лишние JavaScript-экранирования в модели jshn Yandex Sync. Проверено,
   что итоговые строки шаблонов до и после изменения совпадают; это не переписывание shell-контракта.
4. Убраны активные ожидания запрещённой сырой архивной отправки. Это 99 объявлений
   тестов, часть параметризована; число не равно 99 дефектам. В десяти общих циклах
   оставлен разрешённый push-events. Новые тесты guard проверяют отсутствие сети,
   копирования и удаления старой очереди, а не успешность старого tar-контракта.
5. Согласованы cwd и относительные пути четырёх соседних Yandex fixture.
   Платформенные бюджеты подключены через уже существующий test-only helper.
6. Карта влияния дополнена отсутствовавшими прямыми потребителями runtimeProcess,
   включая timeSaveConfirmation и timeTransactionRecovery. Тест проверяет эти связи.
7. Предупреждение README вынесено из HTML-блока логотипа и сформулировано для
   пользователя. Ссылка «последнее ревью» больше не ведёт к промежуточной итерации.
8. Исторические протоколы не переписаны задним числом, но получают ссылку на этот
   итог. Текущие документы больше не должны называть принятые правки незакоммиченным кандидатом.
9. Версия исходников поднята до r324 ради единого cache-busting LuCI; публикация
   пакетов, Android-версии, ключи подписи и установленные устройства не менялись.
10. В тесте ротации `maintenanceJobs` исправлен Windows-путь синтетического журнала:
    он проходит через тот же `fixturePath`, что остальные shell-пути, вместо сырого `C:\...`.
11. В `packageHardeningRuntime` согласованы shell-пути и cwd, подключён общий
    платформенный бюджет. Проверка существующей rootfs и повреждения нового
    log-helper теперь достигает hardener, а не ломается на `mkdir C:\Users/User`.
12. В Google Drive fixture явно включён UTF-8 Python. В отдельном воспроизведении
    подтверждено, что Git Bash при `eval` теряет буквальный CR перед LF; модель
    shell-цитирования сохраняет CR через `printf`. Ожидаемая строка с кириллицей,
    кавычками, управляющими символами и emoji не упрощена.
13. В `yandexEventsRuntime` прежние 25 секунд сохранены для POSIX, Windows использует
    общий тестовый бюджет; реальный журнал и сеть роутера не ускорялись и не менялись.

## Что сознательно не решено

- **Общая транзакция UCI (R03).** Последовательные чтения не дают атомарный снимок,
  а файловый rollback не синхронизирован со всеми внешними писателями OpenWrt.
  Нельзя обещать защиту от root-процесса, меняющего те же файлы вне Sheepfold-lock.
  Следующий этап: согласовать revision/locking с реальным libuci и проверить
  конкурентные настройки на OpenWrt; не добавлять ещё один независимый глобальный lock наугад.
- **Отсутствующий sysntpd.** Сохранён прежний поддерживаемый путь без restart,
  если optional init-script отсутствует. Это не доказательство синхронизации часов.
- **Облачное восстановление.** Безопасный автоматический экспорт и восстановление
  по новому контракту не реализованы. Старые архивные тесты нельзя включать обратно
  без изменения их предпосылок на безопасный формат.
- **Кеш результата Google Drive.** Старый sync-status может показывать историческую
  запись; явный ответ archive-push является отказом. Небезопасный старый writer кеша
  не вызывается дополнительно ради косметического обновления статуса. Нужна отдельная
  доработка публикации/чтения кеша по проверенному образцу Яндекса.
- **Нативные границы.** NTFS и последовательная Windows-модель flock не подтверждают
  Unix-права, символьные ссылки, сигналы, параллельных писателей и BusyBox/libuci.
  Эти сценарии остаются обязательными Linux/OpenWrt-проверками перед выпуском.
- **Интерфейс и службы.** Node VM проверяет логику DOM/RPC-модели, но не реальный
  браузер LuCI, потерю Wi-Fi при сохранении, перезапуск служб или Android.

## Как повторить проверки

Запускать из корня checkout в PowerShell с Node.js, Git Bash и Python в PATH.
Для ESLint нужны зависимости из package-lock; установка без lifecycle-скриптов:

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund --cache .build/npm-cache
npm.cmd run lint:js
node --test tests/messengerSettingsLifecycle.test.mjs tests/runtimeProcess.test.mjs tests/changeImpact.test.mjs
node --test tests/timeSaveConfirmation.test.mjs
node --test tests/timeTransactionRecovery.test.mjs tests/timeSettingsLifecycle.test.mjs
node --test tests/cloudArchiveSafety.test.mjs tests/yandexBackupRuntime.test.mjs
node scripts/run-test-category.mjs --file adminNotificationRuntime.test.mjs --file childAccessRequestRuntime.test.mjs --file childRequestQueueRuntime.test.mjs --file legacyLogRuntime.test.mjs --file logWriterRuntime.test.mjs --file maintenanceRotationRuntime.test.mjs
npm.cmd run quality:docs:all
git diff --check
```

Ожидаются exit 0 и fail 0; платформенные skips должны оставаться видимыми.
Тесты создают синтетические файлы в `.build` и удаляют свои fixture после выполнения;
npm-кеш и зависимости остаются локально. Сеть тестов подменена, рабочие настройки
роутера не используются. Внешние системы и семейные данные не затрагиваются.

Нельзя запускать production helper напрямую на рабочем роутере как замену fixture,
подменять настоящий POSIX flock заглушкой или считать skipped успешной проверкой.
Не выполнять полный Android/AI/relay-набор только из-за этого слияния: эти области
не изменены. Для общего UCI проверены его прямые потребители; дополнительные
аппаратные границы выше не закрываются статическим зелёным результатом.

Ошибка EPERM к чужому npm-cache в этой среде устранена выбором локального
`.build/npm-cache`, без изменения ACL, антивируса, глобального npm или package-lock.
Ожидание shell-стенда на Windows может занимать минуты; это не время выполнения
той же операции на роутере. Исходные лимиты production не увеличены.

Для двух медленных Windows-проверок границы 1000 строк использован отдельный
процессный бюджет; он не является новой настройкой продукта:

```powershell
$env:SHEEPFOLD_TEST_PROCESS_TIMEOUT_MS='600000'
node --test --test-name-pattern='bounds a decimal line count (1001|999)' tests/legacyLogRuntime.test.mjs
Remove-Item Env:SHEEPFOLD_TEST_PROCESS_TIMEOUT_MS
```

Тест нового файла в IPK сначала упёрся в `spawnSync python EPERM`. Поддерживаемая
подготовка артефакта отдельным Python-процессом позволила проверить тот же пакет:

```powershell
python scripts/build-test-ipk.py --out-dir .build/review-ipk
$env:SHEEPFOLD_TEST_IPK=(Resolve-Path '.build/review-ipk/luci-app-sheepfold-family-internet-control_0.1.0-324_all.ipk').Path
node --test --test-name-pattern='ships the common journal boundary' tests/testIpkPermissions.test.mjs
Remove-Item Env:SHEEPFOLD_TEST_IPK
```

Ожидаются exit 0, один успешный тест и IPK только в `.build/review-ipk`.
Никаких установок, подписи, `opkg`/`apk add` или скачивания пакетов на роутер здесь нет.
Временный пакет остаётся локально и не является пользовательским артефактом.

Точные повторные команды для найденных проблем стенда и новых связей пакета:

```powershell
node --test --test-name-pattern='accepts the unmodified|missing log path library|broken log path library' tests/packageHardeningRuntime.test.mjs
node --test --test-name-pattern='preserves opaque credential|preserves escaped names' tests/googleDriveUploadRuntime.test.mjs
node --test --test-name-pattern='push-events sends the configured journal' tests/yandexEventsRuntime.test.mjs
node --test --test-name-pattern='rotates the RAM log' tests/maintenanceJobs.test.mjs
```

Для более широкого, но всё ещё ограниченного облачного прохода использовались
следующие фильтры. Первый включает целую группу снимков Google по имени describe;
на Windows это около девяти минут, а не быстрый smoke. Внешняя сеть подменена.

```powershell
$env:SHEEPFOLD_TEST_PROCESS_TIMEOUT_MS='600000'
node --test --test-concurrency=1 --test-name-pattern='does not run variable names|preserves opaque credential|formatted complete folder cache|zero-byte|downloads verified|refuses archive via|uploads bytes and verifies|returns JSON|defaults to 500|unselected backend|configured journal snapshot' tests/googleDriveUploadRuntime.test.mjs tests/yandexBackupRuntime.test.mjs tests/yandexDiskRuntime.test.mjs tests/yandexUploadRuntime.test.mjs tests/yandexContextRuntime.test.mjs
node --test --test-concurrency=1 --test-name-pattern='accepts successful HTTP 207|does not treat a bracketed remote|downloads logs through HEAD GET HEAD|preserves old copy when curl|supports old valid status|returns a real false boolean|push-events sends the configured journal|push-events ignores obsolete default' tests/yandexDiskRuntime.test.mjs tests/yandexDownloadRuntime.test.mjs tests/yandexSyncRuntime.test.mjs tests/yandexEventsRuntime.test.mjs
Remove-Item Env:SHEEPFOLD_TEST_PROCESS_TIMEOUT_MS
```

Фильтр без совпавших сценариев не доказывает проверку файла. Именно поэтому Disk
из первого прохода дополнительно проверен двумя реальными сценариями во втором.

## Результаты текущей проверки

Проверки выполнены в Windows с Node.js 24.18, Git Bash и Python. Это несколько
целенаправленных прогонов, не один полный `npm test`. Пересекающиеся тесты не
суммируются в рекламное общее число. Ошибки первого запуска ниже не скрыты.

| Граница | Результат и что он подтверждает |
| --- | --- |
| Экспорт, импорт, общий Save, Telegram, UCI-адаптеры, категории, runtimeProcess и changeImpact: 10 файлов | Финальный прогон: 195 passed, 0 failed, 0 skipped. После последнего добавления потребителей отдельно повторены runtimeProcess/changeImpact: 45 passed |
| `timeSettingsLifecycle` | 26 passed: снимки UI и контракт действующего action/backend-wrapper, включая необязательный sysntpd |
| `timeSaveConfirmation` | Полный повтор после LF-исправления: 33 passed, 0 failed, 2 skipped. Первоначальные два отказа `system\r` были ошибкой Python-фикстуры |
| `timeTransactionRecovery` | 28 passed, 0 failed, 5 skipped: отказы снимка/копирования/восстановления, сохранение аварийной копии и побочная уборка |
| `cloudArchiveSafety` | 8 passed: запрет сырого генератора и архивного caller до побочных действий |
| `adminNotificationRuntime` | 19 passed, 15 skipped: доступные в Windows проверки чтения, JSON, дедупликации и лимитов |
| `childAccessRequestRuntime` | 26 passed, без ошибок и пропусков |
| `childRequestQueueRuntime` | 12 passed, 14 skipped |
| `legacyLogRuntime` | Первый прогон: 29 passed, 2 timeout, 12 skipped. Оба упавших сценария отдельно прошли с бюджетом 600000 мс; заняли около 180 и 127 секунд |
| `logWriterRuntime` | 22 passed, 12 skipped |
| `maintenanceRotationRuntime` | 29 passed, 5 skipped |
| 13 файлов статических/регрессионных проверок LuCI, переносимости, журнала и версии ассетов | 143 passed, один отказ синтетического пути в maintenanceJobs; исправленный сценарий отдельно прошёл. Утверждение «первый прогон целиком зелёный» не делается |
| Google Drive / Yandex backup, quota и upload, выбранные сценарии | В первом фильтрованном прогоне 16 passed, 2 failed, 6 skipped; одна passed-строка относилась к файлу без совпавшего теста и не считается проверкой поведения. После UTF-8 и CRLF-правок оба упавших Google-сценария отдельно прошли; guard Яндекса, три PUT/HEAD и квота прошли сразу |
| Yandex Disk / Download / Sync / Events, восемь выбранных сценариев | Семь прошли сразу. Восьмой упёрся в старый лимит 25 секунд и после подключения общего test-only бюджета прошёл примерно за 35 секунд |
| Установочная проверка нового log-helper | 3 passed после исправления cwd/путей: штатная rootfs принимается, отсутствие и повреждённый синтаксис библиотеки отвергаются |
| Состав тестового IPK | 1 passed через предварительно подготовленный пакет; прямой дочерний Python сначала получил EPERM. Библиотека, подключения и postinst присутствуют |
| Синтаксис shell | `bash -n` успешен для всех 11 изменённых shell/CGI-файлов относительно принятого main; это не BusyBox ash или запуск на устройстве |
| ESLint | Успешно; исправлены замечания входной модели, нет новых зависимостей или baseline для сокрытия ошибок |
| Документация | `quality:docs:all`: 299 Markdown-файлов, ссылки, теги, тесты, команды и структура исправны. Проверка не доказывает истинность всех исторических утверждений |
| Итоговый diff | `git diff --check main` без ошибок |

Полные облачные runtime-файлы не прогонялись целиком: выбранные сценарии проверяют
конкретные риски и пути, но не все комбинации отказов curl/JSON/сигналов. Нативные
skips не скрыты и не засчитаны как passed. Полный release gate, Linux/OpenWrt,
браузер LuCI и действующие Google/Yandex аккаунты остаются непроверенными.

Карта влияния построена относительно принятого `main`, а не локального
`origin/main` bundle. Для общих UCI/API/helpers просмотрены прямые потребители;
широкие рекомендации Android/AI/relay не запускались, поскольку их исполняемый
код и контракты в принятом diff не меняются. Проверка исходников не разрешает релиз
без перечисленных аппаратных границ.

## Реестр непринятых архивных ожиданий

Все строки ниже относятся к выключенному архивному caller/генератору, а не к самостоятельному HTTP-helper. Они не превращены в фиктивные успешные assertions или скрытые skips. Исторический код остаётся в исходном bundle/патче. Возвращать сценарий допустимо только после адаптации к безопасному формату, согласованным ключам и restore. Вместо этих ожиданий работают cloudArchiveSafety и отдельная проверка защитного отказа Yandex backup. Номера строк относятся к входной рабочей копии перед удалением.

| Входной файл | Строка | Непринятое ожидание / изменение цикла |
| --- | ---: | --- |
| googleDriveUploadRuntime.test.mjs | 1486 | В общем цикле оставлен только push-events; archive-push проверяется отдельным guard |
| googleDriveUploadRuntime.test.mjs | 1553 | В общем цикле оставлен только push-events; archive-push проверяется отдельным guard |
| googleDriveUploadRuntime.test.mjs | 1605 | В общем цикле оставлен только push-events; archive-push проверяется отдельным guard |
| googleDriveUploadRuntime.test.mjs | 1637 | В общем цикле оставлен только push-events; archive-push проверяется отдельным guard |
| googleDriveUploadRuntime.test.mjs | 332 | 'keeps the archive when Drive reports a different size' |
| googleDriveUploadRuntime.test.mjs | 337 | 'checks Drive metadata before deleting a matching archive' |
| googleDriveUploadRuntime.test.mjs | 347 | preserves source after metadata failure ${JSON.stringify(options)} |
| googleDriveUploadRuntime.test.mjs | 352 | 'does not delete a source changed while waiting for metadata' |
| googleDriveUploadRuntime.test.mjs | 356 | preserves source on upload failure ${JSON.stringify(options)} |
| googleDriveUploadRuntime.test.mjs | 371 | 'prepares private multipart data for a new upload' |
| googleDriveUploadRuntime.test.mjs | 376 | 'does not send multipart data after an input read failure' |
| googleDriveUploadRuntime.test.mjs | 389 | preserves input and does not upload that source after ${name} failure |
| googleDriveUploadRuntime.test.mjs | 405 | 'does not remove another directory printed by failed mktemp' |
| googleDriveUploadRuntime.test.mjs | 412 | 'cleans its workspace after failed multipart POST' |
| googleDriveUploadRuntime.test.mjs | 417 | preserves input after invalid creation response ${createBody} |
| googleDriveUploadRuntime.test.mjs | 422 | 'does not use metadata when jshn disappears after the HTTP read' |
| googleDriveUploadRuntime.test.mjs | 426 | 'normalizes a quoted decimal remote size' |
| googleDriveUploadRuntime.test.mjs | 571 | 'uses the newly selected credential token for the actual upload' |
| googleDriveUploadRuntime.test.mjs | 592 | 'updates the existing file from a normally formatted JSON response' |
| googleDriveUploadRuntime.test.mjs | 599 | does not mutate after ${stage} ${JSON.stringify(opts)} |
| googleDriveUploadRuntime.test.mjs | 611 | rejects an untrustworthy or ambiguous lookup ${body} |
| googleDriveUploadRuntime.test.mjs | 616 | 'accepts exactly one result with explicit complete-search markers' |
| googleDriveUploadRuntime.test.mjs | 620 | 'creates only after a verified complete empty search' |
| googleDriveUploadRuntime.test.mjs | 624 | 'does not choose an unrelated nested id from the lookup body' |
| googleDriveUploadRuntime.test.mjs | 628 | 'escapes query literals separately from URL encoding' |
| googleDriveUploadRuntime.test.mjs | 636 | 'preserves special archive names in the exact file search' |
| googleDriveUploadRuntime.test.mjs | 644 | does not accept failed folder creation ${JSON.stringify(options)} |
| googleDriveUploadRuntime.test.mjs | 652 | 'accepts a formatted creation response and uses a private request file' |
| googleDriveUploadRuntime.test.mjs | 658 | preserves the old folder cache after failed ${command} |
| googleDriveUploadRuntime.test.mjs | 665 | 'does not overwrite a symlink target used as the folder cache' |
| googleDriveUploadRuntime.test.mjs | 670 | 'rejects a directory in place of the folder cache' |
| googleDriveUploadRuntime.test.mjs | 683 | does not create folders after incomplete or ambiguous search ${folderLookupBody} |
| googleDriveUploadRuntime.test.mjs | 689 | 'rejects a failed search-body read even when it prints an empty list' |
| googleDriveUploadRuntime.test.mjs | 694 | 'does not choose the default folder after a configured root read fails' |
| googleDriveUploadRuntime.test.mjs | 700 | 'keeps the default root when UCI confirms that the option is absent' |
| googleDriveUploadRuntime.test.mjs | 715 | 'does not treat an oversized search response as permission to create' |
| googleDriveUploadRuntime.test.mjs | 791 | stops the current upload when ${field} changes at ${stage} |
| googleDriveUploadRuntime.test.mjs | 802 | 'does not create a new file after context changes in an empty lookup' |
| googleDriveUploadRuntime.test.mjs | 937 | 'archive-push reports cleanup failure instead of success after a verified upload' |
| googleDriveUploadRuntime.test.mjs | 1334 | archive upload uses verified credentials rather than persistent authorized=${authorized} |
| googleDriveUploadRuntime.test.mjs | 1340 | archive failure is not successful no-op when authorized=${authorized} and refresh fails |
| googleDriveUploadRuntime.test.mjs | 1345 | 'does not upload when another storage backend is selected' |
| googleDriveUploadRuntime.test.mjs | 1351 | 'explicit archive upload can still create missing folders' |
| googleDriveUploadRuntime.test.mjs | 1362 | 'uploads a checked real configuration archive with the exact member' |
| googleDriveUploadRuntime.test.mjs | 1370 | 'does not report config upload success with a wrong remote size' |
| googleDriveUploadRuntime.test.mjs | 1376 | does not report archive success for ${mode} configuration |
| googleDriveUploadRuntime.test.mjs | 1383 | does not hide tar creation ${kind} |
| googleDriveUploadRuntime.test.mjs | 1390 | rejects config snapshot ${utility} failure before uploading |
| googleDriveUploadRuntime.test.mjs | 1396 | 'rejects a copy that returns success with different bytes' |
| googleDriveUploadRuntime.test.mjs | 1400 | requires successful archive ${phase} verification |
| googleDriveUploadRuntime.test.mjs | 1405 | 'does not accept successful extraction of wrong content' |
| googleDriveUploadRuntime.test.mjs | 1409 | rejects unconfirmed timestamp ${JSON.stringify(output)} |
| googleDriveUploadRuntime.test.mjs | 1413 | 'leaves an existing same-second staging backup untouched' |
| googleDriveUploadRuntime.test.mjs | 1419 | 'does not follow old staging symlinks' |
| googleDriveUploadRuntime.test.mjs | 1425 | 'does not upload if config changes during archive creation' |
| googleDriveUploadRuntime.test.mjs | 1431 | stops on events copy ${kind} |
| googleDriveUploadRuntime.test.mjs | 1437 | 'preserves an existing same-second events copy' |
| googleDriveUploadRuntime.test.mjs | 1448 | 'creates the tar with 0600 before any later upload chmod' |
| googleDriveUploadRuntime.test.mjs | 1456 | 'round-trips the generated archive with the installed BusyBox tar' |
| googleDriveUploadRuntime.test.mjs | 1463 | 'preserves the no-gzip tar format and verifies it before return' |
| googleDriveUploadRuntime.test.mjs | 1469 | 'rejects an extra archive member even when extraction of sheepfold would match' |
| googleDriveUploadRuntime.test.mjs | 1473 | 'rejects malformed successful time output before tar creation' |
| googleDriveUploadRuntime.test.mjs | 1658 | does not fall back after selection becomes ${nextStorage} |
| googleDriveUploadRuntime.test.mjs | 1662 | rejects failed reread with partial ${JSON.stringify(storagePartial)} |
| googleDriveUploadRuntime.test.mjs | 1667 | 'does not infer an absent selection from an unsuccessful configuration read' |
| googleDriveUploadRuntime.test.mjs | 1671 | 'does not cancel an upload because an unrelated global field changed' |
| googleDriveUploadRuntime.test.mjs | 1676 | stops after selection changes at ${changeStorageAt} |
| googleDriveUploadRuntime.test.mjs | 1682 | 'does not restore already completed archives after a switch during final inventory' |
| yandexBackupRuntime.test.mjs | 206 | preserves pending data and stops before cloud mutation on ${fault} |
| yandexBackupRuntime.test.mjs | 214 | 'does not report ok:true when tar fails and no other archives exist' |
| yandexBackupRuntime.test.mjs | 219 | 'rejects a missing config before any MKCOL' |
| yandexBackupRuntime.test.mjs | 224 | 'rejects a symbolic config rather than backing up a link' |
| yandexBackupRuntime.test.mjs | 229 | 'keeps a foreign stage printed by failed mktemp' |
| yandexBackupRuntime.test.mjs | 234 | 'cleans its own directory after failing chmod' |
| yandexBackupRuntime.test.mjs | 239 | 'does nothing when another storage is selected' |
| yandexBackupRuntime.test.mjs | 244 | 'preserves old copies even when the native uploader later fails' |
| yandexBackupRuntime.test.mjs | 250 | 'still reports a later upload failure rather than claiming WebDAV is fixed' |
| yandexBackupRuntime.test.mjs | 260 | supplies a verified config and ${events?'journal':'no journal'} |
| yandexBackupRuntime.test.mjs | 269 | 'keeps pre-existing same-second backup and journal files' |
| yandexBackupRuntime.test.mjs | 274 | 'does not follow the old shared staging symlink' |
| yandexBackupRuntime.test.mjs | 279 | 'creates the archive privately before any later chmod' |
| yandexBackupRuntime.test.mjs | 284 | 'isolates successive operations with the same timestamp' |
| yandexBackupRuntime.test.mjs | 289 | 'keeps the pending archive after uploader rejection' |
| yandexBackupRuntime.test.mjs | 293 | 'retains a verified uncompressed tar without gzip' |
| yandexBackupRuntime.test.mjs | 298 | 'validates the local tar with native BusyBox tar as well' |
| yandexContextRuntime.test.mjs | 188 | 'preserves ordinary complete archive upload' |
| yandexContextRuntime.test.mjs | 195 | archive stops after ${changeField} changes at ${changeAt} |
| yandexContextRuntime.test.mjs | 210 | 'a completed earlier upload is not misreported as rolled back after a late change' |
| yandexContextRuntime.test.mjs | 216 | 'failed settings read does not permit a new command context' |
| yandexContextRuntime.test.mjs | 220 | 'unselected backend remains a skip without cloud reads' |
| yandexContextRuntime.test.mjs | 231 | stops archive when storage becomes RAM at ${changeAt} |
| yandexContextRuntime.test.mjs | 241 | does not fall back after storage becomes ${changeValue} |
| yandexContextRuntime.test.mjs | 253 | rejects failed selection reread with partial ${JSON.stringify(storagePartial)} |
| yandexContextRuntime.test.mjs | 258 | 'does not treat an unrelated global setting as a backend switch' |
| yandexContextRuntime.test.mjs | 263 | 'does not promise rollback for archives completed before a late backend switch' |
| yandexDiskRuntime.test.mjs | 356 | В общем цикле оставлен только push-events; archive-push проверяется отдельным guard |
| yandexDiskRuntime.test.mjs | 400 | В общем цикле оставлен только push-events; archive-push проверяется отдельным guard |
| yandexDiskRuntime.test.mjs | 239 | rejects current bad credentials before archive mutation with flag ${authorized} |
| yandexDiskRuntime.test.mjs | 245 | reaches explicit archive preparation without writing a flag ${authorized} |
| yandexDiskRuntime.test.mjs | 254 | 'keeps another selected storage backend network-free for status and archive' |
| yandexDiskRuntime.test.mjs | 503 | 'stops archive preflight for a dotted root and preserves local archives and UCI' |
| yandexUploadRuntime.test.mjs | 189 | 'archive-push removes queue only after complete verified upload' |
| yandexUploadRuntime.test.mjs | 190 | archive preserves queue on ${JSON.stringify(opts)} |
| yandexSyncRuntime.test.mjs | 155 | В общем цикле оставлен только push-events; archive-push проверяется отдельным guard |
| yandexSyncRuntime.test.mjs | 181 | В общем цикле оставлен только push-events; archive-push проверяется отдельным guard |
| yandexSyncRuntime.test.mjs | 194 | 'archive error code 4 is not confused with the empty-journal skip' |
| yandexSyncRuntime.test.mjs | 199 | 'archive-push records a failed authorization probe' |
| yandexEventsRuntime.test.mjs | 177 | В общем цикле оставлен только push-events; archive-push проверяется отдельным guard |
| yandexEventsRuntime.test.mjs | 272 | В общем цикле оставлен только push-events; archive-push проверяется отдельным guard |

## Инвентаризация изменённых файлов

Сравнение с принятым bdb3a92, а не только с r323. Таблица дополняет решения по B61–B159: документация сохраняет причины и границы, тесты являются исполняемыми проверками указанных контрактов, но наличие файла не означает успешный полный прогон. Цифры строк относятся к финальной инвентаризации, не оценивают объём возможностей; сам этот отчёт не считает собственные строки.

| Файл | Добавлено / удалено | Назначение принятого изменения |
| --- | ---: | --- |
| README.md | +11 / −1 | Короткое пользовательское предупреждение об отключённых облачных копиях и ссылка на итог |
| README.ru.md | +11 / −0 | Короткое пользовательское предупреждение об отключённых облачных копиях и ссылка на итог |
| docs/agent-environment.ru.md | +36 / −1 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/agent-gotchas.ru.md | +167 / −0 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/android-openwrt-api.ru.md | +58 / −0 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/api-contracts.ru.md | +8 / −0 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/apps/android-child-app-ru.md | +18 / −0 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/audit-fixes-r298.ru.md | +192 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r299.ru.md | +162 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r300.ru.md | +171 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r301.ru.md | +207 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r302.ru.md | +114 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r303.ru.md | +170 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r304.ru.md | +186 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r305.ru.md | +200 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r306.ru.md | +230 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r307.ru.md | +168 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r308.ru.md | +180 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r309.ru.md | +197 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r310.ru.md | +206 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r311.ru.md | +206 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r312.ru.md | +160 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r313.ru.md | +145 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r314.ru.md | +170 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r315.ru.md | +203 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r316.ru.md | +201 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r317.ru.md | +178 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r318.ru.md | +188 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r319.ru.md | +186 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r320.ru.md | +173 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r321.ru.md | +202 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r322.ru.md | +186 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/audit-fixes-r323.ru.md | +193 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/backend-design.ru.md | +13 / −0 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/bug-register.ru.md | +6076 / −7 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/current-implementation-status.md | +223 / −2 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/dev/tag-map.md | +45 / −3 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/developer-task.ru.md | +28 / −0 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/google-drive-storage.ru.md | +299 / −1 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/log-events.ru.md | +73 / −0 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/luci-persistence-adapters.ru.md | +43 / −8 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/maintenance-jobs.ru.md | +13 / −0 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/mandatory-companion-changes.ru.md | +8 / −0 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/merge-readiness-plan.ru.md | +2 / −0 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/project-development-roadmap.ru.md | +250 / −0 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/review-r323-acceptance.ru.md | — | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/review-r323-export-followup.ru.md | +174 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/review-r323-import-followup.ru.md | +223 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/review-r323-messenger-lifecycle.ru.md | +215 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/review-r323-persistence-followup.ru.md | +210 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/review-r323-remediation.ru.md | +187 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/review-r323-settings-lifecycle.ru.md | +221 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/review-r323-time-confirmation.ru.md | +246 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/review-r323-time-lifecycle.ru.md | +245 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/review-r323-time-recovery.ru.md | +271 / −0 | Протокол причин, тестов и ограничений соответствующего прохода; исторические числа не переносятся в текущую проверку |
| docs/settings-backup.ru.md | +76 / −2 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/telegram-bot-setup.ru.md | +14 / −1 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/test-strategy.ru.md | +426 / −0 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/time-and-detection-setup.ru.md | +30 / −1 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/troubleshooting.ru.md | +33 / −0 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| docs/yandex-disk-storage.ru.md | +209 / −4 | Актуализация контракта, навигации или runbook затронутой подсистемы; причины см. таблицу карточек |
| package/luci-app-sheepfold-family-internet-control/Makefile | +2 / −1 | r324 для версии LuCI и упаковка общего log helper; не публикация пакета |
| package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/core/persistence/uci.js | +12 / −7 | B142/B143: контроль владения локальным staging, отказ без очистки смешанного черновика |
| package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/messenger/settings.js | +113 / −42 | B147–B150: явный Save, отдельный тест Telegram и корректное состояние кнопки |
| package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/overview/application.js | +2 / −0 | B152/B155/B159: точная интерпретация ошибок time-control через общий action wrapper |
| package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/settings/backup-panel.js | +71 / −29 | B136–B146/B151: безопасный экспорт/импорт и сохранение точного снимка черновика |
| package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/settings/backup-persistence.js | +28 / −0 | B136–B146/B151: безопасный экспорт/импорт и сохранение точного снимка черновика |
| package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/settings/backup.js | +16 / −1 | B136–B146/B151: безопасный экспорт/импорт и сохранение точного снимка черновика |
| package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/settings/controller.js | +2 / −0 | B136–B146/B151: безопасный экспорт/импорт и сохранение точного снимка черновика |
| package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/settings/draft.js | +11 / −0 | B136–B146/B151: безопасный экспорт/импорт и сохранение точного снимка черновика |
| package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/settings/save-flow.js | +29 / −20 | B136–B146/B151: безопасный экспорт/импорт и сохранение точного снимка черновика |
| package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/features/settings/time.js | +47 / −2 | B136–B146/B151: безопасный экспорт/импорт и сохранение точного снимка черновика |
| package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/i18n/ru.json | +1 / −1 | Новые понятные сообщения об ошибке экспорта, импорта, Save, мессенджера и времени; PO остаётся источником JSON |
| package/luci-app-sheepfold-family-internet-control/htdocs/luci-static/resources/sheepfold/i18n/zh_Hans.json | +1 / −1 | Новые понятные сообщения об ошибке экспорта, импорта, Save, мессенджера и времени; PO остаётся источником JSON |
| package/luci-app-sheepfold-family-internet-control/po/ru/sheepfold.po | +39 / −0 | Новые понятные сообщения об ошибке экспорта, импорта, Save, мессенджера и времени; PO остаётся источником JSON |
| package/luci-app-sheepfold-family-internet-control/po/templates/sheepfold.pot | +17 / −0 | Новые понятные сообщения об ошибке экспорта, импорта, Save, мессенджера и времени; PO остаётся источником JSON |
| package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-access-request | +163 / −45 | B61–B67: личность ребёнка, полное чтение, дедупликация и приватная очередь |
| package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-admin-notification | +197 / −75 | B68–B71: достоверный список, квота 100, публикация и сохранность уведомлений |
| package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-api-legacy | +102 / −67 | B72–B75: корректный JSON, ошибки журнала и общий lock |
| package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-google-drive | +1150 / −391 | B82–B105/B131: безопаснее транспорт/кеш/чтение; сырой архив запрещён B132 |
| package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-log | +58 / −31 | B76–B78: проверенный RAM-путь, результат записи и отделение фонового sender |
| package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-log-common | +50 / −0 | B73/B76/B79: единая проверка пути для API, writer и rotator |
| package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-maintenance | +99 / −55 | B79–B81: ошибки ротации, допустимый путь и целые строки |
| package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-runtime-hardening | +4 / −3 | Поставка и проверка нового общего helper, без открытия новых разрешений |
| package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-time-control | +173 / −39 | B152–B159: снимки, подтверждение всех полей, ошибки часов, restore и NTP |
| package/luci-app-sheepfold-family-internet-control/root/usr/libexec/sheepfold/sheepfold-yandex-disk | +688 / −233 | B106–B130: транспорт, URI, контекст и статус; сырой архив запрещён B132 |
| package/luci-app-sheepfold-family-internet-control/root/www/cgi-bin/sheepfold-api | +18 / −4 | B63/B69: ответ HTTP только после завершения чтения helper |
| po/zh_Hans/sheepfold.po | +13 / −0 | Новые понятные сообщения об ошибке экспорта, импорта, Save, мессенджера и времени; PO остаётся источником JSON |
| tests/adminNotificationRuntime.test.mjs | +271 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/auditCorrections.test.mjs | +4 / −1 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/backupExportSafety.test.mjs | +181 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/backupImportUiSafety.test.mjs | +296 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/backupMutationConsistency.test.mjs | +256 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/categories.mjs | +35 / −0 | Назначение новых тестов предметным категориям |
| tests/changeImpact.test.mjs | +93 / −0 | Проверка обязательных прямых потребителей |
| tests/childAccessRequestRuntime.test.mjs | +160 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/childRequestQueueRuntime.test.mjs | +243 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/cloudArchiveSafety.test.mjs | +77 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/googleDriveUploadRuntime.test.mjs | +1307 / −0 | Изолированная модель облачного контракта; запрещённые архивные ожидания исключены по реестру выше |
| tests/helpers/adminNotificationFixture.mjs | +79 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/helpers/childAccessRequestFixture.mjs | +107 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/helpers/routerRuntimeFixture.mjs | +6 / −4 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/helpers/runtimeProcess.mjs | +49 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/legacyLogRuntime.test.mjs | +298 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/logWriterRuntime.test.mjs | +218 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/luciPersistenceAdapters.test.mjs | +1 / −1 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/maintenanceJobs.test.mjs | +6 / −1 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/maintenanceRotationRuntime.test.mjs | +217 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/messengerSettingsLifecycle.test.mjs | +304 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/overviewFinalDecomposition.test.mjs | +4 / −1 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/overviewFinalRefreshSemantics.test.mjs | +4 / −1 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/overviewFinalRuntime.test.mjs | +7 / −3 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/packageHardeningRuntime.test.mjs | +8 / −1 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/runtimeProcess.test.mjs | +67 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/settingsSaveLifecycle.test.mjs | +192 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/testIpkPermissions.test.mjs | +13 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/timeSaveConfirmation.test.mjs | +235 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/timeSettingsLifecycle.test.mjs | +265 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/timeTransactionRecovery.test.mjs | +342 / −0 | Проверка затронутого контракта и ошибок на соответствующем уровне; границы описаны в purpose-header и результатах |
| tests/yandexBackupRuntime.test.mjs | +213 / −0 | Изолированная модель облачного контракта; запрещённые архивные ожидания исключены по реестру выше |
| tests/yandexContextRuntime.test.mjs | +214 / −0 | Изолированная модель облачного контракта; запрещённые архивные ожидания исключены по реестру выше |
| tests/yandexDiskRuntime.test.mjs | +541 / −0 | Изолированная модель облачного контракта; запрещённые архивные ожидания исключены по реестру выше |
| tests/yandexDownloadRuntime.test.mjs | +209 / −0 | Изолированная модель облачного контракта; запрещённые архивные ожидания исключены по реестру выше |
| tests/yandexEventsRuntime.test.mjs | +284 / −0 | Изолированная модель облачного контракта; запрещённые архивные ожидания исключены по реестру выше |
| tests/yandexSyncRuntime.test.mjs | +261 / −0 | Изолированная модель облачного контракта; запрещённые архивные ожидания исключены по реестру выше |
| tests/yandexUploadRuntime.test.mjs | +193 / −0 | Изолированная модель облачного контракта; запрещённые архивные ожидания исключены по реестру выше |
| tools/quality/changeImpactRules.mjs | +139 / −0 | Карта влияния и обязательных проверок новых прямых зависимостей |
