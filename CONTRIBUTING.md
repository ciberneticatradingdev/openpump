# Contributing

Thanks for looking at OpenPump. Here is how to get a change in.

## Setup

Requirements: Rust, Solana CLI 2.x, Anchor 0.31.1, Node 20+, pnpm.

```bash
pnpm install
./scripts/build.sh            # builds the four programs with platform-tools v1.54 and regenerates IDLs/types
anchor test --skip-build      # full integration suite, ~1 minute on a quiet machine
```

Tests are driven off the chain clock, not wall-clock sleeps. If a test times out, close memory-hungry apps before blaming the test.

## Ground rules

- **Clean room.** Do not paste code from pump.fun's recovered sources or any other unlicensed program. Describe the behaviour, write it yourself.
- **Every program change ships with a test** in `tests/openpump.ts`. Math changes also need a unit test in the program's `math.rs`.
- **IDL changes propagate.** After touching a program, run `./scripts/build.sh` and commit the updated `sdk/idl/*.json` and `sdk/src/openpump_*.ts`.
- **Account layouts only grow.** Append fields; never reorder or remove. Old accounts are upgraded with `extend_account`.
- **No new signers in the server.** Cranks run with the keys they already have; anything that needs a new privileged key is an on-chain design question first.

## Pull requests

- One topic per PR, with the roadmap phase in the title when it applies (`[phase-3] creator claim page`).
- Explain what changed on-chain, if anything, and how it was tested.
- CI runs the build and the test suite; keep it green.

## Where help is most useful

- SDK examples and documentation
- Indexer performance (backfill, WebSocket fan-out)
- UI polish and accessibility
- Edge-case tests: dust amounts, rounding at the end of the curve, Token-2022 extensions
