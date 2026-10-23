# Agent Guidelines

These rules apply to the whole repository.

Before interpreting iterative owner feedback or writing a completion message, read `docs/owner-communication-profile.ru.md` (§usrcomm). It records project-specific terminology and communication preferences without replacing explicit newer instructions.

## Project Naming

- Use `Sheepfold` as the main project and product name in English and Russian text.
- Use `Sheepfold` as the public Android app name too.
- In LuCI Russian UI headings, keep the product word in English: `Sheepfold`.
- Do not use `Овчарня` in public product text unless the owner explicitly asks to discuss the old/internal name.
- Sheepfold builds two router packages from one shared source tree: `Sheepfold` and `Sheepfold - AI Support`, plus one parent APK and one child APK shared by both packages. Android product flavors for AI are forbidden. The APKs contain the small AI client but hide every AI-related screen until the connected router returns the positive server capability described in `docs/product-variants.ru.md` (§prodvar).
- Standard Sheepfold router packages must not ship AI backend, AI prompts, provider-key settings, AI LuCI UI, or detailed per-device activity collection. The ordinary administrative/system event journal remains part of both editions in either OpenWrt package format. Never infer Android AI availability locally: missing/invalid capability means disabled.

Correct examples:

- `Sheepfold — система семейного управления доступом...`
- `Android-приложение: Sheepfold`
- `LuCI RU: Sheepfold : контроль доступа в интернет для семьи`

Avoid:

- `Овчарня — система...`
- `Если Овчарня окажется полезной...`
- `Android-приложение Овчарня`
- `Овчарня : контроль доступа в интернет для семьи` in the LuCI header

## User-Facing Wording

- Prefer clear router-based wording over internal-only LuCI wording.
- In Russian, write `через OpenWRT-роутер и его веб-интерфейс LuCI` instead of only `через LuCI`.
- Keep README files approachable for non-developers.
- Keep user-facing strings localizable. Do not hardcode menu labels, validation messages, or bot replies when a localization resource should be used.
- Treat LuCI `.po` catalogs as the source of truth for client-side translation JSON and regenerate JSON only with `python scripts/po2json.py <input.po> <output.json>`. Never round-trip `sheepfold/i18n/*.json` through Windows PowerShell 5 `ConvertFrom-Json` / `ConvertTo-Json`: its case-insensitive property handling collapses valid distinct keys such as `Clear log` and `clear log`.
- Always qualify list terminology when ambiguity is possible: `device allowlist`, `device blocklist`, `site allowlist`, `site blocklist`, or `emergency-useful sites`. In Russian, write `белый список устройств`, `чёрный список устройств`, `белый список сайтов`, or `чёрный список сайтов`; do not say only `чёрный список` when either devices or domains could be meant. The device blocklist always denies LuCI, SSH, and router API access even when a public-domain exception is enabled (§usrcomm, §84azytj).
- Emergency-useful sites are persisted as `emergency_site` UCI sections and applied through Sheepfold-owned DNS/nftables state. Match only web ports, return into the normal OpenWRT/Podkop chain, and never describe IP-backed domain matching as perfect isolation because shared CDN addresses and extra service domains exist (§emerg1).
- In Sheepfold LuCI settings, all setting changes must be saved only after the parent presses the explicit `Save` / `Сохранить` button. Do not autosave settings on field blur, select change, checkbox change, or radio change. The settings page must show this save action at least twice: at the top right of the settings panel and again at the bottom after the settings content. Internally, Sheepfold may still perform OpenWRT `save`/`apply`, service restart, cron update, or backend wrapper calls, but the parent-facing model is one deliberate save action.
- Do not expose separate `Apply` and `Save` actions unless OpenWRT internals force it; if both exist technically, hide or merge `Apply` in the Sheepfold UI so parents are not asked to understand the distinction.
- After Sheepfold changes UCI from LuCI actions, the implementation must also apply/accept LuCI's own pending-change queue so the standard LuCI banner like "Unsaved changes" / `Не принятые изменения` does not remain visible. Prefer a shared helper that saves configs and then uses the LuCI changes API when available, with an OpenWRT `uci apply` fallback.
- In Sheepfold LuCI, keep `All devices`, `Allowlist`, and `Blocklist` as nested tabs inside the top-level `User lists` / `Списки пользователей` tab. `All devices` must be the default nested tab.
- Design the interface for a normal busy parent, not for a network engineer. Reuse the same visual pattern, wording, icon meaning, button placement, and confirmation style for the same action everywhere, so the parent can recognize behavior quickly without studying every screen.
- Sheepfold UI must actively strive to be intuitive for a weak/uncertain PC user. Instructions, warnings, errors, confirmations, and notifications must be written in plain user language: what happened, why it matters, what will happen after the button press, and how to undo or fix it.
- If a feature appears in LuCI, Android, and bot/messenger flows, keep the user-facing names and mental model aligned across all of them unless the platform truly requires different wording.
- Parent Android panel entry and manual refresh must load only that panel's required data through `RouterPanelLoader`; do not restore an all-panels refresh on the control screen. Keep background notifications independent, discard cancelled/late reads, and preserve command read-back before re-enabling controls. See `docs/android-config.ru.md` (§andpanel1).
- For every non-obvious feature, setting, status, or risky action, add contextual help opened by a visible `?` button or equivalent help icon. Keep the screen itself clean, but provide a short step-by-step explanation like the Telegram setup guide. See `docs/contextual-help.ru.md`.

## Coding Style

- Use camelCase for JavaScript/Kotlin variables, functions, object fields, and UI state names whenever the surrounding platform does not require another convention.
- Use camelCase for test filenames, internal test identifiers, and test-category keys. Keep human-readable `describe()` and `it()` titles as natural phrases.
- Variable names must tell a human reviewer what the value contains. For new project-owned local variables and private fields, treat 15 characters as a practical guideline rather than a hard limit. A clear longer name is better than a cryptic abbreviation or a refactor performed only to shorten the name. External contracts, generated names, constants, and platform-required identifiers are exempt (§pm3kq7r).
- Keep OpenWRT/UCI/package keys in their native format, usually snake_case or uppercase Make variables, for example `app_port`, `ui_asset_version`, `PKG_RELEASE`, and `SHEEPFOLD_UI_ASSET_VERSION`.
- Do not convert external API fields, UCI options, package metadata, Android resource names, or documented protocol keys to camelCase unless the external contract itself uses camelCase.
- When fixing non-obvious code in this repository, leave short Russian comments explaining why the fix is needed and why this approach is used. Do not comment obvious assignments or noise.
- When a subtle implementation choice is intentionally correct, add a short Russian comment near that code so future agents do not "simplify" it away.
- Project-owned icons use the unique English `camelCase` names and geometry in `icons/catalog.json`. Do not add inline SVG paths, CSS-drawn copies, or font symbols such as `⚙`, `×`, and `↻` to LuCI/Kotlin screens. Run `npm run icons:generate` and `npm run icons:check`; see `docs/icon-catalog.ru.md` (§iconcat1).
- Store useful but non-canonical companion material in `utilities/` only when its README explains why it is preserved and what must be adapted. Do not place secrets, build artifacts, required scripts, product contracts, or unlabelled temporary files there. Promote accepted decisions to `docs/`/ADR and required helpers to `scripts/` or `tools/` (§utils1).

## README Layout

- Keep installation, update, and uninstall instructions near the top of both `README.md` and `README.ru.md`, before long product explanations.
- Keep the English and Russian README files structurally similar where practical.
- Keep `install.sh`, `update.sh`, and `uninstall.sh` suitable for running directly on an OpenWRT router.
- Test `.ipk` packages must follow OpenWrt `ipkg-build` style: a gzip-compressed tar archive containing `debian-binary`, `data.tar.gz`, and `control.tar.gz`; do not publish ad-hoc `ar` archives for OpenWrt test packages.
- Ordinary `.ipk`/`.apk` builds stay in repository-local build directories. On the owner's current Windows computer, explicitly requested user-facing artifacts go to `C:\Users\User\Documents\pesochnica`, never to `Downloads`; routine verification must not overwrite or accumulate files there. Do not commit generated package artifacts.
- Before adding a new user-facing APK/IPK to `C:\Users\User\Documents\pesochnica`, remove older versions of the same artifact family (`sheepfold-parent`, `sheepfold-child`, Standard router package, or AI Support router package). Never remove unrelated files from that directory.
- The test IPK builder defaults to `.build/ipk-output`. Android uses each project's `app/build/outputs/apk`. For an explicit export on this computer, set `SHEEPFOLD_APK_OUTPUT_DIR=C:\Users\User\Documents\pesochnica` or pass that directory through `--out-dir`.
- The uninstall command must remove the package without clearing Sheepfold client lists or user settings, then print a report of remaining router settings that may require manual cleanup.
- When changing installation, update, or uninstall commands, update both README files and `docs/github-install-setup.md` if relevant.

## Router Connectivity, DNS, Time, And NTP

- Connectivity checks must be country-aware and configurable. Do not depend only on foreign IPs/domains such as `1.1.1.1`, `8.8.8.8`, `google.com`, or Cloudflare/Google endpoints to decide whether the router has internet.
- For the Russia country profile, prefer Russian or Russia-relevant targets for default ping/DNS/HTTP diagnostics. DNS probes should prefer domains such as `ya.ru`, `gosuslugi.ru`, and `ntp1.vniiftri.ru`; fallback foreign targets may exist only as secondary configurable fallback checks.
- ICMP ping alone is not enough because many hosts block it. Use a small ordered diagnostic chain: WAN link/ubus state, default route/gateway, DNS resolution of country-profile domains, and then lightweight HTTP(S) checks where needed.
- Sheepfold automatic setup must include router time setup. Add/keep settings for making the router an NTP server for the LAN, configuring the router NTP client, and choosing the router timezone.
- Default NTP client servers for the Russia-oriented profile: `ntp1.vniiftri.ru`, `ntp2.ntp-servers.net`, `3.openwrt.pool.ntp.org`.
- Router timezone must be changed to the most suitable value during installation/automatic setup. For Russia without a more specific region selection, use Moscow time (`Europe/Moscow`, POSIX `MSK-3`) as the default.
- Because NTP/timezone changes touch OpenWRT system settings, preserve previous values in export/reporting where practical and show the setting clearly in LuCI.
- The LuCI `Information` settings tab and Android `/cgi-bin/sheepfold-api/router-info` diagnostics snapshot may include router health and integration metadata, but must not include Wi-Fi passwords, bot/API tokens, session cookies, child names, client MAC addresses, client device lists, or logs. Android must show a preview and ask for explicit parent confirmation before sending this diagnostics snapshot to an AI provider.

