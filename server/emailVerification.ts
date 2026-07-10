import { storage } from './storage';
import { notificationService } from './notifications';
import { generateVerificationCode } from './auth';

const BASE_URL = process.env.APP_URL || 'http://localhost:5010';

/**
 * Premium HTML Email Template Generator
 */
export function getPremiumHtmlTemplate({
  title,
  preheader,
  greeting,
  bodyText,
  code,
  buttonLabel,
  buttonUrl,
  footerText
}: {
  title: string;
  preheader: string;
  greeting: string;
  bodyText: string;
  code?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  footerText?: string;
}) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f8fafc;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #f8fafc;
      padding: 40px 20px;
      box-sizing: border-box;
    }
    .container {
      max-width: 570px;
      margin: 0 auto;
      background-color: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
    }
    .header {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      padding: 30px;
      text-align: center;
    }
    .header h1 {
      color: #ffffff;
      font-size: 24px;
      font-weight: 700;
      margin: 0;
      letter-spacing: -0.5px;
    }
    .content {
      padding: 40px 30px;
    }
    .greeting {
      font-size: 18px;
      font-weight: 600;
      color: #0f172a;
      margin-top: 0;
      margin-bottom: 16px;
    }
    .body-text {
      font-size: 15px;
      line-height: 24px;
      color: #475569;
      margin-bottom: 24px;
    }
    .code-container {
      background-color: #f1f5f9;
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      padding: 20px;
      text-align: center;
      margin: 24px 0;
    }
    .code-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #64748b;
      margin-bottom: 8px;
    }
    .code-value {
      font-size: 32px;
      font-weight: 700;
      letter-spacing: 4px;
      color: #0f172a;
      font-family: 'Courier New', Courier, monospace;
    }
    .button-container {
      text-align: center;
      margin: 30px 0;
    }
    .button {
      display: inline-block;
      background-color: #2563eb;
      color: #ffffff !important;
      text-decoration: none;
      font-size: 15px;
      font-weight: 600;
      padding: 12px 28px;
      border-radius: 6px;
      box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);
    }
    .button:hover {
      background-color: #1d4ed8;
    }
    .footer {
      background-color: #f8fafc;
      border-top: 1px solid #f1f5f9;
      padding: 24px 30px;
      text-align: center;
    }
    .footer-text {
      font-size: 12px;
      color: #94a3b8;
      line-height: 18px;
      margin: 0;
    }
  </style>
</head>
<body>
  <span style="display:none !important; visibility:hidden; mso-hide:all; font-size:1px; line-height:1px; max-height:0px; max-width:0px; opacity:0; overflow:hidden;">${preheader}</span>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>Chess Tournament Manager</h1>
      </div>
      <div class="content">
        <h2 class="greeting">${greeting}</h2>
        <p class="body-text">${bodyText}</p>
        
        ${code ? `
        <div class="code-container">
          <div class="code-title">Verification Code</div>
          <div class="code-value">${code}</div>
        </div>
        ` : ''}

        ${buttonUrl && buttonLabel ? `
        <div class="button-container">
          <a href="${buttonUrl}" class="button" target="_blank">${buttonLabel}</a>
        </div>
        ` : ''}
      </div>
      <div class="footer">
        <p class="footer-text">${footerText || 'This email was sent automatically. Please do not reply directly.'}</p>
        <p class="footer-text" style="margin-top: 8px;">&copy; ${new Date().getFullYear()} Chess Tournament Manager. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generate and send email verification code (Registration)
 */
