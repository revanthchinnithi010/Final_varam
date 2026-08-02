/**
 * repeatEngine — shared alert repeat scheduler.
 *
 * Three repeat modes for all alert types:
 *   • three_reminders        — t=0 (existing system), +5 min, +10 min → auto-delete
 *   • repeat_until_dismissed — t=0 (existing system), then every 10 min indefinitely
 *   • triple_ring            — t=0 one notification + sound plays 3× with 1 s pauses
 *
 * Persistence: pending schedules are stored in localStorage so they survive
 * page reloads. Timer handles live only in the module-level Map; on reload
 * resumeSchedules() recreates them from the persisted data.
 *
 * Duplicate-guard: scheduleRepeat() always calls cancelRepeat() first, so
 * calling it twice for the same alertId is safe.
 */

import { playAlertSound } from "@/lib/alertSound";
import type { NotifType, NotifSeverity } from "@/contexts/NotificationsContext";

export type RepeatMode =
  | "three_reminders"
  | "repeat_until_dismissed"
  | "triple_ring";

// Mirrors Omit<AppNotification, "id" | "timestamp" | "read"> from NotificationsContext
interface NotifPayload {
  type: NotifType;
  title: string;
  description: string;
  severity: NotifSeverity;
}

type AddNotificationFn = (n: NotifPayload) => void;
type DeleteAlertFn    = (id: string) => void;

// ── localStorage schema ───────────────────────────────────────────────────────
const LS_KEY = "tj_repeat_schedules_v1";

interface PersistedSchedule {
  alertId:       string;
  mode:          RepeatMode;
  /** How many engine-issued follow-up reminders have already fired. */
  remindersSent: number;
  /** Unix-ms timestamp for the next fire. */
  nextFireAt:    number;
  symbol:        string;
  alertType:     "price" | "zone" | "trendline";
  description:   string;
}

function loadSchedules(): PersistedSchedule[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PersistedSchedule[]) : [];
  } catch {
    return [];
  }
}

function saveSchedules(schedules: PersistedSchedule[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(schedules)); } catch { /* ignore */ }
}

function upsertSchedule(s: PersistedSchedule) {
  const rest = loadSchedules().filter(x => x.alertId !== s.alertId);
  saveSchedules([...rest, s]);
}

function removeSchedule(alertId: string) {
  saveSchedules(loadSchedules().filter(x => x.alertId !== alertId));
}

// ── Module-level timer registry ───────────────────────────────────────────────
const timers = new Map<string, ReturnType<typeof setTimeout>[]>();

function clearTimers(alertId: string) {
  const handles = timers.get(alertId) ?? [];
  handles.forEach(clearTimeout);
  timers.delete(alertId);
}

function addTimer(alertId: string, handle: ReturnType<typeof setTimeout>) {
  const existing = timers.get(alertId) ?? [];
  timers.set(alertId, [...existing, handle]);
}

// ── Core fire + reschedule logic ──────────────────────────────────────────────
function fireFollowUp(
  s: PersistedSchedule,
  addNotification: AddNotificationFn,
  deleteAlert: DeleteAlertFn,
) {
  // Play sound
  playAlertSound("neutral");

  // Build notification
  const notifType: NotifType =
    s.alertType === "price"     ? "price_alert"     :
    s.alertType === "zone"      ? "zone_alert"       : "trendline_alert";

  const reminderNumber = s.remindersSent + 2; // +2 because #1 was the original trigger

  const title =
    s.mode === "three_reminders"
      ? `Reminder ${reminderNumber} of 3 — ${s.symbol}`
      : `Ongoing Alert — ${s.symbol}`;

  addNotification({
    type:     notifType,
    severity: "warning",
    title,
    description: s.description,
  });

  const updated: PersistedSchedule = { ...s, remindersSent: s.remindersSent + 1 };

  if (s.mode === "three_reminders") {
    // Three Reminders: fire 2 follow-ups (remindersSent 0 → fire #2, 1 → fire #3)
    if (updated.remindersSent >= 2) {
      // All 3 reminders done — clean up and delete the alert
      removeSchedule(s.alertId);
      clearTimers(s.alertId);
      deleteAlert(s.alertId);
      return;
    }
    // Schedule the final reminder in 5 more minutes
    updated.nextFireAt = Date.now() + 5 * 60 * 1000;
    upsertSchedule(updated);
    scheduleNextTimer(updated, addNotification, deleteAlert);

  } else {
    // repeat_until_dismissed — keep going every 10 minutes
    updated.nextFireAt = Date.now() + 10 * 60 * 1000;
    upsertSchedule(updated);
    scheduleNextTimer(updated, addNotification, deleteAlert);
  }
}