## Operational Gotchas And Documentation

- Non-obvious product, installer, router, LuCI, i18n, grouping, or environment findings must be maintained in focused docs in the same change session — not only left in code comments or chat.
- Use `docs/agent-gotchas.ru.md` as the index: **add** new one-line entries, **update** wording when behavior changes, and **remove** entries when the trap is fixed or the setting becomes visible in UI.
- Put full explanations in the topic doc (for example `docs/localization.ru.md`, `docs/hidden-settings.ru.md`, `docs/device-detection.ru.md`).
- Programming-style rules, deprecations, LuCI view patterns, and review checklists belong in `CODING_RULES.md`, not in product docs.
- Architecture-changing work must start with `docs/architecture/decisions/README.ru.md`. ADRs record why a stable choice was made; focused documents still own the detailed current behavior. Supersede an accepted ADR with a new numbered ADR instead of silently rewriting its history, and keep related § tags and regression tests synchronized (§adrproc).
- Do not dump long technical gotchas into README files; keep README user-facing.
- If no suitable focused doc exists, create one under `docs/` and link it from `docs/developer-task.ru.md` and `docs/agent-gotchas.ru.md`.
- For new pages, substantial documentation restructuring, and documentation review, use the project skill `.agents/skills/sheepfold-documentation/SKILL.md` and the canonical writing standard `docs/documentation-writing-standard.ru.md`. Keep technical truth and Sheepfold terminology above general editorial preferences (§docwrit).

## Implementation Entry Point

- In a fresh chat, read `docs/agent-fast-start.ru.md` first. It is the short route through the repository: gather evidence with targeted searches, read only the focused docs linked by relevant §-tags, and scale tests with the changed surface. Do not repeatedly read the whole documentation tree. (§fastagt)
- Before committing or merging any large cross-component worktree, first read `docs/merge-readiness-plan.ru.md`. It records the current evidence, unresolved release checks, reasons for every required check, and the recommended reading route for a fresh chat. Do not assume that a historical branch name still exists; confirm the real branch and worktree with Git first.
- On Windows, prefer the repository-managed environment scripts in `tools/windows/` and the checked-in Gradle Wrapper. Read `tools/README.ru.md`; do not commit downloaded SDKs, caches, JDKs, Node.js, Python, Git distributions, APKs, or IPKs.
- In a fresh Windows Codex chat, run the full toolchain setup command from `tools/README.ru.md` yourself when execution and network permissions are available. If the environment cannot install software or the user must approve licenses interactively, give the exact command to the user, explain that it must be run from the repository root in PowerShell, and then ask them to reopen the terminal/chat before continuing. Do not merely report that tools are missing without offering this path.
- Before running builds or tests in a fresh local Codex Desktop chat on the user's Windows PC, read `docs/agent-environment.ru.md`. It records the Windows/Codex tooling setup, required programs, common build commands, IPK/APK build notes, and the verification commands that have already worked for this repository. For Linux, WSL, macOS, or GitHub Actions, keep the intent but adapt paths and shell syntax.
- Read `docs/agent-gotchas.ru.md` when debugging surprising LuCI, i18n, default-group, detector, or test-IPK behavior so earlier traps are not rediscovered from scratch.
- Read `docs/troubleshooting.ru.md` when a command, build, test, installation, UCI save, LuCI page, Git operation, messenger, or updater fails. It is the symptom-to-fix handbook for agents and human developers. (§trouble)
- Future AI developers should start with `docs/developer-task.ru.md`, then read `docs/product-requirements.md` and the relevant focused docs.
- Work on AI-assistant memory, dialogue behavior, database design, or external AI integrations must start with `docs/ai-assistant-development/README.md`; put each new idea directly into the relevant focused document, and keep the folder's module map synchronized. If no focused document fits, create one and link it from the folder README. (§aiarch1)
- Before sending AI data to any provider or compute worker, perform deterministic secret removal, identifier pseudonymization, minimization, and any required user preview on the router. A post-send auditor cannot repair a disclosure. Do not call pseudonymized data anonymous (§aimask1).
- External AI compute is optional and must not participate in firewall or access-control decisions. Prefer a user-controlled LAN worker first; never send it the alias reverse map, provider keys, UCI, raw logs, or router credentials, and treat every result as untrusted input (§aiexec1).
- Dynamic JSON in the router AI boundary must be built with OpenWrt `jshn` through the shared AI-only `sheepfold-lib-json`. Decode every project-owned `application/x-www-form-urlencoded` boundary through the shared `sheepfold-lib-form`, reject malformed `%XX` and NUL, and do not recreate local `sed`/`printf` decoders or provider payload templates (§jsonio1).
- Do not implement fastText token classification as if it were sequence BIO NER. Any NER design must demonstrate sentence-context behavior, target-router benchmarks, architecture-specific packaging impact, and leak/false-positive tests before it becomes a privacy boundary (§aimask1).
- Regional AI risk hints must be versioned, sourced, scoped, and phrased as possible barriers to help-seeking, never as traits of every resident. A country/city, sex, age, or religion cannot by itself create a personal risk fact (§aireg01).
- In injury, loss, sexual-health, violence, poisoning, or substance-risk scenarios, AI guidance prioritizes safety and appropriate help before discipline. Do not recommend punishment for disclosing harm or asking for help; separate the later teaching conversation from the act of disclosure (§aireg01).
- Treat caregiver emotional regulation as a central AI-assistant goal. Acknowledge fear, anger, guilt, helplessness, or overload without excusing harm; help the adult pause, protect the child, teach the intended skill later, and repair the relationship after a lapse (§aicare1).
- Do not shame an inexperienced caregiver as the first intervention, but do not soften physical violence into "strict parenting". Understanding the motive is for prevention and change, not removal of responsibility (§aicare1).
- Treat the child AI as a future trusted safety entry point, not merely a status chatbot. Natural attachment may arise and must not be shamed or met with withdrawal of support. The AI identifies itself honestly, remains warm, avoids deliberately engineering exclusivity or retention, and gently broadens the child's safe real-world support when context makes that useful (§aichild).
- Never auto-forward a child's sensitive disclosure merely because a user has the parent/admin role. The parent may be the source of danger. In a validated immediate threat, the safety router may send the minimum necessary alert only inside the approved family/trusted-adult circle when that recipient is safe and able to help. Sheepfold itself never contacts a state body or emergency service; it may only advise a person to call or write (§aichild, §aigov0).
- Use risk-proportionate, transparent persistence for serious avoided topics. Accept ordinary refusal; for serious risk explain the concern, offer a minimal step, and limit reminders; for a concrete immediate threat give concise safety guidance. Never shame, manipulate, or repeat warnings without a new reason (§aiescal).
- A human psychologist/consultant behind an external service is a separate data recipient. Require explicit preview/consent, verified role and qualifications, minimal masked context, retention/deletion terms, and a clear distinction between family consultation and consultation used only to improve an AI response (§aiescal, §aimask1).
- Human-consultant consent must be an explicit case-scoped question with an unchecked acknowledgement. LLM consent, terms acceptance, silence, closing the dialog, or a previous consultant request never authorizes a new human recipient, purpose, or additional data (§aiescal).
- Sheepfold AI must never contact police, child-protection, courts, emergency dispatch, or another state body and must never transmit family data to them. This is a product invariant, not a consent option or a future safety-router branch. The assistant may show a verified contact, prepare words for the user, or open a dialer/message composer only when the final call/send remains a direct human action; never attach a transcript or send automatically (§ailegal, §aichild, §aigov0).
- Do not turn the product invariant above into a false promise about an external LLM provider. A provider processes submitted text under its own terms and may face legally binding requests. The strictest future mode requires a local model/worker so the conversation does not leave user-controlled equipment (§aigov0, §aiexec1, §aimask1).
- Distinguish immediate danger, serious criminal/legal jeopardy, and a low-level non-violent wrong. Immediate danger uses the safety router; serious legal jeopardy routes first to a safe adult and qualified local legal help; a low-level wrong uses a context-aware restorative conversation. Do not automatically equate a country's general risk with the outcome of an individual case (§ailegal, §aireg01).
- Never help conceal ongoing violence or other continuing serious harm, destroy evidence, fabricate an alibi, intimidate a witness, or evade an active rescue response. This boundary does not authorize automatic state reporting or moralizing about every minor offence (§ailegal).
- A recommendation to contact a service must name what kind of recipient it is, what it can actually do in the selected country, what the person may disclose, and whether contact can create additional risk. Do not build a state-service API, automated call, automatic report, or transcript transfer. A convenience action may only leave the final call/message initiation and content under direct human control (§ailegal, §aigov0).
- Religion may be a source of identity, continuity, duty, mutual aid, and moral language for a family or community. The AI may use the family's own commandments and traditions when invited, but it must not deliberately intensify fear, invent God's will, claim spiritual authority, or promise a specific afterlife punishment (§airel01).
- Keep the universal ethical goal visible across AI prompts: help the family care for themselves and one another, respect each person's dignity, govern their desires, and repair harm they caused. A religious family may express this through its own commandments; Sheepfold must not claim a religion of its own (§airel01, §aidlg01).
- Do not threaten a child with vague "legal consequences". Explain only verified, proportionate, situation-specific possible consequences when they are genuinely relevant, clearly mark uncertainty, and keep explanation separate from intimidation or demands for confession (§ailegal).
- Do not reduce a family's contempt or principled rejection of law-enforcement bodies to fear, a confession, or a request for political/moral re-education. In non-critical situations, ask neutrally and prefer safe non-state help. In an immediate life-threatening situation, clearly present the fastest realistic options available to the person, including an appropriate emergency service, while preserving the absolute rule that Sheepfold never contacts it. Do not validate threats, violence, revenge, evidence destruction, or witness intimidation (§ailegal, §aigov0).
- For broad feature work, future AI developers must also read `docs/agent-playbook.ru.md`; it is the detailed implementation playbook that captures product decisions from the planning discussion.
- Keep `docs/developer-task.ru.md` updated when project-level decisions change.
- Do not replace the focused docs with the developer task; it is an entrypoint and summary, not the source of every detail.

