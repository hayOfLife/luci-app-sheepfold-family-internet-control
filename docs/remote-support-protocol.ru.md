# Протокол роутера и сервера временной техподдержки

<!-- §rsup001 -->

Статус: проектный контракт `v1`; текущий source-профиль `sheepfold-support-control-1`
согласуется с private HTTPS service. Устанавливаемый OpenWrt-клиент отложен владельцем
23.10.2026; LuCI-заглушка остаётся неактивной. Наличие Node.js стенда не означает runtime.

## Текущий HTTPS/typed контракт

[ADR-0031](architecture/decisions/0031-typed-https-remote-support.ru.md) заменяет FRP/SSH-часть
ADR-0022. Домашний клиент в будущем использует только исходящий HTTPS и Ed25519-signed
messages; оператор — mTLS и TOTP. Нет FRP, reverse SSH, общего `runShell`, WAN LuCI или LAN routing.

Канонические источники текущего source-профиля:

- [typed payload validator](../tools/remoteSupport/typedPayload.mjs);
- [router schema](../tools/remoteSupport/schemas/typed-router-message-v1.schema.json);
- [server schema](../tools/remoteSupport/schemas/typed-server-message-v1.schema.json);
- [двусторонний стенд и команды запуска](../tools/remoteSupport/README.ru.md).

Envelope, preimage и прежний Ed25519 golden vector сохранены. Общий перечень message types
расширен; текущий typed validator не принимает legacy profile, SSH host key или transport grant.
Сравнение только общей envelope schema не доказывает совместимость предметных payload.

| Router message | Точные поля payload |
|---|---|
| `enrollProof` | `challenge`, `clientNonce` |
| `capabilityReport` | `profile`, `capabilities` |
| `claimOpen` | `sessionId`, `code`, `claimExpiresAt`, `diagnosticsAllowed` |
| `sessionResume` | `sessionId`, `bootId` |
| `sessionReady`, `heartbeat`, `commandPoll` | `sessionId`, `leaseId`, `bootId` |
| `commandResult` | `sessionId`, `leaseId`, `bootId`, `operationId`, `status`, `result` |
| `revokeRequest`, `statusQuery` | `sessionId` |

Capabilities: `claimV1`, `localRevokeV1`, `typedControlRelayV1`, `diagnosticRecipesV1`,
`localApprovalV1`, `restartResumeV1`. Claim требует весь текущий набор, не legacy transport token.
Опрос — 30 секунд; lease — не более 120 секунд; signed reply — 60 секунд; общий message TTL —
не более 300 секунд. Срок claim — до 72 часов, после принятия доступ — до 24 часов без продления.

`sessionResume` идёт по новому control stream. Другие session messages связаны со своим
`sessionId`. Server status содержит `sessionId`, `state`, `claimExpiresAt`, `accessExpiresAt`,
`leaseExpiresAt`, `ticketId`, `leaseId`, `pollAfterSeconds`, `diagnosticsAllowed`.
`sessionCommand` дополнительно содержит типовую команду. После reboot нужны повторное
enrollment той же identity, свежие boot ID/lease и прежний deadline; старое approval не переносится.

Разрешены diagnostic recipes `systemOverview`, `networkHealth`, `serviceHealth` и подготовка/
применение `reloadSheepfold`, `reapplySheepfoldFirewall`. Результат ограничен 8192 JSON bytes;
сервер дополнительно проверяет поля по типу операции. В отличие от ciphertext bug reports,
typed diagnostics доступны control-серверу: состав безопасных результатов и согласие должны
быть проверены до реальных клиентов. Стенд отправляет только synthetic данные.

Node validator серверных сообщений принимает явное время получения:
`validateTypedServerMessage(message, now)`. Проверки envelope/подписи выполняются заранее;
команда и активная lease должны быть действующими именно при получении. Закрытый статус не
может сохранять lease, непринятый claim не содержит access/lease/ticket, а `sessionReady`
и `sessionPreparing` имеют ещё не активированную lease со сроком `0`. Это source-регрессии,
не реализация watchdog или локального исполнения на OpenWrt.

## Исторический FRP/SSH-проект

Остальные разделы ниже сохраняют первоначальный проект и эксперименты 31.08.2026.
Они не являются действующим планом установки. При конфликте с текущим HTTPS/typed разделом
или ADR-0031 применяется новое решение. Старые схемы и `ControlClient` сохраняются для
регрессионных исследований, но не подаются на текущий сервер и не используются как fallback.

## Цели протокола

- сервер не может создать доступ без локально открытого claim;
- роутер и сервер однозначно узнают друг друга криптографически;
- повтор сообщения, reconnect и reboot не создают второй доступ и не продлевают первый;
- код можно безопасно продиктовать, но он не является паролем, портом или transport credential;
- удаление сервера из сети не мешает локально закрыть доступ;
- старый клиент отвергает неизвестную опасную команду;
- все ошибки имеют стабильный машинный код и не требуют разбирать текст;
- реализация подходит OpenWRT 24.10/25.12 и минимальному роутеру Xiaomi AX3000T после измерений.

