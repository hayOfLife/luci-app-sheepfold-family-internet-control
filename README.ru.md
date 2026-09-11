<p align="center">
  <img src="docs/assets/sheepfold-logo.png" alt="Sheepfold logo" width="160">
</p>

# Sheepfold : контроль доступа в интернет для семьи

Русский | [English](README.md)

[Презентация проекта Sheepfold](docs/project-presentation.ru.md)

[Зашифрованные баг-репорты родительского приложения](docs/support-report-transport.ru.md) · [Переходный канал LuCI: Yandex Cloud + YDB](docs/yandex-cloud-ydb-feedback.ru.md)

[Как собираются официальные IPK и OpenWrt APK](docs/github-actions-openwrt-build.ru.md)

**Sheepfold** — система семейного управления доступом домашних устройств в интернет через OpenWRT-роутер.

Проект развивается как приложение для OpenWRT-роутера с веб-интерфейсом LuCI, backend-сервисом, Android-приложением **Sheepfold** и интеграцией с ботом в мессенджере для управления домашним интернетом.

## Установка

Скрипт установки задаёт вопросы первого запуска, определяет AdGuard Home/Podkop, скачивает из последнего stable-релиза подходящий пакет и устанавливает его штатным менеджером OpenWrt: `.ipk` через `opkg` на 24.10 и старше либо OpenWrt `.apk` через `apk` v3 на 25.12 и новее.
Он сначала спрашивает язык приложения (`ru` по умолчанию, `en` для английского), профиль страны, вариант Sheepfold, согласие с пользовательским соглашением и режим автоматизации. По умолчанию включается `Максимальная автоматизация`: согласованный рекомендуемый профиль доступа новых устройств, полного автоопределения, автоматических системных групп и мониторинга паспорта. `Выборочная автоматизация` открывает отдельные настройки в LuCI и начинает с уменьшенного автоопределения.

```sh
wget -O /tmp/sheepfold-install.sh https://raw.githubusercontent.com/kva4991/luci-app-sheepfold-family-internet-control/main/install.sh &&
sh /tmp/sheepfold-install.sh
```

## Обновление

В родительском Android-приложении есть отдельная кнопка **Информация → Обновление приложения**.
Она проверяет опубликованные родительские APK и открывает подтверждение установки Android.
[Инструкция обновления и выпуска](docs/android-app-updates.ru.md) описывает требования к
подписи и доступность релизов. Кнопка не обновляет пакет роутера.

После установки OpenWrt-пакета скрипт обновления передаёт работу установленному Sheepfold updater. Updater проверяет последний stable-релиз GitHub, сравнивает версии, скачивает пакет формата текущей версии OpenWrt, проверяет его внутренние метаданные и запускает установку только при наличии более новой версии.

Галочка **«Участвовать в бетатесте»** внизу «Общие» после подтверждения и сохранения включает часовые автоматические обновления из этих опубликованных релизов и уведомления о SIM/новых Wi-Fi ребёнка, без нового сбора координат. По умолчанию выключена. Подробности: [бета-режим](docs/maintenance-jobs.ru.md).

```sh
wget -O /tmp/sheepfold-update.sh https://raw.githubusercontent.com/kva4991/luci-app-sheepfold-family-internet-control/main/update.sh &&
sh /tmp/sheepfold-update.sh
```

## Удаление с OpenWRT

Скрипт удаления убирает OpenWRT-пакет, сохраняет настройки Sheepfold и список клиентов, а затем показывает отчёт об оставшихся настройках на роутере.

```sh
wget -O /tmp/sheepfold-uninstall.sh https://raw.githubusercontent.com/kva4991/luci-app-sheepfold-family-internet-control/main/uninstall.sh &&
sh /tmp/sheepfold-uninstall.sh
```

## Названия проекта

- GitHub-репозиторий: `luci-app-sheepfold-family-internet-control`
- OpenWRT-пакет: `luci-app-sheepfold-family-internet-control`
- LuCI EN: `Sheepfold Family Internet Control`
- LuCI RU: `Sheepfold : контроль доступа в интернет для семьи`
- Android-приложение: `Sheepfold`
- Android package: `app.sheepfold.android`

## Цели

- Управлять доступом домашних устройств в интернет через OpenWRT-роутер и его веб-интерфейс LuCI.
- Сделать Android-приложение с быстрыми действиями и виджетами.
- Добавить управление через Telegram/VK-бота, VK сделать вариантом по умолчанию при первичной настройке, а MAX оставить экспериментальным адаптером.
- Поддержать белый список, чёрный список, расписания, временные разрешения и доступ к аварийно-полезным сайтам.
- Синхронизировать имена устройств и постоянные IP с постоянной арендой DHCP на OpenWRT-роутере.
- Безопасно работать с `fw4` / `nftables`.
- Сосуществовать с AdGuard Home и Podkop.

## Поддерживаемые версии Android

Оба Android-приложения поддерживают Android 9.0 Pie / API 28 и новее.