## Repository Tool Conventions

<!-- §toolwin -->

- Use `rg` / `rg --files` as the default repository search tool. Do not recursively dump the whole tree or read every document when a focused search and §-tag can locate the relevant contract.
- Use 7-Zip only to inspect or manually extract archives, APKs, and IPKs. Never use 7-Zip to build a Sheepfold `.ipk`; on Windows use `python scripts/build-test-ipk.py`, which preserves the OpenWrt gzip-tar layout and Unix modes.
- Treat `.github/workflows/build-openwrt-packages.yml` as the canonical public package builder: OpenWrt 24.10 produces IPK and 25.12 produces a real apk-tools v3 package through the pinned official OpenWrt SDK Action. `scripts/build-test-ipk.py` is a fast test fixture, not a release builder; never obtain an OpenWrt APK by renaming or repacking an IPK (§owrtci1).
- Keep Standard and AI Support preparation centralized in `scripts/sheepfold_variants.py`. Any change to variant markers, AI-only paths, release prefixes, or internal package identity must update both SDK-feed and archive-level tests before release (§prodvar, §owrtci1).
- Use `node --test <target>` while developing, then run only the relevant overlapping categories from `docs/test-strategy.ru.md` (§testcat). Use `npm.cmd run test:list` to discover categories and `npm.cmd run test:category -- luci devices` to combine them without duplicate files. Do not run tests for subsystems outside the proven change impact merely because code will be pushed or merged. Run full `npm.cmd test` only when impact cannot be bounded, a genuinely cross-cutting API/UCI/package/security or test-runner contract changes, a release gate explicitly requires it, or the owner requests it. In PowerShell prefer `npm.cmd` over `npm` if execution policy blocks `npm.ps1`.
- For a defect, follow `docs/debugging-and-verification.ru.md`: reproduce, trace the value across UI/API/UCI/runtime boundaries, test one root-cause hypothesis, add the lowest useful regression test, and rerun fresh verification before claiming completion (§debug01). A toast, static source assertion, screenshot, or stale successful run proves only its own layer.
- Before finishing a cross-layer change, run `npm.cmd run review:impact` or pass the edited paths to `scripts/inspectChangeImpact.mjs`; review every reported neighboring boundary and explain any deliberately skipped category (§impact1). The advisor is conservative guidance, not a replacement for engineering judgment or full CI.
- Before changing a shared or cross-layer contract, read [the mandatory companion-change matrix](docs/mandatory-companion-changes.ru.md) and apply every matching row (§cmpchg1). If a listed companion change is intentionally unnecessary, record the reason in the task result. When a new stable dependency appears, update the matrix, the tag map and, where the dependency is detectable from paths, the change-impact rules and their tests.
- Use `npm.cmd run quality:plan` before choosing checks and `quality:changed` before pushing executable changes (§qassist). `quality:gate` is the explicit full-suite path for the cross-cutting/release cases above, not the default pre-push ritual. Read `docs/quality-assistants/README.ru.md` before changing the map or runner. Never hide an unknown path, `partial` result, or `pendingManualChecks`; classify or report it.
- Use the all-pairs runtime matrix only to reduce routine configuration combinations. Security invariants, migrations, package installation, DNS/firewall behavior, and live hardware scenarios remain explicit tests even when pair coverage is green (§pairmat).
- Treat VVAH as a manual advisory audit, never as a CI dependency or automatic fixer. Run the checked-in wrapper on a clean commit, inspect `doctor` and `estimate` first, and pass both consent flags only after confirming the LLM endpoint may receive the tracked source. A finding remains unconfirmed until root-cause reproduction, a deterministic regression test and the applicable build/live checks (§secaudit1).
- Every new `tests/*.test.mjs` file must be assigned in `tests/categories.mjs`. Keep `tests/testCategories.test.mjs` green; do not place an IPK-building or long network test into `smoke`.
- Use the checked-in `android\gradlew.bat` and `android-child\gradlew.bat`; do not require or invoke a global Gradle installation.
- In the child APK, periodic or boot-triggered network work belongs to a unique WorkManager job with a network constraint. Keep AlarmManager only for a known user-visible deadline such as access ending; a receiver must not start its own unowned network coroutine (§andwork1).
- Use Git Bash for shell syntax/behavior checks, `gh` for GitHub Actions and PR evidence, and the documented `tools/router-testing/` harness for approved live-router checks (§routerharness). After one-time SSH/DPAPI setup, prefer `npm.cmd run router:readOnly`, `router:fullSafe` and `router:frontend` over scattered manual `ssh`/`scp` commands. Do not install duplicate replacements unless a task demonstrates a missing capability.
- Keep the LuCI endpoint and the Sheepfold application API separate in every test profile. On the owner's current test router LuCI is `http://<router-ip>:80/cgi-bin/luci/...`, while the Android/pairing API is `https://<router-ip>:5201`; never infer the LuCI scheme or port from the protected API endpoint (§routerharness).
- On the owner's current Windows computer, set `SHEEPFOLD_SCRIPT_SCRATCH_ROOT=C:\Users\User\Documents\pesochnica` before long project scripts and point process-local `TEMP`/`TMP` to its `sheepfold-temp` child when a tool supports it. Keep Git and source files in the repository; the scratch directory is only for generated scripts, private reports, caches and explicitly requested artifacts. Kaspersky Endpoint Security may quarantine a live-router PowerShell harness as `PDM:Trojan.Win32.Generic` after it combines backup, SSH/SCP and package installation. Run only a reviewed copy from `C:\Users\User\Documents\pesochnica\sheepfold-router-harness\tools\router-testing`, but do not assume that this path prevents quarantine: it protects the Git source, not the process. If Kaspersky still terminates the copy, do not obfuscate the script or disable protection; use a user-approved antivirus exclusion or the documented short SSH/SCP fallback with the same backup and SHA-256 checks (§routerharness, §toolwin, §winsbx1).
- Every new or meaningfully changed test file and test helper script must begin with a concise purpose note (§testwhy): what behavior or risk it verifies, why this level/technique is appropriate, what state it may change and restore, and what a passing result does not prove. Explain the test design rather than narrating code. Bring a touched legacy test into compliance; migrate untouched files gradually instead of creating an unrelated repository-wide comment-only diff.
- Treat test and operations documentation as durable engineering memory (§docops1). For every executable test, script or network workflow, document the working directory, prerequisites, exact command, expected exit code and visible result, changed and restored state, common errors, invocations that are known to fail or must not be used, and what a successful run does not prove. The goal is to let the next developer or agent reproduce the check without rediscovering the environment and its failure modes.
- The Android runtime lab is manual and hybrid (§andlab1). Do not add `androidLab:*` to ordinary `npm test`, `quality:changed`, or an always-on CI job. Use API 35 smoke only for direct Android work, API 28/35 full before APK delivery/release, and a dedicated physical phone plus the live router for QR, Wi-Fi/private MAC, SIM, TLS, notifications, widgets, biometrics, or OEM background behavior. A green emulator run never closes those manual checks.
- LuCI reviews follow `docs/ui-review-contract.ru.md`: visible commands need an accessible name, interactive elements need a real hit area, mobile/desktop must not overflow, and success is shown only after backend confirmation (§uxrev01). API changes follow `docs/api-contracts.ru.md` and preserve structured error codes, safe defaults, idempotency boundaries, and old-client behavior (§apicon1).
- Run `npm.cmd run lint:js` after LuCI/Node changes and `npm.cmd run lint:android` after Kotlin, Android manifest, or Android resource changes (§lint1). The ESLint config intentionally models LuCI injected globals and its top-level return; do not replace it with a generic browser preset. Do not add an Android lint baseline merely to hide existing errors.
- The canonical Windows installer and readiness check are `tools\windows\setup.ps1` and `tools\windows\check.ps1`. Update their manifest, tests, documentation, and `§toolwin` references together when the tool contract changes.

## Agent Playbook

- `docs/agent-playbook.ru.md` is the detailed repository-wide task brief for AI agents.
- Keep it synchronized with `AGENTS.md`, `docs/product-requirements.md`, and `docs/developer-task.ru.md` whenever core product decisions change.
- If an agent is unsure whether to add a feature, prefer the stricter/smaller interpretation until the project owner explicitly expands scope.
- Never implement a convenience feature that weakens privacy, opens entertainment/marketplace access by default, bypasses the blocklist outside the owner-approved `No restrictions` internet exception, adds hidden child-device behavior, or introduces permanent full remote router management. The only approved tunnel exception is the explicit temporary technical-support session in `§rsup001`.

## Emergency-Useful Sites

- The user-facing feature name is:
  - RU: `Доступ к аварийно-полезным сайтам`
  - EN: `Access to emergency-useful sites`
- Do not call this feature `белый список доменов` in user-facing Russian UI copy.
- Use one editable domain list, not built-in presets. AdGuard Home already has filtering presets; Sheepfold should not duplicate them.
- Every automatically suggested site entry must include:
  - domain;
  - user-visible display name;
  - short explanation of why the site may be needed;
  - optional warning;
  - source, for example `starter`, `manual`, `imported`, or `integration`.
