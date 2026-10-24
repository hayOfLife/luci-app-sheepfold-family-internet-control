# Окружение агента и рабочие команды

Этот документ нужен следующему AI-агенту, чтобы быстро поднять рабочее окружение Sheepfold и не повторять уже найденные ошибки сборки.

Важно: этот документ в первую очередь про следующий чат Codex Desktop на компьютере пользователя с Windows. Для GitHub Actions, WSL или обычного Linux/macOS окружения смысл проверок тот же, но команды установки, пути и доступ к Android SDK будут отличаться.

## Исправление отдельных runtime-стендов после ревью r323

В затронутых fixture используется `tests/helpers/runtimeProcess.mjs`.
Linux/POSIX сохраняет прежние лимиты 15/20 секунд на дочернюю shell-команду;
Windows получает не менее 120 секунд. Только для теста можно задать целое
`SHEEPFOLD_TEST_PROCESS_TIMEOUT_MS` от 1 до 600000. Внешний per-file runner
и тайм-ауты продукта не менялись. Большой лимит не является замером роутера.

Ошибка запуска, `ETIMEDOUT` или завершение сигналом выводятся до проверки
HTTP/JSON. Ненулевой exit самого продукта не превращается в исключение стенда:
отрицательные сценарии обязаны продолжать проверять этот результат.

Fixture ротации и Google Drive проверяют наличие flock. На Linux/POSIX отсутствие
утилиты — явный отказ инфраструктуры. При её отсутствии в Windows допускается
**только последовательная тестовая модель**; native concurrency/permissions/link
сценарии сохраняют Linux gate и видимые пропуски. Модель не поставляется в пакет.

Все shell-пути `yandexContextRuntime` разрешаются относительно того же `repo`,
из которого запускается shell. В `yandexDiskRuntime` используется `work`, а в
Sync/Upload/Download — корень fixture; `shellTestPath` должен получать именно этот
cwd. Иначе Windows-путь повторяет `.build/...` внутри уже выбранного каталога.
Для Python-модели UCI в timeSaveConfirmation запись выполняется с `newline='\n'`:
автоматический CRLF на Windows не является изменением параметра роутера.
Модель использует `PYTHON_EXECUTABLE`, по умолчанию `python` на Windows и `python3`
на POSIX. Прямой вызов `python3` из Git Bash может попасть в Windows Store alias,
даже если PowerShell находит настоящий интерпретатор. Ошибка `Python was not found`
и exit 49 не являются результатом проверки сохранения UCI; сначала проверить
интерпретатор, затем повторить тест. Не ослаблять assertions ради ошибки окружения.
Результаты Windows-прогона и границы — [принятие r324](review-r323-acceptance.ru.md).

## Где находится репозиторий

Не выводить расположение актуальной копии из старого чата. Из выбранного checkout:

```powershell
git rev-parse --show-toplevel
```

Перед работой всегда проверь ветку и изменения:

```powershell
git status --short --branch
git remote -v
```

Не откатывай чужие изменения без прямой просьбы владельца проекта.

### Git отказывает из-за владельца checkout

Если `git status` сообщает `dubious ownership`, а Node quality-runner показывает
`Not a git repository`, сначала проверить фактический каталог и владельца. Не менять
ACL и не добавлять глобальное `safe.directory=*`. Для уже проверенного checkout
достаточно процессного исключения, наследуемого дочерним Git:

```powershell
$repo = 'C:/Users/User/Documents/pesochnica/sheepfold-r297-review'
git -c "safe.directory=$repo" -C $repo status --short --branch
```

Только после успешного результата, из того же корня репозитория, если переменные
`GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` ещё не заданы:

```powershell
$env:GIT_CONFIG_COUNT = '1'
$env:GIT_CONFIG_KEY_0 = 'safe.directory'
$env:GIT_CONFIG_VALUE_0 = $repo
try {
    npm.cmd run quality:plan
} finally {
    Remove-Item Env:GIT_CONFIG_COUNT, Env:GIT_CONFIG_KEY_0, Env:GIT_CONFIG_VALUE_0
}
```

