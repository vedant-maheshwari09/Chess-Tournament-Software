import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  forgotUsernameSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgetAccountSchema,
  type LoginData,
  type RegisterData,
  type ForgotPasswordData,
  type ForgotUsernameData,
  type ResetPasswordData,
  type VerifyEmailData,
  type ResendVerificationData,
  type ForgetAccountData
} from "@shared/schema";

import { cn } from "@/lib/utils";
import { z } from "zod";
import { useLocation } from "wouter";

function getPasswordStrength(password: string): { score: number; label: string; color: string; description: string } {
  if (!password) return { score: 0, label: "", color: "bg-slate-200", description: "" };
  let score = 0;
  if (password.length >= 6) score += 1;
  if (password.length >= 10) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  const finalScore = Math.min(score, 4);

  switch (finalScore) {
    case 1:
      return { score: 1, label: "Weak", color: "bg-red-500", description: "Too short or simple" };
    case 2:
      return { score: 2, label: "Fair", color: "bg-orange-500", description: "Add numbers or capital letters" };
    case 3:
      return { score: 3, label: "Good", color: "bg-yellow-500", description: "Almost secure, add special characters" };
    case 4:
      return { score: 4, label: "Strong", color: "bg-emerald-500", description: "Excellent password" };
    default:
      return { score: 0, label: "Too Weak", color: "bg-red-500/30", description: "Must be at least 6 characters" };
  }
}

function PasswordStrengthMeter({ password }: { password?: string }) {
  if (!password) return null;
  const { score, label, color, description } = getPasswordStrength(password);
  
  return (
    <div className="space-y-1.5 mt-2 transition-all duration-300">
      <div className="flex justify-between items-center text-xs">
        <span className="font-semibold text-slate-500 dark:text-slate-400">Password Strength:</span>
        <span className={cn("font-bold transition-colors duration-300", 
          score === 1 ? "text-red-500" :
          score === 2 ? "text-orange-500" :
          score === 3 ? "text-yellow-600 dark:text-yellow-500" :
          score === 4 ? "text-emerald-500" : "text-slate-400"
        )}>{label}</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 h-1.5">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className={cn(
              "h-full rounded-full transition-all duration-500",
              index < score ? color : "bg-slate-200 dark:bg-slate-850"
            )}
          />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground leading-none">{description}</p>
    </div>
  );
}

