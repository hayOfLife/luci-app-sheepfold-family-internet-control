#!/bin/sh
set -eu

OWNER="hayOfLife"
REPO="luci-app-sheepfold-family-internet-control"
PACKAGE="luci-app-sheepfold-family-internet-control"

echo "Sheepfold updater"
echo "Repository: ${OWNER}/${REPO}"
echo "Package: ${PACKAGE}"

if [ -x /usr/libexec/sheepfold/sheepfold-updater ]; then
    exec /usr/libexec/sheepfold/sheepfold-updater install
fi

echo "Sheepfold package updater is not installed yet."
echo "Install the OpenWRT package first, then use LuCI Settings -> Misc -> Update app."

exit 0