## Разделение каналов

| Канал | Назначение | Доверие |
|---|---|---|
| Control HTTPS | Enrollment, claim, подписанные команды, heartbeat, revoke, relay map | TLS с обычной проверкой имени и закреплённым корнем; сообщения дополнительно подписаны |
| FRP transport | Исходящая доставка TCP к relay | Взаимный TLS с отдельным короткоживущим сертификатом одного роутера/сеанса |
| Reverse SSH | Фактическая работа техподдержки | SSH от bastion до Dropbear роутера с временным ключом заявки |
| LuCI/Android/мессенджер | Статус, уведомление и отзыв | Существующие локальные Sheepfold API и права; они не заменяют local claim |

Успешный control HTTPS не открывает SSH. Успешный FRP login не открывает server route. Доступ появляется только после атомарного принятия claim, установки временного SSH-ключа и подтверждения обеими сторонами.

## Порты и маршрутизация

### `transportPort`

Relay имеет небольшой заранее известный набор исходящих TLS-портов, например основной `443` и резервный. Роутер соединяется с ним сам. Этот порт не секретен; его безопасность обеспечивают TLS, client identity и проверка протокола.

Direct-WAN правило Sheepfold разрешает только сочетание:

```text
UID sheepfold_support + подписанный IP relay + разрешённый transportPort
```

Совпадение только по порту, адресу или packet mark запрещено.

### `sessionRoutePort`

После успешного claim control plane случайно выделяет порт из внутреннего server-side pool. Он:

- относится только к одному `sessionId`;
- слушает только loopback/private-интерфейс relay;
- доступен только закрытому bastion;
- удаляется при revoke/expiry;
- может смениться после восстановления server-side route без изменения срока сеанса;
- не считается фактором аутентификации.

Если выбранная версия `frps` не позволяет доказуемо закрыть proxy bind от публичного интерфейса, transport PoC считается неуспешным. Открывать случайный высокий порт в интернет вместо исправления изоляции запрещено.

### Почему порт не входит в код

12-значный код состоит только из криптографически случайных цифр. В нём нет `routerId`, порта, relay, контрольной суммы с обратимыми данными или номера заявки. Постоянный порт на каждый роутер запрещён: это стабильный идентификатор, ограниченный 16-битным диапазоном и обнаруживаемый сканированием.

Control plane сам связывает код с `claimId`, `routerId`, заявкой и внутренним route. Сотруднику достаточно номера заявки и кода; порт он не диктует и не вводит.

## Криптографические личности и ключи

### Корень Sheepfold

Подписанный пакет содержит только публичный офлайн-корень Sheepfold. Он проверяет версионированный server key manifest. Приватный корневой ключ не находится на control plane и не используется для ежедневной подписи сообщений.

### Роутер

При явном включении модуля router backend:

1. создаёт отдельную Ed25519 identity-пару локально;
2. сохраняет приватный ключ root-only вне UCI, backup/export и argv;
3. доказывает владение ключом, подписывая server challenge;
4. получает случайный `routerId`, не содержащий MAC, serial, SSID или адрес владельца;
5. регистрирует только публичный ключ.

До регистрации server ещё не знает router public key, поэтому используется единственное узкое bootstrap-исключение:

1. `POST /v1/enrollment/start` передаётся только внутри HTTPS с полной проверкой имени и закреплённого корня;
2. строгий body содержит ровно `identityPublicKey`, случайный `clientNonce` и `supportedVersions`, не содержит MAC, serial, SSID, пароля или команды;
3. server ограничивает размер/rate, вычисляет `candidateKeyId` и хранит pending public key не дольше пяти минут;
4. подписанный server-сообщением `enrollChallenge` использует временный `streamId=enrollmentId` и `routerId=null`;
5. ответ `enrollProof` имеет envelope `keyId=candidateKeyId`, поэтому server находит pending public key и проверяет внешнюю подпись до разбора payload;
6. после успешного proof server удаляет pending challenge и отправляет подписанный `enrollAccepted` с новым `routerId` и control `streamId`.

Любое другое router -> server сообщение без проверяемой внешней подписи запрещено. Bootstrap не создаёт claim, transport credential, SSH-ключ или доступ.

Компрометация одного router identity не открывает другие роутеры. Перенос настройки на другой роутер не переносит identity автоматически.

### Сервер

Control plane подписывает сообщения отдельным online Ed25519-ключом. Его публичная часть и срок находятся в manifest, подписанном офлайн-корнем. Ротация требует нового действующего manifest; команда от неизвестного online key не может сама объявить этот ключ доверенным.

### Transport

Для каждого открытого ожидания либо принятого сеанса роутер создаёт отдельную transport keypair и CSR. Control plane возвращает короткоживущий клиентский сертификат, ограниченный `routerId`, `sessionId` и deadline. Приватный transport key остаётся на роутере. Общий FRP token для всех установок запрещён.