function scheduleNextTimer(
  s: PersistedSchedule,
  addNotification: AddNotificationFn,
  deleteAlert: DeleteAlertFn,
) {
  const delay = Math.max(0, s.nextFireAt - Date.now());
  const handle = setTimeout(() => {
    fireFollowUp(s, addNotification, deleteAlert);
  }, delay);
  addTimer(s.alertId, handle);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the repeat sequence for an alert that just triggered.
 *
 * The FIRST notification is already issued by the existing NotificationsContext.
 * This function:
 *   - Plays the alert sound for the initial trigger
 *   - For triple_ring: plays 2 additional sounds with 1 s pauses
 *   - For three_reminders / repeat_until_dismissed: persists a schedule and
 *     queues follow-up notifications + sounds
 */
export function scheduleRepeat(
  alertId: string,
  mode: RepeatMode,
  info: {
    symbol:    string;
    alertType: "price" | "zone" | "trendline";
    description: string;
  },
  addNotification: AddNotificationFn,
  deleteAlert:     DeleteAlertFn,
) {
  // Always cancel first to prevent duplicate schedules
  cancelRepeat(alertId);

  if (mode === "triple_ring") {
    // One notification (already sent), three sounds with 1 s pauses
    playAlertSound("neutral");
    addTimer(alertId, setTimeout(() => playAlertSound("neutral"), 2000));
    addTimer(alertId, setTimeout(() => playAlertSound("neutral"), 4000));
    // No persistent schedule — alert stays active, no follow-up notifications
    return;
  }

  // Play the initial sound for three_reminders and repeat_until_dismissed
  playAlertSound("neutral");

  const intervalMs =
    mode === "three_reminders" ? 5 * 60 * 1000 : 10 * 60 * 1000;

  const schedule: PersistedSchedule = {
    alertId,
    mode,
    remindersSent: 0,
    nextFireAt:    Date.now() + intervalMs,
    symbol:        info.symbol,
    alertType:     info.alertType,
    description:   info.description,
  };

  upsertSchedule(schedule);
  scheduleNextTimer(schedule, addNotification, deleteAlert);
}

/**
 * Cancel all pending repeat timers and remove the persisted schedule.
 * Call when an alert is deleted, disabled, or edited.
 */
export function cancelRepeat(alertId: string) {
  clearTimers(alertId);
  removeSchedule(alertId);
}

/**
 * Resume any schedules persisted from a previous session.
 * Call once on app mount (via useRepeatEngine).
 *
 * @param activeAlertIds  Set of alert IDs that still exist in the store.
 *                        Schedules for missing alerts are discarded.
 */
export function resumeSchedules(
  addNotification: AddNotificationFn,
  deleteAlert:     DeleteAlertFn,
  activeAlertIds:  Set<string>,
) {
  const schedules = loadSchedules();
  const live: PersistedSchedule[] = [];

  for (const s of schedules) {
    if (!activeAlertIds.has(s.alertId)) continue; // alert was deleted while offline
    live.push(s);
    scheduleNextTimer(s, addNotification, deleteAlert);
  }

  saveSchedules(live);
}