- Emergency-useful sites are for restricted access: enough for necessary services, not enough for normal entertainment browsing.
- Emergency-useful sites may be allowed for blocklisted devices only through a separate explicit setting. This must not grant access to LuCI, SSH, or Sheepfold API.
- Do not add marketplaces, shopping services, super-app storefronts, food delivery catalogs, entertainment catalogs, app stores, or broad "everything" portals to default, starter, auto-generated, auto-imported, or "safe minimum" emergency-useful sites lists.

## Yandex Domains

- Do not add broad `yandex.ru` to any default, starter, auto-generated, auto-imported, or "safe minimum" emergency-useful sites list.
- Do not silently include broad Yandex domains when creating examples, onboarding defaults, first-run suggestions, import templates, generated configs, tests, fixtures, or screenshots.
- If Yandex search is needed by default, prefer `ya.ru`.
- If maps are needed by default, prefer `2gis.ru`.
- Add broad Yandex domains only when the parent/admin explicitly adds them manually or selects an advanced option with a clear warning.
- Always explain the reason: broad Yandex domains can open much more than maps or search, including video, music, games, feeds, entertainment pages, and other Yandex services. Yandex Maps may require shared Yandex/static domains, so narrow allowance can be difficult.
- Yandex Go, Yandex Taxi, Yandex Market, Yandex Food, Yandex Lavka, Yandex Delivery, and similar Yandex super-app surfaces must not be added to default emergency-useful site lists. They may be offered only as manually enabled transport/taxi suggestions with a clear warning that Yandex Go can also expose marketplace, food, delivery, carsharing, scooter, and other non-emergency services.

## Site Lists And AdGuard Home

- Sheepfold owns the selected site-list sources and policy. The policy may be executed by the built-in dnsmasq/nftables backend or by the single Sheepfold-managed AdGuard Home URL filter (§dompol).
- If AdGuard Home is detected, recommend `site_filter_backend=auto`, explain the effective executor in LuCI, and show a verified status. An API failure must use the built-in fallback instead of displaying a false successful state.
- Never enable a second independent copy of the same site policy silently. Automatic management may add, refresh, enable, or disable only Sheepfold's owned filter; it must preserve every user-created AdGuard Home filter and custom rule.
- Keep device access control in Sheepfold; do not move Sheepfold device allowlist/blocklist semantics into AdGuard Home. AdGuard Home receives only the generated domain policy scoped to router-observed clients.
- Do not silently expand the meaning of an already enabled `adguard_auto_manage=1`: it grants control only over Sheepfold's owned URL filter. Every future write to global protection, DNS, clients, DHCP, logs, TLS, rewrites, Safe Search, or blocked services needs its own explicit preview and confirmation. Read `docs/adguard-home-automatic-management-roadmap.ru.md` before extending this adapter (§aghplan).

## User Agreement And Privacy

- Keep the full Russian user agreement in `docs/user-agreement.ru.md`.
- Keep `docs/user-agreement.md` as the English routing/summary document until a full English legal text is prepared.
- Keep the full Russian privacy policy in `docs/privacy.ru.md`.
- Keep `docs/privacy.md` as the English routing/summary document until a full English privacy policy is prepared.
- Android first setup must require a checkbox before use: `Я принимаю пользовательское соглашение и даю согласие на обработку персональных и технических данных, необходимых для работы Sheepfold.`
- OpenWRT installer must show a link to the full agreement and require explicit `yes`, `y`, or `да` input before applying installation or configuration changes.
- The OpenWRT installer must ask for application language before the agreement prompt. Use a simple console prompt: `Choose application language / Выберите язык приложения: Русский ru, English en`, with `ru` as the default.
- Immediately after language, ask for the router country profile (`ru`, `by`, or `cn`; preserve the current profile on update). Country-profile code may replace only entries marked `source=country_profile`; manually added or edited emergency-useful sites must survive country changes, and a deleted generated entry must stay excluded (§country1).
- The agreement must be visible before first use in LuCI/Android when practical.
- Do not claim that the agreement is final legal advice; production releases should be reviewed by a qualified lawyer.
- Sheepfold remains self-hosted for family management. Developer-operated cloud components require an explicit ADR and must stay optional. The approved exceptions are the isolated feedback channel in `§feedback`, the owner-initiated temporary support transport in `§rsup001`, and the disabled-by-default partially implemented family message relay in `§mrelay1`. Feedback never participates in router control and may send only user-entered fields plus a separately consented safe-field diagnostic report. Parent Android reports must follow `§srep001`: exact preview, Tink HPKE before the home router, ciphertext-only router API, signed envelope, server allowlist for recipient key IDs, and operator-only private key. LuCI remains a separately documented legacy migration until it has a reviewed HPKE primitive. A failed report endpoint may use only the fixed, strictly parsed and Ed25519-signed GitHub manifest from `§srepdisc1`; it may change only the HTTPS endpoint, never HPKE keys, credentials or family settings, and becomes persistent only after successful ciphertext delivery. Remote support follows its narrower security contract and is not a data-upload exception. The family message relay may carry only AES-GCM-authenticated end-to-end encrypted short messages for an already locally paired parent APK; it is not a proxy for the full Android API. Never send a raw UCI export, device identifiers/names, SSIDs, logs, browsing history, passwords, tokens, or API keys through feedback or unrelated cloud paths.
- The main Android app in `android/` is for parent/admin devices only. A separate child app in `android-child/` is allowed only as an explicitly installed status/helper client without administrative functions; never design hidden child-phone installation flows (§z5ck8mv).
- If app-store publication is added later, prepare store-specific privacy disclosures before release.
- Do not collect website visit history as part of the normal administrative log. If per-device site activity history is added later, it must be a separate opt-in feature, off by default, excluded for administrator devices and allowlisted devices, and documented in privacy/legal text. See `docs/site-activity-logs.ru.md`.

## Messaging

- Telegram and VK are both two-way chat/control channels.
- VK is the default first-run messenger choice.
- Keep `active` disabled until the parent/admin enters valid credentials and binds at least one approved administrator.
- MAX remains an experimental adapter, not a first-release requirement.
- A router can enable only one messenger adapter at a time: Telegram, VK, or experimental MAX.
- Do not design flows that require multiple messenger adapters to be active simultaneously on the same router.
- Messenger integrations must use the same Sheepfold API as LuCI and Android.
- Messenger access must be bound to explicitly approved parent/admin users configured on the router.
- On OpenWRT, prefer outbound HTTPS long polling for Telegram instead of webhooks, so the router does not need an inbound public HTTPS endpoint.
- If MAX is implemented, keep it clearly marked as experimental until current public MAX Bot API behavior is confirmed for router-side use.
- Administrative bot actions such as reboot, update, import, global block, and list changes must require explicit confirmation.

## Remote Access Scope

- Do not design, document, or promise permanent full Android/LuCI management through WireGuard, VPN tunnels, or any other general-purpose tunnel to the router.
- Full Android and LuCI management is local-network only.
- Remote management outside the home network is limited to short confirmed commands and notifications through the single configured messenger adapter or the separate optional family message relay in `§mrelay1`.
- The family message relay is local-first, parent-APK-only and disabled by default. Its strict protocol, synthetic-only server pilot behind DNS/TLS/Caddy and an unfinished unwired Android client foundation exist. Android public-attempt durability and request-bound local lookup have regression coverage; crypto/storage/discovery, unauthenticated API and paired reads passed on physical API 30 (8 tests, no skips, after QR-file pairing). Camera QR, API 28 and the complete relay field gate remain pending. The standalone Jansson/OpenSSL native helper passes Linux amd64 golden-vector/sanitizer tests, SDK 25.12.5/mediatek/filogic build and isolated target smoke under nobody. Package install/UID, other ABIs, poller, durable ledger/dispatcher and Android provisioning/UI/lifecycle remain absent or unverified. Read the continuation plan and helper README before extending this boundary. Keep `clientsReady=no`, `realDataAllowed=no`; no enrollment or real relay credentials/data have been used. It opens no inbound home port, never proxies LuCI/SSH/the full router API, never receives the local Android Bearer, and keeps working local Wi-Fi independent of server availability.
- Family message relay credentials, message keys, queue and service identity are separate from Telegram/VK/MAX, support reports and temporary support credentials. The same physical VPS does not permit key, UID, storage or protocol reuse.
- The only approved exception is a temporary owner-initiated technical-support session described by `docs/remote-support-access-plan.ru.md` and ADR-0022 (§rsup001). It is off by default, installs its module only after explicit enablement, exposes no WAN LuCI/SSH, routes no home subnet, uses a short-lived support key instead of the owner's root password, and must be immediately revocable.
- A 72-hour support code is only a waiting/claim window. The first authenticated claim by the single `Sheepfold Support` service account burns the code and starts a separate 24-hour administrative session. The code alone never authenticates support.
- ADR-0031 replaces the FRP/SSH part of ADR-0022: current support uses outbound HTTPS and Ed25519-signed typed messages; operator authentication uses mTLS plus TOTP. No FRP, reverse SSH, public LuCI, LAN routing or universal shell fallback. A random per-session relay port belongs only to the historical design: it is not a secret and never belongs in the spoken code. Read the current sections of `docs/remote-support-threat-model.ru.md` and `docs/remote-support-protocol.ru.md` (§rsup001).
- Treat `tools/remoteSupport/` as Node.js test-only code. `typedPayload.mjs`, `typed-*-message-v1.schema.json` and `runControlPeer.mjs` describe the current `sheepfold-support-control-1` source profile; `ControlClient`, experimental schemas and transport CSR/grant remain legacy models without fallback. Never ship Node reference code in LuCI/router packages. The owner deferred the installable OpenWrt support client on 2026-10-23: keep the UI inactive and do not interpret schema/loopback success as permission to build or enable it (§rsup001).
- The private `hayOfLife/sheepfold-support-server` repository owns the encrypted report queue, control-plane persistence, typed dispatcher, operator CLI and local Codex bridge. This public repository remains canonical for router-side protocol, consent, expiry/revoke and golden vectors. Read `docs/remote-support-server-integration.ru.md` and compare both `peer-project.json` manifests before changing the shared boundary; never add the private repository as a submodule (§rsuppeer).
- The Sheepfold support transport may bypass Podkop only for verified relay endpoints through Sheepfold-owned rules. Never rewrite Podkop configuration or create a broad direct-WAN bypass.
- Run the support client under a dedicated UID and match UID, verified relay endpoint and port together. Restore the narrow route through firewall4/netifd lifecycle hooks; do not couple it to client-list rebuilds.
- The future support manager owns explicit states, bounded poll/backoff/jitter and replay protection independently of one HTTPS connection; reconnect never extends the 24-hour access window. After reboot it must reenroll the same identity and obtain a fresh lease; old sequence, boot ID and approval must not survive. This manager is deferred, not implemented by the Node wire test (§rsup001).
- While support is active, network/firewall/DNS/Podkop changes require a rollback timer armed before mutation. Cancel rollback only after the relay confirms a new authenticated router heartbeat and restored support session; a local command exit code is insufficient (§rsup001).
- Do not add unrelated VPN setup helpers, WireGuard profiles, tunnel health checks, VPN-based Android onboarding, or a permanent support backdoor.