Ожидается exit 0 с перечнем изменённых областей. Только окружение этого PowerShell
временно меняется; глобальная Git-конфигурация и файлы проекта не затрагиваются.
Не перезаписывать существующий `GIT_CONFIG_COUNT`: сначала выяснить его назначение.
Это настройка доверия к проверенному локальному checkout, не исправление дефекта
продукта и не разрешение доверять любой загруженной копии.

### Push зависает после передачи объектов

10.10.2026 обычная HTTPS-отправка ожидала ответ без завершения; ограниченный повтор
вернул `curl 28` и `unexpected disconnect`, затем вводящее в заблуждение
`Everything up-to-date`. GitHub API всё ещё показывал прежний SHA. Повтор с уже
авторизованным `gh` как процессным credential helper завершился успешно за несколько
секунд. Это рабочий обход наблюдаемого сбоя, не доказательство ошибки credential
manager, антивируса или сети.

Из проверенного корня checkout, только при разрешённом push и после завершения
прежней попытки:

```powershell
git -c safe.directory=C:/Users/User/Documents/pesochnica/sheepfold-r297-review -c credential.helper= -c 'credential.helper=!gh auth git-credential' -c http.version=HTTP/1.1 -c http.lowSpeedLimit=1 -c http.lowSpeedTime=30 push origin main
gh api repos/hayOfLife/luci-app-sheepfold-family-internet-control/git/ref/heads/main --jq .object.sha
git -c safe.directory=C:/Users/User/Documents/pesochnica/sheepfold-r297-review rev-parse HEAD
```

Ожидаются exit 0 у push и совпадение двух SHA. Команда меняет удалённую `main`,
но не глобальный credential helper, TLS-проверку или настройки аккаунта. Не применять
`--force`, не запускать несколько push одновременно и не считать передачу pack либо
строку `Everything up-to-date` доказательством успеха после ненулевого exit. Если `gh`
не авторизован, не извлекать/печатать токен; сообщить о необходимости обычного входа.

### Смена регистра имени файла на Windows

На регистронезависимой файловой системе нельзя считать `Name.kt` и `name.kt` двумя
разными файлами. 31.08.2026 операция patch `Move to` при такой смене регистра удалила
восемь только что созданных тестов, хотя вернула успех. Файлы восстановлены из исходных
правок и повторно проверены. Это ошибка редактирования, не антивирус и не дефект Android.

При необходимости менять только регистр использовать промежуточное действительно
отличающееся имя в два отдельных шага. Перед операцией сохранить исходное содержимое;
после каждого шага проверить наличие и SHA-256 конечного файла. Один exit code или
отсутствие ошибки недостаточны. Для новых файлов сразу выбирать согласованный `camelCase`.

## Временная папка и выдаваемые сборки на этом компьютере

На текущем Windows-компьютере репозиторий остаётся в выбранном checkout, а временные
скрипты, приватные отчёты и кэши следует размещать в каталоге, который владелец
выделил для прогонов Sheepfold:

```powershell
$env:SHEEPFOLD_SCRIPT_SCRATCH_ROOT = 'C:\Users\User\Documents\pesochnica'
$env:SHEEPFOLD_APK_OUTPUT_DIR = 'C:\Users\User\Documents\pesochnica'
$scratchTemp = Join-Path $env:SHEEPFOLD_SCRIPT_SCRATCH_ROOT 'sheepfold-temp'
New-Item -ItemType Directory -Force -Path $scratchTemp | Out-Null
$env:TEMP = $scratchTemp
$env:TMP = $scratchTemp
$env:TMPDIR = $scratchTemp
```

`tools/router-testing/` сам использует `SHEEPFOLD_SCRIPT_SCRATCH_ROOT` для
созданных shell-копий, backup и browser-отчётов. Обычные промежуточные IPK/APK
по-прежнему остаются внутри репозитория. Только когда владелец прямо просит
выдать готовый файл, его копируют в `C:\Users\User\Documents\pesochnica`, а не
в `Downloads`. Исходники и `.git` в эту папку переносить не нужно. (§toolwin,
§routerharness)

