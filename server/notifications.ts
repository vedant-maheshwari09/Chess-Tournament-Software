import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { log } from "./vite";

const carrierGateways: Record<string, string> = {
  att: "txt.att.net",
  verizon: "vtext.com",
  tmobile: "tmomail.net",
  sprint: "messaging.sprintpcs.com",
  googlefi: "msg.fi.google.com",
  uscellular: "email.uscc.net",
};

function sanitizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length < 10) {
    return null;
  }
  return digits;
}

class NotificationService {
  private transporter: nodemailer.Transporter | null = null;
  private fromAddress: string | null = null;
  private ready = false;

  constructor() {
    const user = process.env.NOTIFY_EMAIL_USER ?? process.env.GMAIL_USER;
    const pass = process.env.NOTIFY_EMAIL_PASSWORD ?? process.env.GMAIL_APP_PASSWORD;
    const from = process.env.NOTIFY_FROM_EMAIL ?? user ?? null;

    if (!user || !pass || !from) {
      log("Notification service disabled: missing Gmail credentials.", "notifications");
      this.ready = false;
      return;
    }

    const transportOptions: SMTPTransport.Options = {
      service: "gmail",
      auth: {
        user,
        pass,
      },
    };

    this.transporter = nodemailer.createTransport(transportOptions);
    this.fromAddress = from;
    this.ready = true;
  }

  isEnabled(): boolean {
    return this.ready && !!this.transporter && !!this.fromAddress;
  }

  async sendEmail(options: { to: string | string[]; subject: string; text: string }): Promise<void> {
    if (!this.isEnabled() || !this.transporter || !this.fromAddress) {
      throw new Error("Email notifications are not configured");
    }

    const { to, subject, text } = options;
    const recipients = Array.isArray(to) ? to.filter(Boolean) : [to];
    if (recipients.length === 0) return;

    await this.transporter.sendMail({
      from: this.fromAddress,
      bcc: recipients,
      subject,
      text,
    });
  }

  async sendSms(options: { phoneNumber: string; carrier: string; message: string }): Promise<void> {
    if (!this.isEnabled()) {
      throw new Error("SMS notifications are not configured");
    }

    const phone = sanitizePhone(options.phoneNumber);
    if (!phone) return;

    const carrierKey = (options.carrier || "").toLowerCase();
    const gateway = carrierGateways[carrierKey];
    if (!gateway) {
      log(`Skipping SMS for ${phone}: unknown carrier '${options.carrier}'`, "notifications");
      return;
    }

    const smsAddress = `${phone}@${gateway}`;
    await this.sendEmail({
      to: smsAddress,
      subject: "",
      text: options.message,
    });
  }
}

export const notificationService = new NotificationService();
export const smsCarrierGateways = carrierGateways;
