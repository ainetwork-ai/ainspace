#!/bin/sh
set -eu
TASK_NODE="${AINSPACE_NODE_BIN:-/home/comcom/.local/node/bin/node}"
TASK_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TASK_REPO=$(git -C "$TASK_DIR" rev-parse --show-toplevel)
TASK_REV=$(git -C "$TASK_REPO" rev-parse HEAD)
if [ -n "$(git -C "$TASK_REPO" status --porcelain)" ]; then
  echo "Commit the reviewed release before deploying" >&2; exit 1
fi
TASK_ROOT="${AINSPACE_STORAGE_ROOT:-$HOME/.ainize-web/ainspace-storage}"
TASK_RELEASE="$TASK_ROOT/releases/$TASK_REV"
TASK_TOKEN_FILE="${AINSPACE_STORAGE_TOKEN_FILE:-$HOME/.ainize-web/uncommon-orchestrator/ainspace-storage-token.secret}"
mkdir -p "$TASK_RELEASE" "$HOME/.config/systemd/user"
cp "$TASK_DIR/package.json" "$TASK_DIR/package-lock.json" "$TASK_DIR/tsconfig.json" "$TASK_RELEASE/"
cp "$TASK_DIR/"*.mjs "$TASK_RELEASE/"
cp -R "$TASK_DIR/src" "$TASK_RELEASE/"
cd "$TASK_RELEASE"
export PATH="$(dirname "$TASK_NODE"):$PATH"
npm ci --ignore-scripts > "$TASK_ROOT/install-$TASK_REV.log" 2>&1
"$TASK_NODE" node_modules/typescript/bin/tsc
"$TASK_NODE" --test dist/*.test.js *.test.mjs
ln -sfn "$TASK_RELEASE" "$TASK_ROOT/current"
cat > "$HOME/.config/systemd/user/ainspace-storage.service" <<UNIT_CONTENT
[Unit]
Description=AINspace encrypted blockchain state and live presence
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$TASK_ROOT/current
ExecStart=$TASK_NODE $TASK_ROOT/current/dist/server.js
Environment=AIN_STATE_CONFIG=$TASK_ROOT/config.json
Environment=AINSPACE_STORAGE_TOKEN_FILE=$TASK_TOKEN_FILE
Environment=PORT=13006
Restart=on-failure
RestartSec=3
MemoryMax=2G
NoNewPrivileges=true
UMask=0077

[Install]
WantedBy=default.target
UNIT_CONTENT
systemctl --user stop uncommon-ainspace-storage-candidate 2>/dev/null || true
systemctl --user daemon-reload
systemctl --user enable --now ainspace-storage.service
systemctl --user restart ainspace-storage.service
echo "Storage release $TASK_REV installed; verify authenticated public health before changing frontend routing."