Общие router-скрипты используют этот внешний scratch, но канонические Node-runner'ы
`npm.cmd test` и `npm.cmd run test:category -- ...` на Windows направляют
`TEMP`, `TMP` и `TMPDIR` в абсолютный каталог репозитория `.build/test-tmp`.
Node и Python получают нормальный абсолютный Windows-путь, а общий test-helper
передаёт Git Bash локальный fixture относительно фактического shell-`cwd`. Он
разрешает `..` только для перехода к соседнему файлу внутри явно заданного корня
fixture и возвращается к абсолютной форме для любого внешнего пути. Это
важно: ограниченный shell может читать рабочее дерево, но получить
`Permission denied`, если fixture передан как абсолютный MSYS-путь
`/c/Users/User/...`. При прямом запуске `node --test ...`, который обходит runner,
временный каталог можно подготовить вручную:

```powershell
New-Item -ItemType Directory -Force .build\test-tmp | Out-Null
$testTemp = (Resolve-Path .build\test-tmp).Path
$env:TEMP = $testTemp
$env:TMP = $testTemp
$env:TMPDIR = $testTemp
node --test tests\ИМЯ.test.mjs
```

Это настройка только тестового процесса. Она не переносит репозиторий, не меняет
Windows ACL и не отменяет необходимость внешнего запуска, если сама песочница
запрещает Node создавать дочерний `python` с ошибкой `EPERM`. (§testenv1)

Для fixture, подменяющих системные команды, важен ещё один слой: Git Bash может
поставить `/usr/bin` раньше каталога, добавленного в Windows `PATH`. Поэтому test
helper устанавливает fixture-bin уже внутри `sh -c` и только затем делает `exec`.
Встроенные пути внутри fixture должны оставаться относительными; внешний абсолютный
путь имеет вид `/c/...` и может быть недоступен в sandbox. Python выбирается через
`PYTHON_EXECUTABLE` и запускается в UTF-8. Не заменять это прямым `python3` на
Windows и не передавать Windows-путь с обратными слешами в сгенерированный shell.

Отдельная ловушка Google Drive fixture: `PYTHONUTF8=1` вместе с
`PYTHONIOENCODING=utf-8` нужны и для чтения файлов, и для stdin/stdout модели.
Одной `encoding: 'utf8'` у Node недостаточно. В текущем Git Bash буквальный CR
перед LF исчезает при разборе `eval`, даже внутри кавычек; jshn-модель выводит
этот символ через `printf`, сохраняя исходный assertion точного имени.
Не удалять CR или кириллицу из ожидаемых данных ради зелёного результата.
Проверка и точные команды: [принятие r324](review-r323-acceptance.ru.md).

Канонический полный runner даёт одному файлу 1800 секунд на native Windows и
720 секунд на POSIX. Переменная `SHEEPFOLD_TEST_TIMEOUT_SECONDS` (60–3600)
остаётся явным override. На NTFS native Windows не подтверждает Unix mode-биты,
а без Developer Mode/прав на symlink и установленного `flock` соответствующие
низкоуровневые сценарии помечаются skipped; Linux CI обязан выполнить их полностью.

Перед ручным Gradle проверить процессную переменную `$env:GRADLE_USER_HOME`: она может
быть унаследована от другого проекта. Ошибка доступа к `gradle-*.zip.lck` или JAR в
чужом каталоге не означает повреждение Sheepfold и не требует удаления lock, изменения
ACL или повторной установки Gradle. Канонический `npm.cmd run lint:android` изолирует
оба wrapper в `.build/gradle-user-home`, запрещает daemon и компилирует Kotlin in-process;
глобальную переменную Windows и чужой проект не меняет. Первый запуск нового локального
кеша может скачать закреплённый Gradle и зависимости. Для уже подготовленного доверенного
кеша существует процессный override `SHEEPFOLD_GRADLE_USER_HOME`; лимит одного проекта
задаёт `SHEEPFOLD_ANDROID_LINT_TIMEOUT_SECONDS` (по умолчанию 1800 секунд на Windows,
900 на POSIX). Если sandbox всё равно возвращает `AccessDeniedException` для
`gradle-core-api-*.jar` в доверенном кеше, повторяют неизменную команду
`node scripts/runAndroidLint.mjs` вне sandbox; удалять кеш или менять ACL нельзя.
31.08.2026 старый агрегатный
запуск упёрся в унаследованный путь после успешного ESLint; это не означало успех
прерванного агрегата.