PoC обязан подтвердить поддержку взаимного TLS выбранной сборкой `frpc/frps`. Если она отсутствует или не проходит проверку hostname/CA/client certificate, нельзя молча перейти на один общий token.

### SSH

Bastion создаёт отдельную временную SSH-пару для принятой заявки. Router backend получает только публичный ключ в подписанной команде и добавляет его с маркером `sessionId`. Приватный ключ не выдаётся control plane API, LuCI или сотруднику как скачиваемый файл; соединение создаёт bastion.

## Формат подписанного сообщения

Внешний envelope содержит ровно четыре поля:

```json
{
  "protocolVersion": 1,
  "keyId": "server-2026-01",
  "signedPayload": "<base64url exact UTF-8 JSON bytes>",
  "signature": "<base64url Ed25519 signature>"
}
```

Подпись проверяется до разбора JSON над однозначным бинарным preimage:

```text
ASCII "SheepfoldRemoteSupport\\0"
+ uint32be protocolVersion
+ uint16be длина keyId
+ uint32be длина signedPayload
+ ASCII keyId
+ точные декодированные байты signedPayload
```

Так подпись одновременно связывает версию, `keyId` и payload. Подпись только над `signedPayload` запрещена: внешние поля не должны жить отдельно от подписанного контекста. Точные байты payload исключают расхождения из-за порядка ключей, пробелов и повторной сериализации. После успешной подписи payload разбирается строгой схемой.

Обязательные поля payload:

```json
{
  "messageType": "sessionCommand",
  "routerId": "<128-bit random id>",
  "streamId": "<128-bit replay scope>",
  "messageId": "<128-bit random id>",
  "sequence": 7,
  "issuedAt": 1787421000,
  "notBefore": 1787421000,
  "expiresAt": 1787421060,
  "payload": {
    "sessionId": "<128-bit support session id>"
  }
}
```

Правила разбора:

- имена ключей регистрозависимы;
- `protocolVersion` является целым числом, а не строкой;
- время передаётся Unix timestamp в секундах UTC;
- `expiresAt` является исключающей границей: при `now >= expiresAt` сообщение, claim или сеанс уже просрочены;
- `sequence` является неотрицательным целым в совместимом диапазоне JSON `0..2^53-1`; этого достаточно для одного временного сеанса и не вызывает потери точности в JavaScript/ucode;
- `streamId` всегда содержит ровно 128 случайных бит и задаёт область `sequence`/replay; для сообщения активной техподдержки он равен `sessionId`, а enrollment и отдельный one-shot transport-профиль используют независимый временный ID;
- `routerId=null` допустим только для `enrollChallenge`/`enrollProof`, пока сервер ещё не выдал идентификатор; после enrollment `routerId` обязателен;
- остальные ID содержат ровно 128 случайных бит и передаются как 22 символа canonical base64url без `=` и пользовательских данных;
- повторяющиеся JSON-ключи, NUL, неправильный UTF-8, лишние критические поля и значения вне диапазона отклоняются;
- общий подписанный payload ограничен 16 КБ, глубиной 16, 64 полями объекта и 128 элементами массива; более узкая предметная схема может уменьшать эти пределы;
- неизвестный `messageType` не выполняется;
- неизвестная major-версия не получает fallback на `v1`;
- текст ошибки не участвует в логике клиента.

В каждом направлении подписанные payload создаёт один serializer соответствующей стороны.
Golden vectors фиксируют точные байты, подписи, допустимый разбор и набор испорченных вариантов.

## Версия и capabilities

`protocolVersion=1` означает major-версию. Совместимые добавления объявляются через capabilities, например:

```json
{
  "supportedVersions": [1],
  "capabilities": [
    "claimV1",
    "mutualTlsTransportV1",
    "localRevokeV1",
    "signedRelayMapV1"
  ]
}
```

Capability сообщает только уже реализованное поведение. Отсутствующее значение означает `не поддерживается`, а не разрешение угадать по версии пакета. Security-critical capability нельзя включить server-side feature flag без поддержки router backend.

## Типы сообщений `v1`

