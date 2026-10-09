# Модули-помощники для поиска ошибок

<!-- §qassist -->

Этот раздел описывает локальные детерминированные инструменты Sheepfold. Они помогают новому агенту быстро ответить на четыре вопроса:

1. Какие подсистемы действительно затронуты изменением?
2. Какой минимальный набор проверок даст полезную обратную связь сейчас?
3. Какие дорогие или изменяющие внешнее состояние проверки ещё остаются обязательными?
4. Не ухудшил ли рефакторинг документацию, структуру файлов или LuCI на настоящем роутере?

Инструменты не используют внешнюю LLM, не отправляют исходники в облако и не добавляют runtime-зависимости в роутерный пакет. Для локальных анализаторов достаточно Node.js и уже закреплённых devDependencies. Playwright ставится существующим router harness в `tools/local/` и не попадает в IPK.

## Первые команды нового агента

Из корня репозитория на Windows:

```powershell
git status --short --branch
npm.cmd ci
npm.cmd run quality:plan
```

`npm.cmd ci` нужен только если отсутствует `node_modules` либо изменился lock-файл. Он не требуется перед каждым запуском.

Во время разработки:

```powershell
npm.cmd run quality:changed
```

Перед push после изменения исполняемого кода повторите выбранный impact-контур:

```powershell
npm.cmd run quality:changed
```

Наличие push, PR или merge само по себе не расширяет область проверки. `quality:gate`
нужен только когда impact нельзя надёжно ограничить, изменён сквозной контракт или
отбор/изоляция тестов, владелец запросил полный прогон либо выполняется отдельный
release-gate всего артефакта.

`quality:gate` запускает полный Node-набор через канонический `runAllTests.mjs`, который
разносит сетевые стенды, глубокие shell-симуляции и упаковщики по изолированным
процессам. Нельзя заменять этот путь одним монолитным `node --test`: на Windows он
может удерживать процесс десятки минут. Gate также выполняет строгую проверку
неизвестных карте путей. Он не запускает живой роутер, GitHub Actions и сборку Android
APK: такие команды перечисляются в отчёте как отдельные обязательства, потому что
могут менять внешнее состояние или требуют специального окружения.

