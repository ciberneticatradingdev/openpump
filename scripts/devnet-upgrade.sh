#!/usr/bin/env bash
# Upgrade one program on devnet from target/deploy, growing the program account first if the binary got bigger.
# Usage: ./scripts/devnet-upgrade.sh amm|curve|fees [rpc-url]
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=${1:?amm|curve|fees}; URL=${2:-${DEVNET_RPC_URL:-https://api.devnet.solana.com}}; K=${KEYPAIR:-$HOME/.config/solana/id.json}
case $NAME in
  amm)   ID=BQHw8ro8CMRQbRGDWsseCEffKksJZCqUg4K45sjA6eYb ;;
  curve) ID=AmSumZo1ko2pXPKCAxp2uZwcFoQrVzNkRFf4w7EEHunB ;;
  fees)  ID=goxedqtEDBUXsuMxYDpgfivPGZuQD4ifzfcFkhVCUe5 ;;
  *) echo "unknown program $NAME"; exit 1 ;;
esac
SO=target/deploy/openpump_${NAME}.so
NEW=$(stat -f%z "$SO" 2>/dev/null || stat -c%s "$SO")
CUR=$(solana program show "$ID" -u "$URL" 2>/dev/null | awk '/Data Length/{print $3}' || true)
echo "$NAME: binary $NEW bytes, on-chain ${CUR:-none}"
if [ -n "${CUR:-}" ] && [ "$NEW" -gt "$CUR" ]; then
  solana program extend "$ID" $((NEW - CUR)) -u "$URL" -k "$K"
fi
# TPU sends; retries + priority fee because public devnet RPCs rate-limit by IP
solana program deploy "$SO" --program-id "$ID" --upgrade-authority "$K" -u "$URL" -k "$K" --max-sign-attempts 100 --with-compute-unit-price 200000
solana program show "$ID" -u "$URL" | grep -E "Data Length|Last Deployed"
echo "next: cd server && RPC_URL=$URL pnpm admin:amm-extend   (after an AMM upgrade that grew layouts)"
