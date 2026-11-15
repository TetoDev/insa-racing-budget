import nodemailer from "nodemailer";
import { ROLE_LABELS, type UserRole } from "~/lib/constants";
import { getEnv } from "./env";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createTransporter() {
  const env = getEnv();
  if (!env.smtpHost) {
    return null;
  }
  if (env.smtpRequireAuth && !env.smtpPass) {
    return null;
  }
  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    ignoreTLS: env.smtpIgnoreTls,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    ...(!env.smtpIgnoreTls ? { tls: { minVersion: "TLSv1.2" as const } } : {}),
    ...(env.smtpUser && env.smtpPass
      ? {
          auth: {
            user: env.smtpUser,
            pass: env.smtpPass
          }
        }
      : {})
  });
}

export async function verifySmtpConnection(): Promise<{ ok: boolean; reason?: string }> {
  const transporter = createTransporter();
  if (!transporter) {
    return { ok: false, reason: "SMTP_HOST or SMTP_PASS is not configured." };
  }
  try {
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "SMTP connection verification failed."
    };
  }
}

export async function sendInviteEmail(params: {
  toEmail: string;
  role: UserRole;
  inviteUrl: string;
  invitedByName: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const env = getEnv();
  const transporter = createTransporter();
  if (!transporter) {
    console.warn(`[mailer] SMTP_PASS missing. Invite URL for ${params.toEmail}: ${params.inviteUrl}`);
    return { sent: false, reason: "smtp_not_configured" };
  }

  const roleLabel = ROLE_LABELS[params.role] || params.role;
  const safeUrl = escapeHtml(params.inviteUrl);
  const safeInviter = escapeHtml(params.invitedByName);

  try {
    await transporter.sendMail({
      from: env.smtpFrom,
      to: params.toEmail,
      subject: "Invitation to INSA Racing Purchase & Budget Platform",
      text: [
        `Hello,`,
        ``,
        `${params.invitedByName} has approved your email (${params.toEmail}) and invited you to the INSA Racing Purchase & Budget platform with the role: ${roleLabel}.`,
        ``,
        `Complete your profile (name, title, profile picture, and password) within 7 days using this link:`,
        params.inviteUrl,
        ``,
        `INSA Racing`
      ].join("\n"),
      html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0f172a;">
        <h2 style="margin: 0 0 12px; color: #dc2626;">INSA Racing — Achats & Budget</h2>
        <p style="line-height: 1.5;">
          <strong>${safeInviter}</strong> has approved your email and invited you to join the INSA Racing Purchase &amp; Budget platform as <strong>${escapeHtml(roleLabel)}</strong>.
        </p>
        <p style="line-height: 1.5;">
          Click the button below within 7 days to set your password, team title, and profile picture:
        </p>
        <p style="margin: 24px 0;">
          <a href="${safeUrl}" style="display: inline-block; background: #dc2626; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: 600;">
            Complete Account Setup
          </a>
        </p>
        <p style="font-size: 12px; color: #64748b; word-break: break-all;">
          If the button does not work, copy this link: ${safeUrl}
        </p>
      </div>
    `
    });
  } catch (err) {
    console.error(`[mailer] Failed to send invite email to ${params.toEmail}:`, err);
    return { sent: false, reason: "smtp_send_failed" };
  }

  return { sent: true };
}

export async function sendPasswordResetEmail(params: {
  toEmail: string;
  fullName: string;
  resetUrl: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const env = getEnv();
  const transporter = createTransporter();
  if (!transporter) {
    console.warn(`[mailer] SMTP_PASS missing. Password reset URL for ${params.toEmail}: ${params.resetUrl}`);
    return { sent: false, reason: "smtp_not_configured" };
  }

  const safeUrl = escapeHtml(params.resetUrl);
  const safeName = escapeHtml(params.fullName);

  await transporter.sendMail({
    from: env.smtpFrom,
    to: params.toEmail,
    subject: "Password Reset — INSA Racing Achats",
    text: [
      `Hello ${params.fullName},`,
      ``,
      `We received a request to reset your password for INSA Racing Purchase & Budget.`,
      `Use this single-use link within 30 minutes to choose a new password:`,
      params.resetUrl,
      ``,
      `If you did not request this, you can safely ignore this email.`
    ].join("\n"),
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0f172a;">
        <h2 style="margin: 0 0 12px; color: #dc2626;">Password Reset Request</h2>
        <p style="line-height: 1.5;">Hello <strong>${safeName}</strong>,</p>
        <p style="line-height: 1.5;">
          Use the link below within 30 minutes to set a new password (single-use link):
        </p>
        <p style="margin: 24px 0;">
          <a href="${safeUrl}" style="display: inline-block; background: #0f172a; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: 600;">
            Reset Password
          </a>
        </p>
        <p style="font-size: 12px; color: #64748b; word-break: break-all;">
          If the button does not work, copy this link: ${safeUrl}
        </p>
      </div>
    `
  });

  return { sent: true };
}
