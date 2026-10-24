# Current Implementation Status

## Physical traffic regression on 2026-10-24

Source r325 adds a prerouting policy guard before Podkop TPROXY after a real phone
exposed a bypass of global/restricted blocking through the proxy. Device allowlist
and blocklist checks use real Wi-Fi-bound TCP/HTTP/HTTPS, not only status or nft set
membership. The router still has r286 plus the isolated nft hotfix, not an installed
r325 package. Exact observations, transient proxy failures and limits are recorded
in [the live test record](live-router-testing.ru.md#проверка-трафика-телефона-24102026).
An additional manual gate covers two already-open direct/proxy TLS sockets:
global/device blocking stops further replies, while the device allowlist preserves
both sockets under the global block. Proxy TLS resets also occur before blocking
and from the router itself; upstream stability is still unresolved.
No source publication, release, reboot or new package installation is implied.

After the owner installed experimental `podkop-exp 0.8.1-r1`, the seven-phase
physical-phone matrix passed again (35 TCP/HTTP/HTTPS probes). This run uses the
embedded `podkop` engine, not a separate sing-box process; see the
[0.8.1 record](live-router-testing.ru.md#проверка-экспериментального-podkop-081-24102026).
Two firewall-reload phases and a final restored baseline also passed, bringing
this 0.8.1 run to 50 successful probes; Podkop and network configuration stayed unchanged.
Source r325 also recognizes experimental package names in `router-info` (B168).
That diagnostic correction passed native execution from RAM but is not installed
in the permanent r286 helper. The earlier nft hotfix remains installed.

## Local audit on 2026-10-10

Base: r324 / `0f2f00f`, matching GitHub main at the start of this audit. Source fixes
[B160–B162](bug-register.ru.md) migrate active GitHub URLs to the verified owner
`hayOfLife`, reject release path traversal and add the same bounded URL policy to
the bootstrap installer. Android keeps metadata redirects disabled and preserves
digest/package/signer checks. Installed old clients need a separately built local
upgrade; changing source URLs alone does not repair them. The latest public router
asset observed during this audit is still r58, not r324.

The bootstrap still lacks the updater's independent internal archive validation;
its documentation no longer claims otherwise. Parent network-profile merging
discussed with the owner is not implemented in this main: token authentication
still compares the observed MAC with the bound MAC. See the pending requirement in
[home-network access](home-network-access.ru.md). Neither feature is marked complete.

Fresh checks and remaining validation limits are recorded in the
[audit checkpoint](merge-readiness-plan.ru.md#контрольная-точка-10-октября-2026-года).
Source publication is separate from an APK/router release or deployment.

The follow-up on source base `277faf0` implements [B163–B165](bug-register.ru.md):
byte-verified snapshots, atomic configuration recovery, retention and retry blocking
after a failed restore, an explicit impact rule for `update.sh`, and corrected
current access-priority descriptions. Publishing these source changes does not release
or deploy a package. Snapshots remain in RAM by default, not persistent backups;
native OpenWrt/power-loss checks remain pending. See the [update contract](update-safety.ru.md).

## Accepted r324 baseline

Current source decision, 2026-09-15: **r324**, selectively accepted from r323 and
the review-time-confirmation patch. Both cloud `archive-push` commands fail closed
before raw configuration export; direct journal `push-events` remains separate.
LuCI save/import/export lifecycle and time-save verification/recovery are improved.
The [acceptance report](review-r323-acceptance.ru.md) records B61–B159 individually,
local verification and unresolved native/OpenWrt/cloud boundaries. This is not a
published release or a deployment. Android, access policy and remote services are unchanged.

All dated continuations below are historical evidence, not current archive-upload
instructions or fresh test results for r324.

Focused continuation: 2026-09-13, **r323**, based on `276d4d0` (r322).
B130 checks the still-selected backend throughout both cloud senders, not merely
the credentials/root. A noticed switch to RAM/another backend or a failed reread
stops further requests and unconfirmed archive deletion. B131 rejects Google
sender selection-read failures instead of silently skipping. Other commands keep
their explicit read/download contracts. See the [131-card register](bug-register.ru.md)
and [r323 report](audit-fixes-r323.ru.md). Already completed HTTP/deletions are not
rolled back. HTTP/UCI/jshn are models; no new native/cloud/router/SDK evidence.
Access policy, Android, workflows and runner implementations are unchanged.

Historical continuations (their results are not fresh evidence for this snapshot):

Focused continuation: 2026-09-13, **r322**, based on `2754677` (r321).
B128–B129 validate the configured Yandex quota and preserve one cloud-settings
context throughout each archive/events command. Nested uploaders no longer reset
that context to new credentials while keeping an earlier destination. Detected
changes stop subsequent requests and unconfirmed source deletion, not already
completed operations. See the [129-card register](bug-register.ru.md) and
[r322 report](audit-fixes-r322.ru.md). HTTP/UCI remain models; native router, Yandex,
XML/usage/prune, global backend changes and concurrent transaction guarantees are
not covered. Android, access policy and CI/runner production code are unchanged.

Historical continuations (not fresh evidence for this snapshot):

Focused continuation: 2026-09-12, **r319**, based on `ea0d1db` (r318).
B119–B121 repair the Yandex push-events entry and export the configured journal
through a private snapshot under the shared log lock. The lock is released before
HTTP; subsequent live events remain for the next copy. See the [121-card register](bug-register.ru.md)
and [r319 report](audit-fixes-r319.ru.md). Real shell/files/flock with HTTP/UCI models;
no real Yandex/router or new SDK/Android evidence. XML/quota/prune, restore, RAM
limits and cross-process cloud transactions remain open. No access-policy changes.

Historical continuations (not fresh evidence for this snapshot):

Focused continuation: 2026-09-12, **r318**, based on `6228e37` (r317).
B116–B118 repair Yandex upload/verify launch, independent HEAD size confirmation,
private upload snapshots and detected configuration changes during one transfer.
See the [118-card register](bug-register.ru.md) and [r318 report](audit-fixes-r318.ru.md).
The complete archive caller passes synthetic HTTP/UCI tests; real curl/TLS passes
loopback checks. Real Yandex HEAD support remains unverified: missing or ambiguous
Content-Length fails without authorizing source deletion. Size is not a checksum.
The journal path/lock, full XML/quota/prune, push-events entry, list/download/restore,
RAM bounds and cloud-wide concurrency remain open. No Android/policy/workflow changes.

Historical continuations (not fresh evidence for this snapshot):

Focused continuation: 2026-09-12, **r317**, based on `17eab4b` (r316).
B114–B115 validate the Yandex local config/events preparation before cloud mutation
and isolate every run in an owned private directory. Prior same-name snapshots
survive errors and retries. See [115-card register](bug-register.ru.md) and
[r317 report](audit-fixes-r317.ru.md). The native uploader still has known failures;
positive uploader-boundary models prove preparation, not WebDAV delivery or restore.
No Google Drive, Android, access policy, workflow or runner production changes.

Historical continuations (not fresh evidence for this snapshot):

Focused continuation: 2026-09-12, **r315**, based on `de179d3` (r314).
B109–B111 repair Yandex MKCOL path splitting/caller isolation, reject unconfirmed
preparation and preserve configured root intent after UCI failures. See the
[111-card register](bug-register.ru.md) and [r315 report](audit-fixes-r315.ru.md).
192 focused tests; no native WebDAV/UCI or full backup/restore claim. Existing-URI
405 remains a compatibility path, not collection-type verification. Two late
push-events preflight tests repair its known entry typo only in their fixture;
the actual entry and upload chain are not declared fixed. Android, policies,
workflows and runner code remain unchanged.

Historical continuations (their results do not certify the current snapshot):

Focused continuation: 2026-09-11, **r313**, based on `bf8e075` (r312).
B104–B105 align Google Drive journal exports with `log_cache_path` and capture a
checked local snapshot under the existing writer/API/rotation lock. The lock is
released before network operations; later live events do not invalidate that
snapshot. See the [105-card register](bug-register.ru.md) and
[r313 report](audit-fixes-r313.ru.md). This does not validate other exporters,
cloud concurrency, native OpenWrt, physical equipment or configuration restore.
No Android, access-policy, workflow or test-runner code changed.

Historical continuations (their tests are not results for the current code):


Focused continuation: 2026-09-11, **r310**, based on `0c27dff` (r309).
B98–B99 repair the standalone Drive file listing, typed JSON serialization,
complete bounded folder reads and operation context. See the
[99-card register](bug-register.ru.md) and [r310 report](audit-fixes-r310.ru.md).
The output contract is unchanged; failures do not become successful empty lists.
Restore/latest, full pagination, native OpenWrt runtime and RAM quotas remain R14.
No live Google request or configuration restore was performed. Android, access
policy, workflow and runner code are unchanged.

Historical continuation:

Focused continuation: 2026-09-11, **r309**, based on `c535dfa` (r308).
B95–B97 repair the standalone download entry point, distinguish lookup failure,
and preserve an existing destination until HTTP, ID/size, path and context checks
succeed. See the [97-card register](bug-register.ru.md) and
[r309 report](audit-fixes-r309.ru.md). This is not checksum verification, a pinned
remote revision or safe configuration restore. List/restore, native UCI/jshn,
RAM limits and path races remain R14. No live Google account was used.
Android, access policy, workflow and runner code are unchanged.

Historical continuation:

Focused continuation: 2026-09-10, **r308**, based on `abb68ca` (r307).
B93–B94 validate bounded complete Drive inventories for quota accounting and
stop cleanup on failed/partial reads or unconfirmed DELETEs. Backups are counted,
not pruned. See the [94-card register](bug-register.ru.md) and
[r308 report](audit-fixes-r308.ru.md). No live cloud deletion, full pagination or
atomic UCI/cloud transaction is claimed. Status commits, list/download/restore,
RAM limits and concurrent server-side changes remain R14.
Android, access policy, workflow and runner code are unchanged.

Historical continuation:

Focused continuation: 2026-09-10, **r307**, based on `694355b` (r306).
B91–B92 bind folder-cache reads to verified credentials and the normalized root,
and abort the supported upload paths on detected in-flight configuration changes.
See the [92-card register](bug-register.ru.md) and [r307 report](audit-fixes-r307.ru.md).
No live account identity or atomic UCI/HTTP transaction is claimed. Quotas, remote
folder moves, concurrent publishers, list/download/restore and live tests remain R14.
Android, access policy, workflow and runner code are unchanged.

Historical continuation:

Focused continuation: 2026-09-10, **r306**, based on `9f3a38c` (r305).
B88–B90 distinguish a verified empty Drive search from errors/ambiguity, encode
query literals and URL parameters separately, and publish/read a checked private
folder cache. See the [90-card register](bug-register.ru.md) and
[r306 report](audit-fixes-r306.ru.md). Account-bound folder identity, full pagination,
quotas, list/download/restore, concurrent writers and live Google remain R14.
Access policy, Android, workflow and runner code are unchanged.

Historical continuation:

Focused continuation: 2026-09-10, **r305**, based on `4936914` (r304).
B85–B87 validate OAuth exchange, bind the RAM token cache to observed credentials,
and publish private cache records after successful preparation. The previous r304
upload/remote-size fixes are preserved. See the [87-card register](bug-register.ru.md)
and [r305 report](audit-fixes-r305.ru.md): 150 focused tests in five files, not a full
suite or live Google/native libubox certification. Folder cache/account migration,
search/list/restore, shared status commits and writer races remain R14.
Access policy, Android, workflows and runner code are unchanged.

Historical continuation:

Focused continuation: 2026-09-10, **r303**, based on `0b3f0e4` (r302).
B79–B81 align maintenance rotation with the shared RAM-path contract, check all
staging/statistics/publication failures and preserve complete lines at byte boundaries.
The [81-card register](bug-register.ru.md) and [r303 report](audit-fixes-r303.ru.md)
separate reproduced failures from controls already passing on the baseline.
Android, workflow/runner and access policy remain unchanged. R13 remains open
for install/cloud readers, crash cleanup, retry policy and privileged file races.

Historical continuation:

Focused continuation: 2026-09-10, **r302**, based on `0238869` (r301).
B76–B78 unify writer/API RAM-path validation, verify primary record writes and
isolate background cloud descriptors. The [78-card register](bug-register.ru.md)
and [r302 report](audit-fixes-r302.ru.md) distinguish local runtime evidence from
live delivery. Android, workflows, runner and access policy remain unchanged.
R13 still covers maintenance/install/cloud readers, byte limits and durable delivery.

Historical continuation:

Focused continuation: 2026-09-10, **r301**, based on `fcd2dc7` (r300).
B72–B75 fix the existing RAM-log API: read/masking/UCI failures, path boundaries,
JSON encoding, and coordinated read/clear with the existing writer lock.
The [75-card register](bug-register.ru.md) and [r301 report](audit-fixes-r301.ru.md)
record 206 selected tests in 12 files, including 43 new scenarios. R13 keeps
other log consumers, byte limits, privacy completeness and privileged path races
explicitly open. Android, workflow and runner production code remain unchanged.
Local test IPKs are not a new SDK/live-router verification.

Historical continuation:

Focused continuation: 2026-09-10, **r300**, based on `17e4f90` (r299).
B68–B71 fix the separate persistent administrator-notification queue: verified
reads, truthful HTTP/JSON, coordinated deduplication/retention, private staging.
The [71-card register](bug-register.ru.md) and [r300 report](audit-fixes-r300.ru.md)
record 152 selected tests, local test IPKs and remaining R12 limits. Production
Android, workflows and runner remain unchanged. No new live delivery/SDK claim.


Focused continuation: 2026-09-09, **r299**, based on `7f77e56` (r298).
B65–B67 preserve unreadable/malformed request records, serialize cooperating queue
create/list/prune operations, and check private staging and publication. 148 focused
tests pass, including 29 new scenarios (25 fail / 4 pass on the unchanged baseline).
See the [r299 report](audit-fixes-r299.ru.md) and [67-card register](bug-register.ru.md).
R11 remains open for RAM limits, crash cleanup, monotonic time and UCI/opt-in races.
Accepted CI/runner policy and D01 are unchanged. No new live/SDK/Android evidence.

Historical continuation:

Focused continuation: 2026-09-09, **r298**, based on accepted `bdb3a92` (r297).
B61–B64 fix child-request identity scope, ID command outcome, post-save logging,
parent-list failure status and JSON control-byte encoding. 170 focused tests pass;
26 new scenarios fail/pass as 15/11 on the baseline and pass as 26/26 after the fix.
Accepted test/CI changes are retained. Queue concurrency and suppressed internal
reads remain R11. No new Android/SDK/live-device success is claimed here.
See the [r298 report](audit-fixes-r298.ru.md) and [bug register](bug-register.ru.md).

Historical continuation:

Focused continuation: 2026-09-09, **r297**, based on r296 `89b7093`.
Admin transactions use fresh owned recovery directories and verify snapshots before
mutation. Wi-Fi writes use private deltas; common admin transactions and Wi-Fi reject
observable shared pending changes and recheck revisions before commit. This is not a
complete UCI transaction or writer lock. See the [r297 report](audit-fixes-r297.ru.md)
and [60-card register](bug-register.ru.md). Only affected-area tests were run.
Historical r296 and earlier evidence follows.

Focused continuation: 2026-09-09, **r296**, based on r295 `5f2c816`.
The administrative Wi-Fi backend checks SSID octets and WPA-PSK bounds, preserves
SSID spaces and accepts passwordless OWE. Failed rollback retains available recovery
data and is distinguished from a restored file whose Wi-Fi restart failed.
See the [r296 report](audit-fixes-r296.ru.md) and [57-card register](bug-register.ru.md).
Only affected-area tests were run; no native UCI, live radio or SDK-release claim.
Historical r295 and earlier notes follow.

Focused continuation: 2026-09-09, **r295**, based on r294 `e1084e1`.
Admin-config rejects failed UCI/revision hashes, escapes JSON controls and disables
pathname expansion of logical lists. Installation hardening now follows the r294
pairing-attempt delegation instead of rejecting the removed function name.
See the [r295 report](audit-fixes-r295.ru.md) and [53-card register](bug-register.ru.md).
These are local targeted checks, not full-suite, SDK or physical-device evidence.
Historical r294 and earlier notes follow.

Focused continuation: 2026-09-08, **r294**, based on the available r293 `a1cb6cb`.
Internal pairing attempts now reserve a slot before backend and share a lock with
QR reset; storage and unexpected backend failures return 503. Ordinary logging no
longer corrupts the CGI response. Three backup/staging fixes described by a different
r293 response were absent from the supplied history and were reimplemented (B47–B49).
178 focused tests pass; no full runner, SDK build or physical device validation.
See [r294 report](audit-fixes-r294.ru.md) and the [49-entry register](bug-register.ru.md).

Historical r293 note follows; it does not supersede the r294 evidence:

Focused local fixes: 2026-09-08, **r293**, based on r292 `1812625`. External HTTP rate
counters now serialize updates and resets, reject storage failures, recover from a
backward wall-clock change and distinguish 503 outages from 429 quota exhaustion.
Retry-After reports the remaining window. **142 targeted tests in 8 files** pass;
40 new runtime scenarios are documented in the [r293 record](audit-fixes-r293.ru.md)
and [42-card register](bug-register.ru.md). No full-suite, hardware, SDK or Android
build completion is claimed. The separate inner pairing-attempt counter remains open.

Focused local fixes: 2026-09-08, **r292**, based on r291 `7f4764e`. Complete bound-token
validation, explicit SHA-256 failure handling, temporary authentication errors (503),
and delegation-aware installation hardening are corrected. The owner requested targeted
tests only: see the [r292 record](audit-fixes-r292.ru.md) and [38-card register](bug-register.ru.md).
No full-suite, hardware, SDK or Android-build completion is claimed for r292.

Focused local fixes: 2026-09-08, **r291**, based on r290 `ea56d55`. Pairing now uses
the strict common form boundary, rejects failed/short entropy reads and failed digests,
publishes complete private token records without replacing existing files, and explicitly
checks UCI transaction preparation. All **1038 local tests in 135 files** pass without
skips, including 55 new runtime checks. The [r291 record](audit-fixes-r291.ru.md) and
[34-card cumulative register](bug-register.ru.md) explain each cause, solution and limit.
This does not close the global UCI/token-writer concurrency work in R03/R08 or imply
hardware, SDK, Android-build or CI completion. The owner's priority is unchanged.

Focused local fixes: 2026-09-08, **r290**, based on r289 `83bbfd4`. Token migration and
revocation failures, wireless command outcomes and legacy action-log failure handling
are corrected. All **983 local tests in 133 files** pass without skips, including
40 new runtime checks. Full-run results and tool limitations are recorded in the
[r290 record](audit-fixes-r290.ru.md). The [cumulative register](bug-register.ru.md)
contains 30 cards, with token-writer concurrency explicitly open in R08. No hardware,
SDK, Android or CI completion is implied; the owner's access priority is unchanged.

Focused local fixes: 2026-09-08, **r289**, based on r288 `b9209ce`. Observed UCI changes
now reject the calculation instead of acknowledging a mixed result; this is optimistic
validation, not a complete snapshot or writer transaction. Failed schedule output is
discarded, periodic firewall skips future prediction, conflict-log failure does not
cancel the calculated policy, and failed home-rule generation no longer means a silent
flush. All **943 local tests in 131 files** passed without skips. No new hardware,
native UCI, SDK, Android build or CI evidence is claimed. The owner's No restrictions
priority remains unchanged. See the [r289 record](audit-fixes-r289.ru.md) and
[26-card cumulative register](bug-register.ru.md).

Focused local fixes: 2026-09-08, **r288**, based on r287 `ed8e335`. Runtime generation
markers restore the periodic firewall recovery path, clear uses one owned-object batch,
and unreadable UCI no longer becomes an empty allow policy. CLI duration/retry and
`/devices` error/JSON handling are hardened; upcoming inactive schedule boundaries are
preserved. The complete local Node run passed 922 tests in 130 files with no skips.
This is not new SDK, CI, phone or live-router evidence. See the
[detailed cumulative bug register](bug-register.ru.md) and [r288 record](audit-fixes-r288.ru.md).

Focused local fixes: 2026-09-07, r287, based on merged `ec52b67`. The owner confirmed
`No restrictions` above the device blocklist for ordinary internet; router management
and identity quarantine remain protected separately. Local CGI, policy and Android
session regression tests accompany the changes. This revision has not been deployed
or validated on hardware; older deployment evidence below does not apply to it.
See [the r287 fix record](audit-fixes-2026-09-07.ru.md).

General inventory checked: 2026-08-26. Focused changes and merge review: 2026-08-31.

Changes delivered to `main` in `821a6bb` (2026-08-31): the parent app now has a manual APK
update section in Information, with bounded GitHub downloads, digest/package/version/signature
checks and Android installer confirmation. The parent-device view replaces the administrator
list, using the new optional `/devices.adminLogin` projection for ownership.
Parent debug APK `0.1.57` / code `58` is installed on the physical API 30 phone with
the previous signing certificate and data preserved. All 5 paired read-only integration
tests passed, including the nine production panels and unchanged saved bearer.
Standard `0.1.0-r285` is installed on the test Cudy WR3000S v1 / OpenWrt 25.12.5
from the exact-commit official SDK build. All 13 router checks, five paired phone tests
and LuCI desktop/mobile checks passed. Network/TLS hashes are unchanged; both admin
devices expose a valid owner login, and ordinary devices expose an empty login.
LuCI retains the same 124 nonblocking size warnings. Backup and build evidence:
[r285 deployment record](live-router-testing.ru.md#обновление-r285-31082026).
Parent build and Lint passed;
102 JVM tests, 166 Android/API category checks and 13 API 28 emulator component tests passed.
Lint reports 0 errors and 84 warnings; one new advisory concerns conservative usable-space checking.
The full local quality gate passed all 123 Node test files: 794 passed, two Windows
`flock` cases skipped. [Linux CI](https://github.com/hayOfLife/luci-app-sheepfold-family-internet-control/actions/runs/33389723848)
passed 796/796 without skips and built/linted both Android apps. The full documentation
audit passed for 250 Markdown files.
Parent debug `0.1.58` / code `59` was published on 2026-08-31 as a test-only APK in
the existing `v0.1.0-experimental.1` release, from source `61bbd7b`. Its certificate matches
the installed `0.1.57`; anonymous GitHub metadata, APK bytes and signature checks passed.
The existing router asset and latest release selection are unchanged. At publication, the phone
was left on `0.1.57` for the owner's manual update test. The owner subsequently reported that
returning from the install-source permission screen offered another download instead of
continuing installation. A completed physical update has not been independently verified.
See [the update runbook](android-app-updates.ru.md).

The test `0.1.59` / code `60` fix makes download and installation one explicit operation.
An atomic private-cache checkpoint survives process loss; Activity Result and a resumed,
unlocked Activity continue a recent permission request without downloading again. Cancelling
installation keeps the file but does not reopen the installer automatically. PIN, pairing,
same-signer verification and Android's final confirmation are unchanged. It was published on
2026-08-31 from `2025ec8`, without installing it on the physical phone. Anonymous GitHub metadata,
downloaded bytes and signing certificate were verified; old assets and latest are unchanged.
The full local quality gate passed all 123 test files (795 tests passed, two Windows skips),
and [source CI](https://github.com/hayOfLife/luci-app-sheepfold-family-internet-control/actions/runs/33406798664)
passed Android Lint/builds and its other checks. Build/Lint and all 102 local JVM tests passed;
the focused updater/read-panel suite passed 27/27 on both API 28 and API 35.
The broad emulator run was not green: five router-dependent tests had no discovered router,
and one existing Wi-Fi visibility assertion failed. Evidence and remaining OEM validation
are recorded in the update runbook; no unrelated Wi-Fi/router fix is claimed here.

Subsequent control refresh polish (2026-08-31): the spinner stays inside the disabled
refresh button, without moving the internet commands, and repeated refreshes are rejected
before recomposition. Build/Lint, 102 JVM tests, 15 focused Node checks and all 9
`ParentControlsTest` cases on API 35 passed; the synthetic screenshot was reviewed.
This subsequent UI change is included in published test APK `0.1.58`, but is not yet
installed on the physical phone.

Earlier merge checkpoint (2026-08-31, `gemini_v1`): unknown control state disables
both commands; RAM-only workspace drafts survive Activity recreation and retain their original
revision; Wi-Fi saves require a disconnect warning; notification events precede settings;
schedules have a weekly rule preview. Shared device cards hide technical details and expose
seven filter choices. Personal devices include wearables, which also have a narrower filter.
The same-key parent debug APK `0.1.56` / code `57` was installed without clearing pairing
or settings. Its repeated API 30 run passed 48/48 component/menu/preview tests and all
87 parent JVM tests. Standard `0.1.0-r284` from exact-commit official SDK build `32ffa90`
was installed on the test Cudy WR3000S v1 / OpenWrt 25.12.5. Post-upgrade checks passed:
13 router read-only checks, 9 paired phone/router checks and LuCI desktop/mobile.
Network config hashes are unchanged. LuCI retains 124 nonblocking size warnings;
two additional reports measure the new beta checkbox input rather than its enclosing label.
The optional authenticated Wi-Fi channel endpoint is now shipped on that router;
changing a real Wi-Fi channel is not verified by these read-only tests.

Local full quality gate passed all 123 test files with one Windows-only skip;
Linux CI passed 793/793 tests without skips and built/linted both APKs.
The documentation audit passed for 248 Markdown files. Child APK `1.15` / code `16`
was built but not installed on the parent phone; its JVM task reports `NO-SOURCE`.
Earlier evidence and remaining release checks are kept in the
[live-router runbook](live-router-testing.ru.md#обновление-и-проверки-31082026).
Router writes, camera pairing, Doze, biometrics, API 28/35 and relay E2E remain separate gates.
Permanent OpenWrt release signing keys are not yet configured; the test install does not
replace that release requirement. No public release was published.
See the
[parent runtime runbook](android-test-lab.ru.md#рабочие-панели-родительского-приложения).

Automated tests are grouped into overlapping problem categories (`smoke`, `luci`, `access`, `devices`, `sites`, `backend`, `android`, `security`, `messaging`, `ai`, `packaging`, and `tooling`). See [`test-strategy.ru.md`](test-strategy.ru.md) (§testcat); the category-map test prevents new test files from being left unassigned.

Before committing or merging a working branch, follow the evidence-based checklist in [`merge-readiness-plan.ru.md`](merge-readiness-plan.ru.md). Always discover the actual branch through Git. The checklist separates locally verified work from scenarios that still require a live OpenWRT router or a real Android device.

The current prioritized order of future work is maintained in [`project-development-roadmap.ru.md`](project-development-roadmap.ru.md) (§roadmap). Historical audits remain evidence, but they do not override that roadmap's current ordering.

The canonical end-to-end contract for device discovery, classification, trusted identity,
quarantine, automatic groups, notifications and firewall effects is
[`device-passport-and-control.ru.md`](device-passport-and-control.ru.md) (§devpas1). Focused
device documents supplement that contract instead of redefining it.

Current local r298 test-package name produced by `scripts/build-test-ipk.py` (not an SDK release):

```text
luci-app-sheepfold-family-internet-control_0.1.0-298_all.ipk
```

This local fixture uses `Architecture: all` because it contains LuCI assets, shell scripts, UCI defaults, init/hotplug scripts, CGI endpoints, and rpcd ACL files without native binaries. Official OpenWrt SDK artifacts use the format-native architecture metadata described below.

The `Sheepfold` / `Sheepfold - AI Support` boundary is implemented for both
router package formats and documented in
[`product-variants.ru.md`](product-variants.ru.md). A canonical GitHub Actions
matrix prepares both editions from one variant module and uses the pinned
official OpenWrt SDK to build IPK for 24.10.7 and a real apk-tools v3 package for
25.12.5. All four files keep the same installed package identity, so Standard ↔
AI Support is an upgrade/reinstall that preserves `/etc/config/sheepfold`;
filenames and payloads remain distinct. The workflow validates metadata,
creates SHA256SUMS/build manifest, and attaches only a complete matrix to a
normal release (§prodvar, §owrtci1). The remote workflow and one official
OpenWrt 25.12 live-router round-trip have passed; OpenWrt 24.10 still needs an
equivalent live-router install/runtime pass before a public stable release.

## Локальные исправления r316

Поверх r315 (`da347f1`) общий builder Яндекс Диска кодирует логические пути и
отказывает при dot-segments до MKCOL. Проверены точные URI и реальные loopback
HTTPS request-target, без аккаунта Яндекса. [B112–B113](bug-register.ru.md) и
[протокол r316](audit-fixes-r316.ru.md) отделяют это от непроверенных XML,
upload/download/restore и native OpenWrt. Доработки принятого CI и D01 сохранены.

## Working In The Current Package

- LuCI entry point for `Sheepfold Family Internet Control`.
- UCI config `/etc/config/sheepfold` with default app settings.
- Asset cache busting through `ui_asset_version` and JS/CSS query suffixes.
- LuCI modularization (§frontmod): `view/sheepfold/overview.js` is now a four-line bootstrap; `features/overview/application.js` is the explicit composition root, while focused controllers, persistence adapters and views own the domain behavior. Further extraction is justified by an independent contract, not by a line counter.
- Project-owned interface icons have one named source in `icons/catalog.json`. The generator produces the LuCI registry, autonomous visual catalog and declared Android Vector Drawables; `paths` and `thinPaths` keep outer and inner line weights consistent across platforms (§iconcat1).
- HTTPS-only local Android discovery/API service on the configurable Sheepfold port, default `5201`, with certificate/SPKI pinning in both Android applications.
- Public discovery data through `/.well-known/sheepfold.json`.
- Parent Android recovery after a configured Sheepfold port change: the client re-reads pinned HTTPS discovery on the already pinned local IP, stores the new endpoint, and does not retry commands after an ambiguous timeout (§dnsbind1).
- CGI endpoint `/cgi-bin/sheepfold-api` with current router/app metadata and `/cgi-bin/sheepfold-api/router-info` diagnostics snapshot for Android/APK AI-preview flows.
- Real parent Android pairing through a short-lived one-time code, single-use backend consumption, token hash storage, and token binding to numeric device ID and MAC. Every administrative request also matches the claimed MAC against the DHCP/neighbor MAC observed by the router for `REMOTE_ADDR`; a client header alone is not trusted. Device ID allocation, administrator rights, allowlist membership and one-time-code consumption share an isolated `uci -t/-p` transaction. After final commit the backend reads the main UCI config back, and Android verifies the token with a regular authenticated request before opening the main screen; failed persistence revokes the token and restores the pre-pairing snapshot (§pairtx1).
- Permanent numeric device IDs allocated from a monotonically increasing counter. Package migration preserves every valid number and gap, normalizes legacy forms such as `D-0012` without changing their numeric meaning, and keeps old forms as MAC-bound compatibility aliases for paired clients and historical references (§deviceid2).
- Device detection, direct rescans, and manual reclassification share one `flock` contract; device blocklist, administrator-device, and device allowlist policies are never replaced by an ordinary automatic group (§detlock).
- Configurable blocked-page responder on port `5202`.
- Router-control backend command for Wi-Fi enable/disable, Wi-Fi automation tick, WPS actions, LED actions, blocked-page service, WAN status tick, router diagnostics, and device status changes.
- Reversible `Disable IPv6 on the router` control in Settings -> Misc: disabled by default, forced on for current Podkop integration modes, applied through a Sheepfold-owned sysctl file, and restored to the previous kernel state when automatic compatibility is no longer needed (§ipv6pod).
- Device add/status backend action: create or update a device by MAC, add to allowlist, add to blocklist, or add as a known restricted device.
- Allowlist/blocklist and administrator-device changes apply UCI and synchronize nftables immediately without reloading the LuCI page.
- The live-router write harness checks the corresponding nftables set after each synthetic allowlist/blocklist change, active block/allow/disabled and overnight schedules, both configured same-level conflict outcomes, the `No restrictions` group above a schedule and above the device blocklist for internet, independent management denial, temporary access and forced expiry, then checks runtime cleanup after restore; a UCI-only change is treated as failure. This describes the current harness, not a fresh hardware run (§routerharness, §uirunfx, §fwlock1).
- Temporary access backend action for Android/LuCI/Telegram: stores an expiry in a separate temporary status, never overrides the device blocklist or global internet block, does not pollute the user allowlist, and is cleaned by the service tick after expiry.
- Backend protection that prevents administrator devices from being added to the blocklist.
- Real fw4/nftables enforcement with separate sets for the device blocklist and internet-only restrictions. The device blocklist denies router input and internet forwarding, with the owner-approved `No restrictions` exception for internet only; identity quarantine remains independent. Schedules, restricted status, and the configured new-device restriction deny only internet forwarding. The global block keeps its explicit exemptions. Sheepfold uses only its own fw4 sets/chains and does not alter Podkop packet marks or routing tables.
- Schedule evaluator for device/group targets, overnight ranges, configurable same-level conflict result (`off` by default), conflict journaling, effective client status, and scheduled firewall synchronization. Active block/allow/disabled rules, an overnight boundary and both conflict outcomes are confirmed in real nftables using deterministic test time; service-driven transitions at the router's real wall clock still require a separate long-running test.
- LuCI buttons for adding devices to allowlist/blocklist through the backend command.
- Manual device add from LuCI by MAC/name/IP/type.
- Quick allowlist modal that collects newly connected candidates and adds only the selected candidate.
- Export of settings and known UI data to readable JSON with secret fields masked.
- Import/export v2 for all Sheepfold sections, static DHCP leases and Wi-Fi UCI: readable JSON masks secrets, while the full backup uses password-derived AES-256-GCM. Import validates the payload, rejects conflicting device lists, never exports an active pairing code and refreshes router services. A same-router restore preserves trusted device identity; a new-router/legacy restore keeps permanent `#ID` and family rules but clears router-bound HMAC/quarantine state and administrator-phone bindings (§cfgbak1).
- Log clearing and masked log export.
- Router reboot button through a queued command path.
- Update button that calls the installed updater service and checks GitHub stable releases. A shared adapter selects `opkg` on OpenWrt 24.10 and older or `apk` v3 on 25.12 and newer. Before installation, the updater validates the official asset path, package container, internal name/version/architecture and format-specific safety. Configuration recovery is byte-verified and atomic; failure retains the available snapshot/state and blocks another install. The default snapshot is in RAM and does not survive reboot; this is not binary rollback (§pkgmgr1, §updsafe).
- Wi-Fi page that reads router wireless UCI settings and shows connection QR codes.
- Persistent emergency-useful site cards and initial runtime enforcement: UCI-backed domains, dnsmasq nftset integration when supported, base-domain resolver fallback, and narrow TCP/UDP web exceptions that do not open LuCI/SSH/API (§emerg1). Installation and Settings -> General select a `ru`, `by`, `cn`, or neutral `other` country profile; only profile-owned cards are replaced, manual edits survive, and deleted generated entries stay excluded. The Russian factory profile no longer includes `ya.ru` because search results provide access to a much broader content surface (§country1). Shared-CDN and multi-domain sites still require live-router verification.
- WPS button behavior settings.
- Router LED behavior settings.
- WAN connectivity event logging.
- LuCI settings tab `Information` showing router time, Sheepfold version, internet status, ping to `ya.ru`, OpenWRT/firmware/kernel/model, Wi-Fi radio status, LAN ports, Podkop/AdGuard Home installation/version, uptime/load/memory, and a safe AI context preview for APK.
- Device detection helper with heuristic device types and optional `No restrictions` auto-assignment.
- Auto-assignment to `No restrictions` only when automatic setup of new devices is enabled; a device name alone is not sufficient evidence.
- Device identity evidence includes bounded mDNS TXT fields, LAN-bound SSDP/UPnP descriptions and WS-Discovery. UPnP LOCATION is peer-pinned and size/time limited; WS-Discovery XAddrs are never fetched. One strong UUID/serial HMAC or two matching weak evidence families may suggest that a new MAC resembles an earlier physical device, but Sheepfold does not link records or copy rights automatically. If one UUID is announced by two online MAC records, only the newer numeric ID is quarantined pending a parent decision (§devident1).
- Device lists use three distinct identity indicators: trusted stable evidence, MAC-only protection, and an active identity mismatch/quarantine. Device classification also distinguishes an unknown generic network device, a router/access point and a network switch; none of these infrastructure types receives automatic trust or `No restrictions`.
- Device analysis is event-driven: an offline-to-online transition waits 20 seconds, a 90-second grace period suppresses Wi-Fi sleep/roaming flapping, startup and daily safety passes include only currently online LAN/Wi-Fi clients, and unchanged confident devices avoid heavy scans. One bounded hostapd snapshot adds normalized HT/VHT/HE and speed classes only as weak type hints; raw rates remain in RAM and never affect identity or `No restrictions`. A versioned HMAC-SHA-256 trusted identity baseline is kept separately from the classification hash; conflicting strong/two-family evidence creates an indefinite block/restrict quarantine overlay without deleting the original device rights and reminds the parent no more than daily. Persistent device-blocklist members retain presence and denied-router-access logging but skip classification, port scans, and groups (§detlife1).
- Router-proxied DeepSeek, Gemini, and Grok providers with versioned parent/child runtime prompts and provider keys stored only on the router. The exact implemented request path and its current limits are recorded in [`ai-assistant-development/current-implementation.ru.md`](ai-assistant-development/current-implementation.ru.md) (§aiimpl1).
- Parent Android onboarding, live/file QR scanner, manual pairing, encrypted connection storage, password/PIN/biometric app protection, device actions, notifications, and three internet-state home-screen widgets. New `SF2` QR codes carry a SHA-256 SPKI fingerprint computed by the router and Android verifies it before sending the one-time code; a signed hostname is resolved once to a local IP and that IP is persisted against DNS rebinding. Legacy saved certificate pins remain readable, while a legacy saved hostname requires re-pairing. A final `401`, revoked/unbound admin device, or TLS identity mismatch now clears only the router credential and opens pairing directly; timeout, offline state and `5xx` retain it (§tlspinv2, §dnsbind1, §authrs1).
- Separate child Android application with HTTPS status lookup restricted to a gateway/manual local IP, correct default access for newly detected devices, and router-local `HH:mm` for the next schedule boundary that actually changes effective access. It also has parent-controlled AI access for devices in a personal group, best-effort active-SIM change reports, and an opt-in report of first connections to new Wi-Fi networks. The Wi-Fi report can include the last available phone location, hashes BSSID before transport, keeps at most 100 networks per device, and uses the non-consuming shared administrator notification queue. While the home router is unavailable, the child APK keeps a bounded private queue and sends it after returning home; this is delayed best-effort delivery, not cloud tracking (§b5wkq2e, §simchg1, §childwifi1, §dnsbind1).
- Repository-managed Windows toolchain checks/install scripts and Gradle Wrapper 8.10.2 for both Android applications; Android SDK packages remain outside Git and are installed from Google's verified repository metadata.
- Canonical OpenWrt release workflow for Standard/AI Support IPK and OpenWrt APK, with SDK-feed boundary tests and optional repository signing secrets (§owrtci1).
- Minimal Telegram adapter through outgoing long polling: configured from LuCI, test message button, chat ID discovery when empty, bot command menu sync, commands for status, device list, internet on/off, Wi-Fi on/off, and support. Internet/Wi-Fi shutdown, log clearing, update, reboot, temporary access and every device-policy mutation require a separate single-use six-digit confirmation generated from secure router randomness. Restoring global internet or Wi-Fi remains immediate (§tgconfirm).
- Resilient per-source site-list updater: bounded downloads and archive extraction, format normalization, deduplication, atomic last-known-good caches kept indefinitely until a valid replacement or deliberate removal, background cache bootstrap after reboot, daily retry after failure, authenticated failure/recovery notifications, and rejection of unexpectedly shortened large sources until explicit acceptance (§slstres).
- LuCI source diagnostics for site lists: each configured source shows its last working domain count, last successful update, failure count/reason and next retry without exposing the URL in runtime status. A suspiciously reduced file shows `before / new` counts and requires a separate 10-second confirmation before acceptance (§slstres).
- Transactional runtime application of site allowlists/blocklists: selectable `auto|adguard|sheepfold` executor, local dnsmasq `nftset` plus Sheepfold-owned nftables sets, one API-managed AdGuard Home URL filter that preserves user filters, built-in fallback after an unconfirmed AdGuard result, fail-open behavior before a verified allowlist exists, and rollback of DNS/readiness/firewall state after an application failure (§dompol). Live-router validation remains required.
- Standard and AI Support test packages now keep their runtime jobs separate, while both declare the HTTPS and network-client dependencies required on a clean router.
- Optional `Feedback / suggestions` tab in LuCI and the parent APK. LuCI temporarily keeps the authenticated Yandex Cloud legacy channel. The parent APK shows the exact report JSON, encrypts it with Tink HPKE before the router, and sends only ciphertext through a separately signed support-server envelope. After selected failures of the saved endpoint, the router can verify one fixed GitHub raw manifest with an offline Ed25519 key and retry its HTTPS endpoint without accepting HPKE keys or other settings from GitHub. Production endpoint, discovery key and manifest are still disabled by default; the child APK has no feedback tab or report route (§feedback, §srep001, §srepdisc1).
- Settings -> Integrations contains an explicitly disabled preview of temporary Sheepfold support access. It shows `Off for now`, `Planned`, and a disabled `Give access` button; it does not persist UCI state, install `frpc`, contact a support server, alter firewall/Podkop, or disable IPv6. A focused threat model and draft router/server protocol now define the future security boundary, but no part of that runtime is active (§rsup001).
- A separate private `sheepfold-support-server` repository now contains a disabled-by-default loopback-only OpenWrt queue PoC and read-only operator CLI, while retaining ownership of the future Codex bridge and relay/control plane. The paired manifests and ADR-0023 document the boundary, but neither repository currently contains an enabled production listener, support transport or router-control service (§rsuppeer).
- Uninstall script that removes the OpenWRT package while preserving Sheepfold settings/client lists and printing a remaining-settings report.


- The `r244` maintenance pass added one bounded service-owned scheduler, a shared log lock, atomic calendar/size rotation, conservative UCI cleanup with snapshot/verification, and a machine-readable updater `probe` that cannot install packages (§maintjob1).


- The `r245` time/detection pass extracted country-aware time presentation into `features/settings/time.js`, added transactional `sheepfold-time-control`, and made optional `nmap` capability/installation explicit without adding a heavy package dependency (§country1, §devpas1, §pkgmgr1).


- The `r246` LuCI action pass added one command runner for high-risk mutations, a structured rpcd helper, real global-internet buttons, duplicate-click protection and explicit saved-but-runtime-failed schedule feedback (§frontmod, §apicon1).


- The `r247` persistence pass moved device/DHCP/access runtime, Wi-Fi reload, backup rollback and administrator pairing into narrow DOM-free adapters. Post-commit runtime failures are now reported as saved-but-not-applied and reload the actual UCI state instead of pretending the save rolled back (§frontmod, §persist1).


- The `r248` coordinator-cleanup pass moved schedule/group UCI and runtime sequencing, shared settings side effects, and local discovery/pairing payload construction into focused modules. `overview.js` now keeps confirmations, modal lifecycle, view callbacks and the top-level save sequence rather than staging these domains directly (§frontmod, §coordclean1).

- The planned P1 LuCI modularization boundary is complete. Navigation/page state, command actions, common UCI mechanics, device/DHCP/access runtime, Wi-Fi reload, backup rollback and administrator pairing are separate modules. The `r248` cleanup removed one-line forwarding helpers and the final direct device-list UCI staging from `overview.js`; the coordinator now keeps only confirmations, cross-feature sequencing, local rendering and page lifecycle. New extraction is justified only when a transaction gains an independent rollback/runtime contract, not to reduce a line counter (§frontmod, §apicon1, §persist1, §coordclean1).


- The `r249` overview presentation pass moved shared Settings fields, the complete Misc and Storage composition, AI provider presentation, and the device-type listbox into focused modules. `overview.js` now wires those modules rather than defining their DOM trees; UCI, command, and runtime ordering remain in the previously extracted adapters (§frontmod, §settingview1).

- The `r250` LuCI pass completes `overview.js` decomposition: the public view is a four-line bootstrap, `features/overview/application.js` is the bounded explicit composition root, and domain behavior lives in focused controllers/persistence modules. Runtime tests load and render the real local module graph for Standard and AI Support (§frontmod, §ovfinal1).

- The `r277` settings pass adds the `Maximum automation`/`Selective automation` profile. Maximum mode is the default, hides its three child choices and writes one canonical new-device/detection/group/identity-monitoring profile; migration selects Selective whenever an older config contains a non-default parent choice. The installer uses the same contract (§autoact1).

- The `r279` pass places Wi-Fi automation with the Wi-Fi radios, adds shared LuCI/Android navigation icons, makes cloud storage visibly experimental, enforces HTTPS-only external site sources with a loopback exception, and extends the authenticated parent API with atomic device/list profile, notification-policy and Wi-Fi-automation writes. Parent Android `0.1.55` adds the corresponding device/list/notification editors, the same all-radio Wi-Fi schedule and ten-second shutdown warning as LuCI, plus revisioned agreement acceptance (§iconcat1, §slstres, §apicon1).

- The temporary support UI remains inert. On 2026-08-31 the Node.js reference gained strict experimental payload validators, a sequential client state machine, signed-byte replay fingerprints and a manual two-repository HTTPS/MFA test bench. The private service now separates claim capabilities from transport preparation and replays a lost revoke response byte for byte. No transport, server, router backend or remote route is enabled by the client package. The test bench starts only a synthetic loopback server; it does not implement FRP, a native OpenWrt manager, offline trust-root rotation, persistent client recovery or safe-apply. See `tools/remoteSupport/README.ru.md` for commands and limits (§rsup001, §rsuppeer).

## Still Target / Incomplete

- The planned LuCI modularization boundary is complete. `core/persistence/uci.js` owns the common UCI apply point; device/DHCP/firewall, Wi-Fi reload, backup rollback and administrator pairing have focused adapters, while `features/overview/application.js` remains the explicit composition root. Remaining LuCI work is evidence-driven dead-code removal, mobile UX and extraction only where a domain gains an independent contract, not another broad decomposition (§frontmod, §apicon1, §persist1, §ovfinal1).
- Emergency-useful domain exceptions and schedule enforcement are implemented initially. Earlier live nftables runs confirmed synthetic schedules, an overnight boundary and conflict outcomes under the then-current policy; they do not validate the later priority decision. The current owner-approved order puts `No restrictions` above the device blocklist for internet only, with independent management denial and quarantine; the focused local runtime model confirms that case. DNS variants, shared CDN addresses, real wall-clock transitions, global block, firewall reload and the current cross-policy combinations still require live-router verification (§emerg1, §fwlock1).
- End-to-end client-traffic verification is still needed for the device blocklist, global block, firewall reload recovery, and all four AdGuard Home/Podkop profiles. The temporary-access UCI/nftables lifecycle itself is confirmed with a synthetic MAC, including expiry and restoration of the previous restriction.
- LuCI has a functional UCI schedule editor with allow/block actions, group or device targets, weekday selection, multiple intervals, overnight ranges, duplication, deletion, and disabling without deletion. `Settings → Misc` also controls whether internet stays off or on for a same-level schedule conflict while preserving the warning and journal event.
- `Settings → Misc` shows the fixed order that effective-status and firewall currently enforce. Editing is intentionally disabled until one configurable `access_priority` implementation is shared by LuCI, status API, schedules, and nftables.
- Additional `/api/v1/*` aliases, a refresh-token flow, and advanced LuCI-only administrator operations remain target work. The authenticated parent-management snapshot now covers pairing, device/list mutations and profile editing, notification policy, global internet state, router information, schedules, groups, Wi-Fi, logs, feedback, and AI where the installed product variant permits it.
- `sheepfold-maintenance` enforces saved RAM-log retention/size limits and removes only old offline device cards with no family/security/DHCP/list/schedule/manual state. Ordinary stable-release checks according to `update_check_install_mode` only notify administrators. Explicit `beta_testing=1` consent in General instead enables hourly newer-release installation through the shared updater; the opt-in stages only SIM/new-Wi-Fi notifications without newly enabling location collection. Local tests cover the opt-in, timer and package error paths; real flock and live-router installation remain separate gates (§maintjob1, §betatest1, §updsafe).
- Parent Android has authenticated router-backed editors for devices and device lists, schedules, custom groups, Wi-Fi and notification policy, a read-only parent-device view grouped by the current owner, global Wi-Fi control, all-radio Wi-Fi automation, and log read/filter/clear. A newly enabled automatic Wi-Fi shutdown keeps the selected time while showing a non-skippable ten-second risk dialog. Device status and manual passport fields use one centralized UCI commit before firewall refresh; if that verified commit succeeds but firewall refresh fails, the API returns `mutation.runtimeApplied=false` and Android shows a saved-but-pending warning instead of claiming the data was lost. List conflicts remain explicit instead of moving a MAC silently. Wi-Fi credentials cross this boundary only to an authenticated administrator over the pinned HTTPS connection because the parent editor and connection QR require them; they are never part of discovery or public status. The app relocks after a configurable background delay (one minute by default), applies escalating backoff after five wrong password/PIN attempts, exposes one honest Android biometric mode, and requires unlock plus confirmation before a widget disables internet unless the owner explicitly enables the warned instant mode. Router writes use the versioned `/api/v1/admin-config` snapshot with optimistic revision checking and capability-gated read-only fallback for older routers; administrator creation and pairing QR intentionally remain in protected LuCI. The release build fails closed without external signing secrets, while the owner-controlled production key, physical-phone and live-router validation remain release evidence (§pairsec, §apicon1, §roadmap).
- The parent API implementation is now separated without changing its wire contract: Android keeps transport/session commands in `RouterAdminClient`, JSON compatibility in `RouterAdminJson`, and data classes in `RouterAdminModels`; OpenWrt keeps a small `sheepfold-api-admin-config` dispatcher plus one read-model, one shared transaction layer and focused schedule/group/Wi-Fi/notification/device modules. All shell modules execute in the same process and still share one lock, revision check, commit and rollback (§apicon1).
- Both Android release variants have fail-closed Gradle wiring for externally supplied signing secrets, but still need the owner's permanent production key and physical-device release validation. Debug APKs are development artifacts, not stable distribution files.
- The parent APK stores the accepted agreement revision and acceptance time separately from its router credential. A material revision asks for consent again without repeating permissions, pairing or app protection. LuCI also exposes a confirmed per-administrator `Terminate all sessions` action that revokes every parent-device Bearer token for that login without deleting the account, devices or family rules. Static tests pass; agreement upgrade and multi-phone revocation still require physical/live-router validation (§authrs1, §pairsec).
- Child Android `1.14` uses public status API v3, which does not transport `accessMode`, schedule-conflict details or a personal-group name. Enabled access carries only the result and next real change time; disabled/unknown states may carry a short safe explanation. Sensitive Android permissions are requested only after the router enables SIM or Wi-Fi/location reporting, and denial does not block the status screen. The app distinguishes an unavailable home router from disabled internet, targets Android 9/API 28+, and fails release packaging closed without external owner signing secrets. Physical-device permission, polling, notification and signed-upgrade validation remain required (§b5wkq2e, §simchg1, §childwifi1, §roadmap).
- Full device detection now reports the explicit state `Full mode without port checks` when the optional `nmap` binary is absent. Core DHCP/neighbor/hostapd/mDNS/UPnP/WS-Discovery detection continues. A separately confirmed button checks the package manager and free overlay space, installs only the named `nmap` package, and verifies the binary; selecting Full mode never installs it automatically (§devpas1, §pkgmgr1).
- Administrator Bearer-token requests now fail closed unless the request IP and router-observed DHCP/neighbor MAC match the paired device headers. Static contract tests pass; a physical-phone pass on the test router is still required for DHCP renewal, Wi-Fi reconnect and roaming between access points (§pairsec).
- Temporary remote support remains an inert LuCI placeholder. The current source profile `sheepfold-support-control-1` now has separate strict typed schemas/validator and a manual Node HTTPS/mTLS/TOTP peer bench, aligned with the private service. Legacy FRP/SSH experiments are historical, not a fallback. ADR-0031 replaces that part of ADR-0022. The owner deferred the installable OpenWrt support client on 2026-10-23; no router manager, activation, native consent/replay/approval or production endpoint is supplied by this source alignment. Frozen vendor/release pins remain separate gates (§rsup001, §rsuppeer).
- The optional parent-APK family message relay source contains a strict `HMAC-SHA256+AES-256-GCM` protocol, golden vector and bounded opaque mailbox. The Android foundation has durable public-attempt and request-bound local lookup regression tests. Physical API 30 crypto/store/discovery, unauthenticated router/TLS and paired reads passed after QR-file pairing (8 tests, no skips); camera QR, API 28 and full relay E2E remain pending. Repeated ID allocation/commits were removed from normal device listing and token-device lookup. Parent panel refresh now uses only the selected panel's required endpoints; control refresh makes one `/router-info` request (1501 ms in the physical API 30 check), not the previous five GETs. Background notifications remain independent (§andpanel1). The standalone native Jansson/OpenSSL helper passes Linux amd64 cross-runtime/ASan/UBSan, SDK 25.12.5/mediatek/filogic build and six isolated target smoke checks under nobody. Package install/UID and other ABIs remain unverified. Router poller/ledger/dispatcher and Android provisioning/UI/lifecycle are not implemented or wired. Production remains `clientsReady=no`, `realDataAllowed=no` (§mrelay1).

## AdGuard Home resilience

- The managed feed is fetched through local `uhttpd` and compared with the active file before refresh; cached AdGuard rules alone are not treated as proof that updates still work.
- Three consecutive synchronization failures create one administrator notification; the first later success creates one recovery notification.
- A token rotation disables the previously owned exact URL before storing the new URL. Ownership metadata is mode `0600` and never appears in status or logs.
- Deleted filters are recreated, renamed filters are restored, duplicate exact URLs are rejected, and all writes remain restricted to the Sheepfold-owned URL filter.
- The service retries an active AdGuard policy every 300 seconds by default and still reacts immediately to DHCP/device-signal changes.
- VK and MAX messenger adapters are documented but not implemented.
- Telegram adapter is not a complete production adapter yet: dangerous infrastructure and device-policy actions have one-time confirmation, while richer multi-admin binding, stricter structured command parsing and broader live-router tests remain (§tgconfirm).
- AdGuard Home site filtering is represented in LuCI and implemented through the local API. Podkop remains compatibility-oriented: Sheepfold detects it and preserves its routing state but does not manage Podkop routes.
- AdGuard Home automatic management owns only the Sheepfold URL filter. It reads `/control/status`, `/control/dns_info`, `/control/filtering/status`, and uses read-only `/control/filtering/check_host` for reserved `.test` control rules; global protection, upstreams, clients, DHCP, logs, TLS and user rules are not automatically changed (§aghplan).
- The AdGuard adapter enforces an exact API endpoint/query allowlist, bounded response time/size, fresh response files, schema checks, and distinct failure reasons. It records only safe DNS aggregates, rejects a stopped server or disabled global protection, tolerates unavailable optional DNS diagnostics without removing a confirmed filter, and keeps the built-in fallback. A successful engine check requires exact rule text and the Sheepfold filter ID for global block, emergency allow and an active strict IPv4 class. LuCI still distinguishes this from the unverified LAN-client DNS path. A fake HTTP server verifies this contract; live-router validation remains required (§aghplan).
- Site allowlist/blocklist source files are consumed by the runtime domain policy, and LuCI reports whether filtering is confirmed in AdGuard Home, active through Sheepfold, running through fallback, waiting, unsupported, manual/unverified, or failed. All four topology modes and API failure paths still require live-router tests; DNS-level filtering does not inspect URLs/content and does not yet prevent external DNS, DoH, VPN, proxy, or direct-IP bypass (§slstres, §dompol, §uirunfx).
- The installer downloads the matching IPK or OpenWrt APK from the latest normal GitHub Release, installs it through the native package manager, then applies the chosen language, country and maximum/selective automation profile plus the detected AdGuard Home/Podkop combination. A repeated run defaults to the current language, Standard/AI Support edition and automation mode; selective subordinate settings are preserved unless maximum automation is explicitly selected. It intentionally ignores pre-releases because updates use the stable `releases/latest` channel (§pkgmgr1, §autoact1, §prodvar).
- Country profiles now supply explicit timezone/NTP recommendations for Russia, Belarus and China plus a neutral `Other country` profile without public-IP geolocation. Existing OpenWrt time settings remain authoritative and recommendations require an explicit save; automatic recovery after an invalid clock, country-specific connectivity diagnostics and AI-provider availability still remain target work (§country1).
- Router time setup now preserves an existing OpenWrt timezone, warns about an unset or implausible clock, offers country recommendations, rejects malformed timezone/NTP input, and applies both `system` and Sheepfold UCI through a locked snapshot/verification transaction. Real reboot/NTP convergence and wall-clock schedule transitions still require live-router evidence (§country1).

## Documentation Reading Rule

Documents under `docs/` mix current implementation notes and target product requirements. When a document describes an API, schedule engine, messenger bot, AI assistant, or complete enforcement behavior, treat it as the intended contract unless this status file says the feature is already implemented.

The historical implementation audit is recorded in [`implementation-audit-2026-07-16.ru.md`](implementation-audit-2026-07-16.ru.md) (§implaudit). Dated merge and live-router evidence is preserved in [`merge-readiness-plan.ru.md`](merge-readiness-plan.ru.md) (§mrgready): on 2026-07-19 the complete Node suite passed with 373 passed tests and one intentionally skipped concurrency test, both Android debug APKs compiled, and both test IPK variants `0.1.0-230` were packaged. The first official SDK-built `0.1.0-r230` live-router pass exposed document-wide mobile overflow in Settings -> Information. The bounded-grid fix was then released as the official OpenWrt 25.12 package `0.1.0-r231` (verified SHA-256 `4d0374202b4f32372b75b3cd7f9b64e054d226fcf3f83917c981cba234d1d03f`) and installed as an in-place `r230 -> r231` upgrade after a fresh local backup. Package/UCI version checks, executable files, API discovery, TLS SPKI, router information, IPv6 status, `fw4 check`, and pending-UCI checks all passed. The installed LuCI page also passed the read-only desktop/mobile browser smoke without RPC/JavaScript errors or horizontal overflow. The matching GitHub Validate workflow passed shell/Node and both Android jobs, and the official SDK matrix successfully built and bundled all four Standard/AI Support IPK/APK router packages. These are historical results, not evidence for the current `r279` source tree; current local and still-required live checks are listed in the same readiness plan.

On 2026-07-20 the next LuCI modularization pass extracted backup dialogs, shared text downloads and the router/cloud storage panel, and consolidated duplicated Yandex Disk/Google Drive UI behavior. The complete Node suite then passed with 375 tests and one intentionally skipped concurrency test; focused syntax, localization, asset-versioning and Standard/AI Support package-boundary checks also passed (§frontmod, §cfgbak1).

The same-day follow-up extracted Wi-Fi editor registration, dirty state and save sequencing into `features/wifi/editor.js`. The coordinator now supplies only wireless UCI operations, commit and reload callbacks. A focused test preserves the shared-radio rule that enabling one AP must not silently enable neighboring APs left off; the complete LuCI category passed 147/147 (§frontmod, §wifitgl1).

The integrations follow-up extracted topology selection, site-filter executor controls, AdGuard credentials and the Podkop-linked IPv6 draft rule into `features/integrations/panel.js`. A pure transition test distinguishes automatic `auto_podkop` state from a parent's manual IPv6 choice; runtime application remains in the existing backend. The canonical LuCI category passed 150/150 and the packaging category passed 70/70 (§frontmod, §dompol, §ipv6pod).

The same-day live-router device pass found and fixed two discovery boundaries: an empty DHCP hostname no longer shifts tab-separated fields and hides an online client, and `jshn` MAC keys from `hostapd.* get_clients` are converted back from underscores. A RAM-only DHCP lease fallback, a bounded supplemental OUI entry for `FC671F` Tuya, and a cautious privacy-MAC personal-phone hint were added without treating model, vendor, or owner as trusted identity (§devpas1).

On 2026-07-21 the final `globalTest` pre-merge gate passed with 422 tests: 421 passed, one intentional concurrency test was skipped, and none failed. GitHub Actions run [29784939492](https://github.com/hayOfLife/luci-app-sheepfold-family-internet-control/actions/runs/29784939492) successfully built and bundled Standard and AI Support packages through the official OpenWrt 24.10.7 IPK and 25.12.5 APK SDKs. The test router reported installed `0.1.0-r241`; read-only checks confirmed package/UCI version, pairing transaction semantics, executable files, discovery, TLS SPKI, router information, IPv6 state, `fw4 check`, and no pending UCI changes. The installed LuCI passed desktop/mobile browser checks without JavaScript/RPC errors or horizontal overflow; 109 non-blocking small-target warnings remain a dedicated mobile UX task. PR [#3](https://github.com/hayOfLife/luci-app-sheepfold-family-internet-control/pull/3) was then merged fast-forward into `main` at `c80cd09`; the post-merge Validate and four-package SDK workflows also passed (§qassist, §uxrev01, §roadmap).

The next P1 modularization pass extracted `features/settings/general.js` and `features/settings/persistence.js`. The first owns only General-tab composition and draft transitions; the second validates and partitions one draft across named UCI sections through a narrow adapter. Runtime side-effect ordering remains centralized in `overview.js`, which decreased from about 5056 to 4770 physical lines. The complete Node suite passed with 424 tests: 423 passed, one intentional lock-concurrency test was skipped, and none failed. Fresh Standard and AI Support test packages and both prepared SDK feeds were used so package-boundary tests executed without the Windows sandbox `Node -> Python` restriction (§frontmod, §prodvar, §roadmap).

On 2026-07-21 the cumulative `chatGPT` pass replaced the remaining parent-screen placeholders and added a versioned administrator configuration API. Schedule/group changes are serialized by one lock, use an isolated UCI delta, compare an optimistic revision, verify the committed state and preserve a rollback snapshot. The same pass extracted LuCI navigation state, added one-minute default relocking with selectable delays, escalating password/PIN backoff, a single Android biometric mode, protected widget shutdown and fail-closed external release-signing configuration. Physical phones and live-router validation are still required.

On 2026-07-22 the next cumulative `chatGPT` pass minimized `/client-status` to API v3, removed child-visible access-mode/conflict/group-name fields, gated SIM and Wi-Fi reporting behind the latest router policy, replaced startup-wide permission prompts with explained just-in-time requests, raised the child minimum to Android 9 and added fail-closed external release signing. A lost router now has a separate UI state and never masquerades as disabled internet. Physical Android and live-router evidence is still pending.

- The audited `r252` pass keeps `overview.js` as a four-line bootstrap, adds strict local-module/dependency/UCI-contract checks, and fixes partial persistence, pairing refresh, administrator refresh and LuCI UCI transaction semantics. Model tests do not replace the installed-router/browser matrix (§ovaudit5).

- The `r253` hardening pass centralized dynamic AI JSON construction in the AI-only `sheepfold-lib-json`; the later merge audit moved strict form decoding into the shared `sheepfold-lib-form` because both Standard administrator writes and AI Support accept form-urlencoded input. Malformed encoding is rejected before either boundary. The same pass moved child periodic/boot network refresh to constrained WorkManager while retaining exact access-ending alarms, stopped abandoned schedule-conflict timers, and lowered bounded `nmap` CPU priority when `nice` is available. Physical Android timing and installed-router verification remain separate evidence (§jsonio1, §andwork1, §frontmod, §detload).

- The follow-up archive review removes dialect-dependent interval expressions from
  `awk`, keeps child status free of the rule that granted access, attributes time
  changes through the common log actor, and preserves every LuCI caller's refresh
  when identical backend mutations are coalesced. File-size warnings were recorded
  as reasoned refactoring candidates rather than used as permission to split
  transactions mechanically. The strict quality gate passed with 597 tests:
  596 passed, one intentional concurrency test was skipped, and none failed;
  ESLint, both Android Lint projects, documentation and change-impact coverage also
  passed (§awkport1, §actsub1, §auditopt1).

- The test-coverage audit added a behavioral modal-timer lifecycle test and moved
  provider payload builders into the AI-only JSON helper. AI Support live-router
  read-only checks now round-trip complex chat and Gemini text through the target
  OpenWrt `jshn` without an API key or provider request. Proposed UCI batch export,
  OkHttp migration and schedule indexing remain conditional on a measured problem
  and an approved implementation, so tests do not silently choose architecture
  (§jsonio1, §frontmod, §auditopt1).
