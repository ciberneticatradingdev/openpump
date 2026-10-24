import { useEffect, useRef, useState } from "react";
import { ColorType, CrosshairMode, createChart, type IChartApi, type ISeriesApi } from "lightweight-charts";
import { useCandles } from "../lib/api";

const RES = [
  { label: "1s", s: 1 },
  { label: "1m", s: 60 },
  { label: "5m", s: 300 },
  { label: "15m", s: 900 },
  { label: "1h", s: 3600 },
];

/** Candles as market cap in SOL (price × 1B supply) — far more readable than 5e-7 SOL/token. */
export default function Chart({ mint, height = 380, qSym = "SOL", qDec = 9 }: { mint: string; height?: number; qSym?: string; qDec?: number }) {
  const [res, setRes] = useState(60);
  const { data } = useCandles(mint, res);
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const vol = useRef<ISeriesApi<"Histogram"> | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      height,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "rgba(236,242,237,0.55)", fontFamily: "Inter, system-ui, sans-serif", fontSize: 11 },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)", scaleMargins: { top: 0.1, bottom: 0.25 } },
      timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: true, secondsVisible: res < 60 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { priceFormatter: (p: number) => (p >= 1e6 ? (p / 1e6).toFixed(2) + "M" : p >= 1e3 ? (p / 1e3).toFixed(1) + "K" : p.toFixed(p < 10 ? 2 : 1)) },
    });
    series.current = c.addCandlestickSeries({
      upColor: "#79ff77", downColor: "#ff5c7a", borderVisible: false, wickUpColor: "#79ff77", wickDownColor: "#ff5c7a",
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    vol.current = c.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "" });
    vol.current.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.current = c;
    const ro = new ResizeObserver(() => c.applyOptions({ width: box.current!.clientWidth }));
    ro.observe(box.current);
    return () => { ro.disconnect(); c.remove(); };
  }, [height, res]);

  useEffect(() => {
    if (!series.current || !data) return;
    // lamports/token × 1e9 tokens supply / 1e9 lamports = SOL market cap
    const f = 1e9 / 10 ** qDec; // price is quote-units/token; ×1e9 tokens supply ÷ quote decimals = mcap in quote
    const cs = data.map((k) => ({ time: k.time as any, open: k.open * f, high: k.high * f, low: k.low * f, close: k.close * f }));
    series.current.setData(cs);
    vol.current?.setData(data.map((k) => ({ time: k.time as any, value: k.volume, color: k.close >= k.open ? "rgba(121,255,119,0.25)" : "rgba(255,92,122,0.25)" })));
    chart.current?.timeScale().fitContent();
  }, [data, qDec]);

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center gap-1 px-2 pt-2">
        {RES.map((r) => (
          <button key={r.s} onClick={() => setRes(r.s)} className={`pill !h-7 !px-2.5 ${res === r.s ? "pill-active" : "!border-transparent !bg-transparent text-mute hover:text-ink"}`}>{r.label}</button>
        ))}
        <span className="ml-auto text-[11px] text-dim pr-2">market cap · {qSym}</span>
      </div>
      <div ref={box} className="w-full" style={{ height }} />
      {data && data.length === 0 && <div className="text-center text-dim text-[12px] -mt-48 mb-44 relative">No trades yet — be the first.</div>}
    </div>
  );
}
