/**
 * SelectAlertTypeOverlay — premium redesign
 *
 * Navigation:
 *   DashboardMarketsOverlay → (watchlist tap) → SelectAlertTypeOverlay
 *                             → (card tap)    → existing creation modal
 *
 * Header pattern matches every other overlay in the app:
 *   single div, height = 60px + safe-area-inset-top, paddingTop = safe-area-inset-top,
 *   alignItems: center  →  content sits perfectly centred in the 60px zone below the notch.
 */

import { memo, useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { AppHeader } from "@/components/AppHeader";
import { useSymbolTick } from "@/store/tickStore";
import { useAlertStore } from "@/store/alertStore";
import { useDrawingStore } from "@/store/drawingStore";
import type { Drawing } from "@/types/drawing";
import {
  CreatePriceAlertModal,
  CreateZoneAlertModal,
  FieldRow,
  AlertSelect,
  UTCDateTimePicker,
} from "@/pages/alerts";
import { Input } from "@/components/ui/input";
import { AnimatedButton } from "@/components/animations";
import type { PriceAlert, ZoneAlert, TrendlineAlert } from "@/data/alertsData";
import { TIMEFRAMES, SYMBOLS } from "@/data/alertsData";
import {
  COMPOSITOR_EASE,
  COMPOSITOR_EASE_CLOSE,
  TAP_TRANSITION,
  EASE,
  DUR_STANDARD,
  tweenFast,
} from "@/animations/motion";
import { useChartStore } from "@/store/chartStore";
import { SYMBOL_CATALOG, deriveMeta } from "@/store/brokerWatchlistStore";
import { TrendingUp, TrendingDown, AlertTriangle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const DUR_OPEN  = 320;
const DUR_CLOSE = 240;

// All timeframes shown in the horizontal pill strip (superset of TIMEFRAMES dropdown)
const TF_PILLS = ["1M", "5M", "10M", "15M", "30M", "1H", "2H", "4H", "1D", "1W"] as const;

// ── Keyframes (injected once) ────────────────────────────────────────────────
if (typeof document !== "undefined" && !document.getElementById("__sat_kf__")) {
  const s = document.createElement("style");
  s.id = "__sat_kf__";
  s.textContent = `
    @keyframes sat-dot  { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.45;transform:scale(.65)} }
    @keyframes sat-ripple { 0%{transform:scale(0);opacity:.28} 100%{transform:scale(3);opacity:0} }
    @keyframes sat-flash  { 0%{opacity:1} 25%{opacity:.5} 100%{opacity:1} }
  `;
  document.head.appendChild(s);
}

// ── Timeframe normalisation ───────────────────────────────────────────────────
// Chart stores interval as numeric minutes ("60", "15", "240" …).
// The alert dropdown uses human labels ("1H", "15M", "4H" …).
// Drawings are saved with whatever format the chart had at draw-time, so we
// must normalise both sides to a canonical numeric-minutes string before comparing.

const TF_TO_MINUTES: Record<string, string> = {
  // numeric → canonical
  "1": "1", "3": "3", "5": "5", "10": "10", "15": "15", "30": "30",
  "45": "45", "60": "60", "120": "120", "240": "240",
  "480": "480", "720": "720", "1440": "1440", "10080": "10080",
  // human labels → canonical
  "1M": "1", "3M": "3", "5M": "5", "10M": "10", "15M": "15", "30M": "30",
  "45M": "45", "1H": "60", "2H": "120", "4H": "240",
  "6H": "360", "8H": "480", "12H": "720", "1D": "1440", "D": "1440",
  "1W": "10080", "W": "10080",
};

/** Convert any interval/timeframe string to canonical numeric-minutes string. */
function toCanonicalMinutes(tf: string): string {
  return TF_TO_MINUTES[tf] ?? TF_TO_MINUTES[tf.toUpperCase()] ?? tf;
}

/** Convert a numeric-minutes interval to the human label used in the dropdown. */
function intervalToHumanTf(interval: string): string {
  const minutesToLabel: Record<string, string> = {
    "1": "1M", "3": "3M", "5": "5M", "10": "10M", "15": "15M", "30": "30M",
    "45": "45M", "60": "1H", "120": "2H", "240": "4H",
    "480": "8H", "720": "12H", "1440": "1D", "10080": "1W",
  };
  const canon = toCanonicalMinutes(interval);
  return minutesToLabel[canon] ?? interval.toUpperCase();
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatPrice(p: number): string {
  if (!isFinite(p) || p <= 0) return "—";
  if (p >= 10_000) return p.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (p >= 100)    return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)      return p.toFixed(4);
  if (p >= 0.001)  return p.toFixed(6);
  return p.toFixed(8);
}

/**
 * Format a drawing price with sane decimal precision based on magnitude.
 * ≥ 1,000  → 2 dp with thousands separator (BTC, ETH, indices)
 * ≥ 100    → 2 dp (gold, mid-cap)
 * ≥ 10     → 3 dp
 * ≥ 1      → 5 dp (forex pairs like EURUSD)
 * < 1      → 6 dp (DOGE, PEPE, micro-alts)
 */
function fmtDrawingPrice(price: number): string {
  if (!isFinite(price) || price <= 0) return "—";
  if (price >= 1_000)  return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 100)    return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 10)     return price.toFixed(3);
  if (price >= 1)      return price.toFixed(5);
  if (price >= 0.001)  return price.toFixed(6);
  return price.toFixed(8);
}

