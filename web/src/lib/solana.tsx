import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { ComputeBudgetProgram, PublicKey, Transaction, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { OpenpumpClient } from "@openpump/sdk";
import { useConfig } from "./api";
import "@solana/wallet-adapter-react-ui/styles.css";

// ------------------------------------------------------------- toasts
export interface Toast { id: number; kind: "info" | "ok" | "err"; title: string; body?: string; href?: string }
const ToastCtx = createContext<{ toasts: Toast[]; push: (t: Omit<Toast, "id">) => number; dismiss: (id: number) => void }>(null as any);
export const useToast = () => useContext(ToastCtx);

function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }].slice(-4));
    setTimeout(() => dismiss(id), t.kind === "err" ? 9000 : 6000);
    return id;
  }, [dismiss]);
  return <ToastCtx.Provider value={{ toasts, push, dismiss }}>{children}</ToastCtx.Provider>;
}

// ------------------------------------------------------------- providers
export function SolanaProviders({ children }: { children: ReactNode }) {
  const { data: cfg } = useConfig();
  const endpoint = cfg?.rpc || "http://127.0.0.1:8899";
  const wsEndpoint = endpoint.includes("127.0.0.1") ? "ws://127.0.0.1:8900" : undefined;
  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed", wsEndpoint }}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <ToastProvider>{children}</ToastProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export function useClient() {
  const { connection } = useConnection();
  return useMemo(() => {
    const c = new OpenpumpClient(connection);
    c.detectFeeProgram().catch(() => {}); // flags fee_config / buyback for trade builders
    return c;
  }, [connection]);
}

/** Sign + send + confirm with toasts; returns the signature or null. */
/**
 * Confirm a signature by polling getSignatureStatuses over HTTP, re-broadcasting the raw tx every 3 s until it
 * lands or the blockhash expires. Devnet RPCs regularly accept a send and then drop it (or drop the websocket
 * subscription), which made confirmed trades show up as "failed" in the UI.
 */
async function confirmWithRebroadcast(connection: Connection, sig: string, raw: Uint8Array | null, lastValidBlockHeight: number) {
  const started = Date.now();
  for (;;) {
    const st = (await connection.getSignatureStatuses([sig])).value[0];
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
      if (st.err) throw new Error(JSON.stringify(st.err));
      return;
    }
    if (st?.err) throw new Error(JSON.stringify(st.err));
    const height = await connection.getBlockHeight("confirmed").catch(() => 0);
    if ((height && height > lastValidBlockHeight) || Date.now() - started > 120_000) throw new Error("Transaction expired before it was confirmed. Nothing was charged; please try again.");
    if (raw) await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 3000));
  }
}

export function useSendTx() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signTransaction } = useWallet();
  const toast = useToast();
  const { data: cfg } = useConfig();
  return useCallback(
    async (ixs: TransactionInstruction[], label: string, opts: { cu?: number; signers?: any[] } = {}) => {
      if (!publicKey) {
        toast.push({ kind: "err", title: "Connect a wallet first" });
        return null;
      }
      const id = toast.push({ kind: "info", title: label, body: "Confirm in your wallet…" });
      try {
        const tx = new Transaction();
        if (opts.cu && !ixs.some((i) => i.programId.equals(ComputeBudgetProgram.programId))) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: opts.cu }));
        tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));
        tx.add(...ixs);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.feePayer = publicKey;
        let sig: string;
        let raw: Uint8Array | null = null;
        if (signTransaction) {
          // Sign locally so we keep the raw bytes: public RPCs drop single sends under load, so we re-broadcast
          // every few seconds and poll the status over HTTP instead of trusting one send + a websocket.
          if (opts.signers?.length) tx.partialSign(...opts.signers);
          const signed = await signTransaction(tx);
          raw = signed.serialize();
          sig = await connection.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 });
        } else {
          sig = await sendTransaction(tx, connection, { signers: opts.signers, skipPreflight: false, preflightCommitment: "confirmed" });
        }
        toast.dismiss(id);
        const pending = toast.push({ kind: "info", title: label, body: "Confirming…" });
        try {
          await confirmWithRebroadcast(connection, sig, raw, lastValidBlockHeight);
        } finally {
          toast.dismiss(pending);
        }
        const cluster = cfg?.cluster || "devnet";
        const href = `https://solscan.io/tx/${sig}${cluster.startsWith("mainnet") ? "" : cluster === "localnet" ? "?cluster=custom&customUrl=http://127.0.0.1:8899" : `?cluster=${cluster}`}`;
        toast.push({ kind: "ok", title: `${label} confirmed`, body: sig.slice(0, 12) + "…", href });
        return sig;
      } catch (e: any) {
        toast.dismiss(id);
        const msg: string = e?.message || String(e);
        const m = msg.match(/Error Message: ([^.]+)\./) || msg.match(/custom program error: (0x[0-9a-f]+)/i);
        toast.push({ kind: "err", title: `${label} failed`, body: m ? m[1] : msg.slice(0, 160) });
        return null;
      }
    },
    [connection, publicKey, sendTransaction, signTransaction, toast, cfg]
  );
}

export const pk = (s: string) => new PublicKey(s);