// Extended schema for client-side validation only
const clientResetPasswordSchema = resetPasswordSchema.extend({
  confirmPassword: z.string().min(6),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type ClientResetPasswordData = z.infer<typeof clientResetPasswordSchema>;

type AuthMode = 'login' | 'register' | 'forgot-password' | 'forgot-username' | 'reset-password' | 'verify-email' | 'forget-account';

export default function AuthForm() {
  const [authMode, setAuthMode] = useState<AuthMode>(() => {
    const saved = localStorage.getItem('auth_mode');
    return (saved as AuthMode) || 'login';
  });
  const [resetEmail, setResetEmail] = useState('');
  const [pendingUserEmail, setPendingUserEmail] = useState(() => {
    return localStorage.getItem('pending_user_email') || '';
  });

  // Persist auth state for refresh
  useEffect(() => {
    localStorage.setItem('auth_mode', authMode);
    localStorage.setItem('pending_user_email', pendingUserEmail);
  }, [authMode, pendingUserEmail]);

  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [forgotUsernameMethod, setForgotUsernameMethod] = useState<'email' | 'uscf'>('email');
  const [forgetAccountMethod, setForgetAccountMethod] = useState<'email_username' | 'uscf'>('email_username');
  const [, setLocation] = useLocation();
  const [usernameCheck, setUsernameCheck] = useState<{
    checking: boolean;
    available: boolean | null;
    message: string;
  }>({ checking: false, available: null, message: '' });

  const [emailCheck, setEmailCheck] = useState<{
    checking: boolean;
    available: boolean | null;
    message: string;
  }>({ checking: false, available: null, message: '' });

  const [uscfSearchQuery, setUscfSearchQuery] = useState("");
  const [uscfSearchResults, setUscfSearchResults] = useState<any[]>([]);
  const [isSearchingUscf, setIsSearchingUscf] = useState(false);
  const [uscfSearchOpen, setUscfSearchOpen] = useState(false);

  const { login, register, isLoggingIn, isRegistering } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const loginForm = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const registerForm = useForm<RegisterData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: "",
      email: "",
      password: "",
      firstName: "",
      lastName: "",
      role: "player",
      uscfId: "",
      uscfName: "",
    },
    mode: "onChange",
  });



  // Debounced username validation
  const checkUsernameAvailability = useCallback(async (username: string) => {
    if (!username || username.length < 3) {
      setUsernameCheck({ checking: false, available: null, message: '' });
      return;
    }

    setUsernameCheck({ checking: true, available: null, message: 'Checking availability...' });

    try {
      const res = await fetch(`/api/auth/check-username/${encodeURIComponent(username)}`);

      if (res.status === 503) {
        // Database unavailable - show helpful message but don't block registration
        setUsernameCheck({
          checking: false,
          available: null, // null means we can't determine, but don't block
          message: 'Unable to verify availability right now. You can still register.'
        });
        return;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      setUsernameCheck({
        checking: false,
        available: data.available,
        message: data.message
      });
    } catch (error) {
      // Only show error if it's not a 503 (which we handle above)
      setUsernameCheck({
        checking: false,
        available: null, // Don't block on network errors
        message: 'Unable to check username availability. You can still try to register.'
      });
    }
  }, []);

  // Debounced email validation
  const checkEmailAvailability = useCallback(async (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      setEmailCheck({ checking: false, available: null, message: '' });
      return;
    }

    setEmailCheck({ checking: true, available: null, message: 'Checking availability...' });

    try {
      const res = await fetch(`/api/auth/check-email/${encodeURIComponent(email)}`);

      if (res.status === 503) {
        // Database unavailable - show helpful message but don't block registration
        setEmailCheck({
          checking: false,
          available: null, // null means we can't determine, but don't block
          message: 'Unable to verify availability right now. You can still register.'
        });
        return;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      setEmailCheck({
        checking: false,
        available: data.available,
        message: data.message
      });
    } catch (error) {
      // Only show error if it's not a 503 (which we handle above)
      setEmailCheck({
        checking: false,
        available: null, // Don't block on network errors
        message: 'Unable to check email availability. You can still try to register.'
      });
    }
  }, []);

  // Debounce effect for username
  useEffect(() => {
    const username = registerForm.watch("username");
    const timeoutId = setTimeout(() => {
      checkUsernameAvailability(username);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [registerForm.watch("username"), checkUsernameAvailability]);

  // Debounce effect for email
  useEffect(() => {
    const email = registerForm.watch("email");
    const timeoutId = setTimeout(() => {
      checkEmailAvailability(email);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [registerForm.watch("email"), checkEmailAvailability]);

  // Debounce effect for USCF search
  useEffect(() => {
    if (!uscfSearchQuery || uscfSearchQuery.length < 3) {
      setUscfSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const selectedUscfName = registerForm.watch("uscfName");
      if (selectedUscfName && uscfSearchQuery === selectedUscfName) return;

      setIsSearchingUscf(true);
      try {
        const response = await fetch(`/api/rating-lookup?q=${encodeURIComponent(uscfSearchQuery)}`);
        if (response.ok) {
          const data = await response.json();
          setUscfSearchResults(data.uscf || []);
        }
      } catch (err) {
        console.error("USCF lookup failed:", err);
      } finally {
        setIsSearchingUscf(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [uscfSearchQuery, registerForm.watch("uscfName")]);

  const forgotPasswordForm = useForm<ForgotPasswordData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { username: "" },
  });

  const forgotUsernameForm = useForm<ForgotUsernameData>({
    resolver: zodResolver(forgotUsernameSchema),
    defaultValues: { email: "", uscfId: "" },
  });

  const resetPasswordForm = useForm<ClientResetPasswordData>({
    resolver: zodResolver(clientResetPasswordSchema),
    defaultValues: { email: "", code: "", newPassword: "", confirmPassword: "" },
  });

  const verifyEmailForm = useForm<VerifyEmailData>({
    resolver: zodResolver(verifyEmailSchema),
    defaultValues: { code: "", email: "" },
  });

  const forgetAccountForm = useForm<ForgetAccountData>({
    resolver: zodResolver(forgetAccountSchema),
    defaultValues: { email: "", username: "", uscfId: "" },
  });

  // Update email field when pendingUserEmail changes
  useEffect(() => {
    if (pendingUserEmail && authMode === 'verify-email') {
      verifyEmailForm.setValue('email', pendingUserEmail);
    }
  }, [pendingUserEmail, authMode, verifyEmailForm]);

  // Mutations
  const forgotPasswordMutation = useMutation({
    mutationFn: async (data: ForgotPasswordData) => {
      return apiRequest("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: (data: any) => {
      toast({ title: "Reset code sent", description: data.message });
      setResetEmail(data.email || "");
      setAuthMode('reset-password');
      resetPasswordForm.setValue('email', data.email || "");
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send reset code",
        variant: "destructive",
      });
    },
  });

  const forgotUsernameMutation = useMutation({
    mutationFn: async (data: ForgotUsernameData) => {
      return apiRequest("/api/auth/forgot-username", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: (data) => {
      toast({ title: "Username sent", description: data.message });
      if (data.username) {
        toast({ title: "Your username", description: `Username: ${data.username}` });
        setAuthMode('login');
        loginForm.setValue('username', data.username);
      }
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send username",
        variant: "destructive",
      });
    },
  });

  const forgetAccountMutation = useMutation({
    mutationFn: async (data: ForgetAccountData) => {
      return apiRequest("/api/auth/forget-account", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: (data: any) => {
      toast({ title: "Account Forgotten", description: data.message });
      setAuthMode('login');
      forgetAccountForm.reset();
    },
    onError: (error) => {
      toast({
        title: "Deletion Failed",
        description: error instanceof Error ? error.message : "Failed to forget account. Please check your inputs.",
        variant: "destructive",
      });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (data: ClientResetPasswordData) => {
      // Remove confirmPassword before sending to API
      const { confirmPassword, ...apiData } = data;
      return apiRequest("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify(apiData),
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Password reset successfully. You can now log in with your new password.",
      });
      setAuthMode('login');
      resetPasswordForm.reset();
      setResetEmail('');
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to reset password",
        variant: "destructive",
      });
    },
  });

  const handleLogin = async (data: LoginData) => {
    try {
      await login(data);
      toast({ title: "Welcome back!", description: "You have successfully logged in." });
      setLocation("/");
    } catch (error) {
      toast({
        title: "Login failed",
        description: error instanceof Error ? error.message : "Invalid credentials",
        variant: "destructive",
      });
    }
  };

  const handleRegister = async (data: RegisterData) => {
    try {

      const response = await register(data);
      if (response.requiresVerification) {
        setPendingUserEmail(data.email);
        setAuthMode('verify-email');
        toast({
          title: "Account created!",
          description: "Please check your email for a verification code."
        });
      } else {
        toast({ title: "Welcome to ChessSoftware!", description: "Your account has been created successfully." });
      }
    } catch (error) {
      console.error("Registration error:", error);
      toast({
        title: "Registration failed",
        description: error instanceof Error ? error.message : "Failed to create account",
        variant: "destructive",
      });
    }
  };

  const verifyEmailMutation = useMutation({
    mutationFn: async (data: VerifyEmailData) => {
      const token = localStorage.getItem("auth_token");
      const payload = { ...data, email: data.email || pendingUserEmail };
      return apiRequest("/api/auth/verify-email", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (data) => {
      if (data.token) {
        localStorage.setItem("auth_token", data.token);
        localStorage.removeItem('auth_mode');
        localStorage.removeItem('pending_user_email');
        // Set user data immediately to trigger dashboard view
        queryClient.setQueryData(["/api/auth/me"], data.user);
        queryClient.invalidateQueries({ queryKey: ["/api"] });
        setLocation("/");
      } else {
        // Fallback if no token (shouldn't happen with updated API)
        setAuthMode('login');
        verifyEmailForm.reset();
      }
      toast({
        title: "Email verified!",
        description: "Your email has been verified successfully."
      });
    },
    onError: (error) => {
      toast({
        title: "Verification failed",
        description: error instanceof Error ? error.message : "Invalid verification code",
        variant: "destructive",
      });
    },
  });

  const resendVerificationMutation = useMutation({
    mutationFn: async (data?: ResendVerificationData) => {
      const token = localStorage.getItem("auth_token");
      return apiRequest("/api/auth/resend-verification", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify(data || { email: pendingUserEmail }),
      });
    },
    onSuccess: (data) => {
      toast({ title: "Code sent", description: data.message || "Verification code sent to your email" });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to resend verification code",
        variant: "destructive",
      });
    },
  });

  const getTitle = () => {
    switch (authMode) {
      case 'login': return 'Sign in to your account';
      case 'register': return 'Create your account';
      case 'forgot-password': return 'Reset your password';
      case 'forgot-username': return 'Recover your username';
      case 'reset-password': return 'Set new password';
      case 'verify-email': return 'Verify your email';
      case 'forget-account': return 'Permanently delete your profile';
    }
  };

  const renderForm = () => {
    switch (authMode) {
      case 'login':
        return (
          <Form {...loginForm}>
            <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
              <FormField
                control={loginForm.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter your username" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={loginForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showLoginPassword ? "text" : "password"}
                          placeholder="Enter your password"
                          {...field}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          onClick={() => setShowLoginPassword(!showLoginPassword)}
                        >
                          {showLoginPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={isLoggingIn}>
                {isLoggingIn ? "Signing in..." : "Sign In"}
              </Button>
              <div className="flex flex-col space-y-1 text-center text-sm pt-2">
                <div className="flex justify-between">
                  <Button variant="link" size="sm" onClick={() => setAuthMode('forgot-username')}>
                    Forgot username?
                  </Button>
                  <Button variant="link" size="sm" onClick={() => setAuthMode('forgot-password')}>
                    Forgot password?
                  </Button>
                </div>
                <Button variant="link" size="sm" className="text-red-500 hover:text-red-600 font-semibold" onClick={() => setAuthMode('forget-account')}>
                  Forget Account / Delete Profile
                </Button>
              </div>
            </form>
          </Form>
        );

      case 'register':
        return (
          <Form {...registerForm}>
            <form onSubmit={registerForm.handleSubmit(handleRegister, (errors) => {
              console.log("Form validation errors:", errors);
              toast({
                title: "Form validation failed",
                description: "Please check all required fields",
                variant: "destructive",
              });
            })} className="space-y-4">
              {registerForm.watch("role") === "player" && (
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200/60 dark:border-slate-800/60 space-y-2 relative">
                  <FormLabel className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Link Your USCF Profile (Recommended)
                  </FormLabel>
                  <div className="relative">
                    <Input
                      placeholder="Search USCF Database by name..."
                      value={uscfSearchQuery}
                      onChange={(e) => {
                        setUscfSearchQuery(e.target.value);
                        setUscfSearchOpen(true);
                      }}
                      className="bg-white dark:bg-slate-950"
                    />
                    {isSearchingUscf && (
                      <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  
                  {uscfSearchOpen && uscfSearchResults.length > 0 && (
                    <div className="absolute Daniel-dropdown z-50 left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-950">
                      {uscfSearchResults.map((player: any) => (
                        <button
                          key={player.id}
                          type="button"
                          className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-900 flex flex-col gap-0.5 border-b border-slate-100 dark:border-slate-900 last:border-0"
                          onClick={() => {
                            let fName = player.firstName || "";
                            let lName = player.lastName || "";
                            if (!fName && !lName && player.name) {
                              const parts = player.name.split(",");
                              if (parts.length === 2) {
                                lName = parts[0].trim();
                                fName = parts[1].trim();
                              } else {
                                fName = player.name;
                              }
                            }
                            registerForm.setValue("firstName", fName, { shouldValidate: true });
                            registerForm.setValue("lastName", lName, { shouldValidate: true });
                            registerForm.setValue("uscfId", player.id, { shouldValidate: true });
                            registerForm.setValue("uscfName", player.name || `${fName} ${lName}`.trim(), { shouldValidate: true });
                            setUscfSearchQuery(player.name || `${fName} ${lName}`.trim());
                            setUscfSearchOpen(false);
                            toast({
                              title: "USCF Profile Linked!",
                              description: `Profile for ${fName} ${lName} (ID: ${player.id}) linked successfully.`,
                            });
                          }}
                        >
                          <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                            {player.name || `${player.firstName} ${player.lastName}`}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            ID: {player.id} | Rating: {player.rating || player.ratingRegular || "Unrated"} | State: {player.state || "N/A"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {registerForm.watch("uscfId") && (
                    <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-500 font-medium">
                      <Check className="h-4 w-4" />
                      Linked USCF ID: <span className="font-bold">{registerForm.watch("uscfId")}</span>
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto p-0 text-red-500 text-xs font-semibold ml-auto"
                        onClick={() => {
                          registerForm.setValue("uscfId", null);
                          registerForm.setValue("uscfName", null);
                          setUscfSearchQuery("");
                        }}
                      >
                        Unlink
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={registerForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input placeholder="John" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={registerForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Doe" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="username" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Username
                </label>
                <div className="relative">
                  <Input
                    id="username"
                    placeholder="Enter your username"
                    value={registerForm.watch("username")}
                    onChange={(e) => {

                      registerForm.setValue("username", e.target.value, { shouldValidate: true });
                    }}
                    className={`pr-10 ${usernameCheck.available === true ? 'border-green-500 focus:ring-green-500' :
                        usernameCheck.available === false ? 'border-red-500 focus:ring-red-500' : ''
                      }`}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    {usernameCheck.checking ? (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    ) : usernameCheck.available === true ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : usernameCheck.available === false ? (
                      <X className="h-4 w-4 text-red-500" />
                    ) : null}
                  </div>
                </div>
                {usernameCheck.message && (
                  <p className={`text-sm font-medium ${usernameCheck.available === true ? 'text-green-600' : 'text-red-600'
                    }`}>
                    {usernameCheck.message}
                  </p>
                )}
                {registerForm.formState.errors.username && (
                  <p className="text-sm font-medium text-destructive">
                    {registerForm.formState.errors.username.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Email
                </label>
                <div className="relative">
                  <Input
                    id="email"
                    type="email"
                    placeholder="john@example.com"
                    value={registerForm.watch("email")}
                    onChange={(e) => {
                      registerForm.setValue("email", e.target.value, { shouldValidate: true });
                    }}
                    className={`pr-10 ${emailCheck.available === true ? 'border-green-500 focus:ring-green-500' :
                        emailCheck.available === false ? 'border-red-500 focus:ring-red-500' : ''
                      }`}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    {emailCheck.checking ? (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    ) : emailCheck.available === true ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : emailCheck.available === false ? (
                      <X className="h-4 w-4 text-red-500" />
                    ) : null}
                  </div>
                </div>
                {emailCheck.message && (
                  <p className={`text-sm font-medium ${emailCheck.available === true ? 'text-green-600' : 'text-red-600'
                    }`}>
                    {emailCheck.message}
                  </p>
                )}
                {registerForm.formState.errors.email && (
                  <p className="text-sm font-medium text-destructive">
                    {registerForm.formState.errors.email.message}
                  </p>
                )}
              </div>
              <FormField
                control={registerForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showRegisterPassword ? "text" : "password"}
                          placeholder="Create a password"
                          {...field}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                        >
                          {showRegisterPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <PasswordStrengthMeter password={field.value} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={registerForm.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select your role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="player">Player</SelectItem>
                        <SelectItem value="tournament_director">Tournament Director</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={isRegistering}>
                {isRegistering ? "Creating account..." : "Create Account"}
              </Button>
            </form>
          </Form>
        );

      case 'forgot-password':
        return (
          <Form {...forgotPasswordForm} key="forgot-password">
            <form onSubmit={forgotPasswordForm.handleSubmit((data) => forgotPasswordMutation.mutate(data))} className="space-y-4">
              <FormField
                control={forgotPasswordForm.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter your username" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={forgotPasswordMutation.isPending}>
                {forgotPasswordMutation.isPending ? "Sending..." : "Send Reset Code"}
              </Button>
            </form>
          </Form>
        );

      case 'forgot-username':
        return (
          <Form {...forgotUsernameForm} key="forgot-username">
            <form onSubmit={forgotUsernameForm.handleSubmit((data) => {
              const submissionData = { ...data };
              if (forgotUsernameMethod === 'email') {
                submissionData.uscfId = "";
              } else {
                submissionData.email = "";
              }
              forgotUsernameMutation.mutate(submissionData);
            })} className="space-y-4">
              <div className="flex rounded-lg bg-slate-100 p-1 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/50">
                <Button
                  type="button"
                  variant={forgotUsernameMethod === 'email' ? "default" : "ghost"}
                  size="sm"
                  className="flex-1 text-xs font-semibold"
                  onClick={() => {
                    setForgotUsernameMethod('email');
                    forgotUsernameForm.setValue('uscfId', "");
                  }}
                >
                  Email
                </Button>
                <Button
                  type="button"
                  variant={forgotUsernameMethod === 'uscf' ? "default" : "ghost"}
                  size="sm"
                  className="flex-1 text-xs font-semibold"
                  onClick={() => {
                    setForgotUsernameMethod('uscf');
                    forgotUsernameForm.setValue('email', "");
                  }}
                >
                  USCF ID
                </Button>
              </div>

              {forgotUsernameMethod === 'email' ? (
                <FormField
                  control={forgotUsernameForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="Enter your email" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <FormField
                  control={forgotUsernameForm.control}
                  name="uscfId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>USCF ID</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter your USCF ID" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <Button type="submit" className="w-full" disabled={forgotUsernameMutation.isPending}>
                {forgotUsernameMutation.isPending ? "Retrieving..." : "Retrieve Username"}
              </Button>
            </form>
          </Form>
        );

      case 'forget-account':
        return (
          <Form {...forgetAccountForm} key="forget-account">
            <form onSubmit={forgetAccountForm.handleSubmit((data) => {
              const submissionData = { ...data };
              if (forgetAccountMethod === 'email_username') {
                submissionData.uscfId = "";
              } else {
                submissionData.email = "";
                submissionData.username = "";
              }
              forgetAccountMutation.mutate(submissionData);
            })} className="space-y-4">
              <div className="flex rounded-lg bg-slate-100 p-1 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/50">
                <Button
                  type="button"
                  variant={forgetAccountMethod === 'email_username' ? "default" : "ghost"}
                  size="sm"
                  className="flex-1 text-xs font-semibold"
                  onClick={() => {
                    setForgetAccountMethod('email_username');
                    forgetAccountForm.setValue('uscfId', "");
                  }}
                >
                  Email + Username
                </Button>
                <Button
                  type="button"
                  variant={forgetAccountMethod === 'uscf' ? "default" : "ghost"}
                  size="sm"
                  className="flex-1 text-xs font-semibold"
                  onClick={() => {
                    setForgetAccountMethod('uscf');
                    forgetAccountForm.setValue('email', "");
                    forgetAccountForm.setValue('username', "");
                  }}
                >
                  USCF ID
                </Button>
              </div>

              {forgetAccountMethod === 'email_username' ? (
                <>
                  <FormField
                    control={forgetAccountForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Address</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="Enter your email" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={forgetAccountForm.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter your username" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              ) : (
                <FormField
                  control={forgetAccountForm.control}
                  name="uscfId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>USCF ID</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter your USCF ID" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <Button type="submit" variant="destructive" className="w-full font-bold" disabled={forgetAccountMutation.isPending}>
                {forgetAccountMutation.isPending ? "Forgetting Account..." : "Forget Account Immediately"}
              </Button>
            </form>
          </Form>
        );

      case 'reset-password':
        return (
          <Form {...resetPasswordForm}>
            <form onSubmit={resetPasswordForm.handleSubmit((data) => resetPasswordMutation.mutate(data))} className="space-y-4">
              <FormField
                control={resetPasswordForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="Enter your email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={resetPasswordForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reset Code</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter 6-digit code" maxLength={6} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={resetPasswordForm.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showResetPassword ? "text" : "password"}
                          placeholder="Enter new password"
                          {...field}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          onClick={() => setShowResetPassword(!showResetPassword)}
                        >
                          {showResetPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={resetPasswordForm.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showConfirmPassword ? "text" : "password"}
                          placeholder="Confirm new password"
                          {...field}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        >
                          {showConfirmPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={resetPasswordMutation.isPending}>
                {resetPasswordMutation.isPending ? "Resetting..." : "Reset Password"}
              </Button>
            </form>
          </Form>
        );

      case 'verify-email':
        return (
          <Form {...verifyEmailForm}>
            <form onSubmit={verifyEmailForm.handleSubmit((data) => verifyEmailMutation.mutate(data))} className="space-y-4">
              <div className="text-sm text-muted-foreground text-center mb-4">
                A verification code has been sent to {pendingUserEmail || 'your email'}. Please enter the 6-digit code below.
              </div>
              {!pendingUserEmail && (
                <FormField
                  control={verifyEmailForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="Enter your email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={verifyEmailForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Verification Code</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter 6-digit code" maxLength={6} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={verifyEmailMutation.isPending}>
                {verifyEmailMutation.isPending ? "Verifying..." : "Verify Email"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={resendVerificationMutation.isPending}
                onClick={() => resendVerificationMutation.mutate(pendingUserEmail ? { email: pendingUserEmail } : undefined)}
              >
                {resendVerificationMutation.isPending ? "Sending..." : "Resend Code"}
              </Button>
            </form>
          </Form>
        );
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-transparent p-4">
      <style>{`
        @keyframes premiumFadeIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-premium-in {
          animation: premiumFadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
      <Card className="w-full max-w-md backdrop-blur-md bg-white/85 dark:bg-slate-900/85 border border-white/20 dark:border-slate-800/60 shadow-xl shadow-slate-200/50 dark:shadow-none transition-all duration-300">
        <CardHeader className="space-y-1 relative">
          {authMode === 'verify-email' && (
            <Button 
              variant="ghost" 
              size="icon" 
              className="absolute right-4 top-4 h-8 w-8 text-muted-foreground hover:text-foreground z-10"
              onClick={() => {
                setAuthMode('register');
                setPendingUserEmail('');
                localStorage.removeItem('auth_mode');
                localStorage.removeItem('pending_user_email');
              }}
              title="Cancel Registration"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
          <div className="flex items-center justify-center mb-4">
            <div className="p-2.5 bg-white dark:bg-white/95 rounded-2xl shadow-sm border border-slate-100/80 dark:border-transparent flex items-center justify-center">
              <img src="/logo.png" alt="ChessSoftware Logo" className="w-12 h-12 object-contain mix-blend-multiply" />
            </div>
          </div>
          <CardTitle className="text-2xl text-center font-bold tracking-tight">ChessSoftware</CardTitle>
          <CardDescription className="text-center text-slate-500 dark:text-slate-400">{getTitle()}</CardDescription>
        </CardHeader>
        <CardContent>
          <div key={authMode} className="animate-premium-in">
            {renderForm()}
          </div>

          <div className="mt-4 text-center">
            {authMode === 'login' && (
              <Button variant="ghost" onClick={() => setAuthMode('register')} className="text-sm">
                Don't have an account? Sign up
              </Button>
            )}
            {authMode === 'register' && (
              <Button variant="ghost" onClick={() => setAuthMode('login')} className="text-sm">
                Already have an account? Sign in
              </Button>
            )}
            {(authMode === 'forgot-password' || authMode === 'forgot-username' || authMode === 'reset-password' || authMode === 'forget-account') && (
              <Button variant="ghost" onClick={() => setAuthMode('login')} className="text-sm">
                Back to sign in
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