function instrType(sym: string) {
  const s = sym.toUpperCase();
  return s.includes("PERP") ? "PERP" : s.includes("SPOT") ? "SPOT" : "PERP";
}

function coinInitials(sym: string) {
  return sym.replace(/(USDT?|PERP|SPOT)$/i, "").trim().slice(0, 2).toUpperCase();
}

// ── Live symbol card ─────────────────────────────────────────────────────────
const PremiumSymbolCard = memo(function PremiumSymbolCard({ symbol }: { symbol: string }) {
  const tick   = useSymbolTick(symbol);
  const price  = tick?.price ?? 0;
  const change = tick?.changePct ?? 0;
  const isUp   = change >= 0;
  const green  = "#22c55e";

  const priceRef     = useRef<HTMLSpanElement>(null);
  const prevPriceRef = useRef(price);
  useEffect(() => {
    if (price !== prevPriceRef.current && priceRef.current) {
      priceRef.current.style.animation = "none";
      void priceRef.current.offsetHeight;
      priceRef.current.style.animation = "sat-flash .3s ease";
    }
    prevPriceRef.current = price;
  }, [price]);

  return (
    <div style={{ margin: "16px 16px 0" }}>
      {/* Selected label — outside card */}
      <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#fb923c", letterSpacing: ".09em", textTransform: "uppercase", lineHeight: 1, marginBottom: 8 }}>
        ✅ Selected Symbol
      </span>
    <div style={{
      minHeight: 86,
      padding: "14px 16px",
      borderRadius: 18,
      background: "linear-gradient(135deg,rgba(255,255,255,.05) 0%,rgba(255,255,255,.02) 100%)",
      border: "1px solid rgba(255,255,255,.09)",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      boxShadow: "0 6px 32px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.06)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      flexShrink: 0,
    }}>
      {/* LEFT */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: ".01em", lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {symbol}
        </span>
        {SYMBOL_CATALOG[symbol]?.description && (
          <span style={{ fontSize: 11.5, fontWeight: 400, color: "rgba(148,163,184,.6)", lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {SYMBOL_CATALOG[symbol].description}
          </span>
        )}
      </div>

      {/* RIGHT */}
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <span ref={priceRef} style={{
          display: "block",
          fontSize: 22, fontWeight: 800, color: "#fff",
          letterSpacing: "-.02em", lineHeight: 1,
          fontFamily: "'SF Pro Display','Inter',monospace",
        }}>
          {price > 0 ? formatPrice(price) : "—"}
        </span>
        <div style={{ marginTop: 3, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: isUp ? green : "#f87171", letterSpacing: "-.01em" }}>
            {tick ? `${isUp ? "+" : ""}${change.toFixed(2)}%` : "—"}
          </span>
        </div>
        {/* LIVE */}
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
          <div style={{
            width: 5, height: 5, borderRadius: "50%",
            background: green, boxShadow: `0 0 5px ${green}`,
            animation: "sat-dot 1.6s ease-in-out infinite", flexShrink: 0,
          }}/>
          <div style={{
            padding: "1px 6px", borderRadius: 4,
            background: "rgba(34,197,94,.11)", border: "1px solid rgba(34,197,94,.20)",
            fontSize: 8.5, fontWeight: 700, color: green, letterSpacing: ".08em", lineHeight: 1,
          }}>LIVE</div>
        </div>
      </div>
    </div>
    </div>
  );
});

// ── Ripple ───────────────────────────────────────────────────────────────────
interface Ripple { id: number; x: number; y: number; }

function useRipple() {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const counter = useRef(0);
  const trigger = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const id   = ++counter.current;
    setRipples(p => [...p, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    setTimeout(() => setRipples(p => p.filter(r => r.id !== id)), 600);
  }, []);
  return { ripples, trigger };
}

// ── Alert type card ──────────────────────────────────────────────────────────
interface CardProps {
  accentColor: string;
  title: string; description: string;
  index: number;
  onPress: () => void;
}

function AlertTypeCard({ accentColor, title, description, index, onPress }: CardProps) {
  const [pressed, setPressed] = useState(false);
  const { ripples, trigger }  = useRipple();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "tween", duration: DUR_STANDARD, ease: EASE, delay: index * 0.055 }}
      style={{ width: "100%" }}
    >
      <motion.button
        whileTap={{ scale: 0.97 }}
        transition={TAP_TRANSITION}
        onPointerDown={e => { setPressed(true); trigger(e); }}
        onPointerUp={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        onClick={onPress}
        style={{
          position: "relative", overflow: "hidden",
          display: "flex", alignItems: "center", gap: 14,
          width: "100%", height: 80,
          padding: "0 16px",
          borderRadius: 18,
          border: `1px solid ${pressed ? accentColor + "35" : "rgba(255,255,255,.08)"}`,
          background: pressed
            ? "linear-gradient(135deg,rgba(255,255,255,.07) 0%,rgba(255,255,255,.03) 100%)"
            : "linear-gradient(135deg,rgba(255,255,255,.04) 0%,rgba(255,255,255,.015) 100%)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          boxShadow: pressed
            ? `0 0 0 1px ${accentColor}20,0 0 20px ${accentColor}15,0 10px 32px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.06)`
            : "0 2px 16px rgba(0,0,0,.25),inset 0 1px 0 rgba(255,255,255,.045)",
          cursor: "pointer", textAlign: "left",
          transition: "background .15s ease,border-color .15s ease,box-shadow .18s ease",
          WebkitTapHighlightColor: "transparent",
          willChange: "transform", flexShrink: 0,
        } as React.CSSProperties}
      >
        {/* Ripple */}
        {ripples.map(r => (
          <span key={r.id} style={{
            position: "absolute", left: r.x, top: r.y,
            width: 110, height: 110, marginLeft: -55, marginTop: -55,
            borderRadius: "50%", background: `${accentColor}1e`,
            animation: "sat-ripple .55s cubic-bezier(.22,1,.36,1) forwards",
            pointerEvents: "none",
          }}/>
        ))}

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 16, fontWeight: 600, color: "#fff",
            lineHeight: 1, marginBottom: 6, letterSpacing: "-.01em",
          }}>
            {title}
          </div>
          <div style={{
            fontSize: 12.5, fontWeight: 400,
            color: "rgba(148,163,184,.62)", lineHeight: 1.45,
          }}>
            {description}
          </div>
        </div>

        {/* Chevron */}
        <div style={{
          flexShrink: 0, width: 26, height: 26,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(255,255,255,.045)", border: "1px solid rgba(255,255,255,.07)",
          borderRadius: "50%", color: "rgba(255,255,255,.28)",
        }}>
          <svg width="6" height="11" viewBox="0 0 6 11" fill="none">
            <path d="M1 1l4 4.5L1 10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </motion.button>
    </motion.div>
  );
}

