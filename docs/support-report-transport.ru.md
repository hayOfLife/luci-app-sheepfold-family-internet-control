# Зашифрованные баг-репорты из родительского APK

<!-- §feedback §srep001 §rsuppeer -->

## Статус

Родительское APK, авторизованный router API, подпись envelope и reference-listener закрытого
`sheepfold-support-server` реализованы. Production endpoint и рабочая операторская пара ключей
по умолчанию не заданы, поэтому новая установка остаётся отключённой. LuCI пока использует
прежний необязательный Yandex Cloud канал; это осознанный переходный этап, а не два скрытых
маршрута одной мобильной формы.

## Поток данных

```text
Родитель вводит отчёт в APK
  -> APK получает с парного роутера публичный HPKE keyset и безопасный router-info
  -> APK строит support-report-v1 и показывает его целиком
  -> после подтверждения APK шифрует показанные байты операторскому public key
  -> домашний роутер получает reportId, recipientKeyId и ciphertext
  -> роутер подписывает envelope своей отдельной Ed25519 identity
  -> при отказе сохранённого endpoint роутер может проверить подписанный резервный адрес
  -> центральный HTTPS endpoint проверяет подпись, срок, key ID, размер и лимиты
  -> сервер атомарно сохраняет ciphertext и минимальную metadata
  -> операторская программа скачивает и расшифровывает отчёт локальным private key
```

Шифрование выполняется на телефоне. Домашний роутер не получает текст формы, центральный
сервер не имеет ключа расшифрования, а private key оператора не передаётся ни в APK, ни на
домашний или центральный роутер.

## Что входит в plaintext

`support-report-v1` содержит:

- тип сообщения, тему и фактическое поведение;
- для ошибки необязательные ожидаемое поведение и шаги воспроизведения;
- необязательный контакт для ответа;
- версию и вариант Sheepfold, OpenWrt, архитектуру, модель роутера и режим интеграции;
- только после отдельного флажка: состояние интернета, ping, kernel, uptime, load, memory,
  число LAN-портов, состояние Podkop/AdGuard Home и обезличенное резюме Wi-Fi-модулей;
- manifest `privacy.includedFields`, который перечисляет включённые области.

Автоматически не добавляются UCI, пароли, токены, API-ключи, MAC/IP-адреса, имена людей и
устройств, SSID, пути Wi-Fi-драйверов, журналы, история сайтов и AI-память. Предпросмотр
показывает тот же форматированный JSON, байты которого затем шифруются без перестроения.

## Криптографический контракт

- payload: HPKE `X25519 + HKDF-SHA256 + ChaCha20-Poly1305` через Google Tink;
- public keyset: Tink JSON, закодированный canonical base64url без padding;
- APK отклоняет keyset, если любой ключ не `ASYMMETRIC_PUBLIC` либо не HPKE public key;
- context info заканчивается переводом строки и содержит `reportId` и `recipientKeyId`;
- router envelope подписывается Ed25519 по каноническому порядку полей;
- router ID является первыми 16 байтами SHA-256 от raw Ed25519 public key;
- envelope действует не больше семи суток, но обычная отправка происходит сразу;
- Android отправляет не больше 48 000 байт ciphertext через CGI, router API ограничен
  тремя отчётами в час.

Отдельная identity отчётов хранится в `/etc/sheepfold/support-report/router-ed25519.pem` с
правами `0600`. Она не является TLS-ключом LuCI, администраторским Bearer-токеном или ключом
временного удалённого доступа.

## Router API

Авторизованный `GET /cgi-bin/sheepfold-api/support-report/config` возвращает только:

```json
{
  "recipientKeyId": "operator-key-1",
  "recipientPublicKeyset": "base64url-tink-public-json",
  "cryptoSuite": "HPKE-X25519-HKDF-SHA256-CHACHA20POLY1305",
  "maxCiphertextBytes": 48000
}
```

Авторизованный `POST /cgi-bin/sheepfold-api/support-report` принимает form-urlencoded
`reportId`, `recipientKeyId` и `ciphertext`. Plaintext и флаг диагностики в этот endpoint
не принимаются. HTTP redirect запрещён, endpoint должен использовать HTTPS.

Настройки по умолчанию пусты:

```sh
uci set sheepfold.global.support_report_endpoint='https://support.example/v1/reports'
uci set sheepfold.global.support_report_recipient_key_id='operator-key-1'
uci set sheepfold.global.support_report_recipient_public_keyset='<base64url>'
uci set sheepfold.global.support_report_discovery_public_key='<Ed25519-SPKI-DER-base64url>'
uci commit sheepfold
```

Public keyset не секретен, но менять его может только доверенная установка/обновление. До
production-развёртывания нельзя подставлять случайный ключ: владелец такого private key сможет
прочитать будущие отчёты.

