#!/usr/bin/env bash
# Install fleet-agent on this machine: Ed25519 key (private key never leaves), systemd timer every 30 s.
# Usage: bash install-agent.sh <agent_id> <hub_url>. Prints the public key to register on the hub.
set -euo pipefail
ID="$1"; HUB="$2"
DIR="$HOME/.fleet"; mkdir -p "$DIR"; chmod 700 "$DIR"
# Every module agent.mjs imports must be here (fleet/install-modules.test.mjs checks the list).
for f in jwt agent git-guard commands commandSpec judgeRun judge snapshot snapshotFilter overlapFile; do
  cp "$(dirname "$0")/$f.mjs" "$DIR/"
done
if [ ! -f "$DIR/key.pem" ]; then
  node -e "const c=require('crypto');const k=c.generateKeyPairSync('ed25519');require('fs').writeFileSync('$DIR/key.pem',k.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});require('fs').writeFileSync('$DIR/pub.pem',k.publicKey.export({type:'spki',format:'pem'}))"
fi
chmod 600 "$DIR/key.pem"
sudo tee /etc/systemd/system/fleet-agent.service >/dev/null <<EOF
[Unit]
Description=fleet-agent report
[Service]
Type=oneshot
User=$(id -un)
Environment=FLEET_ID=$ID FLEET_HUB=$HUB FLEET_KEY=$DIR/key.pem FLEET_ROOT=/data/home
# Login shell: loads /etc/profile.d (InstaBox secrets, e.g. GH_TOKEN for git fetch); systemd alone does not.
ExecStart=/bin/bash -lc "exec $(command -v node) $DIR/agent.mjs"
EOF
sudo tee /etc/systemd/system/fleet-agent.timer >/dev/null <<EOF
[Unit]
Description=fleet-agent every 30 s
[Timer]
OnBootSec=20
OnUnitActiveSec=30
AccuracySec=5
[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now fleet-agent.timer
echo "PUBKEY_BEGIN"; cat "$DIR/pub.pem"; echo "PUBKEY_END"