На этом компьютере Kaspersky Endpoint Security может после SSH/SCP и установки
пакета ошибочно поместить запускаемый `runRouterTests.ps1` в карантин как
`PDM:Trojan.Win32.Generic`. Поэтому живой роутерный harness запускают не из
рабочего дерева, а из одноразовой копии каталога `tools\router-testing` в
`C:\Users\User\Documents\pesochnica\sheepfold-router-harness\tools\router-testing`.
До копирования следует проверить `git diff` или сохранить патч незакоммиченных
правок. Копия защищает исходник Git, но не гарантирует запуск: Kaspersky уже
удалял `runRouterTests.ps1` и из `pesochnica`. В этом случае агент не маскирует
сценарий и не отключает защиту, а использует подтверждённое владельцем исключение
либо выполняет документированный короткий SSH/SCP fallback с теми же backup,
SHA-256 и read-only проверками. (§routerharness)
<!-- §winsbx1 -->

## Что должно быть установлено на Windows

<!-- §toolwin -->

Рекомендуемый способ — использовать сценарий из репозитория. Он проверяет окружение и скачивает только отсутствующие компоненты:

```powershell
powershell -ExecutionPolicy Bypass -File tools\windows\setup.ps1 -Install -AcceptAndroidLicenses -AndroidSdkRoot "$env:LOCALAPPDATA\Android\Sdk"
```

Новый чат Codex на Windows должен либо самостоятельно выполнить эту команду с нужными разрешениями, либо передать её пользователю и объяснить, что команду запускают из корня репозитория в PowerShell. После установки надо открыть новый терминал/чат, чтобы он увидел обновлённые `PATH`, `JAVA_HOME`, `ANDROID_HOME` и `ANDROID_SDK_ROOT`.

Если агент продолжает работу в текущем PowerShell/Codex shell без перезапуска, перед проверками и сборками нужно один раз перечитать системный и пользовательский `PATH`:

```powershell
$env:Path = ([Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'))
```

Иначе свежеустановленные Git, Git Bash, Node.js, Python, JDK и Android SDK могут уже быть на диске, но команды `git`, `bash`, `node`, `python`, `java`, `adb` и `sdkmanager` в текущем процессе всё ещё будут не видны.

Только проверка без скачивания и установки:

```powershell
powershell -ExecutionPolicy Bypass -File tools\windows\check.ps1
```

Подробности, состав и правила лицензирования: [`tools/README.ru.md`](../tools/README.ru.md). Тяжёлые программы и Android SDK не хранятся в истории Git; в репозитории находятся installer/check scripts, manifest версий и Gradle Wrapper.

Минимальный набор:

- Git for Windows с Git Bash в `PATH`;
- Python 3 в `PATH`;
- Node.js, подходящий для `node --test`;
- JDK 17;
- Gradle Wrapper из `android/` и `android-child/`, прогретый через `setup.ps1`;
- Android SDK с установленными platform/build-tools, которые требуют Android-проекты;
- Android SDK licenses должны быть приняты.

Полезно дополнительно:

- GitHub CLI `gh` для просмотра логов GitHub Actions;
- 7-Zip для ручной проверки архивов и ripgrep (`rg`) для быстрого поиска; оба устанавливаются общим Windows-скриптом;
- Android Studio для удобной установки SDK компонентов и принятия лицензий.

Проверка окружения:

```powershell
git --version
bash --version
python --version
node --version
java -version
android\gradlew.bat -p android --version
android-child\gradlew.bat -p android-child --version
adb version
sdkmanager --list
```

Если `python --version` открывает Microsoft Store или пишет, что Python не найден, отключи Windows App execution alias для Python или переустанови Python с галочкой `Add python.exe to PATH`.

Если `sdkmanager` не находится, проверь переменные:

```powershell
echo $env:ANDROID_HOME
echo $env:ANDROID_SDK_ROOT
```

Обычно они должны указывать на:

```powershell
C:\Users\User\AppData\Local\Android\Sdk
```

