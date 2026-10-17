/**
 * Multi-channel notification dispatcher.
 *
 * Channels: console, Slack webhook, email (Resend/Postmark), SMS (Twilio).
 * Opt-in per channel is stored in the recipient's policy.
 */

import { logger } from "./logger.ts";
import { getPushTokens } from "./push-tokens.ts";

export type NotificationLevel = "info" | "warning" | "critical";

export interface Notification {
  level: NotificationLevel;
  title: string;
  description: string;
  context?: Record<string, unknown>;
  channel?: "email" | "sms" | "slack" | "push" | "all";
  recipientEmail?: string;
  recipientPhone?: string;
  /** Caregiver ID used to look up registered push tokens. */
  recipientCaregiverId?: string;
  /** Explicit push token — overrides the caregiver-token lookup. */
  recipientPushToken?: string;
}

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const POSTMARK_API_KEY = process.env.POSTMARK_API_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const NOTIFICATION_EMAIL_FROM =
  process.env.NOTIFICATION_EMAIL_FROM || "notifications@careguard.ai";

const PUSH_WEBHOOK_URL = process.env.PUSH_WEBHOOK_URL;

const ICONS: Record<NotificationLevel, string> = {
  info: "",
  warning: "",
  critical: "",
};

export interface NotificationOptIn {
  email: boolean;
  sms: boolean;
  slack: boolean;
  push: boolean;
}

export const DEFAULT_NOTIFICATION_OPT_IN: NotificationOptIn = {
  email: true,
  sms: false,
  slack: true,
  push: false,
};

function sendSlack(n: Notification): Promise<void> {
  if (!SLACK_WEBHOOK_URL) return Promise.resolve();
  const ctx = n.context
    ? `\n\n\`\`\`${JSON.stringify(n.context, null, 2)}\`\`\``
    : "";
  return fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `${ICONS[n.level]} *${n.title}*\n${n.description}${ctx}`,
    }),
  })
    .then(() => {})
    .catch((err: any) => {
      logger.warn(
        { err: err?.message ?? err },
        "failed to deliver Slack webhook",
      );
    });
}

async function sendEmail(n: Notification): Promise<void> {
  const to = n.recipientEmail;
  if (!to) return;

  if (RESEND_API_KEY) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: NOTIFICATION_EMAIL_FROM,
          to,
          subject: `[CareGuard] ${n.title}`,
          text: `${n.description}\n\n${n.context ? JSON.stringify(n.context, null, 2) : ""}`,
        }),
      });
    } catch (err: any) {
      logger.warn(
        { err: err?.message ?? err },
        "failed to send email via Resend",
      );
    }
    return;
  }

  if (POSTMARK_API_KEY) {
    try {
      await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "X-Postmark-Server-Token": POSTMARK_API_KEY,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          From: NOTIFICATION_EMAIL_FROM,
          To: to,
          Subject: `[CareGuard] ${n.title}`,
          TextBody: `${n.description}\n\n${n.context ? JSON.stringify(n.context, null, 2) : ""}`,
        }),
      });
    } catch (err: any) {
      logger.warn(
        { err: err?.message ?? err },
        "failed to send email via Postmark",
      );
    }
  }
}

async function sendSms(n: Notification): Promise<void> {
  const to = n.recipientPhone;
  if (!to || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER)
    return;

  try {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const body = new URLSearchParams({
      To: to,
      From: TWILIO_FROM_NUMBER,
      Body: `[CareGuard] ${n.title}: ${n.description}`,
    });
    const auth = Buffer.from(
      `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`,
    ).toString("base64");
    await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
  } catch (err: any) {
    logger.warn({ err: err?.message ?? err }, "failed to send SMS via Twilio");
  }
}

/**
 * Send a push notification to a single device token via a configurable
 * webhook (provider-agnostic: FCM, APNs, Expo, etc.).
 *
 * If `PUSH_WEBHOOK_URL` is not set the call is a no-op — the other channels
 * (email / SMS / Slack) still fire because `notify()` dispatches them
 * independently.
 *
 * Returns true if the push was delivered (or skipped due to missing config),
 * false if delivery failed so the caller can rely on the fallback channels.
 */
async function sendPushToOne(token: string, n: Notification): Promise<boolean> {
  if (!PUSH_WEBHOOK_URL) return false;

  try {
    const res = await fetch(PUSH_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        title: `[CareGuard] ${n.title}`,
        body: n.description,
        data: {
          level: n.level,
          context: n.context ?? {},
        },
      }),
    });
    if (!res.ok) {
      logger.warn(
        { status: res.status, token: token.slice(0, 12) + "…" },
        "push webhook returned non-OK status",
      );
      return false;
    }
    return true;
  } catch (err: any) {
    logger.warn(
      { err: err?.message ?? err, token: token.slice(0, 12) + "…" },
      "failed to deliver push notification",
    );
    return false;
  }
}

/**
 * Resolve device tokens for a notification and attempt push delivery.
 *
 * Token resolution order:
 *   1. Explicit `recipientPushToken` on the Notification (single device).
 *   2. All tokens registered for `recipientCaregiverId` via the token store.
 *
 * If no tokens are found, push is silently skipped — the other channels
 * remain as the fallback.
 */
async function sendPush(n: Notification): Promise<void> {
  let tokens: string[] = [];

  if (n.recipientPushToken) {
    tokens = [n.recipientPushToken];
  } else if (n.recipientCaregiverId) {
    tokens = getPushTokens(n.recipientCaregiverId).map((e) => e.token);
  }

  if (tokens.length === 0) return;

  // Fire-and-forget to all registered devices. If all fail, the other
  // channels (email / SMS / Slack) still fired independently in `notify`.
  await Promise.allSettled(tokens.map((t) => sendPushToOne(t, n)));
}

export async function notify(n: Notification): Promise<void> {
  const line = `${ICONS[n.level]} [${n.level.toUpperCase()}] ${n.title} — ${n.description}`;
  if (n.level === "critical" || n.level === "warning") {
    logger.warn({ title: n.title, description: n.description }, line);
  } else {
    logger.info({ title: n.title, description: n.description }, line);
  }

  const channel = n.channel || "all";

  if (channel === "slack" || channel === "all") {
    await sendSlack(n);
  }
  if (channel === "email" || channel === "all") {
    await sendEmail(n);
  }
  if (channel === "sms" || channel === "all") {
    await sendSms(n);
  }
  // Push is dispatched independently — a failure here does not block the
  // other channels, which act as the fallback.
  if (channel === "push" || channel === "all") {
    await sendPush(n);
  }
}