| `messageType` | Направление | Назначение | Идемпотентность |
|---|---|---|---|
| `enrollChallenge` | server -> router | Случайный challenge для регистрации public key | Новый challenge отменяет прежний после срока |
| `enrollProof` | router -> server | Подпись challenge и public identity | Один proof создаёт не более одного `routerId` |
| `enrollAccepted` | server -> router | Выданные `routerId`, identity key ID и новый control stream | Повтор для того же enrollment возвращает прежний результат |
| `capabilityReport` | router -> server | Версии, возможности и безопасные сведения transport | Повтор заменяет только ту же revision |
| `relayMap` | server -> router | Подписанный список relay, IP, портов и срока | Принимается только более новая revision |
| `claimOpen` | router -> server | Открытие 72-часового ожидания после local action | Один idempotency key создаёт один claim |
| `claimOpened` | server -> router | Подтверждение server-side verifier/deadline | Не изменяет первоначальный deadline |
| `claimAccepted` | server -> router | Заявка, срок 24 часа, SSH public key и transport lease | Один `sessionId` добавляет один ключ/route |
| `sessionReady` | router -> server | Ключ установлен, `frpc` готов, локальный срок принят | Повтор не создаёт новый route |
| `sessionActive` | server -> router | Bastion подтвердил новый SSH handshake | Только это состояние позволяет UI показать подключение |
| `heartbeat` | router -> server | Состояние manager/transport и sequence | Не продлевает deadline |
| `sessionCommand` | server -> router | Закрытый enum безопасных управляющих действий | Строго по sequence и allowlist |
| `revokeRequest` | router -> server | Сообщение о локальном отзыве | Повтор безопасен |
| `revokeConfirmed` | server -> router | Server route закрыт и credential отозван | Повтор безопасен |
| `statusQuery` | обе стороны | Сверка фактического состояния | Не меняет состояние |
| `transportRequest` | router -> server | Подписанный CSR отдельного экспериментального профиля | Точные исходные bytes только в RAM до срока запроса |
| `transportGrant` | server -> router | Короткая credential lease отдельного экспериментального профиля | Только точный действующий ответ; не означает SSH-ready |

`sessionCommand` не содержит shell-строку, URL для произвольного скачивания или произвольный путь к файлу. Для `v1` разрешены только перечисленные операции:

- `activateAcceptedSession`;
- `revokeSession`;
- `replaceSignedRelayMap`;
- `rotateTransportCertificate`;
- `confirmSafeApplyResult`.

Добавление операции, способной выполнить произвольный код, изменить семейные правила или создать claim, требует новой версии/ADR и отдельного security review.

## Открытие claim

1. Локальный backend проверяет root password gate, LuCI ACL, lock, наличие WAN и установленный transport.
2. Роутер создаёт `sessionId`, CSPRNG-код из 12 цифр и неизменяемый `claimExpiresAt <= now + 72h`.
3. Подписанный `claimOpen` отправляется через аутентифицированный TLS. Открытый код передаётся серверу один раз только внутри этого запроса и запрещён для access/error logs.
4. Server немедленно вычисляет verifier через отдельный server-side secret/pepper, очищает открытое значение из request context и подтверждает срок.
5. Локальный LuCI показывает код группами `0000 0000 0000`; runtime-файл доступен только root и удаляется после claim/expiry/revoke.

Роутер не хранит код в UCI. Server backup не содержит открытого кода. Для поиска active claim используется keyed lookup tag, а не обычный быстрый хеш 12 цифр.

## Принятие claim

1. Сотрудник проходит служебную аутентификацию и MFA, выбирает/создаёт номер заявки и вводит код.
2. Server применяет лимиты по claim, учётной записи, IP/сессии bastion и общему сервису. После пяти неверных попыток claim необратимо блокируется; владелец создаёт новый.
3. Принятие выполняется одной транзакцией `open -> claimed`; два параллельных запроса не могут победить одновременно.
4. Code verifier удаляется, code lookup tag помещается в короткий replay denylist до конца retention.
5. Создаются `accessStartsAt` и `accessExpiresAt <= accessStartsAt + 24h`. Остаток 72-часового окна не используется.
6. Bastion создаёт временный SSH-ключ, relay выделяет независимый случайный `sessionRoutePort`, server выпускает transport certificate.
7. Подписанный `claimAccepted` доставляет только необходимые public/lease данные. Роутер ещё не показывает `подключилась`.
8. После `sessionReady` bastion выполняет SSH handshake. Только подписанный `sessionActive` переводит UI в активное состояние и создаёт уведомление.

Номер порта не показывается владельцу и сотруднику, не входит в код и не сохраняется после закрытия.

## Сроки и неверные часы

- Server time является окончательным для claim/access deadlines.
- Внутри одного boot роутер дополнительно хранит связь signed server time с monotonic uptime.
- Перевод локальных часов назад не увеличивает оставшийся срок.
- После reboot действующий сеанс остаётся закрытым, пока server не подтвердит прежний `sessionId`, deadline и transport lease.
- Незабранный claim хранит открытый код только в volatile runtime и отменяется после reboot; владелец создаёт новый код.
- После reboot временный SSH-ключ устанавливается заново только по действующему подписанному server status; одного восстановления TCP/FRP недостаточно.
- Если server недоступен, локальный backend может только сохранить более строгий исход: закрыть просроченное или отозванное. Он не создаёт новый доступ офлайн.
- Heartbeat, reconnect и safe-apply подтверждение никогда не меняют `accessExpiresAt`.

## Sequence, nonce и повторы

