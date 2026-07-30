/**
 * AppHeader — shared navigation header used by Dashboard (Alerts overlay),
 * Markets, and Select Alert Type overlays.
 *
 * Spec (single source of truth):
 *   • Total height : calc(56px + var(--app-safe-top, env(safe-area-inset-top)))
 *   • Top padding  : var(--app-safe-top, env(safe-area-inset-top))  — places content below notch on iOS.
 *                    Tablet WebView overrides --app-safe-top to 0px (native spacer already reserves the inset).
 *   • Side padding : 16px each side
 *   • Gap          : 12px between back button and title
 *   • Back button  : 32 × 32 circle, transparent bg, no border
 *   • Back icon    : ArrowLeft 20 × 20, rgba(255,255,255,0.6)
 *   • Title        : 17px / 700 weight / #ffffff
 *   • Border       : 1px solid rgba(255,255,255,0.07) bottom
 *   • Background   : #000000 (override via `background` prop when needed)
 */

import type { CSSProperties, ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

interface AppHeaderProps {
  /** Page / screen title rendered next to the back button. */
  title: string;
  /** Called when the back button is pressed. */
  onBack: () => void;
  /** Override background colour — defaults to #000000. */
  background?: string;
  /** Optional content slotted after the title (e.g. action icons). */
  children?: ReactNode;
}

const HEADER_BASE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "0 16px",
  // Use --app-safe-top so the Expo/tablet WebView (which already reserves the
  // status-bar height as a native spacer above the WebView) can override this
  // to 0px and avoid double-counting the inset.  On plain web it falls back to
  // env(safe-area-inset-top) and behaves exactly as before.
  paddingTop: "var(--app-safe-top, env(safe-area-inset-top))",
  height: "calc(56px + var(--app-safe-top, env(safe-area-inset-top)))",
  borderBottom: "1px solid rgba(255,255,255,0.07)",
  flexShrink: 0,
};

const BACK_BTN: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "rgba(255,255,255,0.6)",
  flexShrink: 0,
  WebkitTapHighlightColor: "transparent",
};

const TITLE: CSSProperties = {
  fontSize: 17,
  fontWeight: 700,
  color: "#ffffff",
  margin: 0,
  flex: 1,
  lineHeight: 1.2,
};

export function AppHeader({
  title,
  onBack,
  background = "#000000",
  children,
}: AppHeaderProps) {
  return (
    <div style={{ ...HEADER_BASE, background }}>
      <button onClick={onBack} style={BACK_BTN}>
        <ArrowLeft style={{ width: 20, height: 20 }} />
      </button>
      <h1 style={TITLE}>{title}</h1>
      {children}
    </div>
  );
}
