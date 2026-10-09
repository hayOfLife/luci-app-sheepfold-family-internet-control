# GitHub installation and release setup

Repository:

```text
https://github.com/hayOfLife/luci-app-sheepfold-family-internet-control
```

## Public install

```sh
wget -O /tmp/sheepfold-install.sh https://raw.githubusercontent.com/hayOfLife/luci-app-sheepfold-family-internet-control/main/install.sh &&
sh /tmp/sheepfold-install.sh
```

The installer reads the latest stable GitHub Release, asks for Standard or AI
Support, detects the router package manager, and downloads the matching format:

- OpenWrt 24.10 and older: `.ipk` installed by `opkg`;
- OpenWrt 25.12 and newer: a real OpenWrt `.apk` installed by apk-tools v3.

It does not confuse an OpenWrt APK with an Android APK. Before downloading, the
bootstrap checks the exact Sheepfold repository path, a single safe release tag,
and the selected edition's package filename/extension. The system package manager
then processes the downloaded package. Unlike the installed updater, `install.sh`
does not yet independently validate all internal package metadata or archive paths.
Do not describe these two entry points as providing identical verification.

## GitHub account rename

The canonical owner is `hayOfLife` (verified on 2026-10-10). Old `kva4991` API URLs
redirect, while release metadata already contains the new owner. New source URLs,
Android metadata requests and router release-path checks must change together;
arbitrary redirects or a second permanently trusted owner are not a migration strategy.
The [update safety contract](update-safety.ru.md) records the compatibility limits.

The `update.sh` wrapper still delegates to the **installed** updater. It cannot repair
an older helper that rejects the renamed release URLs. After a separately approved
build/publication, install the verified replacement locally while preserving settings.
Do not fetch and execute an arbitrary remote helper as a bypass. The latest release
observed on 2026-10-10 still contains the historical r58 IPK; a source fix is not a release.

## Public uninstall

```sh
wget -O /tmp/sheepfold-uninstall.sh https://raw.githubusercontent.com/hayOfLife/luci-app-sheepfold-family-internet-control/main/uninstall.sh &&
sh /tmp/sheepfold-uninstall.sh
```

The uninstaller removes the package through the current router package manager,
keeps `/etc/config/sheepfold` and client settings, and prints the remaining-state
report.

## Canonical package build

Public OpenWrt packages are built by
`.github/workflows/build-openwrt-packages.yml` through the pinned official
OpenWrt SDK Action (§owrtci1). The matrix contains Standard and AI Support for
OpenWrt 24.10/IPK and 25.12/OpenWrt APK.

Run it in GitHub under `Actions → Build OpenWrt packages → Run workflow`, or:

```powershell
gh workflow run "Build OpenWrt packages" --ref main
gh run watch
```

On PR/push, download the `sheepfold-openwrt-packages` Actions artifact. The
bundle contains four router packages, per-build metadata, `SHA256SUMS`, and an
aggregate manifest. `scripts/build-test-ipk.py` is only a fast local test
builder and must not be used as the canonical public release chain.

Full instructions, signing secrets, pinned SDK versions, and maintenance rules:
[`github-actions-openwrt-build.ru.md`](github-actions-openwrt-build.ru.md).

## Publishing a stable release

1. Merge and verify the intended commit in `main`.
2. Make sure the package release number was increased.
3. Run the full test suite and the OpenWrt workflow manually.
4. Install the resulting package on the test router and verify update/config
   preservation.
5. Create a GitHub Release tag for the verified commit.
6. Publish it as a normal Release, not a draft or Pre-release.
7. Wait for `Build OpenWrt packages` to finish.
8. Verify that the Release has two IPK files, two OpenWrt APK files,
   `SHA256SUMS`, and `openwrt-build-manifest.json`.

Only the release-publishing job receives `contents: write`. A pre-release does
not receive router assets because the updater deliberately follows
`releases/latest`.

## Updating an installed router

```sh
wget -O /tmp/sheepfold-update.sh https://raw.githubusercontent.com/hayOfLife/luci-app-sheepfold-family-internet-control/main/update.sh &&
sh /tmp/sheepfold-update.sh
```

The installed updater compares package-manager versions, validates the trusted
GitHub asset path and internal metadata, saves the UCI configuration before the
package-manager transaction, and attempts verified atomic configuration recovery
after a failed install. A failed recovery retains its available snapshot/state and
blocks another install until an operator resolves them. The default snapshot lives
in RAM and does not survive reboot. This is configuration recovery, not a binary
firmware rollback; see the [recovery procedure](update-safety.ru.md#восстановление-после-файлового-отказа).

The optional `beta_testing=1` General setting authorizes hourly background updates
from the same published stable releases, with no same-version reinstall or edition
switch. It defaults to off and is never activated by package migration. See the
[maintenance contract](maintenance-jobs.ru.md) for consent, notification settings,
shutdown behavior and test commands.