- Server и router ведут отдельную возрастающую `sequence` на каждый `streamId` и направление. Для сообщений сервисного сеанса `streamId` совпадает с вложенным `sessionId`; enrollment и экспериментальный credential exchange используют отдельный временный stream.
- Новая последовательность каждого направления начинается с `0`; после restart принимающая сторона восстанавливает последний подтверждённый номер из защищённого состояния, а не создаёт пустое окно посреди сеанса.
- `messageId`/nonce хранится в ограниченном replay cache как минимум до `expiresAt` сообщения.
- Значение ниже уже подтверждённого sequence отклоняется.
- Повтор последнего idempotent message может вернуть прежний результат, но не повторяет side effect.
- Повтор совпадает по всем подписанным байтам, не только по `sequence/messageId`. Изменённый
  payload с прежними ID отвергается. Потерянный ответ на отзыв возвращается с первоначальной
  подписью и server sequence, иначе клиент получит искусственный `sequenceGap`.
- Пропуск sequence вызывает `sequenceGap` и явный status sync, а не выполнение более новой опасной команды вслепую.
- Новый transport socket не обнуляет sequence.
- Factory reset создаёт новую router identity; старый `routerId` не восстанавливает support session.

## State machine роутера

```text
disabled
  -> moduleReady
  -> waitingForWan
  -> claimOpening
  -> claimOpen
  -> claimBlocked | claimExpired
  -> sessionPreparing
  -> sessionReady
  -> sessionActive
  -> reconnecting | failingOver
  -> revoking
  -> revoked | sessionExpired | securityBlocked
```

Переход выполняет один manager под lock. LuCI только читает структурированный status и вызывает узкие backend-операции. Если local state и signed server status противоречат друг другу, выбирается более закрытое состояние и запускается сверка.

## Стабильные ошибки `v1`

| `errorCode` | Смысл | Безопасное действие клиента |
|---|---|---|
| `protocolUnsupported` | Версия не поддерживается | Не соединяться, предложить совместимое обновление |
| `signatureInvalid` | Подпись/ключ не прошли | Немедленно блокировать сообщение и transport |
| `serverIdentityInvalid` | TLS/manifest не подтверждены | Не использовать адрес и не отключать проверку |
| `routerUnknown` | `routerId` не зарегистрирован/отозван | Требовать локального повторного enrollment |
| `messageMalformed` | Строгая схема не пройдена | Не применять частичные поля |
| `messageNotYetValid` | Срок действия подписанного сообщения ещё не начался | Не выполнять сообщение, сверить время/status |
| `messageExpired` | Срок сообщения истёк | Запросить новый status |
| `sequenceReplay` | Старый/повторный side effect | Вернуть прежний результат без выполнения |
| `sequenceGap` | Пропущена команда | Выполнить status sync |
| `claimNotOpen` | Локального ожидания нет | Не создавать его server-side |
| `claimCodeInvalid` | Введённый код не соответствует открытому claim | Учесть неудачную попытку без раскрытия дополнительных данных |
| `claimExpired` | Прошло 72 часа | Удалить локальный код |
| `claimAlreadyUsed` | Код уже сгорел | Не выдавать новый доступ |
| `claimAttemptsExceeded` | Превышен лимит | Заблокировать claim, попросить владельца создать новый |
| `sessionExpired` | Прошло 24 часа | Удалить ключ/route/credential |
| `sessionRevoked` | Одна сторона отозвала доступ | Выполнить идемпотентную локальную очистку |
| `transportUnavailable` | Relay/FRP недоступен | Bounded retry без продления срока |
| `relayMapInvalid` | Карта просрочена/не подписана | Оставить последнюю действующую карту |
| `clockUntrusted` | Нельзя безопасно определить срок | Не восстанавливать активный доступ |
| `packageMissing` | Optional transport не установлен | Оставить режим неактивным |
| `stateConflict` | Router/server расходятся | Выбрать более закрытое и сверить status |
| `rateLimited` | Лимит control API | Подождать указанное безопасное время |
| `securityBlocked` | Нарушен security-инвариант | Закрыть transport до локального решения |
| `internalError` | Неизвестная серверная ошибка | Не считать действие выполненным |

Локализованный текст формируется отдельно. Ветвление backend/Android/LuCI по русской или английской фразе запрещено.

## Локальный отзыв

`revoke` сначала выполняется на роутере:

1. manager под lock переходит в `revoking`;
2. удаляет временный SSH-ключ;
3. останавливает session proxy/transport credential;
4. удаляет Sheepfold-owned session route и runtime secret;
5. фиксирует локальный `revokedAt`;
6. затем отправляет `revokeRequest` серверу с повторами до подтверждения.

Недоступность сервера не оставляет локальный вход открытым. Server expiry/revoke независимо закрывает bastion route. Повтор операции возвращает подтверждённое закрытое состояние.

## Safe-apply

Control protocol не передаёт shell-команды сетевой настройки. Safe-apply запускается внутри уже открытого SSH-сеанса локальным Sheepfold helper по отдельному manifest затрагиваемых файлов. Server только подтверждает, что после изменения увидел новый подписанный heartbeat и новый SSH handshake для прежнего `sessionId`.

