import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { AppConfigService } from "./AppConfigService.js";

const TELEGRAM_API = "https://api.telegram.org";

const KEY_GLOBAL_ENABLED = "telegram_global_enabled";

function maskToken(token: string): string {
  if (token.length <= 12) return "***";
  return `${token.slice(0, 10)}...${token.slice(-4)}`;
}

export class TelegramService {
  private botToken:      string | undefined;
  private chatId:        string | undefined;
  private enabled:       boolean = false;
  private globalEnabled: boolean = true;  // global on/off toggle (does not disconnect)

  constructor() {
    this.botToken = process.env["TELEGRAM_BOT_TOKEN"];
    this.chatId   = process.env["TELEGRAM_CHAT_ID"];
    this.enabled  = !!(this.botToken && this.chatId);
  }

  async init(): Promise<void> {
    // Load global enabled flag from settings table
    try {
      const rows = await db.select().from(settingsTable)
        .where(eq(settingsTable.key, KEY_GLOBAL_ENABLED));
      if (rows[0]) {
        this.globalEnabled = rows[0].value !== "false";
      }
    } catch (err) {
      logger.warn({ err }, "TelegramService: could not load global enabled flag");
    }

    // Load encrypted credentials from AppConfigService
    try {
      const dbToken  = await AppConfigService.get("TELEGRAM_BOT_TOKEN");
      const dbChatId = await AppConfigService.get("TELEGRAM_CHAT_ID");

      if (dbToken && dbChatId) {
        this.botToken = dbToken;
        this.chatId   = dbChatId;
        this.enabled  = true;
        logger.info(
          { tokenMasked: maskToken(dbToken), chatId: dbChatId, source: "db_encrypted" },
          "TelegramService: loaded credentials from encrypted DB",
        );
        return;
      }
    } catch (err) {
      logger.warn({ err }, "TelegramService: could not load credentials from AppConfigService, using env vars");
    }

    if (this.enabled) {
      logger.info(
        { tokenMasked: maskToken(this.botToken!), chatId: this.chatId, source: "env" },
        "TelegramService: enabled from env vars",
      );
    } else {
      logger.warn("TelegramService: disabled — set credentials via UI or env vars");
    }
  }