В пользовательский `Path` обычно нужны:

```powershell
%ANDROID_HOME%\platform-tools
%ANDROID_HOME%\cmdline-tools\latest\bin
```

## Git Bash в PATH

Для shell-тестов и GitHub Actions-совместимых проверок на Windows должен быть доступен `bash` и `sh`.

Проверка:

```powershell
bash --version
sh --version
```

Если Git Bash установлен, но не виден, добавь в пользовательский `Path`:

```powershell
C:\Program Files\Git\bin
C:\Program Files\Git\usr\bin
```

Команда PowerShell:

```powershell
$oldPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$add = @('C:\Program Files\Git\bin', 'C:\Program Files\Git\usr\bin')
$newPath = (($oldPath -split ';') + $add | Where-Object { $_ } | Select-Object -Unique) -join ';'
[Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
```

После этого нужно открыть новый PowerShell/Codex shell.

## Основные проверки перед коммитом

Запускать из корня репозитория.

Node-тесты:

```powershell
npm.cmd run test:list
npm.cmd run test:smoke
npm.cmd run test:category -- luci devices
npm.cmd test
```

Выбор предметной категории и условия полного прогона описаны в [`test-strategy.ru.md`](test-strategy.ru.md) (§testcat). Формат точного runbook, ожидаемых результатов, ошибок и запрещённых способов запуска задаёт `§docops1`, а обязательные изменения рядом с правкой перечислены в [`mandatory-companion-changes.ru.md`](mandatory-companion-changes.ru.md) (§cmpchg1). Не запускать все долгие HTTP/shell-стенды после каждой локальной правки.

Android XML:

```powershell
python -c "from pathlib import Path; import xml.etree.ElementTree as ET; [ET.parse(str(p)) for project in (Path('android'), Path('android-child')) for p in project.rglob('*.xml')]; print('android xml ok')"
```

Проверка пробелов/хвостов:

```powershell
git diff --check
```

Shell syntax и runtime hardening:

```powershell
bash -lc 'set -euo pipefail; package_root="package/luci-app-sheepfold-family-internet-control/root"; find "$package_root/usr/libexec/sheepfold" -type f -print0 | xargs -0 -n1 sh -n; find "$package_root/usr/share/sheepfold/router-profiles" -type f \( -name apply-mode -o -name install -o -name uninstall \) -print0 | xargs -0 -n1 sh -n; find "$package_root/etc/hotplug.d" -type f -print0 | xargs -0 -n1 sh -n; sh -n "$package_root/www/cgi-bin/sheepfold-api"; sh -n "$package_root/www/.well-known/sheepfold.json.sh"; sh -n "$package_root/etc/init.d/sheepfold"; sh "$package_root/usr/libexec/sheepfold/sheepfold-runtime-hardening" "$package_root"; echo shell-ok'
```

Если проверяешь именно mDNS-инварианты, помни: в PowerShell легко сломать экранирование `$UCODE_SOURCE`. Надёжнее сначала открыть файл или запускать команду ровно как в `.github/workflows/placeholder.yml`.

## Быстрая тестовая сборка OpenWRT IPK