Локальный exit code, старый socket или один heartbeat без SSH не отменяют rollback timer.

## Журналирование и приватность

Разрешено сохранять:

- `routerId` в безопасном локальном/серверном формате;
- `sessionId`, номер заявки, actor `Sheepfold Support`;
- переходы состояния, сроки, relay ID и безопасный `errorCode`;
- fingerprint временного SSH public key;
- факт локального или серверного отзыва.

Запрещено сохранять:

- открытый код и verifier;
- приватные identity/transport/SSH keys;
- client certificate private material;
- shell-команды, terminal transcript и LuCI cookies;
- raw UCI, SSID, MAC/IP домашних клиентов и журнал посещений;
- секрет в URL query, process argv, push или обычном экспорте.

## Совместимость и обновление

- Router и server объявляют поддерживаемые major-версии до claim.
- Обновление manager во время активного сеанса по умолчанию откладывается.
- Если protocol update несовместим, владелец сначала закрывает сеанс.
- Server поддерживает старую major-версию только в объявленный срок; после него старый клиент получает `protocolUnsupported`, а не ослабленный режим.
- Downgrade не восстанавливает старый ключ, код или session state.
- Новая реализация должна уметь полностью удалить свои `v1` runtime-артефакты без знания будущей версии.

## Обязательные golden vectors и тесты

1. Корректная server/router подпись для фиксированных synthetic keys.
2. Изменение одного байта payload, `keyId`, подписи и protocol version.
3. Повтор JSON-ключа, неверный регистр, NUL, invalid UTF-8, лишнее критическое поле и число вне диапазона.
4. Replay одинакового `messageId`, старого sequence и одновременный claim из двух запросов.
5. Reconnect и смена `sessionRoutePort` без изменения `sessionId/accessExpiresAt`.
6. Доказательство, что code generation не зависит от порта/router ID/заявки.
7. Пять ошибочных кодов блокируют claim; верный код после блокировки не оживляет его.
8. Неверное время, reboot и server outage не продлевают доступ.
9. Local revoke закрывает ключ/route при недоступном server.
10. WAN-скан не видит `sessionRoutePort`; bastion видит только свой session.
11. Credential одного роутера не проходит как identity другого.
12. Журнал, UCI, `ps`, export и crash report не содержат synthetic secrets.

Unit/golden тесты доказывают только формат и переходы. mTLS, bind interface, firewall isolation, resource budget и реальный SSH path подтверждаются отдельно на relay и тестовом Xiaomi AX3000T.

Reference-модель и схемы запускаются командой:

```powershell
node --test tests/remoteSupportProtocol.test.mjs tests/remoteSupportArchitecture.test.mjs
```

## Экспериментальный control-профиль

30.08.2026 в private server появился отдельный локальный HTTPS/control runtime
`sheepfold-support-server-experimental-1`. 31.08.2026 добавлены исполняемые public validators,
клиентский автомат и loopback HTTPS-стенд с этим сервером. Router/APK/backend/вкладки не изменяются.

Точный payload задан в
[`experimental-router-message-v1.schema.json`](../tools/remoteSupport/schemas/experimental-router-message-v1.schema.json)
и [`experimental-server-message-v1.schema.json`](../tools/remoteSupport/schemas/experimental-server-message-v1.schema.json).
Они дополняют общий signed payload, а не меняют его подпись. Проверка JSON Schema сама по себе
не доказывает canonical base64url, подпись, владение identity, связь stream/session, replay и срок:
это обязательные дополнительные runtime проверки.

| Router message | Точные поля вложенного payload |
| --- | --- |
| `enrollProof` | `challenge`, `clientNonce` |
| `capabilityReport` | `profile`, `capabilities` |
| `claimOpen` | `sessionId`, `code`, `claimExpiresAt`, `routerHostKey`, `diagnosticsAllowed` |
| `sessionReady`, `heartbeat` | `sessionId`, `leaseId`, `bootId`; default server пока не создаёт такую lease |
| `revokeRequest`, `statusQuery` | `sessionId` |

`routerHostKey` — точный OpenSSH `ssh-ed25519` public host key без comment, не временный ключ
оператора. `diagnosticsAllowed` — отдельное разрешение диагностических recipes; сам claim
не означает согласие на выгрузку любых данных. Дополнительные ключи отвергаются целиком.

Начальные routes: `POST /experimental/support/enrollment/start` с прежним enrollment-start body
и `POST /experimental/support/router` с signed envelope. Ответ HTTP: `{ok:true,profile,result}`,
где `result` — signed message; ошибка `{ok:false,errorCode}`. Body ограничен 24576 bytes,
signed payload — 16384. `Content-Type: application/json`, без query/compression/redirect.
Default listener private runtime только `127.0.0.1`; production endpoint не опубликован.

