/**
 * Decode `emit_cpi!` events. Anchor writes each event as a self-CPI whose data is
 * [8-byte event-cpi tag][8-byte event discriminator][borsh payload]; the tag is
 * sha256("anchor:event")[..8] = e445a52e51cb9a1d.
 */
import { BorshCoder } from "@coral-xyz/anchor";
import { PublicKey, type ParsedTransactionWithMeta, type VersionedTransactionResponse } from "@solana/web3.js";
import { AMM_IDL, AMM_PROGRAM_ID, CURVE_IDL, CURVE_PROGRAM_ID, FEES_IDL, FEES_PROGRAM_ID } from "./ids";

const EVENT_TAG = Buffer.from("e445a52e51cb9a1d", "hex");
const curveCoder = new BorshCoder(CURVE_IDL);
const ammCoder = new BorshCoder(AMM_IDL);
const feesCoder = new BorshCoder(FEES_IDL);

export interface DecodedEvent {
  program: "curve" | "amm" | "fees";
  name: string;
  data: any;
  signature: string;
  slot: number;
  blockTime: number | null;
}

const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
/** Anchor 0.30+ IDLs are snake_case; expose event fields as camelCase like the rest of the TS client. */
function camelKeys(obj: any): any {
  if (obj == null || typeof obj !== "object" || Array.isArray(obj) || typeof obj.toBase58 === "function" || typeof obj.toNumber === "function") return obj;
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) out[camel(k)] = camelKeys(v);
  return out;
}

function decodeData(program: "curve" | "amm" | "fees", data: Buffer) {
  if (data.length < 16 || !data.subarray(0, 8).equals(EVENT_TAG)) return null;
  const coder = program === "curve" ? curveCoder : program === "amm" ? ammCoder : feesCoder;
  const ev = coder.events.decode(data.subarray(8).toString("base64"));
  return ev ? { name: ev.name, data: camelKeys(ev.data) } : null;
}

/** Works on getTransaction (versioned) responses with loaded addresses. */
export function decodeEventsFromTx(tx: VersionedTransactionResponse, signature: string): DecodedEvent[] {
  const out: DecodedEvent[] = [];
  const msg = tx.transaction.message;
  const keys: PublicKey[] = [
    ...msg.staticAccountKeys,
    ...(tx.meta?.loadedAddresses?.writable ?? []),
    ...(tx.meta?.loadedAddresses?.readonly ?? []),
  ];
  const programOf = (idx: number) => {
    const k = keys[idx];
    if (!k) return null;
    if (k.equals(CURVE_PROGRAM_ID)) return "curve" as const;
    if (k.equals(AMM_PROGRAM_ID)) return "amm" as const;
    if (k.equals(FEES_PROGRAM_ID)) return "fees" as const;
    return null;
  };
  const consider = (programIdIndex: number, dataB58: string) => {
    const program = programOf(programIdIndex);
    if (!program) return;
    const data = Buffer.from(bs58decode(dataB58));
    const ev = decodeData(program, data);
    if (ev) out.push({ program, ...ev, signature, slot: tx.slot, blockTime: tx.blockTime ?? null });
  };
  for (const inner of tx.meta?.innerInstructions ?? []) {
    for (const ix of inner.instructions) consider(ix.programIdIndex, ix.data);
  }
  return out;
}

/** Same for getParsedTransaction responses (used by the indexer). */
export function decodeEventsFromParsedTx(tx: ParsedTransactionWithMeta, signature: string): DecodedEvent[] {
  const out: DecodedEvent[] = [];
  for (const inner of tx.meta?.innerInstructions ?? []) {
    for (const ix of inner.instructions as any[]) {
      if (!("data" in ix) || !ix.programId) continue;
      const pid = new PublicKey(ix.programId);
      const program = pid.equals(CURVE_PROGRAM_ID) ? "curve" : pid.equals(AMM_PROGRAM_ID) ? "amm" : pid.equals(FEES_PROGRAM_ID) ? "fees" : null;
      if (!program) continue;
      const ev = decodeData(program, Buffer.from(bs58decode(ix.data)));
      if (ev) out.push({ program, ...ev, signature, slot: tx.slot, blockTime: tx.blockTime ?? null });
    }
  }
  return out;
}

// tiny base58 decoder (avoids pulling bs58 as a dep in browsers)
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function bs58decode(s: string): Uint8Array {
  const bytes: number[] = [0];
  for (const ch of s) {
    let carry = ALPHABET.indexOf(ch);
    if (carry < 0) throw new Error("bad base58");
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let k = 0; k < s.length && s[k] === "1"; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}
