/**
 * Standalone AMM pools from the deployer's machine (devnet validation of OpenSwap without the curve):
 *   pnpm pool token <name> <symbol> <supplyWhole> [uri]   -> new 6-decimal SPL mint + Metaplex metadata, supply minted to the admin
 *   pnpm pool create <mint> <baseWhole> <quoteSol> [index] -> create a <mint>/SOL pool seeded with those amounts (LP to the admin)
 *   pnpm pool show <pool>                                   -> reserves, LP supply, price
 * Needs the same keypair as admin.ts (ADMIN_KEYPAIR or ~/.config/solana/id.json).
 */
import "dotenv/config";
import fs from "node:fs";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createInitializeMint2Instruction, createMintToInstruction, getAssociatedTokenAddressSync, getMinimumBalanceForRentExemptMint, MINT_SIZE, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { MPL_TOKEN_METADATA_PROGRAM_ID, OpenpumpClient, WSOL_MINT, bs58decode, pda } from "@openpump/sdk";

const DECIMALS = 6;

function loadKeypair(): Keypair {
  const raw = process.env.ADMIN_KEYPAIR || fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8");
  if (raw.trim().startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58decode(raw.trim()));
}

/** Metaplex CreateMetadataAccountV3 (discriminator 33), hand-encoded so the server needs no mpl dependency. */
function createMetadataIx(mint: PublicKey, authority: PublicKey, name: string, symbol: string, uri: string): TransactionInstruction {
  const str = (s: string) => { const b = Buffer.from(s, "utf8"); const len = Buffer.alloc(4); len.writeUInt32LE(b.length); return Buffer.concat([len, b]); };
  const data = Buffer.concat([
    Buffer.from([33]),
    str(name), str(symbol), str(uri),
    Buffer.from([0, 0]), // seller_fee_basis_points u16
    Buffer.from([0]),    // creators: None
    Buffer.from([0]),    // collection: None
    Buffer.from([0]),    // uses: None
    Buffer.from([1]),    // is_mutable
    Buffer.from([0]),    // collection_details: None
  ]);
  return new TransactionInstruction({
    programId: MPL_TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: pda.metadata(mint), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const conn = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const admin = loadKeypair();
  const provider = new AnchorProvider(conn, new Wallet(admin), { commitment: "confirmed" });
  const client = new OpenpumpClient(conn, provider);
  await client.detectFeeProgram().catch(() => {});
  const send = (ixs: TransactionInstruction[], signers: Keypair[] = []) => provider.sendAndConfirm(new Transaction().add(...ixs), signers);

  if (cmd === "token") {
    const [name, symbol, supplyWhole, uri = ""] = args;
    if (!name || !symbol || !supplyWhole) throw new Error("usage: pool token <name> <symbol> <supplyWhole> [uri]");
    const mint = Keypair.generate();
    const ata = getAssociatedTokenAddressSync(mint.publicKey, admin.publicKey);
    const supply = BigInt(supplyWhole) * 10n ** BigInt(DECIMALS);
    const sig = await send([
      SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: mint.publicKey, space: MINT_SIZE, lamports: await getMinimumBalanceForRentExemptMint(conn), programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(mint.publicKey, DECIMALS, admin.publicKey, null),
      createMetadataIx(mint.publicKey, admin.publicKey, name, symbol, uri),
      createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata, admin.publicKey, mint.publicKey),
      createMintToInstruction(mint.publicKey, ata, admin.publicKey, supply),
    ], [mint]);
    console.log(`mint ${mint.publicKey.toBase58()} (${symbol}, ${supplyWhole} minted to ${admin.publicKey.toBase58()})\nsig ${sig}`);
  } else if (cmd === "create") {
    const [mintS, baseWhole, quoteSol, indexS] = args;
    if (!mintS || !baseWhole || !quoteSol) throw new Error("usage: pool create <mint> <baseWhole> <quoteSol> [index]");
    const mint = new PublicKey(mintS);
    const baseIn = BigInt(Math.round(Number(baseWhole) * 10 ** DECIMALS));
    const quoteIn = BigInt(Math.round(Number(quoteSol) * LAMPORTS_PER_SOL));
    const index = indexS !== undefined ? Number(indexS) : await client.freePoolIndex(admin.publicKey, mint, WSOL_MINT);
    const { pool, lpMint, ixs } = await client.createPoolIxs(admin.publicKey, index, mint, WSOL_MINT, baseIn, quoteIn);
    const sig = await send(ixs);
    const lp = OpenpumpClient.initialLp(baseIn, quoteIn) - 1000n;
    console.log(`pool ${pool.toBase58()} (index ${index})\nlp mint ${lpMint.toBase58()} → ${lp} LP to the admin, 1000 locked\nprice ${(Number(quoteIn) / Number(baseIn)) * 10 ** DECIMALS / LAMPORTS_PER_SOL} SOL per token\nsig ${sig}`);
  } else if (cmd === "show") {
    const pool = await client.fetchPoolByAddress(new PublicKey(args[0]));
    if (!pool) throw new Error("no pool at that address");
    const r = await client.fetchPoolReserves(pool);
    console.log({ ...pool, address: pool.address.toBase58(), baseMint: pool.baseMint.toBase58(), quoteMint: pool.quoteMint.toBase58(), lpMint: pool.lpMint.toBase58(), creator: pool.creator.toBase58(), coinCreator: pool.coinCreator.toBase58(), poolBaseTokenAccount: pool.poolBaseTokenAccount.toBase58(), poolQuoteTokenAccount: pool.poolQuoteTokenAccount.toBase58(), reserves: r, price: `${(Number(r.quoteReserve) / Number(r.baseReserve)) * 10 ** DECIMALS / LAMPORTS_PER_SOL} quote per token` });
  } else {
    throw new Error("usage: pool token|create|show");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