export async function sendEmailVerificationCode(userId: number, email: string, firstName: string): Promise<string> {
  const code = generateVerificationCode();
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 15); // Code expires in 15 minutes

  // Create verification code record
  await storage.createVerificationCode({
    userId,
    code,
    type: 'email_verification',
    expiresAt,
    used: false,
  });

  console.log(`[AUTH] Verification code for user ID ${userId} (${email}): ${code}`);

  const buttonUrl = `${BASE_URL}/login?mode=verify-email&email=${encodeURIComponent(email)}&code=${code}`;
  const htmlContent = getPremiumHtmlTemplate({
    title: 'Verify Your Email Address',
    preheader: 'Complete your registration with your verification code.',
    greeting: `Hello ${firstName},`,
    bodyText: 'Thank you for creating an account! Please use the following code to verify your email address. You can also click the button below to instantly complete your verification.',
    code,
    buttonLabel: 'Verify My Email',
    buttonUrl,
  });

  notificationService.sendEmail({
    to: email,
    subject: 'Verify Your Email Address',
    text: `Hello ${firstName},\n\nThank you for creating an account! Please use the code: ${code} to verify your email address.\n\nBest regards,\nChess Tournament Manager`,
    html: htmlContent,
  }).catch(err => {
    console.error(`[email] Failed to send verification email to ${email} in background:`, err);
  });

  return code;
}

/**
 * Send password reset code
 */
export async function sendPasswordResetCode(userId: number, email: string, firstName: string, username: string): Promise<string> {
  const code = generateVerificationCode();
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 30); // Code expires in 30 minutes

  // Create password reset record
  await storage.createPasswordReset(userId, code, expiresAt);

  console.log(`[AUTH] Password reset code for user ID ${userId} (${email}): ${code}`);

  const buttonUrl = `${BASE_URL}/login?mode=reset-password&username=${encodeURIComponent(username)}&code=${code}`;
  const htmlContent = getPremiumHtmlTemplate({
    title: 'Password Reset Code',
    preheader: 'Reset your password securely.',
    greeting: `Hello ${firstName},`,
    bodyText: 'You requested to reset your password for Chess Tournament Manager. Please use the verification code below to reset it, or click the button below to go directly to the reset page with your details pre-filled.',
    code,
    buttonLabel: 'Reset My Password',
    buttonUrl,
    footerText: "If you didn't request this, please ignore this email. Your password will remain unchanged.",
  });

  notificationService.sendEmail({
    to: email,
    subject: 'Password Reset Code',
    text: `Hello ${firstName},\n\nYou requested to reset your password. Please use the code: ${code} to complete your reset.\n\nBest regards,\nChess Tournament Manager`,
    html: htmlContent,
  }).catch(err => {
    console.error(`[email] Failed to send password reset email to ${email} in background:`, err);
  });

  return code;
}

/**
 * Send username recovery email
 */
export async function sendUsernameRecoveryEmail({
  email,
  firstName,
  code,
  uscfId,
}: {
  email: string;
  firstName: string;
  code: string;
  uscfId?: string;
}): Promise<void> {
  const queryParts = [];
  queryParts.push(`code=${code}`);
  if (uscfId) {
    queryParts.push(`uscfId=${encodeURIComponent(uscfId)}`);
  } else {
    queryParts.push(`email=${encodeURIComponent(email)}`);
  }
  const buttonUrl = `${BASE_URL}/login?mode=verify-username&${queryParts.join('&')}`;

  const htmlContent = getPremiumHtmlTemplate({
    title: 'Account Username Recovery',
    preheader: 'Recover your username securely.',
    greeting: `Hello ${firstName},`,
    bodyText: 'You requested to retrieve the username(s) associated with your Chess Tournament Manager account. Please use the verification code below to retrieve them, or click the button below to be taken directly to the retrieval page.',
    code,
    buttonLabel: 'Recover My Username',
    buttonUrl,
  });

  notificationService.sendEmail({
    to: email,
    subject: 'Your Account Username Recovery',
    text: `Hello ${firstName},\n\nYou requested to retrieve your username. Please use the recovery code: ${code} to retrieve it.\n\nBest regards,\nChess Tournament Manager`,
    html: htmlContent,
  }).catch(err => {
    console.error(`[email] Failed to send username recovery email to ${email} in background:`, err);
  });
}