Сотрудник использует отдельные operator routes с mTLS certificate pin и TOTP. Открытый code
поступает только через скрытый stdin, не argv. Для claim он указывает `sessionId`, номер заявки
и `operationId`; одинаковый повтор возвращает первоначальный результат. Принятие меняет состояние
на `sessionPreparing`, но не создаёт SSH. Сервер объявляет только реализованную `claimV1`,
не объявляет рабочую `mutualTlsTransportV1` без транспорта.

Клиент заявки по умолчанию объявляет только `claimV1/localRevokeV1`. Явный Node-only параметр
`transportCredentials:true` добавляет `transportCredentialsV1`, но не `typedGatewayV1`. Проверка
`mutualTlsTransportV1/typedGatewayV1` выполняется отдельно при `prepare`, до вызова broker.
Прежнее требование полного транспорта уже на `claimOpen` не позволяло честному control-only
клиенту открыть заявку и было исправлено. Смена capabilities не выдаёт transport credential.

Исполняемый client verifier строже общей формы status: `sessionReady/sessionActive/reconnecting`
и ненулевая lease не принимаются без согласованного transport-профиля. `claimOpened` означает
только `claimOpen`; `revokeConfirmed` требует terminal state. Claim deadline неизменен,
первый access deadline не длиннее 24 часов от подписанного времени ответа, последующие ответы
не меняют его или номер заявки. Поздний ответ после локального отзыва не открывает доступ.

Ошибка источника времени, недопустимый wall-clock (`NaN`, отрицательное или дробное значение,
бесконечность, `-0`, значение вне safe-integer), недопустимый monotonic uptime или откат часов
дают `clockUntrusted` и необратимый `securityBlocked` текущего экземпляра. Он удаляет код,
bootstrap и незавершённый запрос, включая отзыв. После восстановления часов status доступен,
но старый подписанный ответ, локальный отзыв или новый запрос не возвращают разрешение.
Monotonic uptime может быть дробным, как `performance.now() / 1000`, но должен быть конечным,
неотрицательным, не `-0` и не больше `Number.MAX_SAFE_INTEGER`; вычисленное время тоже проверяется.
**Почему выбран этот способ / нюансы.** Ошибка часов не является повреждённым wire payload:
пока сроки недостоверны, сохранённый открытый код или retry могут ошибочно вернуть доступ.
Блокировка действует только в тестовом RAM-автомате; durable recovery и закрытие SSH остаются
отдельными runtime gates.

При неопределённом результате запроса клиент сохраняет для повтора те же bytes/ID/sequence
только в RAM и только до исходного срока сообщения. После локального отзыва открывающий запрос
больше не повторяется. Если его ответ потерян навсегда, текущий автомат остаётся закрытым:
восстановление sequence без повторного `claimOpen` требует ещё не реализованного signed
status-sync контракта. Это блокирует production manager, но не оправдывает сброс счётчика.
После server-side закрытия запрос, чей cached response содержал старое открытое состояние,
получает `sessionRevoked`, а не новый ответ с пропущенным номером. HTTP-ошибка не является
подписанным разрешением или подтверждением состояния.

В экспериментальном профиле restart сервера отзывает все старые open claims/sessions. Это
более закрытый исход, чем проектный resume: требуется новое локальное разрешение владельца,
а старые сроки и код не оживают при восстановлении backup. Роутер должен принять этот исход,
не пытаться автоматически создать новый claim. Heartbeat и reconnect не продлевают 24 часа.
После аварийного завершения experimental server не снимает старый writer lock самостоятельно:
OS-level lock/service crash-recovery gate ещё не пройден. Это ограничение локального server
entrypoint, а не разрешение клиенту продлить срок или выдать доступ повторно.

**Почему выбран этот способ / нюансы.** Публичный проект остаётся владельцем формата; локальный
контракт не выдаётся за опубликованную совместимую версию. Схемы `claimAccepted`, реальной
`sessionActive`, relay map и safe-apply надо согласовать вместе с настоящим
FRP/bastion adapter. Transport CSR/grant ниже выделен в отдельную schema и не расширяет старую
control server-response schema. После review и
public commit private repo обновляет pinned vendor revision/SHA-256; рабочий файл не является
immutable release. Полный план ADR-0022 этим профилем не отменяется.

## Экспериментальный transport-профиль

`sheepfold-support-transport-experimental-1` — отдельный opt-in контракт для Node-стенда,
не опубликованный endpoint и не включение LuCI/APK/роутерного runtime. Source of truth:
[`transportPayload.mjs`](../tools/remoteSupport/transportPayload.mjs),
[`transportClient.mjs`](../tools/remoteSupport/transportClient.mjs) и
[`предметная JSON Schema`](../tools/remoteSupport/schemas/experimental-transport-message-v1.schema.json).
Common envelope/preimage остаются `v1`, golden signature не изменяется. Старый control verifier
по-прежнему не принимает transport grant и не получает fallback.

