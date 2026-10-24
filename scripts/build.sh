#!/usr/bin/env bash
# Anchor 0.31 defaults to platform-tools v1.43 (Cargo 1.79) which cannot parse edition-2024 crates,
# so we build the SBF binaries with v1.54 and generate IDLs/types in a separate step (host toolchain).
set -euo pipefail
cd "$(dirname "$0")/.."
source ~/.cargo/env
anchor build --no-idl -- --tools-version v1.54 "$@"
mkdir -p target/idl target/types
for p in peoplepad_amm peoplepad_curve; do
  anchor idl build -p "$p" -o "target/idl/$p.json" -t "target/types/$p.ts"
done
ls -la target/deploy/*.so target/idl/*.json target/types/*.ts
