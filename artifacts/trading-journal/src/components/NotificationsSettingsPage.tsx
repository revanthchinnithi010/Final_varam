/**
 * NotificationsSettingsPage — alert sound, ringtone, and duration settings.
 *
 * NAVIGATION: pure controlled component. No pushState, no popstate listeners.
 * ProfilePage owns the history stack. This component:
 *   - Renders when open=true
 *   - Calls onClose() for its Back button (= ProfilePage's popPage = history.back())
 *   - Calls onOpenPicker(name) to push a picker page onto the stack
 *   - Receives pickerPage ("picker_sound" | "picker_duration" | null) from ProfilePage
 *   - Calls onClosePicker() from picker's Back button (= ProfilePage's popPage)
 *
 * All preferences persisted to localStorage under "tj_notification_prefs".
 */

import React, { memo, useEffect, useRef, useState, useCallback } from "react";
import { COMPOSITOR_EASE } from "@/animations/motion";
import {
  ArrowLeft, Volume2, VolumeX, Music, Timer, ChevronRight, Check,
  Upload, Trash2, Play, FileAudio, AlertCircle,
} from "lucide-react";

import { COMPOSITOR_EASE as EASE_OPEN, COMPOSITOR_EASE_CLOSE as EASE_CLOSE } from "@/animations/motion";
import {
  saveCustomRingtone,
  clearCustomRingtone,
  getCustomRingtoneName,
  hasCustomRingtone,
  playNotificationSound,
} from "@/lib/notificationManager";

const DUR_OPEN  = 240;
const DUR_CLOSE = 210;

const LS_KEY = "tj_notification_prefs";

const SOUNDS    = ["Default", "Chime", "Ping", "Bell", "Ding", "Custom"] as const;
const DURATIONS = ["3 seconds", "5 seconds", "10 seconds", "30 seconds"] as const;
type SoundType    = typeof SOUNDS[number];
type DurationType = typeof DURATIONS[number];

interface NotifPrefs {
  soundEnabled: boolean;
  sound:        SoundType;
  duration:     DurationType;
}

function loadPrefs(): NotifPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { soundEnabled: true, sound: "Default", duration: "5 seconds", ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { soundEnabled: true, sound: "Default", duration: "5 seconds" };
}

function savePrefs(p: NotifPrefs) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

/* ── PickerPage — pure controlled list picker ────────────────────────────────
   No history manipulation — open/close is driven entirely by ProfilePage's
   navStack via the pickerPage prop.                                           */

