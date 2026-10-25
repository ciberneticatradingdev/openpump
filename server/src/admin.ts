/**
 * One-off admin commands run from the deployer's machine:
 *   pnpm admin:init     -> create AMM config + curve Global with DEFAULT_PARAMS
 *   pnpm admin:params   -> re-apply DEFAULT_PARAMS (set_params)
 *   pnpm admin:fees     -> initialize the fees program (global, tiered config, buyback vault 0) and
 *                          route 20 % of the protocol fee to the buyback vault (set_params)
 *   tsx src/admin.ts incentives <mint> <startUnix> <endUnix> <secondsInADay> <dayNumber|30> <tokensPerDay(base units)>
 *                       -> schedule / fund the trade-to-earn campaign (then transfer tokens to the vault ATA)
 * Needs ADMIN_KEYPAIR (JSON array or base58) matching INITIAL_AUTHORITY/INITIAL_ADMIN in the programs.
 */
import "dotenv/config";
import fs from "node:fs";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { DEFAULT_AMM_FEES, DEFAULT_FEE_TIERS, DEFAULT_FLAT_FEES, DEFAULT_PARAMS, OpenpumpClient, bs58decode, pda } from "@openpump/sdk";

function loadKeypair(): Keypair {
  const raw = process.env.ADMIN_KEYPAIR || fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8");
  if (raw.trim().startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58decode(raw.trim()));
}

async function main() {
  const cmd = process.argv[2];
  const conn = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const admin = loadKeypair();
  const provider = new AnchorProvider(conn, new Wallet(admin), { commitment: "confirmed" });
  const client = new OpenpumpClient(conn, provider);
  const feeRecipient = new PublicKey(process.env.FEE_RECIPIENT || admin.publicKey.toBase58());
  const params = { feeRecipient, ...DEFAULT_PARAMS };
  console.log("admin", admin.publicKey.toBase58(), "fee recipient", feeRecipient.toBase58());

  const tx = new Transaction();
  if (cmd === "init") {
    tx.add(await client.createAmmConfigIx(admin.publicKey, DEFAULT_AMM_FEES.lpFeeBasisPoints, DEFAULT_AMM_FEES.protocolFeeBasisPoints, DEFAULT_AMM_FEES.coinCreatorFeeBasisPoints, feeRecipient));
    tx.add(await client.initializeIx(admin.publicKey, params));
  } else if (cmd === "params") {
    tx.add(await client.setParamsIx(admin.publicKey, params));
  } else if (cmd === "fees") {
    const social = new PublicKey(process.env.SOCIAL_CLAIM_AUTHORITY || admin.publicKey.toBase58());
    tx.add(...(await client.initializeFeeProgramIxs(admin.publicKey, social, DEFAULT_FLAT_FEES, DEFAULT_FEE_TIERS)));
    tx.add(await client.setParamsIx(admin.publicKey, { ...params, buybackBasisPoints: BigInt(process.env.BUYBACK_BPS || 2000), buybackFeeRecipient: pda.buybackVault(0) }));
    console.log("fee config", pda.feeConfig().toBase58(), "buyback vault", pda.buybackVault(0).toBase58(), "social claim authority", social.toBase58());
  } else if (cmd === "incentives") {
    const [mint, start, end, day, dayNumber, supply] = process.argv.slice(3);
    tx.add(await client.adminUpdateIncentivesIx(admin.publicKey, new PublicKey(mint), { startTime: Number(start), endTime: Number(end), secondsInADay: Number(day), dayNumber: Number(dayNumber), tokenSupplyPerDay: BigInt(supply) }));
    console.log("vault ATA:", (await import("@solana/spl-token")).getAssociatedTokenAddressSync(new PublicKey(mint), (await import("@openpump/sdk")).pda.globalVolumeAccumulator(), true).toBase58());
  } else {
    throw new Error("usage: admin.ts init|params|fees|incentives");
  }
  const sig = await provider.sendAndConfirm(tx, [admin]);
  console.log("ok", sig);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