Оба сообщения имеют случайный `streamId`, **не равный `sessionId`**, `sequence:0` и срок envelope
не более 60 секунд. `messageId` является отдельным nonce. Новый запрос не обнуляет старый
control stream: этот credential exchange имеет собственную одноразовую replay-область.

| Тип | Точные поля вложенного payload |
| --- | --- |
| `transportRequest` | `profile`, `sessionId`, `csrDer` |
| `transportGrant` | `profile`, `sessionId`, `csrSha256`, `leaseId`, `accessExpiresAt`, `leaseExpiresAt`, `certificateDer`, `proxyName`, `proxyPort`, `token` |

`csrDer/certificateDer` — canonical base64url без padding, DER не больше 4096 bytes.
`csrSha256/token` — ровно 64 lowercase hex, `proxyName` — `support-` и 32 lowercase hex,
`proxyPort` — integer 1024..65535. ID имеют прежние 16 bytes; все строки именно primitive string,
без coercion, accessor и дополнительных полей. JSON Schema не заменяет canonical encoding,
DER framing, криптографию и сравнение сроков.

Сервер проверяет внешнюю router identity-подпись до CSR; затем обязан проверить CSR signature
(proof-of-possession), отдельный Ed25519 transport key, accepted session и исходные сроки.
Передача CSR не является подтверждением claim/MFA. Root/transport private key, endpoint, CA
и SSH key не входят в grant; доверенные адрес/CA устанавливаются отдельно, без wire-ротации.

Клиент связывает ответ с router/session/stream, исходным SHA-256 CSR и заранее подтверждённым
`accessExpiresAt <= issuedAt + 86400`. `leaseExpiresAt <= issuedAt + 120`, не позже access deadline; envelope истекает
не позже lease. Сертификат подписан закреплённым CA, содержит отдельный согласованный Ed25519
SPKI, точный subject `CN=Sheepfold temporary support`, только clientAuth EKU, critical keyUsage
digitalSignature only и critical BasicConstraints CA:FALSE без pathLen. CA также Ed25519.
`notAfter` **точно равен** `leaseExpiresAt`, CA действителен на срок leaf.
Допустимы только BC/KU/EKU/SKI/AKI extensions; SAN/AIA, повторения и повреждённый DER отвергаются.

**Почему выбран этот способ / нюансы.** `X509Certificate.ca` учитывает keyUsage: CA:TRUE вместе
с digitalSignature без keyCertSign может дать `false`. Поэтому дополнительно проверяется
ограниченный DER BasicConstraints с точным содержимым `30 00` и keyUsage `03 02 07 80`, а не только этот флаг.
Подписанные negative fixtures проверяют CA:TRUE, duplicate OID, явный noncanonical FALSE,
неcritical BC/KU, keyCertSign и неожиданные SAN/AIA.
CSR framing на клиенте не доказывает владение ключом — proof-of-possession остаётся серверным gate.

`request/retry` хранят точные bytes только в RAM; первый ответ принимается до срока исходного
запроса. Повтор уже принятого ответа должен совпадать побайтно и всё ещё иметь действующий
envelope; изменённый/просроченный ответ закрывает grant. После expiry envelope уже принятые
credentials можно читать до неизменяемой lease, **не вызывая повторный accept**. Отзыв, потеря
RAM, истечение lease или недостоверные часы не допускают восстановления прежнего разрешения.
Скачок wall-clock вперёд перебазирует monotonic anchor: если wall-clock затем остановится,
оставшаяся lease продолжает сокращаться. Иначе старый anchor мог бы задержать локальный expiry.
Объект не пишет файлы и не запускает watchdog; очистка фактического FRP/SSH остаётся за manager.

Token и весь credential-bearing signed response запрещено сохранять в HMAC snapshot,
`received.response`, обычном журнале, argv или артефакте: HMAC не является шифрованием.
Серверу нужны RAM-only replay и durable tombstone без самого ответа. Наличие token/сертификата
не меняет `transportReady:false`: SSH host key, typed helper и действующее подключение не проверены.

Команды, cleanup, типовые ошибки и границы теста находятся в
[`runbook Node-клиента`](../tools/remoteSupport/README.ru.md#отдельный-клиент-transport-credentials).
После public review/commit private проект отдельно обновляет pin/SHA-256 и выполняет обе peer
проверки и synthetic credential/FRP gate. Наличие локальной схемы не разрешает production rollout.

## Вопросы перед фиксацией production `v1`

- Подтвердить точную поддержку Ed25519 и mTLS пакетами OpenWRT 24.10/25.12 на минимальном роутере.
- Выбрать server-side HSM/secret storage для online signing key и claim pepper.
- Подтвердить, что выбранный `frps` связывает reverse proxy только с loopback/private адресом; иначе выбрать другой способ внутренней доставки.
- Определить срок server audit retention и процедуру удаления данных заявки.
- Подготовить ротацию offline root/online key без удалённого небезопасного доверия новому ключу.
- Решить, когда одна общая учётная запись будет заменена персональными аккаунтами сотрудников.