Более старые версии Android намеренно не поддерживаются.

## Целевые версии OpenWRT

Sheepfold ориентирован на современные роутеры OpenWRT с `firewall4` / `nftables`.

Поддержка устаревших `firewall3` / `iptables` не планируется. Ожидаемые устройства — достаточно свежие домашние роутеры и прошивки, например класс Xiaomi Mi Router AX3000T.

## Планируемая цепочка трафика

1. Sheepfold решает, разрешён ли устройству доступ в сеть.
2. Разрешённый DNS-трафик может идти через AdGuard Home.
3. Разрешённый и отфильтрованный трафик может идти дальше через Podkop.

Проект не должен ломать AdGuard Home, Dnsmasq, Podkop, sing-box или стандартные правила firewall OpenWRT.

## Приоритет правил

1. Устройства из чёрного списка блокируются всегда.
2. Устройства из белого списка не блокируются глобальными правилами и расписаниями.
3. Одно устройство не может одновременно находиться в белом и чёрном списке.
4. Временные разрешения не должны обходить чёрный список.
5. Расписания применяются только к устройствам, которых нет в белом и чёрном списках.

## Структура репозитория

```text
package/luci-app-sheepfold-family-internet-control/  каркас OpenWRT-пакета
android/                                             Android-приложение
bot/                                                 адаптеры Telegram/VK-бота, экспериментальный MAX
docs/                                                продуктовая и техническая документация
install.sh                                           установщик для роутера
update.sh                                            обновление с роутера
uninstall.sh                                         удаление с роутера с сохранением настроек
```

## Статус

Репозиторий содержит экспериментальную, а не стабильную версию. LuCI и backend роутера уже реализуют управление доступом устройств, расписания, защищённое Android-сопряжение, списки сайтов и базовое управление через Telegram. До стабильного выпуска ещё нужны описанная в документации живая матрица OpenWrt и интеграций, проверки на физических Android-телефонах и основной ключ подписи владельца проекта.

См. также:

- [Текущий статус реализации](docs/current-implementation-status.md)
- [Актуальный план дальнейшей разработки](docs/project-development-roadmap.ru.md)
- [Product requirements](docs/product-requirements.md)
- [Прямое задание для ИИ-разработчика](docs/developer-task.ru.md)
- [Справочник ошибок и их исправления](docs/troubleshooting.ru.md)
- [Подробный реестр ошибок и причин решений](docs/bug-register.ru.md)
- [Аудит r306: точный поиск Drive и кэш папок](docs/audit-fixes-r306.ru.md)
- [Аудит r308: учёт облачной квоты и безопасный отказ очистки](docs/audit-fixes-r308.ru.md)
- [Аудит r310: достоверный список облачных копий](docs/audit-fixes-r310.ru.md)
- [Аудит r309: скачивание без потери прежнего файла](docs/audit-fixes-r309.ru.md)
- [Аудит r307: контекст папок Drive и смена настроек во время загрузки](docs/audit-fixes-r307.ru.md)
- [Аудит r305: OAuth и кэш токена](docs/audit-fixes-r305.ru.md)
- [API между Android-приложением и OpenWRT](docs/android-openwrt-api.ru.md)
- [ИИ-помощник для родителей](docs/ai-assistant.ru.md)
- [Передача контекста ИИ-помощнику](docs/ai-context-sharing.ru.md)
- [Черновик промпта ИИ-помощника](docs/ai-assistant-prompt-for-support-parent/v1/ai-assistant-prompt.ru.md)
- [Возрастные сценарии контроля](docs/age-scenarios.ru.md)
- [Расписания доступа](docs/schedules.ru.md)
- [Профили стран](docs/country-profiles.ru.md)
- [Планирование доступа к аварийно-полезным сайтам](docs/domain-allowlist.ru.md)
- [Паспорт устройства, мониторинг и управление](docs/device-passport-and-control.ru.md)
- [Автоопределение устройств](docs/device-detection.ru.md)
- [Integrations](docs/integrations.md)
- [Локализация](docs/localization.ru.md)
- [Сообщения и уведомления](docs/messaging.ru.md)
- [Кэш браузера LuCI и версионирование ассетов](docs/luci-cache.ru.md)
- [GitHub and installer plan](docs/github-install-setup.md)
- [Security model](docs/security.md)
- [Пользовательское соглашение](docs/user-agreement.ru.md)
- [Политика приватности](docs/privacy.ru.md)
- [Donation](docs/donation.md)
- [Сравнение роутеров с поддержкой OpenWRT](https://hattabbi4.github.io/openwrt-router-compare/)
- [Какой роутер для OpenWrt купить в 2025 году?](https://itdog.info/kakoj-router-dlya-openwrt-kupit-v-2025-godu/)

## Поддержать проект

Если Sheepfold окажется полезным и вы захотите поддержать разработку, см. [Donation](docs/donation.md).

## Лицензия

MIT License.

[Локальные исправления r296 и регрессионные проверки](docs/audit-fixes-r296.ru.md).