## Administrators And Roles

- Do not show an administrator role selector in the current MVP unless the project owner explicitly asks for roles again.
- If a future permission split is added, use `owner` and `admin`: `owner` can manage administrators; `admin` can manage family internet rules but must not remove the owner.
- Do not add hidden child/client roles or child-facing control interfaces with administrative power. The existing separate `android-child/` client may show only its own router-computed status and allowed child AI helper flows; it must not manage router rules (§z5ck8mv).
- Administrative logs should record who changed what, when, and with what result, without storing secrets.
- LuCI must include a separate `Administrators` tab.
- A default administrator account must exist after installation/first setup.
- Additional administrators must have unique display names, unique logins, and passwords stored as salted hashes.
- Bind administrator devices only from the `Administrators` tab through the `Link devices` / `Привязать устройства` action.
- Do not expose a `Make admin` action in the general device list.
- Blocklisted devices must not be available for administrator binding.
- When a device is bound to an administrator, remove ordinary group/schedule assignments and make sure the parent does not lock themselves out.
- Admin devices should show a special local icon inspired by FontAwesome `laptop-mobile`; do not hotlink FontAwesome or any external CDN asset from LuCI.
- Admin device rows must expose a `Pairing` / `Сопряжение` action that opens QR/manual Android setup.
- Pairing payloads must use short-lived one-time tokens scoped to one administrator and one device. Never include router root passwords, LuCI session cookies, bot tokens, AI keys, or unrelated secrets in QR codes.
- Test the QR renderer with the complete production payload, including the router address, configured port, administrator login, ten-character pairing code, and 64-character TLS SPKI fingerprint. A short sample QR does not prove that the administrator QR is visible or decodable (§qrcap1).
- One-time pairing token consumption must be enforced by the router backend, not by Android or LuCI frontend state. After successful pairing, the backend must mark the token/code as consumed and reject every later reuse.
- Administrator QR pairing intentionally has no second verification code. Keep the parent flow one-step, show a prominent warning not to share the QR, retain a short TTL/rate limit/SPKI pin, and document that the first successful phone receives the credential (§pairux1).
- Multi-router home access must follow `docs/home-network-access.ru.md`: never expose the shared `/www` listener, never open a generic WAN/CGNAT port, and never treat RFC1918 alone as trust. Isolate the API web root first, register explicit trusted segments, advertise only minimal endpoint candidates, and require SPKI validation. A simple port-forward helper does not solve client identity behind NAT (§homen01).
- Manual pairing codes must be generated by the router backend with a cryptographically secure random source. Use 10 random characters from safe lowercase `abcdefghkmnpqrstuvwxyz`, safe uppercase `ABCDEFGHKMNPQRSTUVWXYZ`, safe digits `2456789`, and safe special characters `+-*()[]{}<>?@#$%^&:;.,`, with no more than 3 special characters.
- Pairing tokens must be revocable and stored only as hashes or non-reusable secrets on the router.
- Pairing actions must be logged with masking.

## Android Pairing And Wi-Fi MAC

- The owner approved future credential-authenticated network profiles for one parent phone, but r324 main still has single-MAC bound tokens. The rules below describe that current limitation, not rejection of the agreed design. Record the pending work in `docs/home-network-access.ru.md`; never implement it by merely removing source checks or claim aliases already exist.

- Keep the two intentional Android build roots: `android/` for the parent/admin application and `android-child/` for the non-admin child application. Do not merge their permissions, credentials, or responsibilities.
- `android/app/` and `android-child/app/` are application modules inside those builds, not additional projects.
- Do not add root-level Gradle files for Android unless the project owner explicitly changes the repository layout.
- Use the checked-in wrappers, for example `android\gradlew.bat -p android :app:assembleDebug` and `android-child\gradlew.bat -p android-child :app:assembleDebug` on Windows.
- First Android setup should be initiated locally from LuCI by scanning an admin-device pairing QR code or entering manual settings.
- Android first setup screen order is: agreement, home local network connection, real Wi-Fi MAC check/guidance when applicable, router setup by QR/manual entry, then local app password/PIN.
- Android first setup must require Wi-Fi or wired Ethernet/local network access to the router. Do not allow continuing setup over cellular/mobile data.
- If the active network is wired Ethernet, skip Wi-Fi-specific randomized MAC instructions but warn that the router sees the Ethernet adapter MAC, not the phone Wi-Fi MAC.
- The OpenWRT backend must expose a Sheepfold-specific local discovery endpoint so Android can detect that the current Wi-Fi network contains a Sheepfold router before asking the parent to confirm the home network manually.
- The child Android app must also discover Sheepfold automatically from the default gateway of the active Wi-Fi/Ethernet network. Search for up to 30 seconds before showing a clear wrong-Wi-Fi hint and a manual router-address fallback; never make manual IP entry the normal first-run path.
- Discovery must not rely on a generic HTTP/LuCI response. It must verify a Sheepfold marker and return structured JSON with package/app marker, version, router name, and API base URL.
- Supported discovery endpoints should include `/cgi-bin/luci/admin/services/sheepfold/api/ping`, `/cgi-bin/luci/admin/sheepfold/api/ping`, or `/.well-known/sheepfold.json`.
- Manual settings shown next to QR must include router address/API URL, administrator login or identifier, pairing code/token, token lifetime, and Wi-Fi MAC guidance.
- Android must check whether the phone is visible to the router under the MAC address Sheepfold will manage.
- If randomized/private MAC is enabled for the home Wi-Fi, guide the parent to Android Wi-Fi network settings and explain why Sheepfold needs the real device MAC.
- Do not continue first pairing until the parent switches this Wi-Fi network to the real device MAC and Sheepfold can verify it from router-side data.
- Do not promise automatic disabling of randomized/private MAC on Android. Public APIs and manufacturer builds may prevent reliable automatic switching.

## Router Password Gate

- On first opening Sheepfold in LuCI, check whether the OpenWRT root password is set.
- If the root password is empty/not configured, do not allow Sheepfold settings to open.
- If password verification itself fails, fail closed and keep the settings blocked; never interpret an RPC/backend error as proof that a password exists (§rootgate).
- Show a clear warning and route the user to the OpenWRT password/administration page.
- Do not create default Sheepfold administrator passwords. First setup must force the owner to set their own password.

## Device Defaults

- Before changing device discovery, presence, classification, trusted identity, quarantine,
  automatic groups, device notifications, or their firewall effect, read
  `docs/device-passport-and-control.ru.md`. It is the canonical end-to-end contract; focused
  detector and research documents supplement it rather than replace it (§devpas1).