  async configure(token: string, chatId: string): Promise<{ success: boolean; error?: string; errorType?: "invalid_token" | "invalid_chat" | "network_error" | "unknown" }> {
    // Step 1: Validate token via getMe (fast, no side-effects)
    let meRes: Response;
    try {
      meRes = await fetch(`${TELEGRAM_API}/bot${token}/getMe`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, "TelegramService: getMe network error");
      return { success: false, error: `Network error — cannot reach Telegram API (${msg})`, errorType: "network_error" };
    }

    if (!meRes.ok) {
      const body = await meRes.json().catch(() => ({})) as { description?: string };
      const desc = body.description ?? `HTTP ${meRes.status}`;
      logger.warn({ status: meRes.status, desc }, "TelegramService: invalid bot token");
      return {
        success:   false,
        error:     `Invalid bot token — ${desc}. Copy it directly from @BotFather.`,
        errorType: "invalid_token",
      };
    }

    // Step 2: Validate chat ID by sending the welcome message
    let msgRes: Response;
    try {
      msgRes = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          chat_id:    chatId,
          text:       "✅ <b>TradeVault Connected!</b>\n\nYour Telegram bot is now configured and ready to receive alerts.",
          parse_mode: "HTML",
        }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, "TelegramService: sendMessage network error");
      return { success: false, error: `Network error while sending test message (${msg})`, errorType: "network_error" };
    }

    if (!msgRes.ok) {
      const body = await msgRes.json().catch(() => ({})) as { description?: string };
      const desc = body.description ?? `HTTP ${msgRes.status}`;
      logger.warn({ status: msgRes.status, desc, chatId }, "TelegramService: invalid chat ID");
      return {
        success:   false,
        error:     `Chat ID invalid — ${desc}. Make sure you have started the bot (send /start) and the Chat ID is correct.`,
        errorType: "invalid_chat",
      };
    }

    // Step 3: Persist credentials encrypted via AppConfigService
    try {
      await AppConfigService.set("TELEGRAM_BOT_TOKEN", token);
      await AppConfigService.set("TELEGRAM_CHAT_ID", chatId);
    } catch (err) {
      logger.error({ err }, "TelegramService: failed to persist credentials to encrypted DB");
      return { success: false, error: "Failed to save credentials to database — please try again.", errorType: "unknown" };
    }

    this.botToken = token;
    this.chatId   = chatId;
    this.enabled  = true;

    logger.info({ tokenMasked: maskToken(token), chatId }, "TelegramService: configured via UI (encrypted)");
    return { success: true };
  }

  async disconnect(): Promise<void> {
    try {
      await AppConfigService.delete("TELEGRAM_BOT_TOKEN");
      await AppConfigService.delete("TELEGRAM_CHAT_ID");
    } catch (err) {
      logger.warn({ err }, "TelegramService: error clearing encrypted DB config");
    }
    this.botToken = process.env["TELEGRAM_BOT_TOKEN"];
    this.chatId   = process.env["TELEGRAM_CHAT_ID"];
    this.enabled  = !!(this.botToken && this.chatId);
    logger.info("TelegramService: disconnected (encrypted credentials cleared)");
  }

  /** Global on/off toggle — does not remove credentials, just suppresses delivery. */
  async setGlobalEnabled(value: boolean): Promise<void> {
    this.globalEnabled = value;
    try {
      await db.insert(settingsTable)
        .values({ key: KEY_GLOBAL_ENABLED, value: String(value), updatedAt: new Date() })
        .onConflictDoUpdate({
          target: settingsTable.key,
          set:    { value: String(value), updatedAt: new Date() },
        });
      logger.info({ globalEnabled: value }, "TelegramService: global enabled flag updated");
    } catch (err) {
      logger.warn({ err }, "TelegramService: failed to persist global enabled flag");
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isGlobalEnabled(): boolean {
    return this.globalEnabled;
  }

  getStatus(): {
    configured:    boolean;
    chatId:        string | null;
    tokenMasked:   string | null;
    source:        "db" | "env" | "none";
    globalEnabled: boolean;
  } {
    const hasEnv = !!(process.env["TELEGRAM_BOT_TOKEN"] && process.env["TELEGRAM_CHAT_ID"]);
    return {
      configured:    this.enabled,
      chatId:        this.chatId ?? null,
      tokenMasked:   this.botToken ? maskToken(this.botToken) : null,
      source:        this.enabled ? (hasEnv ? "env" : "db") : "none",
      globalEnabled: this.globalEnabled,
    };
  }

  async sendMessage(
    text:            string,
    chatId?:         string,
    bypassGlobal?:   boolean,
  ): Promise<{ success: boolean; telegramResponse?: unknown; error?: string }> {
    if (!this.enabled || !this.botToken) {
      return { success: false, error: "Telegram not configured" };
    }

    if (!bypassGlobal && !this.globalEnabled) {
      return { success: false, error: "Telegram alerts are globally disabled" };
    }

    const target  = chatId ?? this.chatId!;
    const payload = { chat_id: target, text, parse_mode: "HTML" };

    logger.info(
      { tokenMasked: maskToken(this.botToken), targetChatId: target, payloadLength: text.length },
      "TelegramService: sending message",
    );

    try {
      const res = await fetch(`${TELEGRAM_API}/bot${this.botToken}/sendMessage`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });

      let responseBody: unknown;
      try { responseBody = await res.json(); }
      catch { responseBody = await res.text().catch(() => "<unreadable>"); }

      if (!res.ok) {
        logger.error({ httpStatus: res.status, telegramResponse: responseBody }, "TelegramService: delivery failed");
        return { success: false, telegramResponse: responseBody, error: `HTTP ${res.status}: ${res.statusText}` };
      }

      logger.info({ httpStatus: res.status, targetChatId: target }, "TelegramService: delivered");
      return { success: true, telegramResponse: responseBody };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err, targetChatId: target }, "TelegramService: network error");
      return { success: false, error: errorMsg };
    }
  }

  async sendTestMessage(): Promise<{
    success: boolean; configured: boolean; telegramResponse?: unknown; error?: string;
  }> {
    // Test always bypasses globalEnabled so the user can verify bot connectivity
    const result = await this.sendMessage(
      "✅ <b>TradeVault Test Message</b>\n\nYour Telegram alerts are working correctly.",
      undefined,
      true,
    );
    return { ...result, configured: this.enabled };
  }

  async sendAlertTriggered(opts: {
    symbol: string; condition: string; targetPrice: number;
    triggeredPrice: number; message?: string | null;
  }): Promise<boolean> {
    const arrow = opts.condition.includes("above") ? "⬆️" : "⬇️";
    const emoji = opts.condition.includes("above") ? "🟢" : "🔴";
    const text  = [
      `${emoji} <b>PRICE ALERT TRIGGERED</b>`,
      ``,
      `📊 <b>Symbol:</b> ${opts.symbol}`,
      `${arrow} <b>Condition:</b> ${opts.condition.replace(/_/g, " ")}`,
      `🎯 <b>Target:</b> $${opts.targetPrice.toFixed(5)}`,
      `💹 <b>Triggered at:</b> $${opts.triggeredPrice.toFixed(5)}`,
      opts.message ? `📝 <b>Note:</b> ${opts.message}` : null,
      ``,
      `⏰ ${new Date().toUTCString()}`,
    ].filter(Boolean).join("\n");
    const result = await this.sendMessage(text);
    return result.success;
  }

  async sendZoneAlert(opts: {
    symbol: string; zoneType: string; condition: string;
    upperPrice: number; lowerPrice: number; triggeredPrice: number;
    direction: string; notes?: string | null;
  }): Promise<boolean> {
    const zoneEmoji: Record<string, string> = {
      supply: "🔴", demand: "🟢", support_resistance: "🔵", order_block: "🟠",
    };
    const emoji     = zoneEmoji[opts.zoneType] ?? "📦";
    const zoneLabel = opts.zoneType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    const condLabel = opts.condition === "touch" ? "Touched Zone" : opts.condition === "break" ? "Broke Zone" : "Retested Zone";
    const text      = [
      `${emoji} <b>ZONE ALERT — ${condLabel.toUpperCase()}</b>`,
      ``,
      `📊 <b>Symbol:</b> ${opts.symbol}`,
      `🗂 <b>Zone Type:</b> ${zoneLabel}`,
      `📏 <b>Zone Range:</b> $${opts.lowerPrice.toFixed(5)} – $${opts.upperPrice.toFixed(5)}`,
      `💹 <b>Triggered at:</b> $${opts.triggeredPrice.toFixed(5)}`,
      `↕️ <b>Action:</b> Price ${opts.direction}`,
      opts.notes ? `📝 <b>Notes:</b> ${opts.notes}` : null,
      ``,
      `⏰ ${new Date().toUTCString()}`,
    ].filter(Boolean).join("\n");
    const result = await this.sendMessage(text);
    return result.success;
  }

  async sendTrendlineAlert(opts: {
    symbol: string; timeframe: string; condition: string;
    triggeredPrice: number; projectedPrice: number; direction: string; notes?: string | null;
  }): Promise<boolean> {
    const emoji     = opts.direction.includes("above") ? "🟢" : "🔴";
    const condLabel =
      opts.condition === "break" ? "Trendline Break" :
      opts.condition === "touch" ? "Trendline Touch" : "Trendline Retest";
    const text = [
      `${emoji} <b>TRENDLINE ALERT — ${condLabel.toUpperCase()}</b>`,
      ``,
      `📊 <b>Symbol:</b> ${opts.symbol}`,
      `⏱ <b>Timeframe:</b> ${opts.timeframe}`,
      `📐 <b>Projected Price:</b> $${opts.projectedPrice.toFixed(5)}`,
      `💹 <b>Triggered at:</b> $${opts.triggeredPrice.toFixed(5)}`,
      `↕️ <b>Action:</b> Price ${opts.direction}`,
      opts.notes ? `📝 <b>Notes:</b> ${opts.notes}` : null,
      ``,
      `⏰ ${new Date().toUTCString()}`,
    ].filter(Boolean).join("\n");
    const result = await this.sendMessage(text);
    return result.success;
  }

  async sendDrawingAlert(opts: {
    symbol: string; timeframe: string; drawingType: string; condition: string;
    conditionLabel: string; triggeredPrice: number; projectedPrice: number;
    direction: string; notes?: string | null;
  }): Promise<boolean> {
    const drawingEmojis: Record<string, string> = {
      trendline:       "📈",
      ray:             "📐",
      horizontal_line: "➡️",
      rectangle:       "📦",
      channel:         "🛤️",
    };
    const dirEmoji = opts.direction.includes("above") ? "🟢" : "🔴";
    const dtLabel  = opts.drawingType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    const emoji    = drawingEmojis[opts.drawingType] ?? "📊";

    const text = [
      `${dirEmoji} <b>${dtLabel.toUpperCase()} ALERT</b>`,
      ``,
      `${emoji} <b>Symbol:</b> ${opts.symbol}`,
      `⚡ <b>Condition:</b> ${opts.conditionLabel}`,
      `📐 <b>Projected Price:</b> ${opts.projectedPrice.toFixed(5)}`,
      `💹 <b>Current Price:</b> ${opts.triggeredPrice.toFixed(5)}`,
      `⏱ <b>Timeframe:</b> ${opts.timeframe}`,
      opts.notes ? `📝 <b>Notes:</b> ${opts.notes}` : null,
      ``,
      `⏰ ${new Date().toUTCString()}`,
    ].filter(Boolean).join("\n");

    const result = await this.sendMessage(text);
    return result.success;
  }

  async sendFeedAlert(message: string): Promise<boolean> {
    const result = await this.sendMessage(`⚠️ <b>Feed Alert</b>\n\n${message}`);
    return result.success;
  }
}
