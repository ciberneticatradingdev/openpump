/**
 * Holder-rewards crank. Every `HOLDER_CRANK_MS` it looks at holder-reward coins whose vault
 * holds at least `HOLDER_MIN_POT` (in quote units), snapshots the top holders from the RPC,
 * and pays them pro-rata with `distribute_fee_to_holders`.
 *
 * Needs HOLDER_REWARD_AUTHORITY_KEYPAIR (JSON array or base58) = Global.holder_reward_authority.
 * Without it the crank is off and pots simply accumulate until an authority runs.
 *
 * Snapshot rules (documented on /how-it-works):
 *   - top 20 token accounts by balance (RPC getTokenLargestAccounts), minus the curve, the AMM
 *     pool, the locked LP and any program-owned account
 *   - pro-rata by balance; payouts below `HOLDER_MIN_PAYOUT` are skipped (dust stays in the pot)
 */
import { AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { OpenpumpClient, WSOL_MINT, bs58decode, pda } from "@openpump/sdk";
import type { Db } from "./db";

type Broadcast = (msg: any) => void;

export class HolderCrank {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private busy = false;
  readonly authority: Keypair | null;
  private client: OpenpumpClient;

  constructor(private conn: Connection, private db: Db, private broadcast: Broadcast) {
    this.authority = loadAuthority();
    const provider = this.authority ? new AnchorProvider(conn, { publicKey: this.authority.publicKey, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t } as any, { commitment: "confirmed" }) : undefined;
    this.client = new OpenpumpClient(conn, provider);
  }

  start() {
    if (!this.authority) {
      console.log("[crank] HOLDER_REWARD_AUTHORITY_KEYPAIR not set — holder rewards accumulate, nothing is distributed");
      return;
    }
    this.running = true;
    const interval = Number(process.env.HOLDER_CRANK_MS || 5 * 60_000);
    console.log(`[crank] holder rewards authority ${this.authority.publicKey.toBase58()} every ${interval / 1000}s`);
    const tick = async () => {
      if (!this.running) return;
      if (!this.busy) {
        this.busy = true;
        try {
          await this.runOnce();
        } catch (e) {
          console.error("[crank]", (e as Error).message);
        } finally {
          this.busy = false;
        }
      }
      this.timer = setTimeout(tick, interval);
    };
    this.timer = setTimeout(tick, 15_000);
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  async runOnce() {
    const coins = this.db.prepare("SELECT mint, quote_mint, quote_decimals, bonding_curve, pool, supply FROM coins WHERE is_holder_reward=1").all() as any[];
    for (const c of coins) await this.distribute(c).catch((e) => console.error("[crank]", c.mint.slice(0, 6), (e as Error).message));
  }

  async distribute(c: { mint: string; quote_mint: string; quote_decimals: number; bonding_curve: string; pool: string | null }) {
    const mint = new PublicKey(c.mint);
    const quoteMint = new PublicKey(c.quote_mint || WSOL_MINT.toBase58());
    const native = quoteMint.equals(WSOL_MINT);
    const dec = native ? 9 : c.quote_decimals;
    const minPot = BigInt(Math.floor(Number(process.env.HOLDER_MIN_POT || (native ? 0.05 : 1)) * 10 ** dec));
    const minPayout = BigInt(Math.floor(Number(process.env.HOLDER_MIN_PAYOUT || (native ? 0.0005 : 0.01)) * 10 ** dec));

    const pot = await this.client.holderPot(mint, quoteMint);
    if (pot < minPot) return;

    // snapshot
    const largest = await this.conn.getTokenLargestAccounts(mint, "confirmed");
    const infos = await this.conn.getMultipleAccountsInfo(largest.value.map((a) => a.address), "confirmed");
    const exclude = new Set<string>([pda.bondingCurve(mint).toBase58(), c.pool ?? "", pda.holderRewards(mint).toBase58()]);
    const holders: { owner: PublicKey; amount: bigint }[] = [];
    largest.value.forEach((a, i) => {
      const info = infos[i];
      if (!info) return;
      const owner = new PublicKey(info.data.subarray(32, 64));
      if (exclude.has(owner.toBase58())) return;
      const amount = BigInt(a.amount);
      if (amount > 0n) holders.push({ owner, amount });
    });
    // drop program-owned wallets (PDAs of other programs can't usefully receive SOL)
    const ownerInfos = await this.conn.getMultipleAccountsInfo(holders.map((h) => h.owner), "confirmed");
    const eligible = holders.filter((_, i) => !ownerInfos[i] || ownerInfos[i]!.owner.equals(new PublicKey("11111111111111111111111111111111")));
    const totalBal = eligible.reduce((a, h) => a + h.amount, 0n);
    if (!eligible.length || totalBal === 0n) return;

    const recipients: PublicKey[] = [];
    const amounts: bigint[] = [];
    let total = 0n;
    for (const h of eligible) {
      const share = (pot * h.amount) / totalBal;
      if (share < minPayout) continue;
      recipients.push(h.owner);
      amounts.push(share);
      total += share;
    }
    if (!recipients.length) return;

    const ix = await this.client.distributeToHoldersIx(this.authority!.publicKey, mint, recipients, amounts, quoteMint);
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ix);
    tx.feePayer = this.authority!.publicKey;
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.sign(this.authority!);
    const sig = await this.conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await this.conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    console.log(`[crank] ${c.mint.slice(0, 6)} paid ${Number(total) / 10 ** dec} to ${recipients.length} holders ${sig.slice(0, 8)}`);
    this.broadcast({ type: "holder_rewards", mint: c.mint, total: total.toString(), recipients: recipients.length, sig, ts: Math.floor(Date.now() / 1000) });
  }
}

function loadAuthority(): Keypair | null {
  const raw = process.env.HOLDER_REWARD_AUTHORITY_KEYPAIR;
  if (!raw) return null;
  try {
    if (raw.trim().startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
    return Keypair.fromSecretKey(bs58decode(raw.trim()));
  } catch (e) {
    console.error("[crank] bad HOLDER_REWARD_AUTHORITY_KEYPAIR", (e as Error).message);
    return null;
  }
}
