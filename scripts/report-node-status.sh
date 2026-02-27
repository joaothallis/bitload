#!/usr/bin/env bash
set -u

NODE_NAME="${1:-bitcoin-node-1}"
DATADIR="${2:-.devenv/state/${NODE_NAME}}"
OUTFILE="${3:-${NODE_NAME}-status.txt}"

COMMANDS=(
  "getblockchaininfo"
  "getnetworkinfo"
  "getrpcinfo"
  "getmempoolinfo"
  "getpeerinfo"
)

{
  echo "# ${NODE_NAME} status"
  echo "generated_at=$(date -Iseconds)"
  echo "datadir=${DATADIR}"
  echo

  for cmd in "${COMMANDS[@]}"; do
    echo "## command"
    echo "bitcoin-cli -regtest -datadir=${DATADIR} ${cmd}"
    echo

    bitcoin-cli -regtest -datadir="${DATADIR}" "${cmd}"
    rc=$?
    echo
    echo "exit_code=${rc}"
    echo
  done
} > "${OUTFILE}" 2>&1

echo "Wrote ${OUTFILE}"
