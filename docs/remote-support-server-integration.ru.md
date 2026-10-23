# Связь Sheepfold с закрытым сервером техподдержки

<!-- §rsuppeer -->

## Проверка совместимости 23.10.2026

Серверная source-реализация действительно ушла вперёд: она использует
`sheepfold-support-control-1`, а прежний public `ControlClient` моделирует
`sheepfold-support-server-experimental-1`. Первоначальный `supportPeerMismatch`
сравнивал эти разные экспериментальные профили, а не два работающих устройства.
Это не ошибка уже установленного Podkop, телефона или production-сервиса.

Теперь текущий публичный контракт выделен в `typedPayload.mjs` и
`typed-*-message-v1.schema.json`; ручной `runControlPeer.mjs` проверяет именно его
против нынешнего private service. Добавлены `sessionResume`, `commandPoll`,
`commandResult` и `sessionResumed`; `claimOpen` не содержит `routerHostKey`.
У текущего профиля другие capabilities и расширенный signed status, включая lease,
diagnostic consent и 30-секундный интервал опроса. Подпись и общий golden vector не менялись.

По решению владельца 23.10.2026 устанавливаемый OpenWrt-клиент отложен. Node.js
reference не является этим клиентом. Ни заглушка LuCI, ни новый runtime на роутере/VPS
не включаются. [ADR-0031](architecture/decisions/0031-typed-https-remote-support.ru.md)
согласует публичную архитектуру с private ADR-0016 без FRP/SSH.

Различайте четыре независимых результата:

| Проверка | Что означает успех |
|---|---|
| metadata peer | совпали repository URL, contract ID и major; не runtime |
| `support:peer-check` в private | текущие typed поля и подписи согласованы с рабочим public checkout |
| `runControlPeer.mjs` в public | synthetic HTTPS/mTLS/TOTP и обмен с текущим private source |
| frozen vendor/release | совпал конкретный закреплённый исторический snapshot; обновляется отдельно после review/public commit |

Старые `experimental-*` схемы и CSR/grant сохранены для истории, но не становятся
fallback текущего сервера. Vendor hashes не переписываются ради зелёного результата.
Точные команды и границы приведены в
[runbook стенда](../tools/remoteSupport/README.ru.md). Семейный relay остаётся отдельной подсистемой.

## Исторические контрольные точки

Статус: спроектирована граница двух репозиториев. В private repo уже есть отключённый по
умолчанию loopback-only OpenWrt PoC очереди зашифрованных отчётов и read-only operator CLI.
Production TLS endpoint, рабочая пара ключей расшифрования и runtime удалённого управления ещё
не включены.

31.08.2026 согласован экспериментальный control-профиль: public `ControlClient` и private
`SupportControlService` проходят совместный loopback HTTPS/MFA стенд. Это локальные source
изменения, не deployment. Публичная реализация остаётся Node.js test-only; OpenWrt manager и
FRP/SSH не добавлены. Команда, ожидаемые результаты и ограничения находятся в
[`tools/remoteSupport/README.ru.md`](../tools/remoteSupport/README.ru.md).

