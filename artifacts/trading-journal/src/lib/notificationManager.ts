/**
 * notificationManager — single source of truth for alert notification sounds.
 *
 * ALL alert types (price, zone, trendline) and their repeat reminders must
 * call playNotificationSound() from this module. No other module should
 * synthesise audio for alerts.
 *
 * Design principles:
 *  • Reads the user-selected ringtone from localStorage on EVERY call so a
 *    setting change in Settings → Notifications → Alert Sounds takes effect
 *    for the very next alert — no restart required.
 *  • Honours soundEnabled: false → silent.
 *  • Duplicate-play guard: if a sound is already in progress, the new call is
 *    dropped (prevents stacking simultaneous sounds for the same event).
 *  • Web Audio synthesis only — no external audio files, no system sounds,
 *    no hardcoded fallbacks.
 */

const LS_KEY = "tj_notification_prefs";

type SoundOption = "Default" | "Chime" | "Ping" | "Bell" | "Ding";

interface NotifPrefs {
  soundEnabled: boolean;
  sound: SoundOption;
}

function readPrefs(): NotifPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<NotifPrefs>;
      return {
        soundEnabled: p.soundEnabled !== false,
        sound: (p.sound as SoundOption) ?? "Default",
      };
    }
  } catch { /* ignore */ }
  return { soundEnabled: true, sound: "Default" };
}

function makeCtx(): AudioContext | null {
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    return new AudioCtx();
  } catch {
    return null;
  }
}

// ── Individual ringtone synthesisers ─────────────────────────────────────────
// Each returns the total duration in seconds so the caller can schedule ctx.close().

function synthDefault(ctx: AudioContext): number {
  // Three ascending tones — classic alert arpeggio
  const freqs = [523.25, 659.25, 783.99];
  let t = ctx.currentTime;
  for (const freq of freqs) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.start(t); osc.stop(t + 0.24);
    t += 0.14;
  }
  return t - ctx.currentTime + 0.25;
}

function synthChime(ctx: AudioContext): number {
  // Soft chime: fundamental + two upper partials, long gentle decay
  const partials: [freq: number, vol: number, dur: number][] = [
    [523.25, 0.15, 1.0],
    [1046.5, 0.08, 0.75],
    [1568.0, 0.04, 0.55],
  ];
  const t = ctx.currentTime;
  for (const [freq, vol, dur] of partials) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  return 1.1;
}

function synthPing(ctx: AudioContext): number {
  // Single crisp high-frequency ping
  const t = ctx.currentTime;
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain); gain.connect(ctx.destination);
  osc.type = "sine";
  osc.frequency.setValueAtTime(1320, t);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.20, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.30);
  osc.start(t); osc.stop(t + 0.32);
  return 0.4;
}

function synthBell(ctx: AudioContext): number {
  // Deeper bell: 440 Hz fundamental with two harmonics, medium decay
  const partials: [freq: number, vol: number, dur: number][] = [
    [440,  0.18, 1.3],
    [880,  0.09, 1.0],
    [1320, 0.05, 0.75],
  ];
  const t = ctx.currentTime;
  for (const [freq, vol, dur] of partials) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  return 1.45;
}

function synthDing(ctx: AudioContext): number {
  // Quick two-note descending ding (notification feel)
  const freqs = [880, 698.46];
  let t = ctx.currentTime;
  for (const freq of freqs) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.17, t + 0.007);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.start(t); osc.stop(t + 0.30);
    t += 0.18;
  }
  return t - ctx.currentTime + 0.32;
}

// ── Duplicate-play guard ──────────────────────────────────────────────────────
// Tracks when the current sound will finish (unix ms). A new call that arrives
// while the guard is active is silently dropped — this prevents stacking
// multiple simultaneous sounds when a burst of alert events fires at once.
let guardUntilMs = 0;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Play the user-selected notification sound once.
 *
 * This is the ONLY function that should be called to produce alert audio.
 * It is shared by price alerts, zone alerts, trendline alerts, and all
 * repeat-reminder notifications.
 *
 * Returns immediately (audio is async via Web Audio API).
 */
export function playNotificationSound(): void {
  const prefs = readPrefs();
  if (!prefs.soundEnabled) return;

  const now = Date.now();
  if (now < guardUntilMs) return; // already playing — drop duplicate

  const ctx = makeCtx();
  if (!ctx) return;

  let durationSec: number;
  switch (prefs.sound) {
    case "Chime": durationSec = synthChime(ctx);   break;
    case "Ping":  durationSec = synthPing(ctx);    break;
    case "Bell":  durationSec = synthBell(ctx);    break;
    case "Ding":  durationSec = synthDing(ctx);    break;
    default:      durationSec = synthDefault(ctx); break; // "Default"
  }

  guardUntilMs = now + durationSec * 1000;
  setTimeout(() => ctx.close(), (durationSec + 0.3) * 1000);
}
