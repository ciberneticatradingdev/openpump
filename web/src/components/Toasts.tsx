import { useToast } from "../lib/solana";

export default function Toasts() {
  const { toasts, dismiss } = useToast();
  return (
    <div className="fixed top-16 right-3 sm:right-5 z-50 flex flex-col gap-2 w-[320px] max-w-[calc(100vw-24px)]">
      {toasts.map((t) => (
        <div key={t.id} className={`panel bg-[#0b100c] p-3 shadow-dock border-l-4 ${t.kind === "ok" ? "border-l-acc" : t.kind === "err" ? "border-l-red" : "border-l-line2"}`}>
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold">{t.title}</div>
              {t.body && <div className="text-[12px] text-mute mt-0.5 break-words">{t.body}</div>}
              {t.href && (
                <a href={t.href} target="_blank" rel="noreferrer" className="text-[12px] text-acc hover:underline">View on Solscan ↗</a>
              )}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-dim hover:text-ink text-[16px] leading-none">×</button>
          </div>
        </div>
      ))}
    </div>
  );
}