- New device behavior is configurable: `allow` by default, or `restrict_until_configured`.
- Global "Block internet" currently blocks every device except administrator devices, the device allowlist, and the protected `No restrictions` group. Do not describe a custom `access_priority` as active until status API and nftables share one implementation.
- Readable settings exports must never contain secrets. Full exports must use the versioned AES-GCM envelope, and imports must validate the complete payload before staging any UCI changes. Preserve `[secret]` only from the matching current section and never write that marker as a credential. Never export a live one-time pairing code, even inside the encrypted backup. Each router has a non-secret random `router_install_id`: same-router restore preserves trusted identity state, while a different or legacy source preserves permanent device IDs and family rules but clears router-bound HMAC identity/quarantine data and Android administrator bindings. Never export the local identity HMAC secret (§cfgbak1).
- Device groups should include children, parents, TVs/media devices, guests/custom groups, a special `No restrictions` / `Без ограничений` group, and a protected non-removable `Personal devices` / `Персональные устройства` group.
- The `No restrictions` group is a high-priority trusted service-device rule that bypasses the ordinary internet device blocklist, global shutdown, schedules, and new-device restrictions (owner decision 2026-09-07). Device-blocklist denial of LuCI/SSH/API and identity quarantine remain independent and must not be bypassed. Assigning a device to this protected group is security-sensitive and must be visible and confirmed.
- Strong device detection may suggest or confirm `No restrictions` for infrastructure devices such as NAS, Home Assistant, AdGuard Home, Proxmox, video recorders, and smart-home hubs.
- Smart speakers remain a recognized `speaker` type but must never receive `No restrictions` automatically; they are user-facing media/voice endpoints, not trusted infrastructure (§devpas1).
- Keep end smart-home devices as a separate device type `Smart home` / `Умный дом`: floor-heating controllers, kettles, irons, light relays/switches, smart sockets, automatic curtains, sensors, and similar household endpoints. Do not confuse them with smart-home hubs/servers.
- Full detection should combine several router-side signals such as DHCP/static lease data, hostname, vendor/OUI when available, open ports, service banners, mDNS/SSDP/UPnP/WS-Discovery names, and previously confirmed device fingerprints. Treat port/banner checks as confidence signals, not as cryptographic identity.
- Keep the classification fingerprint and the trusted identity baseline separate. The classification hash only decides whether type inference may need updating. Identity comparison may use a hashed UPnP/WS-Discovery UUID, UPnP serial, or mDNS serial as one strong family, or at least two independent weak families such as a non-MAC DHCP client ID and mDNS host. Never advertise either mechanism as cryptographic authentication (§detlife1).
- Keep at most three compact dated classification-evidence snapshots per device. Store only the short classification hash, type, confidence, evidence-family names and contradictions; never raw UUID, serial, MAC, IP or hostname. Rotate only when the classification fingerprint changes so diagnostics remain useful without causing routine flash writes (§detlife1).
- Treat HT/VHT/HE and current client rates from one bounded `hostapd.* get_clients` snapshot as weak type hints only. Never put Wi-Fi capabilities into the trusted identity baseline, count them as an independent evidence family, or use them to grant `No restrictions`. Keep raw rates in `/tmp`; persist only compact monotonic generation/speed classes so roaming and signal fluctuations do not cause flash churn (§detlife1).
- Persist identity components as versioned HMAC-SHA-256 values with a separate local secret, never with the classification hash's MD5 fallback. Preserve that secret across package updates and `sysupgrade`, exclude it from user exports, and migrate old baselines only after a positive legacy-format match (§detlife1).
- A matching strong identifier or two matching weak families may only create a parent-facing suggestion that a new MAC resembles an older device. Never auto-link MAC records or copy device allowlist/blocklist membership, administrator rights, groups, schedules, or temporary access; the parent assigns policy to the new numeric device ID (§devident1).
- Numeric device IDs are permanent audit references. Preserve every valid existing ID, allocate new IDs from a monotonically increasing counter, never reuse a deleted ID and never compact the sequence during an update. Gaps are expected and safer than changing the meaning of old logs, schedules or tokens (§deviceid2).
- If the same UUID is announced by two currently online MAC records, leave the lower numeric device ID unchanged and put only the newer record into the indefinite identity quarantine until the parent decides. Never infer that two interfaces are the same physical device or transfer policy automatically (§devident1, §detlife1).
- An explicit future `Merge with another record` action is all-or-nothing: one logical device owns every linked MAC, history and policy; the lower permanent numeric ID remains primary and every absorbed ID remains an unreused audit alias. Show policy conflicts before confirmation. Never copy pairing secrets; revoke administrator Bearer tokens and require fresh QR pairing after an administrator-device merge (§merge01).
- Treat UPnP `LOCATION` and WS-Discovery `XAddrs` as attacker-controlled input. A bounded UPnP description fetch may target only the exact numeric IPv4 sender currently present on LAN, over HTTP without DNS, userinfo, redirects or router-self access, with strict time/size/request-count limits. Never fetch WS-Discovery `XAddrs` or UPnP control/event URLs. UPnP remains a secondary self-reported signal and must never grant administrator, device-allowlist, or `No restrictions` rights by itself (§devident1, §detload).
- Do not add SNMP discovery to the standard product. It is commonly disabled, needs credentials/configuration, and does not justify another background scanner for the family-router use case (§devident1).
- Keep confirmed detector regression data in `tests/fixtures/deviceFingerprints.json`, stripped of real household MAC, IP, hostname, UUID, serial and account data. A fixture documents expected classification and auto-group safety; it is not a production fingerprint database (§devident1).
- Never claim that passive router traffic reveals a Google, Yandex, or other user account. TLS/QUIC may expose a destination service but not a reliable login/e-mail. Do not perform TLS MITM or turn account guesses into device identity; any future account link must use an explicit consented OAuth flow (§devident1).
- Pairing/Bearer tokens authenticate Android API commands; the trusted network baseline evaluates an ordinary LAN connection for firewall/device policy. Neither replaces the other (§devident1, §detlife1).
- Sheepfold must assume children may use unregistered or borrowed phones. Do not trust child-device apps, self-reported phone data, or Android-side state for enforcement. Child-device decisions must be based on router-side data and clearly marked confidence.
- If a parent manually sets a device type, stop further automatic type detection for that device. The router may still update IP/name/lease observations, but must not run type classification or overwrite the manual type.
- If automatic detection has identified a device type confidently, further automatic type detection may be skipped only after any pending safe auto-group decision has enough evidence. Do not freeze an infrastructure candidate merely because type confidence is high while `No restrictions` still lacks two independent evidence families (§agfix88).
- Confidently recognized phones, tablets, computers, TVs/media players, and smart watches may be assigned to `Personal devices` when automatic setup is enabled. This group is organizational only: it must not bypass blocklists, schedules, or global blocking (§persdev).
- Keep strong device detection in focused router-side backend modules, separate from LuCI rendering. The current distribution may ship those scripts in the same installable Sheepfold package; do not invent a second package unless package-size evidence and a migration plan justify it (§devpas1).
- The detector may use existing OpenWRT tools when available, such as `nmap`/`nmap-ssl` for bounded port evidence and `umdns` for local mDNS data. SSDP and WS-Discovery use LAN-bound `ucode-mod-socket` collectors; a WS-Discovery Probe is allowed only for a newly connected device while ordinary passes remain passive. Bounded UPnP description reading is full-mode only. Heavy helpers must remain optional/full-mode capabilities, not mandatory runtime work in reduced installations (§devpas1).
- Do not run heavy scans continuously. Use bounded local-network scans, cache results, explain detector confidence in UI, and let the parent correct the result.
- Detect offline-to-online transitions from current LAN ARP/neighbour, hostapd association, or a recent DHCP hotplug signal. A static lease or stale `/tmp/dhcp.leases` row alone is not an online event. Wait 20 seconds for complementary signals, process at most four connection events per service tick, run one startup pass, and run the fallback pass once per day. Every startup/daily/event pass must filter to devices confirmed online at that moment (§detlife1).
- Cache a full port scan per device for one day by default, clamp user-controlled `nmap` arguments, limit the default host timeout to 20 seconds, and prioritize the requested MAC during explicit reclassification. A daily control pass does not force daily `nmap` when the confident fingerprint is unchanged (§detload, §detlife1).
- Persistent device-blocklist members keep presence and denied-router-access logging, but receive no type classification, identity collection, port scan, or group assignment. Hide/reject manual reclassification until the parent removes the device from the device blocklist (§detlife1).
- If a known MAC presents a conflicting strong identity family or at least two conflicting weak families, apply a separate quarantine overlay before administrator, `No restrictions`, and device-allowlist rights. Automatic monitoring uses device-blocklist-level internet quarantine; manual monitoring uses restricted internet access. Both modes must deny LuCI, SSH and Sheepfold API until the parent decides. Never overwrite the original rights or trusted baseline automatically, so the original device regains its policy when its fingerprint returns (§detlife1).
- Missing mDNS/SSDP data or one weak mismatch is insufficient evidence of replacement. An active quarantine is cleared only by a positive strong/two-family match or the parent's explicit `Trust current connection` action. Roaming between 2.4/5 GHz or mesh access points does not trigger analysis while the MAC remains online (§detlife1).
- Hold a missing online signal for 90 seconds before declaring a real disconnect, so Wi-Fi sleep and roaming do not cause repeated analyses. Identity quarantine has no automatic expiry; remind at most once per day while unresolved and stop after the parent resolves it (§detlife1).
- The fixed whole-device order is: `No restrictions` → device blocklist → administrator devices → allowlist → global block → temporary access → device schedule → group schedule → default access. Emergency-useful domains are a separate narrow exception and never open LuCI, SSH, or Sheepfold API (§84azytj).
- Full automatic setup is the default because it is the useful path for most families. Reduced mode is for routers with very little free space or constrained resources.
- The OpenWRT installer must ask `Apply Sheepfold automatic setup?` / `Применить автонастройку программы?`. If the parent/admin presses Enter or answers `yes`, `y`, or `да`, set `auto_configure=1`, `detection_mode=full`, and `no_restrictions_auto_assign=1`.
- Full automatic setup may place confidently detected infrastructure devices into `No restrictions` automatically. The UI should still make this visible and explain why the device was trusted, so the parent can correct mistakes.
- If the parent/admin explicitly selects reduced mode with `no`, `n`, or `нет`, set or keep `auto_configure=1`, `detection_mode=reduced`, and `no_restrictions_auto_assign=1`. Reduced mode avoids heavy port checks but still may auto-assign confidently detected infrastructure devices to `No restrictions`.
- The General settings page must expose `Update check and installation` with values daily, weekly, monthly, and never. Default is weekly. Updates use stable releases only. The sole scheduled-install exception is explicit `beta_testing=1` consent in General: hourly newer-version checks through the existing updater, not branch artifacts or same-version reinstalls. Beta opt-in stages SIM/new-Wi-Fi notifications but must not enable location, activity logs, AI, support access or change family policy. Preserve separate notification choices afterwards; read `docs/maintenance-jobs.ru.md` and ADR-0028 (§betatest1).
- Offline known devices should be cleaned after a configurable number of inactive days; default is 90 days.
- Blocked-page placeholder text must be configurable by the parent/admin.
- Allowlist should support quick add mode: a parent opens a 30 second connection window, sees a Wi-Fi QR code and devices that connected after the window started, then explicitly presses `Add` / `Добавить` for each candidate.
- Quick add must collect candidates, not silently add every new device to the allowlist.
- A child APK may expose `Request 30 minutes` only when an administrator explicitly enables requests for that account. Resolve the child device from router-side IP/DHCP/ARP data, rate-limit and queue the request, notify the opted-in administrator, and never grant access automatically (§child30).
- The child status UI shows only the router-local `HH:mm` of the next boundary that actually changes effective access. Do not show a countdown or leak rule names. Keep `accessEndsAt` and `minutesRemaining` only for compatible local end-of-temporary-access notifications, and do not run future-boundary evaluation in the minute-by-minute firewall path (§b5wkq2e).
- SIM-change monitoring in the explicitly installed child APK is advisory and best-effort. Android may return no phone number. Never request or depend on ICCID, IMSI, IMEI, or another privileged hardware identifier; resolve the reporting Sheepfold device only from router-side IP/DHCP/ARP data. A first report with an installed SIM is itself journaled and, when allowed by `sim_change_notifications`, notified with the explicit note `(обнаружена в телефоне при установке приложения)`. Only a first report with no active SIM creates a silent empty baseline. Later changes are journaled, and `sim_change_notifications=new_only` notifies only for a previously unseen subscription fingerprint (§simchg1).
- Child Wi-Fi network reporting is opt-in and advisory. The child APK must not collect or post SSID/location until `/client-status` explicitly enables it. Hash `SSID + BSSID` on the phone and never send or store raw BSSID on the router. A bounded private phone queue may defer reports until the home router is reachable; disabling the setting must remove it, and location revocation must strip unsent coordinates. Resolve the reporting device only from router-side IP/DHCP/ARP, exclude administrator devices, cap persistent history, provide a LuCI clear action, and describe coordinates as the phone's last available position rather than the verified access-point address (§childwifi1).
- The quick add button may turn grey when the 30 second window expires, but it must remain clickable to restart the timer.

