import { storage } from './storage';
import { notificationService } from './notifications';
import { generateVerificationCode } from './auth';

/**
 * Generate and send email verification code
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

  // Send email
  const emailSubject = 'Verify Your Email Address';
  const emailText = `Hello ${firstName},

Thank you for creating an account! Please use the following code to verify your email address:

${code}

This code will expire in 15 minutes.

If you didn't create this account, please ignore this email.

Best regards,
Chess Tournament Manager`;

  await notificationService.sendEmail({
    to: email,
    subject: emailSubject,
    text: emailText,
  });

  return code;
}

/**
 * Send password reset code
 */
export async function sendPasswordResetCode(userId: number, email: string, firstName: string): Promise<string> {
  const code = generateVerificationCode();
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 30); // Code expires in 30 minutes

  // Create password reset record
  await storage.createPasswordReset(userId, code, expiresAt);

  console.log(`[AUTH] Password reset code for user ID ${userId} (${email}): ${code}`);

  // Send email
  const emailSubject = 'Password Reset Code';
  const emailText = `Hello ${firstName},

You requested to reset your password. Please use the following code to reset your password:

${code}

This code will expire in 30 minutes.

If you didn't request a password reset, please ignore this email. Your password will remain unchanged.

Best regards,
Chess Tournament Manager`;

  await notificationService.sendEmail({
    to: email,
    subject: emailSubject,
    text: emailText,
  });

  return code;
}

