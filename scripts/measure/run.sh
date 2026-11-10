#!/bin/sh
# Copies scripts/measure into the backend container and runs one script there.
#
#   sh scripts/measure/run.sh 01-model-info.mjs [args...]
#
# MSYS_NO_PATHCONV stops Git Bash on Windows from rewriting /tmp/... into a
# Windows path before docker sees it. Output and the token ledger live in
# /tmp/measure-out inside the container and are mirrored to scripts/measure/out
# after every run, so the ledger survives a container restart.
set -e
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/../.."

docker compose exec -T backend sh -c 'mkdir -p /tmp/measure /tmp/measure-out'
for f in scripts/measure/*.mjs; do
  docker compose cp "$f" backend:/tmp/measure/ >/dev/null 2>&1
done
# A restarted container has lost its ledger; put the mirrored one back first.
if [ -f scripts/measure/out/ledger.json ]; then
  docker compose exec -T backend sh -c 'test -f /tmp/measure-out/ledger.json' 2>/dev/null \
    || docker compose cp scripts/measure/out/ledger.json backend:/tmp/measure-out/ledger.json >/dev/null 2>&1
fi
# Inputs (UTF-8 text, extracted documents) travel the same way.
if [ -d scripts/measure/in ]; then
  docker compose exec -T backend sh -c 'mkdir -p /tmp/measure/in'
  for f in scripts/measure/in/*; do
    [ -f "$f" ] && docker compose cp "$f" backend:/tmp/measure/in/ >/dev/null 2>&1
  done
fi

script="$1"; shift
status=0
docker compose exec -T -e MEASURE_OUT=/tmp/measure-out backend node "/tmp/measure/$script" "$@" || status=$?

mkdir -p scripts/measure/out
docker compose cp backend:/tmp/measure-out/. scripts/measure/out/ >/dev/null 2>&1
exit $status
