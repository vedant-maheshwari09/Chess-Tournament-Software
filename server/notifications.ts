import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { log } from "./vite";
import { Resend } from "resend";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import fs from "fs";
import path from "path";
import webpush from "web-push";
import { storage } from "./storage";

// Using dynamic environment keys or fallback valid generated keys for portability
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "BG2yHrGF3i0wdfshkoO0WmIj0vGiHs6WO67QyCzzR06quXpeHoZBxJrrJleLWce7LTcUlvzJm7KASQ1qDwPKFy0";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "UAiR126H07-Cz2xy4UC8nr0QxF4iKM_cHm6kVv99CGs";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

webpush.setVapidDetails(
  VAPID_SUBJECT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

class NotificationService {
  private transporter: nodemailer.Transporter | null = null;
  private resend: Resend | null = null;
  private fromAddress: string | null = null;
  private gmailReady = false;
  private firebaseReady = false;
  private resendEnabled = false;

  constructor() {
    const cleanEnv = (val?: string) => val?.trim().replace(/^"(.*)"$/, '$1');

    const user = cleanEnv(process.env.NOTIFY_EMAIL_USER ?? process.env.GMAIL_USER);
    const pass = cleanEnv(process.env.NOTIFY_EMAIL_PASSWORD ?? process.env.GMAIL_APP_PASSWORD);
    const from = cleanEnv(process.env.NOTIFY_FROM_EMAIL) ?? user ?? "noreply@example.com";
    
    this.fromAddress = from;

    const resendKey = cleanEnv(process.env.RESEND_API_KEY);
    if (resendKey) {
      try {
        this.resend = new Resend(resendKey);
        this.resendEnabled = true;
        log("Resend client initialized", "notifications");
        // If no explicit from address was configured, use Resend's test sender
        if (this.fromAddress === "noreply@example.com") {
          this.fromAddress = "Chess Tournament <onboarding@resend.dev>";
          log("Using Resend default test sender (onboarding@resend.dev)", "notifications");
        }
      } catch (err) {
        log(`Failed to initialize Resend: ${err}`, "notifications");
      }
    }

    if (user && pass) {
      const transportOptions: SMTPTransport.Options = {
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          user,
          pass,
        },
      };
      this.transporter = nodemailer.createTransport(transportOptions);
      this.gmailReady = true;
    }

    try {
      const serviceAccountPath = path.resolve(process.cwd(), "firebase-service-account.json");
      if (fs.existsSync(serviceAccountPath)) {
        if (!getApps().length) {
          const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
          initializeApp({
            credential: cert(serviceAccount)
          });
        }
        this.firebaseReady = true;
        log("Firebase Admin initialized successfully", "notifications");
      } else {
        log("firebase-service-account.json not found. Push notifications disabled.", "notifications");
      }
    } catch (error) {
      console.error("Failed to initialize Firebase Admin:", error);
    }
  }

  isEmailEnabled(): boolean {
    return !!this.resend || this.gmailReady;
  }

  isPushEnabled(): boolean {
    return true; // We now use standard web-push which is always enabled
  }

  isEnabled(): boolean {
    return this.isEmailEnabled() || this.isPushEnabled();
  }

  async sendEmail(options: { to: string | string[]; subject: string; text?: string; html?: string }): Promise<void> {
    if (!this.isEmailEnabled() || !this.fromAddress) {
      log("Email notifications are disabled, skipping email send.", "notifications");
      return;
    }

    const { to, subject, text, html } = options;
    const recipients = Array.isArray(to) ? to.filter(Boolean) : [to];
    if (recipients.length === 0) return;

    const isGmailSender = this.fromAddress.toLowerCase().includes("gmail.com");

    if (this.gmailReady && this.transporter) {
      try {
        log(`Attempting email send via Gmail SMTP to ${recipients.join(", ")}...`, "notifications");
        await this.transporter.sendMail({
          from: this.fromAddress,
          to: recipients,
          subject,
          text: text ?? "",
          html,
        });
        log(`Email sent successfully via Gmail SMTP to ${recipients.length} recipients`, "notifications");
        return;
      } catch (err) {
        log(`Gmail send failed: ${err}, falling back...`, "notifications");
      }
    }

    // Fallback to Resend if enabled, but rewrite the from address to onboarding@resend.dev
    // if the configured sender is a Gmail/webmail address to avoid unverified domain errors.
    if (this.resendEnabled && this.resend) {
      try {
        log(`Attempting email send via Resend to ${recipients.join(", ")}...`, "notifications");
        
        const isPublicDomain = /@(gmail|yahoo|outlook|hotmail|live|icloud|mail)\.com/i.test(this.fromAddress);
        const resendFrom = isPublicDomain ? "Chess Tournament <onboarding@resend.dev>" : this.fromAddress;
        
        const { data, error } = await this.resend.emails.send({
          from: resendFrom,
          to: recipients,
          replyTo: this.fromAddress,
          subject,
          text: text ?? "",
          html: html,
        });
        
        if (error) {
          log(`Resend API returned error: ${JSON.stringify(error)}`, "notifications");
        } else {
          log(`Email sent successfully via Resend (ID: ${data?.id})`, "notifications");
          return;
        }
      } catch (err) {
        log(`Resend exception: ${err}`, "notifications");
      }
    }
  }

  async sendPushNotification(token: string, title: string, body: string): Promise<void> {
    if (!this.firebaseReady) {
      log("Firebase is not initialized. Skipping legacy Firebase push.", "notifications");
      return;
    }

    try {
      const response = await getMessaging().send({
        token,
        notification: { title, body },
        webpush: {
          notification: { title, body, icon: "/assets/icons/icon-192x192.png" }
        }
      });
      log(`Firebase Push sent. Message ID: ${response}`, "notifications");
    } catch (error) {
      log(`Failed to send Firebase push: ${error}`, "notifications");
    }
  }

  async sendWebPushNotificationToUser(userId: number, title: string, body: string, url?: string): Promise<void> {
    try {
      const subscriptions = await storage.getPushSubscriptionsByUser(userId);
      if (!subscriptions || subscriptions.length === 0) return;

      const payload = JSON.stringify({
        title,
        body,
        icon: "/assets/icons/icon-192x192.png",
        url: url || "/"
      });

      const sendPromises = subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification({
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth
            }
          }, payload);
        } catch (error: any) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            log(`Subscription expired/invalid for user ${userId}, deleting...`, "notifications");
            await storage.deletePushSubscription(sub.endpoint);
          } else {
            log(`Error sending web push: ${error}`, "notifications");
          }
        }
      });

      await Promise.all(sendPromises);
    } catch (error) {
      log(`Failed to send web push notifications: ${error}`, "notifications");
    }
  }
}

export const notificationService = new NotificationService();
