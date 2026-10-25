export default function Progress({ value, className = "", color = "bg-acc" }: { value: number; className?: string; color?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={`h-1.5 w-full rounded-full bg-ink/10 overflow-hidden ${className}`}>
      <div className={`h-full rounded-full ${color} transition-[width] duration-700`} style={{ width: `${v}%` }} />
    </div>
  );
}