Исторический экспериментальный slice добавлял отдельные `transportRequest/transportGrant` и
Node-only `TransportClient`: CSR связывается router-подписью, ответ проверяется по CA/SPKI и
неизменяемой lease, token/replay остаются в RAM. Это не новый production HTTP endpoint и не
готовый manager; старые control capabilities по умолчанию не меняются. Точный wire и server-side
обязательства: [transport-профиль](remote-support-protocol.ru.md#экспериментальный-transport-профиль).
Private vendor pin обновляется только после review/public commit; живой VPS этим не изменяется.

## Репозитории

На 10.10.2026 GitHub API подтвердил переименование владельца в `hayOfLife` для обоих
проектов. Публичные manifests и навигационные ссылки актуализированы; историческое
имя в ADR-0023 сохранено. Это смена адреса, не протокола или ключей доверия.
Перед совместным выпуском обязательно синхронизировать private peer manifests и
проверить vendor hashes: в этом локальном проходе серверный репозиторий не изменялся,
сквозная совместимость с ним не объявляется подтверждённой.

- этот публичный клиентский проект: <https://github.com/hayOfLife/luci-app-sheepfold-family-internet-control>;
- закрытый server/control/operator project: <https://github.com/hayOfLife/sheepfold-support-server>.

Если у агента есть доступ только к Sheepfold, этот документ, `tools/remoteSupport/peer-project.json` и `§rsup001` дают полную границу взаимодействия. Недоступность private repo не разрешает придумывать server behavior или объявлять его готовым.

## Архитектура

Действующая выбранная архитектура ADR-0031/private ADR-0016:

```text
Домашний Sheepfold (клиент отложен)
  -> исходящий HTTPS + Ed25519: typed control messages
  -> локальное разрешение, подтверждение exact plan hash, независимый revoke

Сервер Sheepfold (Debian primary, OpenWrt reserve)
  -> проверяет identity/claim/MFA/deadline/sequence
  -> хранит ограниченную очередь типовых операций и результатов
  -> не создаёт разрешение владельца и не исполняет shell на роутере

Операторский ноутбук с серым IP
  -> сам подключается к server
  -> локально расшифровывает отчёты
  -> операторский доступ через mTLS + TOTP
  -> supportctl и будущий ограниченный Codex bridge
```

Публичный сервер не получает root password, LuCI cookie, Android Bearer, домашнюю LAN route или ключ расшифрования баг-репортов.

Родительский APK уже использует отдельный report plane: plaintext формируется и показывается
на телефоне, затем шифруется HPKE до домашнего роутера; роутер только подписывает ciphertext.
Точный контракт и переходное отличие LuCI описаны в
[документе зашифрованных баг-репортов](support-report-transport.ru.md) (§srep001).
При отказе сохранённого report endpoint роутер может проверить отдельный Ed25519-signed manifest
по фиксированному пути GitHub. Публичный проект владеет форматом и verifier, private проект —
offline signer; manifest не имеет права менять HPKE keyset (§srepdisc1).

Family message relay родительского APK из `§mrelay1` является отдельным message plane. Он не
переиспользует support claim/session, FRP, report envelope, local Android Bearer или текущий
`sheepfold.remote-support.peer.v1`. Private repo уже содержит отдельные peer manifest, strict
vendor-копию protocol v1 и выключенный loopback-only listener `127.0.0.1:8790` с отдельными
process/UID, storage, keys и rate limits. Listener `127.0.0.1:8787` по-прежнему относится только к
synthetic support/report трафику. Ни один из них **не является** production endpoint для Android
или домашнего роутера. Точный статус и параметры клиента описаны в
[`android-router-message-relay.ru.md`](android-router-message-relay.ru.md).

## Владение контрактами

План следующего support milestone находится в private-проекте:
`docs/remote-support-implementation-plan.ru.md`. Он покрывает identity/claim/MFA,
типовые operations, fresh lease после reboot, независимый отзыв и будущую интеграцию
вкладки «Тех поддержка». Этап OpenWrt manager и пользовательской активации отложен владельцем.
По уточнению владельца 30.08.2026 тестовое развёртывание не выполняется: это документационный
checkpoint серверного deployment, не разрешение открыть дополнительные порты. Последующий
локальный control-стенд не отменяет этот запрет.

| Область | Source of truth |
|---|---|
| Signed router/control protocol, claim/session state, golden vectors | этот public repo |
| Router consent, local expiry/revoke, package/firewall integration | этот public repo |
| Формат и router verifier подписанного резервного report endpoint | этот public repo |
| Encrypted report envelope и очередь | private server repo |
| Offline signer резервного endpoint и церемония его ключа | private server repo |
| Control persistence, operator MFA, typed dispatcher | private server repo |
| supportctl, JSON CLI и local Codex MCP bridge | private server repo |
| Family message relay envelope, payload, AES-GCM vector и router/phone protocol | этот public repo |
| Family message relay credentials, opaque queue и loopback runtime | private server repo |
| Family message relay synthetic DNS/TLS/Caddy ingress | private server repo; развёрнут без enrollment и real data, дальнейшие operations ждут client/legal gates |

## Работа Codex

Codex не подключается к публичному control plane напрямую. На операторском ноутбуке запускается локальный `supportctl` и будущий MCP bridge. Он выдаёт модели только типизированные действия, допустимые в текущем session:

- список и чтение расшифрованных баг-репортов;
- состояние принятого router session;
- versioned diagnostic recipes;
- подготовка плана изменения;
- применение exact plan hash после подтверждения пользователя и с rollback;
- установка только проверенного подписанного Sheepfold package;
- немедленный revoke.

Универсального `runShell` в MCP v1 нет. Неизвестный случай требует ручного терминала сотрудника и отдельного будущего ADR для one-shot command approval.

## Как агент открывает второй проект

Private repo нельзя добавлять submodule в public Sheepfold. Агент с GitHub-доступом клонирует его рядом:

```powershell
gh repo clone hayOfLife/sheepfold-support-server C:\path\to\sheepfold-support-server
node tools\remoteSupport\checkPeerContract.mjs --peer C:\path\to\sheepfold-support-server
```

В обратную сторону private repo содержит `docs/sheepfold-client-integration.ru.md` и аналогичный `peer:check`.

## Порядок совместимого изменения

1. Обновить public schema/golden vectors на отдельной ветке без включения runtime.
2. Обновить server adapter и pinned public revision.
3. Выполнить cross-runtime tests.
4. Сначала развернуть backward-compatible server.
5. Затем выпустить router client, который может отправлять новую версию.
6. Major удаляется только после объявленного срока поддержки.

## Баг-репорты

Sheepfold показывает владельцу preview, маскирует диагностику и шифрует payload для operator key до отправки. Central server видит только report/router IDs, timestamps, size и delivery state. Он не должен расшифровывать пользовательский текст, логи, модель роутера или версии внутри payload.

Получение отчёта не даёт удалённый доступ. Support session по-прежнему требует отдельного локального 12-значного claim, служебной аутентификации/MFA и сгорает через 24 часа после принятия.