// ── Drawing selection helpers ─────────────────────────────────────────────────

function drawingDisplayId(d: Drawing): string {
  const pad = String(d.id).padStart(4, "0");
  return d.toolType === "ray" ? `RAY-${pad}` : `TL-${pad}`;
}
function fmtUtcDate(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}
function fmtUtcTime(sec: number): string {
  return new Date(sec * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }) + " UTC";
}

// ── Trendline Alert full-screen screen ───────────────────────────────────────
const TrendlineAlertScreen = memo(function TrendlineAlertScreen({
  open, symbol, onClose, onSave,
}: {
  open: boolean;
  symbol: string;
  onClose: () => void;
  onSave: (a: TrendlineAlert) => void;
}) {
  const [visible, setVisible] = useState(false);
  const hasOpenedRef = useRef(false);
  if (open) hasOpenedRef.current = true;

  useEffect(() => {
    if (open) {
      let raf: number;
      const t = setTimeout(() => { raf = requestAnimationFrame(() => setVisible(true)); }, 0);
      return () => { clearTimeout(t); cancelAnimationFrame(raf); };
    }
    setVisible(false);
    return undefined;
  }, [open]);

  // Read the live chart interval so we can initialise the form timeframe correctly.
  // chartStore stores interval as numeric minutes ("60", "15" …); convert to the
  // human label that matches the TIMEFRAMES dropdown ("1H", "15M" …).
  const chartInterval = useChartStore(s => s.interval);
  const chartHumanTf  = intervalToHumanTf(chartInterval);

  const [form, setForm] = useState({
    symbol:    symbol ?? "",
    timeframe: chartHumanTf,
    p1Price: "", p1Time: "",
    p2Price: "", p2Time: "",
    condition: "touch" as TrendlineAlert["condition"],
    notes: "",
  });

  // Sync symbol AND timeframe every time the screen opens so it always reflects
  // the chart that is currently visible — not whatever it was the last time.
  useEffect(() => {
    if (open) {
      setForm(f => ({
        ...f,
        symbol:    symbol ?? "",
        timeframe: intervalToHumanTf(useChartStore.getState().interval),
      }));
    }
  }, [open, symbol]);

  // Keep timeframe in sync if the user changes chart interval while the screen
  // is already mounted (e.g. via the chart control bar behind the overlay).
  useEffect(() => {
    if (open) setForm(f => ({ ...f, timeframe: chartHumanTf }));
  }, [chartHumanTf, open]);

  // ── Drawing selection ───────────────────────────────────────────────────────
  const allDrawings = useDrawingStore(s => s.drawings);

  // Normalize both sides so "60" === "1H", "15" === "15M" etc. all match.
  const normalSymbol   = (form.symbol ?? "").trim().toUpperCase();
  const normalTf       = toCanonicalMinutes(form.timeframe);

  const relevantDrawings = allDrawings.filter(d =>
    (d.toolType === "trendline" || d.toolType === "extended" || d.toolType === "ray") &&
    (d.symbol ?? "").trim().toUpperCase() === normalSymbol &&
    toCanonicalMinutes(d.timeframe) === normalTf
  );

  // ── Debug logging (temporary, per requirements) ─────────────────────────────
  useEffect(() => {
    if (!open) return;
    console.group("[TrendlineAlert] Drawing filter diagnostics");
    console.log("Total drawings in store  :", allDrawings.length);
    console.log("Selected symbol (raw)    :", form.symbol);
    console.log("Selected timeframe (raw) :", form.timeframe);
    console.log("Symbol after normalise   :", normalSymbol);
    console.log("Timeframe after normalise:", normalTf);
    console.log("chartStore.interval      :", chartInterval);
    console.log("Filtered drawings count  :", relevantDrawings.length);
    console.log("Matched drawing IDs      :", relevantDrawings.map(d => d.id));
    if (allDrawings.length > 0) {
      console.log("All drawings (symbol/tf) :", allDrawings.map(d => ({
        id: d.id,
        toolType: d.toolType,
        symbol: d.symbol,
        timeframe: d.timeframe,
        symbolNorm: (d.symbol ?? "").trim().toUpperCase(),
        tfNorm: toCanonicalMinutes(d.timeframe),
      })));
    }
    console.groupEnd();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, allDrawings.length, normalSymbol, normalTf]);

  const [selectedDrawingId, setSelectedDrawingId] = useState<number | null>(null);

  // Clear selection each time the screen opens
  useEffect(() => {
    if (open) setSelectedDrawingId(null);
  }, [open]);

  // Auto-populate form whenever the selected drawing (or its coords) changes
  useEffect(() => {
    if (selectedDrawingId === null) return;
    const d = allDrawings.find(dr => dr.id === selectedDrawingId);
    if (!d) { setSelectedDrawingId(null); return; }   // drawing deleted
    const p0 = d.points[0], p1 = d.points[1];
    if (!p0 || !p1) return;
    setForm(f => ({
      ...f,
      symbol: d.symbol,
      timeframe: d.timeframe,
      p1Price: String(p0.price),
      p1Time:  new Date(p0.time * 1000).toISOString(),
      p2Price: String(p1.price),
      p2Time:  new Date(p1.time * 1000).toISOString(),
    }));
  }, [selectedDrawingId, allDrawings]); // eslint-disable-line react-hooks/exhaustive-deps

  const timeInvalid = !!(form.p1Time && form.p2Time && new Date(form.p2Time) <= new Date(form.p1Time));
  const canSave = !!(form.p1Price && form.p2Price && form.p1Time && form.p2Time && !timeInvalid);

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      id: `ta${Date.now()}`, type: "trendline",
      symbol: form.symbol, timeframe: form.timeframe,
      point1Price: parseFloat(form.p1Price), point1Time: form.p1Time,
      point2Price: parseFloat(form.p2Price), point2Time: form.p2Time,
      condition: form.condition, notes: form.notes,
      status: "active", createdAt: new Date().toISOString(), triggeredAt: null,
    });
    onClose();
  };

  const slope = form.p1Price && form.p2Price
    ? parseFloat(form.p2Price) > parseFloat(form.p1Price) ? "ascending" : "descending"
    : null;

  if (!hasOpenedRef.current) return null;

  return createPortal(
    <div
      aria-hidden={!open}
      style={{ position: "fixed", inset: 0, zIndex: 96, pointerEvents: open ? "auto" : "none" }}
    >
      <div
        style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          background: "#000000",
          transform: visible ? "translateX(0)" : "translateX(100%)",
          transition: `transform ${visible ? DUR_OPEN : DUR_CLOSE}ms ${visible ? COMPOSITOR_EASE : COMPOSITOR_EASE_CLOSE}`,
          willChange: "transform",
          overflow: "hidden",
        }}
      >
        <AppHeader title="Create Trendline Alert" onBack={onClose} />

        <div style={{
          flex: 1, overflowY: "auto",
          overscrollBehavior: "none",
          padding: "20px 16px",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 32px)",
        } as React.CSSProperties}>
          <div className="space-y-4">

            {/* ── SYMBOL CARD ── */}
            {(() => {
              const meta = deriveMeta(form.symbol);
              return (
                <div style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px",
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.09)",
                }}>
                  {/* Badge */}
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    background: "rgba(255,255,255,0.07)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: "0.03em",
                      color: "rgba(255,255,255,0.75)", lineHeight: 1,
                    }}>
                      {meta.badge.slice(0, 4)}
                    </span>
                  </div>

                  {/* Symbol + description */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.92)",
                      letterSpacing: "0.01em", lineHeight: 1.2,
                    }}>
                      {form.symbol}
                    </p>
                    <p style={{
                      fontSize: 11, color: "rgba(255,255,255,0.38)",
                      marginTop: 2, letterSpacing: "0.01em",
                    }}>
                      {(SYMBOL_CATALOG[form.symbol]?.description) || meta.label}
                    </p>
                  </div>

                  {/* Chevron — visual affordance (symbol locked to active chart) */}
                  <ChevronDown
                    style={{ width: 16, height: 16, color: "rgba(255,255,255,0.25)", flexShrink: 0 }}
                  />
                </div>
              );
            })()}

            {/* ── TIMEFRAME PILL STRIP ── */}
            <div style={{
              display: "flex", gap: 6,
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
              scrollbarWidth: "none",
              paddingBottom: 2,         // room for focus ring
              marginBottom: -2,
            } as React.CSSProperties}>
              {TF_PILLS.map(tf => {
                const isActive = toCanonicalMinutes(form.timeframe) === toCanonicalMinutes(tf);
                return (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, timeframe: tf }))}
                    style={{
                      flexShrink: 0,
                      height: 34,
                      minWidth: 44,
                      paddingLeft: 12,
                      paddingRight: 12,
                      borderRadius: 8,
                      border: isActive
                        ? "1.5px solid var(--primary, #b7ff5a)"
                        : "1px solid rgba(255,255,255,0.10)",
                      background: isActive
                        ? "var(--primary, #b7ff5a)"
                        : "rgba(255,255,255,0.03)",
                      color: isActive ? "#000" : "rgba(255,255,255,0.45)",
                      fontSize: 12,
                      fontWeight: isActive ? 700 : 500,
                      letterSpacing: "0.02em",
                      cursor: "pointer",
                      transition: "background 0.15s, border-color 0.15s, color 0.15s",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {tf}
                  </button>
                );
              })}
            </div>

            {/* ── SELECT EXISTING DRAWING ── */}
            <div>
              <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-3">
                Select Existing Drawing
              </p>
              {relevantDrawings.length === 0 ? (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-center">
                  <p className="text-xs text-muted-foreground/40">
                    No Trendlines or Rays found for the selected Symbol and Timeframe.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {relevantDrawings.map(d => {
                    const p0 = d.points[0];
                    const p1 = d.points[1];
                    const isSelected = selectedDrawingId === d.id;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setSelectedDrawingId(isSelected ? null : d.id)}
                        className={cn(
                          "w-full text-left rounded-xl border transition-colors",
                          isSelected
                            ? "border-primary/40 bg-primary/[0.04]"
                            : "border-white/[0.06] bg-white/[0.02]"
                        )}
                        style={{ padding: "14px 14px" }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>

                          {/* ── Radio ── */}
                          <div style={{
                            marginTop: 2, width: 18, height: 18, borderRadius: "50%",
                            border: `2px solid ${isSelected ? "var(--primary, #b7ff5a)" : "rgba(255,255,255,0.22)"}`,
                            flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                            transition: "border-color 0.15s",
                          }}>
                            {isSelected && (
                              <div style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--primary, #b7ff5a)" }} />
                            )}
                          </div>

                          {/* ── Two-column body ── */}
                          <div style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 8px" }}>

                            {/* ── LEFT: Type · ID · First Point ── */}
                            <div>
                              {/* Type + ID */}
                              <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 10 }}>
                                <span style={{
                                  fontSize: 13, fontWeight: 700, letterSpacing: "0.05em",
                                  textTransform: "uppercase",
                                  color: isSelected ? "var(--primary, #b7ff5a)" : "rgba(255,255,255,0.85)",
                                }}>
                                  {d.toolType === "ray" ? "Ray" : "Trendline"}
                                </span>
                                <span style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.32)" }}>
                                  {drawingDisplayId(d)}
                                </span>
                              </div>

                              {/* First Point */}
                              <p style={{
                                fontSize: 9, fontWeight: 600, letterSpacing: "0.1em",
                                textTransform: "uppercase", color: "rgba(255,255,255,0.28)",
                                marginBottom: 5,
                              }}>
                                First Point
                              </p>
                              <p style={{
                                fontSize: 17, fontWeight: 600, color: "rgba(255,255,255,0.92)",
                                fontVariantNumeric: "tabular-nums", lineHeight: 1.15,
                                letterSpacing: "-0.01em",
                              }}>
                                {p0 ? fmtDrawingPrice(p0.price) : "—"}
                              </p>
                              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
                                {p0 ? fmtUtcDate(p0.time) : "—"}
                              </p>
                              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.32)" }}>
                                {p0 ? fmtUtcTime(p0.time) : "—"}
                              </p>
                            </div>

                            {/* ── RIGHT: Second Point · Symbol · Timeframe ── */}
                            <div>
                              {/* Spacer to align "Second Point" with "First Point" */}
                              <div style={{ height: 33 }} />

                              {/* Second Point */}
                              <p style={{
                                fontSize: 9, fontWeight: 600, letterSpacing: "0.1em",
                                textTransform: "uppercase", color: "rgba(255,255,255,0.28)",
                                marginBottom: 5,
                              }}>
                                Second Point
                              </p>
                              <p style={{
                                fontSize: 17, fontWeight: 600, color: "rgba(255,255,255,0.92)",
                                fontVariantNumeric: "tabular-nums", lineHeight: 1.15,
                                letterSpacing: "-0.01em",
                              }}>
                                {p1 ? fmtDrawingPrice(p1.price) : "—"}
                              </p>
                              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
                                {p1 ? fmtUtcDate(p1.time) : "—"}
                              </p>
                              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.32)" }}>
                                {p1 ? fmtUtcTime(p1.time) : "—"}
                              </p>

                            </div>

                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── OR ENTER MANUALLY divider ── */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-white/[0.06]" />
              <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">or enter manually</span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>

            {/* Slope indicator */}
            {slope && (
              <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={tweenFast}
                className="p-3 rounded-xl bg-primary/10 border border-primary/20 flex items-center gap-3">
                {slope === "ascending"
                  ? <TrendingUp className="w-5 h-5 text-primary flex-shrink-0" />
                  : <TrendingDown className="w-5 h-5 text-primary flex-shrink-0" />}
                <div>
                  <p className="text-xs font-semibold text-primary capitalize">{slope} Trendline</p>
                  <p className="text-[10px] text-primary/60">
                    Slope: {(parseFloat(form.p2Price) - parseFloat(form.p1Price)).toFixed(2)} pts
                  </p>
                </div>
              </motion.div>
            )}

            {/* Point 1 */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-3">
              <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider">Point 1 — Anchor</p>
              <FieldRow label="Price">
                <Input type="number" placeholder="e.g. 18500" value={form.p1Price}
                  onChange={e => setForm(f => ({ ...f, p1Price: e.target.value }))}
                  className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-muted-foreground/50 h-9" />
              </FieldRow>
              <UTCDateTimePicker label="Time (UTC)" value={form.p1Time}
                onChange={iso => setForm(f => ({ ...f, p1Time: iso }))} />
            </div>

            {/* Point 2 */}
            <div className={cn(
              "rounded-xl border p-3 space-y-3 transition-colors",
              timeInvalid ? "border-amber-500/30 bg-amber-500/[0.04]" : "border-white/[0.06] bg-white/[0.02]"
            )}>
              <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider">Point 2 — Direction</p>
              <FieldRow label="Price">
                <Input type="number" placeholder="e.g. 18750" value={form.p2Price}
                  onChange={e => setForm(f => ({ ...f, p2Price: e.target.value }))}
                  className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-muted-foreground/50 h-9" />
              </FieldRow>
              <UTCDateTimePicker label="Time (UTC)" value={form.p2Time}
                onChange={iso => setForm(f => ({ ...f, p2Time: iso }))} />
            </div>

            {/* Time validation warning */}
            <AnimatePresence>
              {timeInvalid && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={tweenFast}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                  <p className="text-[11px] text-amber-400">Point 2 time must be after Point 1</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Condition */}
            <FieldRow label="Alert Condition">
              <div className="flex gap-2">
                {(["touch", "break", "retest"] as const).map(c => (
                  <AnimatedButton key={c} onClick={() => setForm(f => ({ ...f, condition: c }))}
                    className={cn(
                      "flex-1 py-2 rounded-lg text-xs font-semibold capitalize border transition-all",
                      form.condition === c
                        ? "bg-primary/20 border-primary/40 text-primary"
                        : "border-white/[0.08] text-muted-foreground hover:border-white/20 hover:text-white"
                    )}>
                    {c}
                  </AnimatedButton>
                ))}
              </div>
            </FieldRow>

            {/* Notes */}
            <FieldRow label="Notes">
              <textarea rows={2} placeholder="Trendline notes..." value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-white placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </FieldRow>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <AnimatedButton variant="ghost" className="flex-1 h-9 text-muted-foreground hover:text-white" onClick={onClose}>
                Cancel
              </AnimatedButton>
              <AnimatedButton
                disabled={!canSave}
                className="flex-1 h-9 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={handleSave}>
                Create Trendline
              </AnimatedButton>
            </div>

          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
});

