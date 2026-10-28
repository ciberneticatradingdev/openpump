import { graduationSol } from "../lib/format";
import { useConfig } from "../lib/api";
import { BRAND } from "../lib/brand";

export default function HowItWorks() {
  const { data: cfg } = useConfig();
  const g = cfg?.global;
  const creator = g ? Number(g.creatorFeeBasisPoints) / 100 : 0.5;
  const protocol = g ? Number(g.feeBasisPoints) / 100 : 0.5;
  return (
    <div className="max-w-[680px] mx-auto space-y-3">
      <div className="px-1">
        <h1 className="font-head font-bold text-[24px] tracking-tight">How {BRAND.name} works</h1>
        <p className="text-mute text-[13px] mt-1">Two open programs on Solana: a bonding curve and an AMM. No admin can touch your coin's liquidity.</p>
      </div>
      {[
        ["1. Launch", `One transaction creates the mint, Metaplex metadata and the bonding curve, mints 1,000,000,000 tokens into the curve and revokes the mint authority. Launching costs rent only (~0.02 SOL).`],
        ["2. Bonding curve", `Price follows a constant-product curve seeded with ${g ? Number(g.initialVirtualSolReserves) / 1e9 : 30} virtual SOL and ${g ? (Number(g.initialVirtualTokenReserves) / 1e15).toFixed(3) : "1.073"}B virtual tokens. ${g ? (Number(g.initialRealTokenReserves) / 1e12).toFixed(1) : "793.1"}M tokens are for sale; when they're gone (~${g ? graduationSol(g) : 85} SOL in), the curve completes. During the first ${g ? g.antiSnipeSlots : 15} slots each buy is capped at ${g ? Number(g.antiSnipeMaxBps) / 100 : 1}% of supply so bots can't sweep the launch.`],
        ["3. Fees", `Every trade pays ${creator}% to the coin's creator and ${protocol}% to the protocol, taken from the SOL leg. The creator's share accrues in a vault from the very first trade and can be claimed any time.`],
        ["4. Graduation", `Once the curve completes, anyone can call migrate. All raised SOL and the remaining 206.9M tokens are deposited into a fresh AMM pool at the same price, and 100% of the LP tokens are burned. Liquidity is permanent by construction.`],
        ["5. AMM", `Graduated coins trade on the constant-product AMM. Fees per swap: ${g?.amm ? Number(g.amm.lpFeeBasisPoints) / 100 : 0.2}% to LPs (stays in the pool), ${g?.amm ? Number(g.amm.protocolFeeBasisPoints) / 100 : 0.05}% protocol and ${g?.amm ? Number(g.amm.coinCreatorFeeBasisPoints) / 100 : 0.05}% to the creator. Anyone can add or remove liquidity.`],
        ["Programs", `Curve: ${cfg?.curveProgram ?? "…"}\nAMM: ${cfg?.ammProgram ?? "…"}\nCluster: ${cfg?.cluster ?? "…"}`],
      ].map(([t, b]) => (
        <section key={t} className="panel p-4">
          <h2 className="font-head font-semibold text-[15px]">{t}</h2>
          <p className="text-mute text-[13px] mt-1 whitespace-pre-wrap num">{b}</p>
        </section>
      ))}
    </div>
  );
}
