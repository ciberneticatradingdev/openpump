#!/usr/bin/env bash
# Local validator with both programs + Metaplex preloaded (same setup as `anchor test`).
# Usage: ./scripts/localnet.sh            (foreground)
set -euo pipefail
cd "$(dirname "$0")/.."
pkill -f solana-test-validator 2>/dev/null || true
sleep 1
exec solana-test-validator --reset --quiet \
  --ledger .anchor/dev-ledger \
  --bpf-program AmSumZo1ko2pXPKCAxp2uZwcFoQrVzNkRFf4w7EEHunB target/deploy/openpump_curve.so \
  --bpf-program BQHw8ro8CMRQbRGDWsseCEffKksJZCqUg4K45sjA6eYb target/deploy/openpump_amm.so \
  --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s tests/fixtures/mpl_token_metadata.so \
  --rpc-port 8899