На Windows используй Python/PowerShell сборщик, а не ручной tar/ar. Это быстрый
пакет для локальных и live-router проверок, а не канонический публичный release.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-test-ipk.ps1
```

Готовые пакеты появляются в:

```powershell
.build\ipk-output\
```

Сборщик пишет `.ipk` в `.build/ipk-output`. Для другого пути: `python scripts/build-test-ipk.py --variant all --out-dir D:\artifacts`. На этом компьютере явно запрошенную итоговую сборку копировать в `C:\Users\User\Documents\pesochnica`; обычный тестовый прогон туда ничего не экспортирует.

Правильный `.ipk` для OpenWRT `opkg` здесь является gzip-tar архивом с файлами:

```text
./debian-binary
./data.tar.gz
./control.tar.gz
```

Проверка структуры:

```powershell
python -c "from pathlib import Path; import tarfile; d=Path('.build/ipk-output'); p=sorted(d.glob('luci-app-sheepfold-*_all.ipk'))[-1]; print(p); tf=tarfile.open(p,'r:gz'); print('\n'.join(tf.getnames()))"
```

Не коммить `.ipk`.

### Канонические IPK и OpenWrt APK

Публичные пакеты собирает GitHub Actions через официальный OpenWrt SDK:

```powershell
gh workflow run "Build OpenWrt packages" --ref main
gh run list --workflow "Build OpenWrt packages"
gh run watch
```

Workflow выпускает IPK для OpenWrt 24.10 и настоящий apk-tools v3 `.apk` для
25.12. Переименовывать тестовый IPK в APK запрещено. WSL и локальный Docker для
этой операции на Windows не обязательны. Полный контракт, артефакты и подписи:
[`github-actions-openwrt-build.ru.md`](github-actions-openwrt-build.ru.md)
(§owrtci1).

### Права на helper-скрипты в тестовом IPK

Все файлы в `usr/libexec/sheepfold/` должны попадать в `.ipk` с режимом **0755**, и `postinst` после установки снова делает `find … -exec chmod 0755`. Иначе LuCI получит `Permission denied` при вызове `sheepfold-router-control` → `sheepfold-router-control-legacy` (вкладка «Информация о роутере», белые списки и т.д.).

Проверка: `node --test tests/testIpkPermissions.test.mjs`.

Быстрый обход на уже установленном роутере:

```sh
find /usr/libexec/sheepfold -type f -exec chmod 0755 {} +
```

### LuCI i18n в тестовом IPK

Тестовый сборщик **обязан** включать скомпилированный русский каталог:

```text
/usr/lib/lua/luci/i18n/sheepfold.ru.lmo
```

Компиляция: `scripts/po2lmo.py` из `po/ru/sheepfold.po` (вызывается из `scripts/build-test-ipk.py`). Без этого файла на роутере LuCI покажет английские msgid из `_()`, даже при `Application language = Russian`.

Проверка: `node --test tests/testIpkI18n.test.mjs`.

Подробнее о двух параметрах языка (LuCI vs Sheepfold): [`docs/localization.ru.md`](localization.ru.md).

## Версия пакета

Если изменение должно попасть в новый пакет для роутера, подними:

- `PKG_RELEASE` в `package/luci-app-sheepfold-family-internet-control/Makefile`;
- значение выводится из Makefile и записывается postinst; bootstrap находится в
  `package/luci-app-sheepfold-family-internet-control/root/usr/share/sheepfold/sheepfold.uci.defaults`.
  Готового `/etc/config/sheepfold` в payload нет, и создавать его ради версии нельзя.

Тест `tests/luciAssetVersioning.test.mjs` проверяет, что они синхронизированы.

## Android-сборки

Родительское приложение:

```powershell
android\gradlew.bat -p android assembleDebug --stacktrace
```

Детское приложение:

```powershell
android-child\gradlew.bat -p android-child assembleDebug --stacktrace
```

В Codex sandbox Gradle может не иметь доступа к `C:\Users\User\AppData\Local\Android\Sdk`. Если видишь `Permission denied` к SDK, повтори сборку вне песочницы через escalated command.

Типичные проблемы:

- `License for package ... not accepted` — принять лицензии через Android Studio SDK Manager или `sdkmanager --licenses`;
- `bad_record_mac` при скачивании AAR — сетевой/SSL сбой загрузки, часто проходит при повторе;
- `resource string/... not found` — отсутствующая Android string resource;
- Kotlin nullable/type mismatch — реальная ошибка кода, чинить.

Обычная Gradle-сборка оставляет два APK в `app/build/outputs/apk/debug`. Явные задачи `exportDebugApk` и `exportChildDebugApk` копируют их в `SHEEPFOLD_APK_OUTPUT_DIR`; на текущем компьютере это `C:\Users\User\Documents\pesochnica`. Запускать export-задачи только по прямой просьбе. Не коммить `android/app/build` и `android-child/app/build`.

Android runtime не входит в обычный цикл. Для прямой Android-задачи либо полного
предрелизного прохода использовать ручной стенд:

```powershell
npm.cmd run androidLab:doctor
npm.cmd run androidLab:smoke
npm.cmd run androidLab:full
```

Если AVD ещё не созданы, один раз выполнить
`npm.cmd run androidLab:setup -- -Install -AcceptAndroidLicenses`. Физические
телефоны, очистка debug APK, отчёты и ограничения описаны в
[`android-test-lab.ru.md`](android-test-lab.ru.md) (§andlab1).

## GitHub Actions

Если в песочнице `gh auth status` сообщает invalid token, Git выдаёт
`SEC_E_NO_CREDENTIALS`, SSH не читает существующий key, а ADB пытается создать
`\\.android`, сначала повторить ту же узкую команду с разрешённым доступом к
пользовательскому окружению. 31.08.2026 вне песочницы существующая GitHub keyring,
SSH-привязка и ADB работали без повторного входа и переустановки. Не выполнять
`gh auth logout`, не удалять ключи и не отключать TLS-проверку по такому симптому.
Это не универсальное оправдание invalid token: если разрешённый повтор тоже не
прошёл, нужна обычная диагностика учётной записи. (§testenv1)

Основные workflow находятся в:

```text
.github/workflows/placeholder.yml
.github/workflows/validate-android.yml
.github/workflows/build-openwrt-packages.yml
```

Первый проверяет shell/Node, второй собирает и проверяет два Android APK только при
изменении их входов. Третий канонически собирает Standard/AI Support через
официальный OpenWrt SDK: IPK для 24.10 и настоящий
apk-tools v3 APK для 25.12 (§owrtci1). Package-workflow автоматически запускается
только при изменении package payload, корневых переводов, своего workflow или
четырёх используемых им Python-модулей. Ручной запуск и публикация релиза доступны
независимо от `paths`-фильтра.

Разделение workflow:

- `placeholder.yml`: `shell-and-node`;
- `validate-android.yml`: `android` matrix для `android` и `android-child`;
- `build-openwrt-packages.yml`: SDK matrix и release bundle.

`shell-and-node` получает полную Git-историю, вычисляет базовый commit события и
передаёт diff в `runQualityChecks.mjs`. Поэтому Node-тесты и ESLint выбираются по
реально затронутым путям. Не заменять этот вход монолитным
`node --test tests/*.test.mjs`: он обходит карту влияния и одновременно запускает
конфликтующие shell-fixture. Полный suite остаётся отдельным release-gate по §testcat.
Quality-step идёт до изменяющего права `runtime-hardening`, иначе служебный `chmod`
попадёт в diff. Runtime-fixture детерминированно использует POSIX `sh` и системный
`flock`; конкурентные сценарии штатно пропускаются на Windows. Реальные BusyBox
`ash`, UCI и права файлов подтверждает live-router/OpenWrt контур, а не подмена
команд внутри fault-injection fixture.

Число job зависит от затронутых путей. При одновременных `push` и `pull_request`
проверки могут дублироваться; сначала сравнивайте имя workflow и commit.

Для просмотра логов удобно установить `gh`:

```powershell
gh auth login
gh run view <run-id> --repo hayOfLife/luci-app-sheepfold-family-internet-control --log-failed
```

## Live-router тесты

Тесты с настоящим OpenWRT-роутером описаны отдельно:

```text
docs/live-router-testing.ru.md
```

Не запускай write/hardware тесты на семейном рабочем роутере без явного согласия владельца, backup UCI и нужных флагов окружения.

## Что недавно оказалось важным

Полный реестр операционных мелочей: [`docs/agent-gotchas.ru.md`](agent-gotchas.ru.md).

- `sheepfold-service` должен реагировать на фактический переход устройства offline -> online, а не на любое изменение файла DHCP-аренд (§detlife1).
- После подключения действует 20-секундная задержка для сбора признаков; тяжёлый `nmap` нужен только новому, изменившемуся или неуверенно распознанному online-устройству.
- Контрольный проход автообнаружения выполняется раз в сутки только по подтверждённо online-устройствам. После запуска службы также выполняется один online-only проход.
- `.ipk` нужно собирать OpenWRT-совместимым gzip-tar форматом. Старый Debian `ar` формат уже отвергался роутером как `Malformed package file`.
- Публичное имя Android-приложения: `Sheepfold`, не `Овчарня`.