## Wi-Fi Settings

- Sheepfold may expose common 2.4 GHz and 5 GHz Wi-Fi settings: SSID, password, security mode, and channel.
- Wi-Fi changes must require confirmation because the current admin may be disconnected.
- Do not hide or replace standard OpenWRT wireless pages; Sheepfold only provides a simpler family-facing shortcut.
- Do not add guest-network features unless explicitly requested again.

## LuCI Browser Cache

- LuCI frontend assets must use one cache-busting version value.
- The canonical source is the OpenWRT package version: `PKG_VERSION-PKG_RELEASE`.
- The package Makefile should expose it as `SHEEPFOLD_UI_ASSET_VERSION` and write it to `ui_asset_version` during install/update.
- Default UCI may expose this as `ui_asset_version`, but individual JS/CSS files must not hardcode their own versions.
- Append the same version to Sheepfold JS/CSS/static asset URLs as a query suffix such as `?v=0.1.0-1`.
- Bump the package version/release when LuCI frontend files change.
- After changing LuCI asset versioning, run `node --test tests/luciAssetVersioning.test.mjs`; before publication use `npm.cmd test`. Do not replace the full Windows runner with monolithic `node --test tests/*.test.mjs`: the project runner isolates every test file because mixed fake-server, Git Bash, and Python workloads can retain one process indefinitely.
- Keep manual browser-cache clearing as troubleshooting, not the normal update path.
- Clear LuCI index/module cache from install/update hooks when the menu or LuCI view structure changes.

## LuCI Architecture

- Use a Podkop-like structure for the real LuCI implementation: a small entrypoint with `form.Map("sheepfold")`, `tabbed = true`, and separate modules for devices, allowlist, blocklist, schedules, emergency-useful sites, Wi-Fi, integrations, messaging, logs, diagnostics, and settings.
- Organize LuCI frontend implementation by responsibility: menu routes and page composition in `resources/view/sheepfold/`; framework/backend plumbing in `resources/sheepfold/core/`; reusable presentation helpers in `resources/sheepfold/shared/`; and domain code in `resources/sheepfold/features/<area>/`. Keep a helper beside the feature it serves instead of growing a generic `utils.js` dumping ground (§frontmod).
- Prefer one cohesive helper module that names operations for a single domain over repeated local helper functions. Do not create a helper merely to hide one obvious expression, and do not make unrelated domains depend on each other's UI state (§frontmod).
- For a larger domain, split only the responsibilities that exist: `model.js` for pure rules, `api.js` for narrow backend calls, and `view.js` for DOM composition and local interaction. Keep a small domain in one specifically named file; do not create ceremonial layers or giant generic helper modules (§frontmod).
- Before changing a LuCI feature, inspect one or two nearest feature modules and follow their established contract and naming. Do not scan or refactor the whole frontend merely to discover a style example (§frontmod).
- Never replace `overview.js` with a global `appControl`, `overviewContext`, component registry, or another object that exposes arbitrary application state and methods to every feature. Pass only the data and callbacks named by the feature contract (§frontmod).
- Create fresh initial state through a feature-specific factory when a panel has a non-trivial state shape. Do not reuse one mutable default object between renders or panels (§frontmod).
- Every timer, polling loop, event listener, watcher, and subscription must have an explicit stop/dispose path owned by the same module that starts it. Put mode-dependent intervals and retry values in a named policy map instead of scattering numeric literals (§frontmod).
- Keep feature-specific CSS selectors visibly grouped and prefixed by their feature. A later physical CSS split is allowed only when the LuCI asset-versioning path continues to version every resulting file (§frontmod, §assetv1).
- Podkop is the implementation style reference for LuCI structure, backend JSON methods, diagnostics, ACL discipline, install/update flow, and cache handling. Do not copy Podkop routing/sing-box responsibilities into Sheepfold.
- Keep the visual prototype separate from the future production architecture; do not keep growing one huge `overview.js`.
- In the family-facing LuCI navigation, keep `Emergency-useful sites`, `Integrations`, and `Messenger` inside the `Settings` page. The current settings content belongs under a `General` subtab, and import/export/update/reboot actions belong under a `Misc` subtab.
- LuCI must call a narrow backend command/API layer such as `/usr/bin/sheepfold <method>` instead of building arbitrary shell commands.
- rpcd ACL must explicitly allow only the Sheepfold files, UCI configs, ubus objects, and executable commands required by the UI.
- Put diagnostics in a dedicated tab and return structured JSON for checks.

## UCI Config Hygiene

- When changing UCI schema, package `postinst`, or defaults, read `docs/uci-config-migration.ru.md` first. Do not ship `/etc/config/sheepfold` in the `.ipk` payload; use `sheepfold.uci.defaults` plus `postinst` migrations.
- Keep UCI section names unique inside `/etc/config/sheepfold`.
- Only the main application section may be named `global`: `config sheepfold 'global'`.
- Helper sections must use explicit names such as `messenger_global`, `export_global`, `wifi_control_global`, and `pairing_global`.
- Do not add several `config ... 'global'` sections in the same UCI file. LuCI and commands like `uci get sheepfold.global.*` can otherwise read or write the wrong section.
- When renaming UCI sections, add an install/update migration in `postinst` so existing routers are fixed automatically.

## OpenWRT Package Managers And Test Builds

- Installed backend code must use `/usr/libexec/sheepfold/sheepfold-package-manager` for package detection, installed versions, named installs, local-file installs, removal, and version comparison. Do not add direct `opkg`/`apk` branches to each feature (§pkgmgr1).
- OpenWrt 24.10 and older use `opkg`; OpenWrt 25.12 and newer use `apk` v3. If both commands exist, prefer the platform-native `opkg` on the older system. Never run a mass `opkg upgrade` or `apk upgrade` from Sheepfold.
- `install.sh` may contain a minimal bootstrap copy of the adapter contract because the installed helper does not exist before the first installation. Keep that copy narrow and behaviorally covered; after installation, the shared adapter is the source of truth.
- Release and live-router paths must keep `.ipk` and OpenWrt `.apk` distinct from Android APKs. Select assets by the exact OpenWrt package-name prefix, validate internal package name/version/architecture, and never obtain OpenWrt APKs by renaming IPKs.
- Test `.ipk` files for this project must be built in the OpenWRT/ipkg-compatible format used by `opkg`: a gzip-compressed tar containing `./debian-binary`, `./data.tar.gz`, and `./control.tar.gz`.
- Do not switch the local test builder to Debian `ar` container format unless it is verified on the target OpenWRT `opkg`; the Xiaomi AX3000T test router rejected that format as `Malformed package file`.

## Export And Backup

- Default export must be readable JSON/archive without secrets.
- Full export with bot tokens, API keys, sessions, passwords, or other secrets must require encrypted export with a password.

## Schedules

- Schedules apply only to devices that are not in the allowlist or blocklist.
- Temporary access may override a schedule, but must never override the blocklist.
- Schedule UI must support weekdays, time ranges, enabled/disabled state, allow/block actions, and intervals crossing midnight.
- Temporary access quick buttons are +15 minutes, +30 minutes, +1 hour, +2 hours, +3 hours, +5 hours, until end of day, and until bedtime.
- If schedule rules conflict, show a warning and keep backend behavior deterministic.

## AdGuard Home And Podkop Integrations

- The LuCI setting is `Use together with` / `Использование совместно с`.
- Supported integration modes are `none`, `adguard`, `podkop`, and `adguard_podkop`.
- Current Podkop compatibility forces the visible `router_ipv6_disabled` setting on for `podkop` and `adguard_podkop`. Manage only Sheepfold's sysctl file, remember and restore previous kernel values, and never rewrite foreign network/DHCP/Podkop configuration for this feature. Revisit the rule when Podkop officially supports IPv6 (§ipv6pod).
- Keep this setting: it defines the Sheepfold compatibility plan for DNS/routing diagnostics and safe apply-time behavior, not merely whether third-party packages are installed.
- Do not model AdGuard Home and Podkop as mutually exclusive; they can be used together.
- The installer must detect existing AdGuard Home and Podkop installations and choose the matching Sheepfold `integration_mode`.
- LuCI should show AdGuard Home status through its local API when credentials are configured. For Podkop, use conservative local package/service/config detection until a stable Sheepfold-facing API exists.
- Show integration-specific notes before applying changes.
- Automatic router changes require explicit confirmation and should create/export a backup first.
- Automatic install-time changes may write only Sheepfold-owned UCI options unless the user explicitly confirms broader router changes.
- Do not overwrite AdGuard Home or Podkop configs blindly.
- Do not modify Podkop-managed Dnsmasq, nftables, sing-box, or routing state unless the change is explicitly designed and documented.

## Localization