На Windows оба канонических test-runner хранят temp в `.build/test-tmp` внутри
репозитория. Node и Python используют его абсолютный Windows-путь, а test-helper
преобразует передаваемые Git Bash fixture-пути в POSIX-форму и устанавливает fixture
`PATH` уже внутри shell. Это не даёт MSYS переставить `/usr/bin` перед fault-injection
wrapper. Полный runner до начала долгих групп отдельно проверяет запуск Git Bash и
дочернего Python. `Python ... EPERM`
при успешном прямом `python --version` требует повторить gate вне песочницы, а не
переустанавливать Python или ослаблять тест. Подробная диагностика:
[категории тестов](../test-strategy.ru.md#ipk-зависимые-тесты-на-windowscodex).
<!-- §testenv1 -->

## Карта инструментов

| Задача | Команда | Скорость | Меняет внешнее состояние |
| --- | --- | --- | --- |
| Только посмотреть риск и план | `npm.cmd run quality:plan` | секунды | нет |
| Посмотреть карту вручную | `npm.cmd run review:impact` | секунды | нет |
| Запустить минимальные проверки | `npm.cmd run quality:changed` | обычно секунды или минуты | только `.build/quality/last-run.json` |
| Явный полный gate | `npm.cmd run quality:gate` | полный suite может идти более 10 минут | только локальный отчёт и test temp |
| Проверить изменённые документы | `npm.cmd run quality:docs` | секунды | нет |
| Проверить все Markdown-файлы репозитория | `npm.cmd run quality:docs:all` | секунды | нет |
| Найти рост крупных файлов | `npm.cmd run quality:structure` | секунды | нет |
| Вывести all-pairs матрицу | `npm.cmd run quality:matrix` | доли секунды | нет |
| Проверить LuCI на роутере | `npm.cmd run router:frontend` | десятки секунд | read-only сессия LuCI, локальные артефакты |

`quality:changed` дедуплицирует пересекающиеся категории и запускает каждый выбранный
test-файл в отдельном процессе. Это чуть дороже старта одного `node --test`, зато
shell/HTTP-fixtures не конкурируют друг с другом и отказ остаётся привязан к одному файлу.
Android Lint также изолирует Gradle cache в `.build/gradle-user-home`, не используя
случайно унаследованный кеш другого проекта.

## Как модули связаны

```mermaid
flowchart TD
  G["Git diff, rename и untracked"] --> I["changeImpact"]
  R["changeImpactRules"] --> I
  I --> P["План: риск, категории, ручные проверки"]
  I --> Q["runQualityChecks"]
  C["tests/categories.mjs"] --> S["testSelection"]
  S --> Q
  D["documentationAudit"] --> Q
  F["structureAudit"] --> Q
  T["poCatalog + PO/JSON regression test"] --> Q
  Q --> J[".build/quality/last-run.json"]
  M["pairwise + runtime model"] --> X["Конфигурационная матрица"]
  B["frontendSmoke"] --> A["frontendAudit"]
  A --> L["Скриншоты и result.json живого LuCI"]
```

## Что включать в зависимости от задачи

| Изменение | Минимум во время работы | Перед завершением |
| --- | --- | --- |
| Только текст документа | `quality:docs`, ближайший контрактный тест | `git diff --check`; полный suite обычно не нужен |
| LuCI JS/CSS | `quality:changed`, затем `test:luci` при необходимости | `lint:js`, `router:frontend` по отчёту; полный suite только при сквозном impact |
| Backend helper | `quality:changed`, обычно `backendFast` | затронутые категории; `router:readOnly` либо `router:fullSafe` по отчёту |
| Firewall/DNS/AdGuard | ближайший unit/runtime-тест | затронутые `access/sites/networkIntegration`, `router:fullSafe`, при необходимости `router:runtimeMatrix` |
| Android Kotlin/XML | `test:android`, Android Lint | сборка затронутого APK и сценарий эмулятора/телефона |
| UCI/defaults/package | `backendFast packaging security` | живой upgrade/restore и официальный SDK build; полный suite только при общей migration/package-границе |
| Только тестовая инфраструктура | direct test + `quality:changed` | полный suite лишь при изменении отбора/изоляции, способном пропустить test-файл; правка timeout или текста ошибки его не требует |
| Native relay helper / SFMR1 wire model | дешёвый guard + protocol tests | ручной Linux `runNativeCryptoTests.sh --sanitize`, официальный SDK и target vector; [команды и ограничения](../../package/sheepfold-message-relay-crypto/README.ru.md) |

## Значение итоговых статусов

`install.sh`, `update.sh`, `uninstall.sh` и установленный `sheepfold-updater` входят
в правило packaging и выбирают прямые update/preservation/language-тесты. Не
скрывайте неизвестный путь ослаблением `--strict`: дополните карту и её регрессию,
если путь действительно принадлежит существующей подсистеме (§impact1, §updsafe).

- `passed`: все автоматически выбранные локальные проверки пройдены.
- `partial`: выбранные проверки пройдены, но общий контракт требует полного suite либо Android Lint был явно пропущен.
- `failed`: упал lint/test/docs/diff-check или строгий режим встретил неизвестный путь.
- `pendingManualChecks`: команды для живого роутера, Android build или GitHub SDK. Они не выполнены автоматически и не должны исчезать из итогового отчёта агента.

Зелёный локальный статус не доказывает работу Wi-Fi, nftables, DNS, Android lifecycle или установки на конкретной модели OpenWrt. Граница доказательства всегда указывается рядом с инструментом.

## Файлы реализации

| Файл | Ответственность |
| --- | --- |
| `tools/quality/changeImpactRules.mjs` | единственная карта путей, риска, категорий и внешних проверок |
| `tools/quality/changeImpact.mjs` | чистая агрегация отчёта без Git и subprocess |
| `tools/quality/gitChanges.mjs` | tracked, untracked, delete и обе стороны rename |
| `scripts/inspectChangeImpact.mjs` | CLI для просмотра и JSON |
| `scripts/runQualityChecks.mjs` | последовательный локальный gate и измерение этапов |
| `tools/quality/testSelection.mjs` | объединение категорий и точечных тестов без дублей |
| `tools/quality/testEnvironment.mjs` | локальный Windows temp, относительные Git Bash fixture-пути и единая граница sandbox |
| `tools/quality/documentationAudit.mjs` | ссылки, §-теги, test/npm-контракты, заголовки, fenced code blocks и alt-текст |
| `tools/quality/whitespaceAudit.mjs` | пробелы и окончание строк, включая ещё не добавленные в Git файлы |
| `tools/quality/structureAudit.mjs` | рост крупных изменённых файлов относительно Git-базы |
| `tools/quality/poCatalog.mjs` | строгий разбор PO для сверки исходного каталога с клиентским JSON без дочернего Python |
| `tools/quality/pairwise.mjs` | детерминированное покрытие допустимых пар конфигурации |
| `tools/router-testing/frontendAudit.mjs` | чистые read-only проверки страницы LuCI |
| `tools/router-testing/frontendSmoke.mjs` | запуск браузера и запись артефактов |

Подробности: [карта влияния и gate](change-impact-and-gate.ru.md), [документация, структура, матрица и LuCI](matrix-structure-and-ui.ru.md).

## Навык ясной документации

<!-- §docwrit -->

Проектный skill [sheepfold-documentation](../../.agents/skills/sheepfold-documentation/SKILL.md) направляет агента от проверки реального поведения к подходящему типу документа и [стандарту технической документации Sheepfold](../documentation-writing-standard.ru.md). Он применяется при создании страниц, существенной переработке и ревью документации, но не раздувает постоянный контекст `AGENTS.md` полным редакционным справочником.

`quality:docs` намеренно проверяет только детерминированные признаки: локальные ссылки, §-теги, существующие test/npm-контракты, один `H1`, порядок уровней заголовков, закрытые fenced code blocks и непустой alt-текст изображения. Он не пытается regex-правилами оценить ясность русского языка, техническую истинность или статус реализации: эти свойства агент сверяет с кодом, тестами, схемами и runtime-доказательствами.

Имена обычных `.test.mjs` проверяются по каталогу `tests/`. Для ручного стенда вне suite
указывать точный путь `tools/.../имя.test.mjs`: проверяется существование именно этого файла,
а не одноимённого теста в другом каталоге. Это не добавляет стенд в автоматический запуск.

## Когда расширять инструменты

Новая подсистема требует обновления `changeImpactRules.mjs`, если её путь не попадает в существующую предметную область или ей нужна особая живая проверка. Новая тестовая категория добавляется только при устойчиво отдельном типе проблем, а не ради одного файла. Новый сканер принимается, только если он ловит конкретный класс ошибок лучше существующего ESLint/test/harness и его стоимость измерена.

Не добавлять целиком внешние коллекции skills, AI-slop scanners и MCP-обёртки «на всякий случай». Репозиторий должен сохранять воспроизводимый локальный контур, понятный без стороннего аккаунта и сетевого сервиса.

## Ручной внешний security-аудит

<!-- §secaudit1 -->

VVAH является исключением только как необязательный консультативный слой перед
релизом или после изменения критической границы. Он не входит в
`quality:changed`, `quality:gate` и CI. Автоматически проверяется лишь контракт
runner: отдельный чистый clone, estimate по умолчанию, два флага согласия,
`--stop-after s9`, отсутствие автоисправления и manifest происхождения.

Команды и порядок разбора находок:
[ручной агентный аудит](../manual-agentic-security-audit.ru.md).