// ── Main overlay ─────────────────────────────────────────────────────────────
export interface SelectAlertTypeOverlayProps {
  open: boolean;
  symbol: string;
  onClose: () => void;
}

export const SelectAlertTypeOverlay = memo(function SelectAlertTypeOverlay({
  open, symbol, onClose,
}: SelectAlertTypeOverlayProps) {
  const { addAlert } = useAlertStore();

  const hasOpenedRef = useRef(false);
  if (open) hasOpenedRef.current = true;

  const [visible, setVisible] = useState(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (open) {
      let raf: number;
      const t = setTimeout(() => { raf = requestAnimationFrame(() => setVisible(true)); }, 0);
      return () => { clearTimeout(t); cancelAnimationFrame(raf); };
    }
    setVisible(false);
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  type Modal = "price" | "zone" | "trendline" | null;
  const [activeModal, setActiveModal] = useState<Modal>(null);

  const handlePriceAlertSave     = useCallback((a: PriceAlert)     => { addAlert(a); setActiveModal(null); onCloseRef.current(); }, [addAlert]);
  const handleZoneAlertSave      = useCallback((a: ZoneAlert)      => { addAlert(a); setActiveModal(null); onCloseRef.current(); }, [addAlert]);
  const handleTrendlineAlertSave = useCallback((a: TrendlineAlert) => { addAlert(a); setActiveModal(null); onCloseRef.current(); }, [addAlert]);

  if (!hasOpenedRef.current) return null;

  return createPortal(
    <>
      {/* ── Outer shell: positioning only — no transform, no background.
           Matches the two-div pattern used by DashboardAlertsOverlay and
           DashboardMarketsOverlay: keeping transform off the position:fixed
           element prevents WebKit / Android WebView from evaluating
           env(safe-area-inset-top) from a different reference point, which
           was the root cause of the extra vertical space compared to Markets. ── */}
      <div
        aria-hidden={!open}
        style={{
          position: "fixed", inset: 0, zIndex: 95,
          pointerEvents: open ? "auto" : "none",
        }}
      >
        {/* ── Inner panel: animation + layout + background ── */}
        <div
          className="transform-gpu"
          style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column",
            background: "#000000",
            transform: visible ? "translateX(0)" : "translateX(100%)",
            transition: `transform ${visible ? DUR_OPEN : DUR_CLOSE}ms ${visible ? COMPOSITOR_EASE : COMPOSITOR_EASE_CLOSE}`,
            willChange: "transform",
            overflow: "hidden",
          }}
        >
        {/* ── Header ── */}
        <AppHeader title="Select Alert Type" onBack={onClose} />

        {/* ── Scrollable content ── */}
        <div style={{
          flex: 1, overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          overscrollBehavior: "contain",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 32px)",
        } as React.CSSProperties}>

          {/* Live symbol card */}
          <PremiumSymbolCard symbol={symbol} />

          {/* Section label */}
          <div style={{
            padding: "24px 16px 14px",
            fontSize: 11, fontWeight: 700,
            color: "rgba(255,255,255,.45)",
            letterSpacing: ".09em",
            textTransform: "uppercase",
          }}>
            Choose alert type
          </div>

          {/* Cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 16px" }}>
            <AlertTypeCard
              index={0}
              accentColor="#B7FF5A"
              title="Trendline Alerts"
              description="Trigger when price touches or crosses a trendline."
              onPress={() => setActiveModal("trendline")}
            />
            <AlertTypeCard
              index={1}
              accentColor="#fb923c"
              title="Zone Alerts"
              description="Trigger when price enters or exits a defined zone."
              onPress={() => setActiveModal("zone")}
            />
            <AlertTypeCard
              index={2}
              accentColor="#60a5fa"
              title="Price Alerts"
              description="Trigger when price reaches a specific price level."
              onPress={() => setActiveModal("price")}
            />
          </div>
        </div>
        </div> {/* inner panel */}
      </div> {/* outer shell */}

      {/* Trendline — full-screen slide-in screen */}
      <TrendlineAlertScreen
        open={activeModal === "trendline"}
        symbol={symbol}
        onClose={() => setActiveModal(null)}
        onSave={handleTrendlineAlertSave}
      />
      {activeModal === "zone" && (
        <CreateZoneAlertModal
          initialSymbol={symbol}
          onClose={() => setActiveModal(null)}
          onSave={handleZoneAlertSave}
        />
      )}
      {activeModal === "price" && (
        <CreatePriceAlertModal
          initialSymbol={symbol}
          onClose={() => setActiveModal(null)}
          onSave={handlePriceAlertSave}
        />
      )}
    </>,
    document.body,
  );
});