function PickerPage<T extends string>({
  open, onClose, title, options, selected, onSelect,
}: {
  open:     boolean;
  onClose:  () => void;
  title:    string;
  options:  readonly T[];
  selected: T;
  onSelect: (v: T) => void;
}) {
  const [rendered, setRendered] = useState(open);
  const [visible,  setVisible]  = useState(false);
  const [pressed,  setPressed]  = useState<T | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (open) {
      setRendered(true);
      let rafId: number;
      const id = setTimeout(() => { rafId = requestAnimationFrame(() => setVisible(true)); }, 0);
      return () => { clearTimeout(id); cancelAnimationFrame(rafId); };
    } else {
      setVisible(false);
      const id = setTimeout(() => setRendered(false), DUR_CLOSE + 40);
      return () => clearTimeout(id);
    }
  }, [open]);

  /* ESC → go back */
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  if (!rendered) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 204,
      background: "#000000",
      transform:  visible ? "translateX(0)" : "translateX(100%)",
      transition: visible
        ? `transform ${DUR_OPEN}ms ${EASE_OPEN}`
        : `transform ${DUR_CLOSE}ms ${EASE_CLOSE}`,
      willChange: "transform",
      backfaceVisibility: "hidden",
      WebkitBackfaceVisibility: "hidden",
      display: "flex", flexDirection: "column", overflow: "hidden",
      paddingBottom: "env(safe-area-inset-bottom)",
    }}>
      <header style={{
        height: 60, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 12px",
        background: "#000000",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <button onClick={onClose} aria-label="Back" style={{
          width: 40, height: 40, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.09)",
          color: "rgba(255,255,255,0.72)", cursor: "pointer",
        }}>
          <ArrowLeft style={{ width: 18, height: 18 }} />
        </button>
        <span style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.92)", letterSpacing: "-0.02em" }}>
          {title}
        </span>
        <div style={{ width: 40 }} />
      </header>

      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
        <p style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.10em",
          textTransform: "uppercase",
          padding: "24px 24px 10px",
          color: "rgba(148,163,184,0.40)", lineHeight: 1,
        }}>
          Select {title}
        </p>

        {options.map((opt, i) => {
          const active    = selected === opt;
          const isPressed = pressed === opt;
          const isCustom  = opt === "Custom";
          return (
            <React.Fragment key={opt}>
              <button
                onPointerDown={() => setPressed(opt)}
                onPointerUp={  () => setPressed(null)}
                onPointerLeave={() => setPressed(null)}
                onClick={() => { onSelect(opt); onClose(); }}
                style={{
                  display: "flex", alignItems: "center",
                  padding: "0 24px", height: 64, width: "100%",
                  background: isPressed ? "rgba(255,255,255,0.04)" : "transparent",
                  border: "none", cursor: "pointer", gap: 16,
                  transition: "background 60ms",
                }}
              >
                {isCustom && (
                  <div style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "rgba(139,92,246,0.18)",
                    border: "1px solid rgba(139,92,246,0.30)",
                  }}>
                    <Upload style={{ width: 13, height: 13, color: "#a78bfa" }} />
                  </div>
                )}
                <div style={{ flex: 1, textAlign: "left" }}>
                  <span style={{ fontSize: 15, fontWeight: 500, color: "rgba(255,255,255,0.88)", display: "block" }}>
                    {isCustom ? "Custom (MP3)" : opt}
                  </span>
                  {isCustom && (
                    <span style={{ fontSize: 11, color: "rgba(148,163,184,0.45)", display: "block", marginTop: 2 }}>
                      Upload your own ringtone file
                    </span>
                  )}
                </div>
                {active && (
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%",
                    background: "#a5b4fc",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <Check style={{ width: 11, height: 11, color: "#1e1b4b", strokeWidth: 3 }} />
                  </div>
                )}
              </button>
              {i < options.length - 1 && (
                <div style={{ height: 1, background: "rgba(255,255,255,0.05)", marginLeft: 24 }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

/* ── Toggle row ─────────────────────────────────────────────────────────── */
function ToggleRow({
  icon: Icon, iconColor, iconBg, label, sub, value, onChange, showDivider,
}: {
  icon: React.ElementType; iconColor: string; iconBg: string;
  label: string; sub?: string; value: boolean;
  onChange: (v: boolean) => void; showDivider: boolean;
}) {
  return (
    <>
      <button
        onClick={() => onChange(!value)}
        style={{
          display: "flex", alignItems: "center",
          padding: "0 24px", height: 68, width: "100%",
          background: "transparent", border: "none", cursor: "pointer", gap: 16,
        }}
      >
        <div style={{
          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: iconBg,
        }}>
          <Icon style={{ width: 18, height: 18, color: iconColor }} />
        </div>
        <div style={{ flex: 1, textAlign: "left" }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.90)", lineHeight: 1.3 }}>{label}</p>
          {sub && <p style={{ fontSize: 12, color: "rgba(148,163,184,0.55)", marginTop: 2 }}>{sub}</p>}
        </div>
        <div style={{
          width: 46, height: 26, borderRadius: 13, flexShrink: 0,
          background: value ? "#a5b4fc" : "rgba(255,255,255,0.12)",
          position: "relative",
          transition: "background 200ms",
        }}>
          <div style={{
            position: "absolute",
            top: 3, left: value ? 23 : 3,
            width: 20, height: 20, borderRadius: "50%",
            background: value ? "#1e1b4b" : "rgba(255,255,255,0.70)",
            transition: `left 200ms ${COMPOSITOR_EASE}`,
          }} />
        </div>
      </button>
      {showDivider && <div style={{ height: 1, background: "rgba(255,255,255,0.05)", marginLeft: 80 }} />}
    </>
  );
}

/* ── Nav row ────────────────────────────────────────────────────────────── */
function NavRow({
  icon: Icon, iconColor, iconBg, label, value, onClick, showDivider, disabled,
}: {
  icon: React.ElementType; iconColor: string; iconBg: string;
  label: string; value?: string; onClick: () => void;
  showDivider: boolean; disabled?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <>
      <button
        onPointerDown={() => !disabled && setPressed(true)}
        onPointerUp={  () => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        onClick={onClick}
        disabled={disabled}
        style={{
          display: "flex", alignItems: "center",
          padding: "0 24px", height: 68, width: "100%",
          background: pressed ? "rgba(255,255,255,0.04)" : "transparent",
          border: "none", cursor: disabled ? "default" : "pointer", gap: 16,
          transition: "background 60ms",
          opacity: disabled ? 0.40 : 1,
        }}
      >
        <div style={{
          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: iconBg,
        }}>
          <Icon style={{ width: 18, height: 18, color: iconColor }} />
        </div>
        <span style={{ flex: 1, textAlign: "left", fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.90)" }}>
          {label}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {value && <span style={{ fontSize: 13, color: "rgba(148,163,184,0.65)" }}>{value}</span>}
          <ChevronRight style={{ width: 16, height: 16, color: "rgba(148,163,184,0.30)" }} />
        </div>
      </button>
      {showDivider && <div style={{ height: 1, background: "rgba(255,255,255,0.05)", marginLeft: 80 }} />}
    </>
  );
}

/* ── Custom ringtone upload section ──────────────────────────────────────── */
interface CustomUploadSectionProps {
  disabled: boolean;
  onFileUploaded: () => void;
}

function CustomUploadSection({ disabled, onFileUploaded }: CustomUploadSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName]   = useState<string | null>(() => getCustomRingtoneName());
  const [fileReady, setFileReady] = useState(() => hasCustomRingtone());
  const [error, setError]         = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [playing,   setPlaying]   = useState(false);
  const [dropOver,  setDropOver]  = useState(false);

  const handleFile = useCallback((file: File) => {
    setError(null);

    if (!file.type.includes("mpeg") && !file.name.toLowerCase().endsWith(".mp3")) {
      setError("Only MP3 files are supported.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(`File too large. Maximum size is 5 MB (yours: ${(file.size / 1024 / 1024).toFixed(1)} MB).`);
      return;
    }

    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      saveCustomRingtone(dataUrl, file.name);
      setFileName(file.name);
      setFileReady(true);
      setUploading(false);
      onFileUploaded();
    };
    reader.onerror = () => {
      setError("Failed to read the file. Please try again.");
      setUploading(false);
    };
    reader.readAsDataURL(file);
  }, [onFileUploaded]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // reset so same file can be re-selected
    e.target.value = "";
  }, [handleFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDropOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleClear = useCallback(() => {
    clearCustomRingtone();
    setFileName(null);
    setFileReady(false);
    setError(null);
    onFileUploaded();
  }, [onFileUploaded]);

  const handlePreview = useCallback(() => {
    if (playing) return;
    setPlaying(true);
    playNotificationSound();
    // Reset playing state after a generous window
    setTimeout(() => setPlaying(false), 3000);
  }, [playing]);

  return (
    <div style={{
      margin: "0 16px 4px",
      borderRadius: 16,
      border: "1px solid rgba(139,92,246,0.22)",
      background: "rgba(139,92,246,0.06)",
      overflow: "hidden",
      opacity: disabled ? 0.4 : 1,
      pointerEvents: disabled ? "none" : "auto",
      transition: "opacity 200ms",
    }}>
      {/* Section label */}
      <div style={{
        padding: "14px 16px 10px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <FileAudio style={{ width: 14, height: 14, color: "#a78bfa", flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(148,163,184,0.55)" }}>
          Custom Ringtone
        </span>
      </div>

      {fileReady && fileName ? (
        /* ── Uploaded state ─────────────────────────────── */
        <div style={{ padding: "14px 16px" }}>
          {/* Filename row */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px",
            background: "rgba(255,255,255,0.04)",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.07)",
            marginBottom: 10,
          }}>
            <FileAudio style={{ width: 16, height: 16, color: "#a78bfa", flexShrink: 0 }} />
            <span style={{
              flex: 1, fontSize: 13, fontWeight: 500,
              color: "rgba(255,255,255,0.85)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {fileName}
            </span>
            {/* Preview button */}
            <button
              onClick={handlePreview}
              title="Preview"
              style={{
                width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: playing ? "rgba(165,180,252,0.20)" : "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.10)",
                cursor: "pointer", transition: "background 150ms",
              }}
            >
              <Play style={{ width: 12, height: 12, color: playing ? "#a5b4fc" : "rgba(255,255,255,0.65)" }} />
            </button>
            {/* Delete button */}
            <button
              onClick={handleClear}
              title="Remove"
              style={{
                width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(239,68,68,0.10)",
                border: "1px solid rgba(239,68,68,0.18)",
                cursor: "pointer", transition: "background 150ms",
              }}
            >
              <Trash2 style={{ width: 12, height: 12, color: "#f87171" }} />
            </button>
          </div>

          {/* Replace link */}
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              background: "none", border: "none", padding: 0,
              fontSize: 12, color: "#a78bfa", cursor: "pointer",
              textDecoration: "underline", textDecorationColor: "rgba(167,139,250,0.4)",
              textUnderlineOffset: 3,
            }}
          >
            Replace with a different file
          </button>
        </div>
      ) : (
        /* ── Drop / upload state ────────────────────────── */
        <div
          onDragOver={e => { e.preventDefault(); setDropOver(true); }}
          onDragLeave={() => setDropOver(false)}
          onDrop={handleDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          style={{
            padding: "24px 16px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
            cursor: uploading ? "wait" : "pointer",
            borderRadius: 12,
            border: `2px dashed ${dropOver ? "rgba(167,139,250,0.65)" : "rgba(139,92,246,0.25)"}`,
            margin: 12,
            background: dropOver ? "rgba(139,92,246,0.10)" : "transparent",
            transition: "border-color 150ms, background 150ms",
          }}
        >
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(139,92,246,0.15)",
            border: "1px solid rgba(139,92,246,0.30)",
          }}>
            {uploading
              ? <div style={{
                  width: 20, height: 20, borderRadius: "50%",
                  border: "2px solid rgba(167,139,250,0.30)",
                  borderTopColor: "#a78bfa",
                  animation: "spin 0.7s linear infinite",
                }} />
              : <Upload style={{ width: 20, height: 20, color: "#a78bfa" }} />
            }
          </div>
          <p style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.80)", margin: 0 }}>
            {uploading ? "Reading file…" : "Tap to upload MP3"}
          </p>
          <p style={{ fontSize: 11, color: "rgba(148,163,184,0.45)", margin: 0, textAlign: "center" }}>
            {uploading ? "Please wait" : "MP3 format · max 5 MB"}
          </p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 8,
          padding: "10px 14px 14px",
        }}>
          <AlertCircle style={{ width: 14, height: 14, color: "#f87171", flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 12, color: "#f87171", lineHeight: 1.5 }}>{error}</span>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp3,audio/mpeg"
        onChange={handleInputChange}
        style={{ display: "none" }}
        aria-hidden
      />

      {/* Spin keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────────────── */

export interface NotificationsSettingsPageProps {
  open:          boolean;
  onClose:       () => void;
  /** The navStack entry for the active picker, e.g. "picker_sound" or null */
  pickerPage:    string | null;
  onOpenPicker:  (name: string) => void;
  onClosePicker: () => void;
}

export const NotificationsSettingsPage = memo(function NotificationsSettingsPage({
  open, onClose, pickerPage, onOpenPicker, onClosePicker,
}: NotificationsSettingsPageProps) {
  const [rendered, setRendered] = useState(open);
  const [visible,  setVisible]  = useState(false);
  const [prefs, setPrefs]       = useState<NotifPrefs>(loadPrefs);
  // Re-render when custom ringtone is uploaded/cleared so the nav row label updates
  const [customName, setCustomName] = useState<string | null>(() => getCustomRingtoneName());

  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const updatePrefs = useCallback((patch: Partial<NotifPrefs>) => {
    setPrefs(p => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);

  const handleCustomFileChanged = useCallback(() => {
    setCustomName(getCustomRingtoneName());
  }, []);

  /* ── Lifecycle ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (open) {
      setRendered(true);
      let rafId: number;
      const id = setTimeout(() => { rafId = requestAnimationFrame(() => setVisible(true)); }, 0);
      return () => { clearTimeout(id); cancelAnimationFrame(rafId); };
    } else {
      setVisible(false);
      const id = setTimeout(() => setRendered(false), DUR_CLOSE + 40);
      return () => clearTimeout(id);
    }
  }, [open]);

  /* ── ESC → go back ──────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  if (!rendered) return null;

  /* Label shown in the Alert Ringtone nav row */
  const ringtoneLabel =
    prefs.sound === "Custom" && customName
      ? customName.replace(/\.mp3$/i, "")
      : prefs.sound;

  return (
    <>
      <div style={{
        position: "fixed", inset: 0, zIndex: 203,
        background: "#000000",
        transform:  visible ? "translateX(0)" : "translateX(100%)",
        transition: visible
          ? `transform ${DUR_OPEN}ms ${EASE_OPEN}`
          : `transform ${DUR_CLOSE}ms ${EASE_CLOSE}`,
        willChange: "transform",
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
        display: "flex", flexDirection: "column", overflow: "hidden",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}>
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <header style={{
          height: 60, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 12px",
          background: "#000000",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          <button onClick={onClose} aria-label="Back" style={{
            width: 40, height: 40, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.09)",
            color: "rgba(255,255,255,0.72)", cursor: "pointer",
          }}>
            <ArrowLeft style={{ width: 18, height: 18 }} />
          </button>
          <span style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.92)", letterSpacing: "-0.02em" }}>
            Notifications
          </span>
          <div style={{ width: 40 }} />
        </header>

        {/* ── Scrollable content ───────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>

          <p style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.10em",
            textTransform: "uppercase", padding: "24px 24px 10px",
            color: "rgba(148,163,184,0.40)", lineHeight: 1,
          }}>Alerts</p>

          <ToggleRow
            icon={prefs.soundEnabled ? Volume2 : VolumeX}
            iconColor={prefs.soundEnabled ? "#34d399" : "#94a3b8"}
            iconBg={prefs.soundEnabled ? "rgba(16,185,129,0.14)" : "rgba(148,163,184,0.10)"}
            label="Alert Sounds"
            sub="Play a sound when alerts trigger"
            value={prefs.soundEnabled}
            onChange={v => updatePrefs({ soundEnabled: v })}
            showDivider
          />

          <NavRow
            icon={Music}
            iconColor="#a78bfa"
            iconBg="rgba(139,92,246,0.14)"
            label="Alert Ringtone"
            value={ringtoneLabel}
            onClick={() => onOpenPicker("picker_sound")}
            showDivider={prefs.sound !== "Custom"}
            disabled={!prefs.soundEnabled}
          />

          {/* Custom MP3 upload section — visible only when Custom is selected */}
          {prefs.sound === "Custom" && (
            <>
              <CustomUploadSection
                disabled={!prefs.soundEnabled}
                onFileUploaded={handleCustomFileChanged}
              />
              <div style={{ height: 1, background: "rgba(255,255,255,0.05)", marginLeft: 16, marginRight: 16, marginBottom: 4 }} />
            </>
          )}

          <NavRow
            icon={Timer}
            iconColor="#fbbf24"
            iconBg="rgba(245,158,11,0.14)"
            label="Alert Duration"
            value={prefs.duration}
            onClick={() => onOpenPicker("picker_duration")}
            showDivider={false}
          />

        </div>
      </div>

      {/* ── Picker sub-pages ─────────────────────────────────────────────────
          Controlled by ProfilePage's navStack via pickerPage prop.
          Back button calls onClosePicker = ProfilePage's popPage = history.back(). */}

      <PickerPage
        open={pickerPage === "picker_sound"}
        onClose={onClosePicker}
        title="Alert Ringtone"
        options={SOUNDS}
        selected={prefs.sound}
        onSelect={v => updatePrefs({ sound: v as SoundType })}
      />

      <PickerPage
        open={pickerPage === "picker_duration"}
        onClose={onClosePicker}
        title="Alert Duration"
        options={DURATIONS}
        selected={prefs.duration}
        onSelect={v => updatePrefs({ duration: v as DurationType })}
      />
    </>
  );
});