## Резервное обнаружение адреса

Если сохранённый endpoint не отвечает, возвращает redirect, `404`, `408`, `410` либо одну из
временных ошибок `500/502/503/504`, router helper один раз обращается к фиксированному файлу.
Исключение: структурированный `503` с `error=serverMaintenance` означает, что действующий сервер
достиг безопасного лимита хранения; для него endpoint discovery не запускается:

`https://raw.githubusercontent.com/hayOfLife/luci-app-sheepfold-family-internet-control/main/docs/runtime-manifests/support-report-endpoint-v1.txt`

Это не чтение README и не поиск URL в произвольном JSON. Файл имеет четыре строки, строгий ASCII
формат, возрастающий sequence и Ed25519 signature. Public verification key заранее закреплён в
UCI доверенной поставкой пакета. Пустой `support_report_discovery_public_key` завершает fallback
до обращения в сеть, как и происходит в текущей production-конфигурации.

GitHub manifest может сообщить только HTTPS endpoint. Recipient key ID, Tink HPKE public keyset,
router identity, токены и настройки Sheepfold из него не читаются. Запрос запрещает proxy и
redirect. Подписанный адрес сначала используется как одноразовый кандидат и записывается в UCI
только после успешного приёма исходного ciphertext сервером.

Последний успешно принятый sequence защищает от отката на более старый manifest. Кандидат,
который не смог принять отчёт, не меняет flash и не блокирует прежний адрес. Discovery не
выполняется по расписанию, поэтому не создаёт фонового GitHub-трафика или постоянной записи во
flash. Точный формат, first-use ограничения, ротация signer key и выпуск файла описаны в
ADR-0026 и [`runtime-manifests/README.ru.md`](runtime-manifests/README.ru.md).

## Центральный сервер

Reference-listener из private repo слушает только `127.0.0.1` и должен стоять за отдельно
проверенным TLS/mTLS frontend. Он требует:

- `SHEEPFOLD_REPORT_STORE` с marker `.sheepfold-support-storage` на ожидаемом SSD/USB;
- `SHEEPFOLD_REPORT_KEY_IDS` со списком принимаемых key ID;
- атомарную запись через temp, fsync и rename;
- идемпотентный точный повтор одного report ID;
- восстановление metadata точным повтором, если питание исчезло между двумя durable write;
- ограниченные in-memory rate-limit maps, чтобы случайные router identity не расходовали RAM
  без границы.

Сервер видит router ID, report ID, время, key ID, размер и состояние очереди. Исходный IP
используется только для краткоживущего лимита в RAM и не записывается в metadata.

## Ротация ключа

1. Операторская программа создаёт новую HPKE-пару и сохраняет private key офлайн.
2. Сервер временно принимает старый и новый key ID.
3. В Sheepfold release/config публикуется только новый public keyset.
4. После истечения окна старых envelope и расшифровки очереди старый key ID запрещается.
5. Старый private key архивируется либо уничтожается по принятой retention policy.

Удаление старого key ID на сервере до обновления роутеров превращает валидные отчёты в
непринимаемые; удаление private key до опустошения очереди делает ciphertext необратимым.

## Ошибки и повторы

При выбранной сетевой ошибке или временном `5xx` роутер сначала может выполнить один безопасный
fallback адреса. `400`, `401`, `403`, `409`, `413` и `429` не запускают discovery: новый адрес не
исправит неверный payload, права, конфликт, размер или rate limit. После окончательной ошибки
форма и предпросмотр остаются в текущем процессе APK, а пользователь может повторить отправку.
Durable offline-очереди в Android v1 нет. Повтор с тем же ciphertext идемпотентен; тот же report
ID с другими байтами сервер отклоняет как конфликт.

Если сервер отвечает `503`, `error=serverMaintenance` и текстом «Отказано, ведутся работы на
сервере.», роутер возвращает Android код `support_report_server_maintenance` и тот же понятный
текст. Это не сетевой перенос endpoint: повтор возможен позже, после освобождения места или
обслуживания сервера.

## Реализация и проверки

- Android: `SupportReportPayload.kt`, `SupportReportCrypto.kt`, `FeedbackTab.kt`;
- router: `sheepfold-support-report`, `sheepfold-support-endpoint-discovery`,
  `/support-report/config`, `/support-report`;
- public static contract: `tests/supportReportTransport.test.mjs`;
- signer/shell interoperability: `tests/supportEndpointDiscovery.test.mjs`;
- Android runtime HPKE round-trip: `supportReportCryptoTest.kt`;
- server signature/queue tests находятся в private `sheepfold-support-server`.

Детское APK не содержит вкладку, route client или скрытую отправку баг-репортов.
