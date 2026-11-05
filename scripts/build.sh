#!/usr/bin/env bash
# Gera os pacotes da extensão em dist/:
#   neurotab.zip           → Edge, Chrome, Brave, Opera (Chromium)
#   neurotab-vX.Y.Z.zip    → o mesmo, com a versão no nome
#   neurotab-firefox.zip   → Firefox
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(node -p "require('./manifest.json').version")
rm -rf build dist
mkdir -p build/chromium build/firefox dist
for d in build/chromium build/firefox; do cp -r manifest.json src icons _locales LICENSE "$d/"; done
node scripts/firefox-manifest.mjs build/firefox/manifest.json
(cd build/chromium && zip -qr ../../dist/neurotab.zip .)
(cd build/firefox && zip -qr ../../dist/neurotab-firefox.zip .)
cp dist/neurotab.zip "dist/neurotab-v$V.zip"
echo "Pacotes da versão $V em dist/:" && ls -1 dist
