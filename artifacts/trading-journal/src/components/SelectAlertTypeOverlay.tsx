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
import { SYMBOL_CATALOG } from "@/store/brokerWatchlistStore";
import { TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const DUR_OPEN  = 320;
const DUR_CLOSE = 240;

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

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatPrice(p: number): string {
  if (!isFinite(p) || p <= 0) return "—";
  if (p >= 10_000) return p.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (p >= 100)    return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)      return p.toFixed(4);
  if (p >= 0.001)  return p.toFixed(6);
  return p.toFixed(8);
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

  const [form, setForm] = useState({
    symbol: symbol ?? "",
    timeframe: "1H",
    p1Price: "", p1Time: "",
    p2Price: "", p2Time: "",
    condition: "touch" as TrendlineAlert["condition"],
    notes: "",
  });

  // Reset form + symbol when screen opens fresh
  useEffect(() => {
    if (open) setForm(f => ({ ...f, symbol: symbol ?? "" }));
  }, [open, symbol]);

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

            {/* Symbol + Timeframe */}
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Symbol">
                <div className="w-full h-9 px-3 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-white flex items-center">
                  {form.symbol}
                </div>
                <p className="text-[10px] mt-1" style={{ color: "#fb923c" }}>by default symbol selected</p>
              </FieldRow>
              <FieldRow label="Timeframe">
                <AlertSelect value={form.timeframe} onChange={v => setForm(f => ({ ...f, timeframe: v }))} options={TIMEFRAMES} />
              </FieldRow>
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
