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
import { motion } from "motion/react";
import { AppHeader } from "@/components/AppHeader";
import { useSymbolTick } from "@/store/tickStore";
import { useAlertStore } from "@/store/alertStore";
import {
  CreatePriceAlertModal,
  CreateZoneAlertModal,
  CreateTrendlineAlertModal,
} from "@/pages/alerts";
import type { PriceAlert, ZoneAlert, TrendlineAlert } from "@/data/alertsData";
import {
  COMPOSITOR_EASE,
  COMPOSITOR_EASE_CLOSE,
  TAP_TRANSITION,
  EASE,
  DUR_STANDARD,
} from "@/animations/motion";

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
    <div style={{
      margin: "16px 16px 0",
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
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {/* Selected label */}
          <span style={{ fontSize: 9.5, fontWeight: 600, color: "rgba(148,163,184,.45)", letterSpacing: ".09em", textTransform: "uppercase", lineHeight: 1 }}>
            Selected Symbol
          </span>
          {/* Symbol + type badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#fff", letterSpacing: ".01em", lineHeight: 1 }}>
              {symbol}
            </span>
            <div style={{
              padding: "2px 5px", borderRadius: 4,
              background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.11)",
              fontSize: 8.5, fontWeight: 700, color: "rgba(255,255,255,.5)", letterSpacing: ".07em", lineHeight: 1,
            }}>
              {instrType(symbol)}
            </div>
          </div>
          {/* Broker badge */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            padding: "2px 7px", borderRadius: 5, width: "fit-content",
            background: "rgba(96,165,250,.09)", border: "1px solid rgba(96,165,250,.18)",
          }}>
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
              <path d="M5 0L9.5 5L5 10L.5 5Z" fill="#60a5fa" opacity=".9"/>
            </svg>
            <span style={{ fontSize: 8.5, fontWeight: 700, color: "#60a5fa", letterSpacing: ".08em", lineHeight: 1 }}>DELTA</span>
          </div>
        </div>
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
            fontSize: 10.5, fontWeight: 700,
            color: "rgba(148,163,184,.38)",
            textTransform: "uppercase", letterSpacing: ".11em",
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

      {/* Creation modals */}
      {activeModal === "trendline" && (
        <CreateTrendlineAlertModal
          initialSymbol={symbol}
          onClose={() => setActiveModal(null)}
          onSave={handleTrendlineAlertSave}
        />
      )}
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
