const palette = ["#02b874", "#b7791f", "#0284c7", "#e0245e", "#7c3aed", "#ea580c"];
const hue = (s: string) => palette[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length];

export default function Avatar({ src, name, size = 40, className = "" }: { src?: string | null; name: string; size?: number; className?: string }) {
  const r = Math.round(size * 0.28);
  if (src)
    return <img src={src} alt={name} width={size} height={size} loading="lazy" className={`object-cover shrink-0 bg-panel2 ${className}`} style={{ width: size, height: size, borderRadius: r }} onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />;
  return (
    <div className={`grid place-items-center shrink-0 font-head font-bold text-white ${className}`} style={{ width: size, height: size, borderRadius: r, background: hue(name), fontSize: size * 0.36 }}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}