- Russian is the primary product wording source.
- English is the required fallback language.
- Translation files are small; keep them in the repository/package by default instead of downloading them separately.
- Planned generated UI languages include Spanish, German, French, Portuguese (Brazil), Italian, Polish, Turkish, Ukrainian, Chinese Simplified, Japanese, Korean, Arabic, Hindi, Indonesian, and Vietnamese.

## AI Assistant And Country Profiles

- The Android parent assistant must use an abstract provider layer. Do not hardcode DeepSeek or any other provider as the only global option.
- DeepSeek can be the preferred default provider only in country profiles where it is allowed and reachable.
- Provider availability is country-profile configuration, not a permanent legal claim in code.
- The selected router country controls visible AI providers and suggested emergency-useful sites.
- Manual user entries must survive country changes.
- AI context sharing must use an explicit preview/confirmation step. Automatic action mode never authorizes automatic disclosure of MAC/IP/device names/child names/family details/logs/device lists/router settings.
- Future `ai_auto_actions` is off by default. When it is off, every proposed router action requires parent confirmation. When it is on, only applying an existing schedule or moving a device to an ordinary user group may run without a second question. Every other operation requires explicit confirmation. The feature is a documented plan and must not be presented as implemented until the versioned action API and tests exist (§aimed01).
- Keep long assistant prompts in separate prompt documents, not buried inside architecture docs.
- Assistant prompts are drafts until reviewed by the project owner and, for family/psychology guidance, a qualified family psychologist.
- The assistant may propose router setting changes through Android using a strict versioned action schema. In manual mode the preview requires confirmation; in automatic mode only the allowlisted low-risk subset may skip the second question. Never claim an action succeeded before the backend returns a verified result.
- New words must not silently enter the trusted PII/entity dictionary. Present the inferred meaning and ask the user, for example: `Фуфочка — это ваша кошка по кличке Фуфа?` Store the mapping only after confirmation.
- Internal profiles may contain useful working hypotheses, but never hidden facts or a user-facing psychological report. Each hypothesis needs evidence, provenance, confidence, at least one plausible alternative, and a review date. When a subject comments on a hypothesis, store that view separately and reassess; do not overwrite the model hypothesis automatically. Other family members never receive it except for a separately designed minimal life/health safety signal. Data deletion remains a separate privacy control (§aisurv1, §aichild).
- The assistant may help compose bug reports, feature requests, and feedback for the developer. It must anonymize sensitive data, ask before sending, and may include a rough value/impact percentage as a subjective prioritization hint.

## Site List Sources

- Do not manually compile or maintain a huge built-in “safe child websites” list in the repository.
- Use updateable external list sources and store them as configurable sources. See `docs/site-list-sources.ru.md`.
- Treat every downloaded source as untrusted. Parse each source into a bounded candidate file, validate it completely, and atomically replace only that source's cache. A malformed line may be skipped, but a failed source must keep its last-known-good cache while other sources continue updating (§slstres).
- Never interpret “configured entries exist but all are invalid” as an intentional empty list. Only an actually empty source setting may clear the resulting list. Retry a failed source after one day and notify administrators after three consecutive failed cycles without notification spam (§slstres).
- Keep per-source status, limits, and failure reasons. Do not run multi-million-entry desktop/server filters on a router merely because an upstream project publishes them; choose resource-sized variants or delegate to AdGuard Home (§slstres).
- Do not claim that site filtering works merely because sources download successfully. Verify the complete runtime path from cache to DNS/firewall and all four AdGuard Home/Podkop modes before presenting the feature as enforced (§slstres, §uirunfx).
- Keep traffic topology and site-list execution separate: `integration_mode` describes Sheepfold/AdGuard Home/Podkop, while `site_filter_backend=auto|adguard|sheepfold` chooses who applies domain lists. Do not infer one setting solely from the other after the user has saved a choice (§dompol).
- Automatic AdGuard Home management owns exactly one token-protected URL filter. Never edit `AdGuardHome.yaml`, call `filtering/set_rules`, or alter another filter. The official `filtering/set_url` body keeps `enabled`, `name`, and the new URL inside `data`; protect this shape with tests (§dompol).
- AdGuard Home `$client` rules use router-observed IPv4. A MAC identifier works only when AdGuard Home itself runs DHCP, so refresh the owned feed after lease changes and fall back instead of claiming success when a required client has no current IPv4 (§dompol).
- LuCI must expose `Whitelist sources` / `Источники белых списков` and `Site blacklist sources` / `Источники чёрного списка сайтов` in Settings -> Misc.
- Groups may enable a “whitelist sources only” mode. This is different from device allowlist and must not override the device blocklist.
- Site blacklist mode values: disabled, enabled for everyone, enabled for everyone except allowlist and administrators.
- Sheepfold must clearly explain that external category lists can contain mistakes and are not a legal or safety guarantee.

## Activity Journal

- Internet activity journal is separate from the administrative action log.
- It has two required levels: the user-facing global `ai_individual_logs` switch is off by default and mirrors the internal collector switch `private_logs`; the device/group `activity_log_enabled` scope must also allow collection. Do not restore the removed duplicate global `activity_log_enabled` option.
- When the global switch is off, hide per-device activity-log controls and reject writes in the backend. When it is enabled, initially enable eligible devices in the protected `Personal devices` group; the parent can then change individual device choices.
- Do not collect activity journal data for administrator devices, device allowlist, or device blocklist.
- Show only a visible badge/size/status in ordinary UI; do not display raw browsing history by default.
- AI analysis of activity logs requires an explicit data-preview confirmation. The assistant should summarize patterns and risks, not hand the parent a raw list of sites to confront the child with.
- Router-visible data is the boundary. DNS alone does not provide video titles, descriptions, or comments; collect such metadata only through a separate explicit mechanism and say when it is unavailable.
- The child APK does not need to announce router activity logging. Before enabling it, the parent UI must require confirmation that the user has lawful authority over the ward/device or suitable permission from the legal representative under applicable local law. Keep the exact warning country-reviewable and do not present it as universal legal advice (§aiact01).
- Planned child AI memory exposes only existence, size, broad categories, retention, and protection status to the parent. Conversation text and personal conclusions remain in the child-private scope; sharing belongs to the child except for a separately designed minimal life/health safety signal (§aichild).
- New AI memory is private to the speaker by default. Ask about visibility in age-appropriate language only when preserving a meaningful record. For an ordinary child secret ask only whether it should remain in this chat; do not push disclosure without a reason. Sensitive records cannot be shared in bulk; `можешь сказать маме` authorizes only the selected record or shown summary. Router administrator status and marriage do not grant access to another adult's or child's private AI memory (§aidata1, §aichild).
- A verified immediate life/health safety signal may be sent silently to a safe parent when warning the child would increase risk or delay help. Send the minimum and coach the parent to approach gently; never generalize this to ordinary secrets or misconduct (§aichild).
- A one-line parent hint is insufficient after a child safety signal. The future implementation needs the scenario library in `docs/ai-assistant-development/parent-conversation-after-safety-signal.ru.md`, selected by risk, age, urgency, and recipient safety (§aichild).
- Child memory has three planned retention layers: permanent concise `lifeArchive`, usefulness-reviewed `importantMemory`, and `currentTopics` removed after two years without new user evidence. Parent administrators cannot selectively delete or inspect child memory; product reset and the subject's own erasure rights require separate design (§aidata1, §aichild).
- A subject may ask the assistant to forget their own information. The future `memoryForgettingPolicy` must explain that the assistant will lose this context, clarify scope, obtain confirmation, and cascade deletion through summaries, embeddings, hypotheses based only on that record, caches, and AI copies. Never keep a hidden content copy (§aiforgt).
- If that request occurs during an already verified immediate life/health threat, move only the necessary minimum into an isolated 72-hour `safetyHold`. It may support the personal dialogue, `childSafetyRouter`, and an already-started minimal family safety action; it is excluded from ordinary memory, family context, backup, and export and expires without AI-read extension unless the subject explicitly preserves selected content (§aiforgt).
- Safe-adult candidates may come from a child or adult suggestion, but `childSafetyRouter` maintains the set and chooses the recipient per incident. Re-evaluate possible aggressors and conflicts; if nobody is safe, send nothing automatically (§aichild).
- A subject's death is not an erasure or sharing instruction. Preserve the concise `lifeArchive`, age out working layers by their normal policies, retain provenance and prior visibility, and never copy the deceased person's private memory into relatives' records automatically (§aiforgt).
- `familyShared` permits context-aware use, not raw disclosure. Discuss the relevant meaning tactfully when useful, but do not quote the conversation, expose its source, or surface internal memory cards unless the subject's permission explicitly covers that disclosure (§aidata1, §aiforgt).
- A statement about another family member is a sourced third-party judgment, not that person's trait. The other person's assistant may explore the topic with neutral, non-interrogative questions without revealing the source, presuming guilt, or forwarding answers back automatically (§aisurv1).

## Android App Security Copy

- Parent APK self-update belongs to the Information tab, is user-initiated, and uses the
  fixed GitHub release channel with digest/package/version/same-signer checks. Never replace
  it with arbitrary router-supplied APK URLs, silent installation, uninstall or new signing
  keys. Read `docs/android-app-updates.ru.md` before changing it (§apkupd1).
- Parent devices are grouped by the paired device ID and router-provided administrator
  login, never by display name or a remembered QR label. Account creation and pairing stay in LuCI.

- During first setup, Android app local authentication should recommend password or PIN.
- Fingerprint and face unlock may be offered, but should not be described as the safest default for a parental-control app.
- Use concise wording: biometric unlock can be less safe because a child may try to unlock the app while the parent is asleep.

## Platform Scope

- Target modern OpenWRT with `firewall4` / `nftables`.
- Do not add legacy `firewall3` / `iptables` support unless explicitly requested later.
- Target Android 9.0 Pie / API 28 and newer.

## Repository Hygiene

- Keep `README.md` in English.
- Keep `README.ru.md` in Russian.
- Keep shell scripts and OpenWRT package files LF-only.
- Do not commit secrets, tokens, router passwords, or local environment files.
