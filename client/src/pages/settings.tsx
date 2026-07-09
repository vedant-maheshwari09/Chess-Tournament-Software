import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { LogOut, Trash2, ArrowLeft, SlidersHorizontal, User2, Mail, Smartphone, Bell, Trophy, Users, Loader2, Check, BadgeCheck, MessageSquare } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { subscribeToPushNotifications, unsubscribeFromPushNotifications, getPushSubscriptionStatus } from "@/lib/push";
import { UscfVerificationCard } from "@/components/uscf-verification-card";
import { FideVerificationCard } from "@/components/fide-verification-card";

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();


  const [notifyEmail, setNotifyEmail] = useState<boolean>(user?.notifyEmail ?? true);
  const [notifyPairings, setNotifyPairings] = useState<boolean>(user?.notifyPairings ?? true);
  const [notifyRegistration, setNotifyRegistration] = useState<boolean>(user?.notifyRegistration ?? true);
  const [notifyTournamentStatus, setNotifyTournamentStatus] = useState<boolean>(user?.notifyTournamentStatus ?? true);

  const [prizePaymentEnabled, setPrizePaymentEnabled] = useState<boolean>(true);
  const [prizeStripeEmail, setPrizeStripeEmail] = useState<string>("");
  const [prizeBankRouting, setPrizeBankRouting] = useState<string>("");
  const [prizeBankAccount, setPrizeBankAccount] = useState<string>("");
  const [isSavingPrizePayment, setIsSavingPrizePayment] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Director global payment defaults
  const [directorProvider, setDirectorProvider] = useState<"stripe" | "paypal">("stripe");
  const [stripeAccountId, setStripeAccountId] = useState<string>("");
  const [stripePublishableKey, setStripePublishableKey] = useState<string>("");
  const [payoutStatementDescriptor, setPayoutStatementDescriptor] = useState<string>("");

  // Chat customizability states (syncs to/from localStorage)
  const [chatPlayChime, setChatPlayChime] = useState<boolean>(() => localStorage.getItem("chat_play_chime") !== "false");
  const [chatEnterToSend, setChatEnterToSend] = useState<boolean>(() => localStorage.getItem("chat_enter_to_send") !== "false");
  const [chatMuteGeneral, setChatMuteGeneral] = useState<boolean>(() => localStorage.getItem("chat_mute_general") === "true");
  const [chatMuteAnnouncements, setChatMuteAnnouncements] = useState<boolean>(() => localStorage.getItem("chat_mute_announcements") === "true");
  const [chatDensity, setChatDensity] = useState<"cozy" | "compact">(() => (localStorage.getItem("chat_density") as "cozy" | "compact") || "cozy");

  const handleToggleChatPlayChime = (checked: boolean) => {
    setChatPlayChime(checked);
    localStorage.setItem("chat_play_chime", String(checked));
    toast({ title: checked ? "Chat sound chimes enabled" : "Chat sound chimes disabled" });
  };

  const handleToggleChatEnterToSend = (checked: boolean) => {
    setChatEnterToSend(checked);
    localStorage.setItem("chat_enter_to_send", String(checked));
    toast({ title: checked ? "Enter key will send messages" : "Enter key will insert a newline" });
  };

  const handleToggleChatMuteGeneral = (checked: boolean) => {
    setChatMuteGeneral(checked);
    localStorage.setItem("chat_mute_general", String(checked));
    toast({ title: checked ? "General chat muted" : "General chat unmuted" });
  };

  const handleToggleChatMuteAnnouncements = (checked: boolean) => {
    setChatMuteAnnouncements(checked);
    localStorage.setItem("chat_mute_announcements", String(checked));
    toast({ title: checked ? "Announcements chat muted" : "Announcements chat unmuted" });
  };

  const handleChatDensityChange = (value: string) => {
    setChatDensity(value as "cozy" | "compact");
    localStorage.setItem("chat_density", value);
    toast({ title: `Chat density set to ${value}` });
  };

  // Profile Edit States
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [organizationName, setOrganizationName] = useState(user?.organizationName ?? "");
  const [profilePicture, setProfilePicture] = useState(user?.profilePicture ?? "");
  const [imgError, setImgError] = useState(false);

  const updatePreferencesMutation = useMutation({
    mutationFn: async (preferences: {
      notifyEmail?: boolean;
      notifyPairings?: boolean;
      notifyRegistration?: boolean;
      notifyTournamentStatus?: boolean;
    }) => {
      return apiRequest("/api/auth/preferences", {
        method: "PATCH",
        body: JSON.stringify(preferences),
      });
    },
    onSuccess: (updatedUser: any) => {
      queryClient.setQueryData(["/api/auth/me"], updatedUser);
    },
    onError: (error: any) => {
      if (user) {
        setNotifyEmail(user.notifyEmail ?? true);
        setNotifyPairings(user.notifyPairings ?? true);
        setNotifyRegistration(user.notifyRegistration ?? true);
        setNotifyTournamentStatus(user.notifyTournamentStatus ?? true);
      }
      toast({
        title: "Update failed",
        description: error?.message ?? "Unable to save preferences.",
        variant: "destructive",
      });
    },
  });

  const handleTogglePreference = (key: "email" | "pairings" | "registration" | "tournamentStatus", checked: boolean) => {
    if (key === "email") {
      setNotifyEmail(checked);
      updatePreferencesMutation.mutate({ notifyEmail: checked });
    } else if (key === "pairings") {
      setNotifyPairings(checked);
      updatePreferencesMutation.mutate({ notifyPairings: checked });
    } else if (key === "registration") {
      setNotifyRegistration(checked);
      updatePreferencesMutation.mutate({ notifyRegistration: checked });
    } else if (key === "tournamentStatus") {
      setNotifyTournamentStatus(checked);
      updatePreferencesMutation.mutate({ notifyTournamentStatus: checked });
    }
  };

  useEffect(() => {
    if (!updatePreferencesMutation.isPending) {
      setNotifyEmail(user?.notifyEmail ?? true);
      setNotifyPairings(user?.notifyPairings ?? true);
      setNotifyRegistration(user?.notifyRegistration ?? true);
      setNotifyTournamentStatus(user?.notifyTournamentStatus ?? true);
    }

    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
    setOrganizationName(user?.organizationName ?? "");
    setProfilePicture(user?.profilePicture ?? "");
    setImgError(false);

    const payment = (user?.paymentSettings as any) || {};
    setPrizePaymentEnabled(payment.prizePaymentEnabled ?? true);
    setPrizeStripeEmail(payment.prizeStripeEmail ?? user?.email ?? "");
    setPrizeBankRouting(payment.prizeBankRouting ?? "");
    setPrizeBankAccount(payment.prizeBankAccount ?? "");
  }, [user, updatePreferencesMutation.isPending]);

  const updateProfileMutation = useMutation({
    mutationFn: async (body: { firstName?: string; lastName?: string; organizationName?: string; profilePicture?: string }) => {
      return apiRequest("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: (updatedUser: any) => {
      queryClient.setQueryData(["/api/auth/me"], updatedUser);
      toast({ title: "Profile updated successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error?.message ?? "Unable to save profile.",
        variant: "destructive",
      });
    },
  });

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("avatar", file);

    try {
      const data = await apiRequest("/api/auth/profile/upload-picture", {
        method: "POST",
        body: formData,
      });
      setProfilePicture(data.profilePicture);
      setImgError(false);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Profile picture updated" });
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  const handleSaveProfile = () => {
    updateProfileMutation.mutate({
      firstName,
      lastName,
      organizationName: user?.role === 'tournament_director' ? organizationName : undefined
    });
  };

  // Fetch and update global director payment settings
  const { data: directorSettings, isLoading: isLoadingDirectorSettings } = useQuery<any>({
    queryKey: ["/api/account/payments"],
    enabled: user?.role === "tournament_director",
  });

  useEffect(() => {
    if (directorSettings) {
      setDirectorProvider(directorSettings.preferredProvider || "stripe");
      setStripeAccountId(directorSettings.stripeAccountId || "");
      setStripePublishableKey(directorSettings.stripePublishableKey || "");
      setPayoutStatementDescriptor(directorSettings.payoutStatementDescriptor || "");
    }
  }, [directorSettings]);

  const saveDirectorSettingsMutation = useMutation({
    mutationFn: async (payload: {
      preferredProvider: "stripe" | "paypal" | null;
      stripeAccountId?: string;
      stripePublishableKey?: string;
      payoutStatementDescriptor?: string;
    }) => {
      const res = await apiRequest("/api/account/payments", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/account/payments"] });
      toast({
        title: "Director payments updated",
        description: "Your global payment settings have been saved.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Unable to update payments",
        description: error?.message ?? "An error occurred. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSaveDirectorSettings = () => {
    saveDirectorSettingsMutation.mutate({
      preferredProvider: directorProvider,
      stripeAccountId: stripeAccountId.trim(),
      stripePublishableKey: stripePublishableKey.trim(),
      payoutStatementDescriptor: payoutStatementDescriptor.trim(),
    });
  };

  const handleSavePrizePayment = async () => {
    setIsSavingPrizePayment(true);
    try {
      const response = await apiRequest("/api/auth/profile/prize-payment", {
        method: "PATCH",
        body: JSON.stringify({
          prizePaymentEnabled,
          prizeStripeEmail,
          prizeBankRouting,
          prizeBankAccount,
        }),
      });
      const data = await response.json();
      queryClient.setQueryData(["/api/auth/me"], data);
      toast({
        title: "Payout details saved",
        description: "Your prize payment preferences have been updated successfully.",
      });
    } catch (err: any) {
      toast({
        title: "Failed to save details",
        description: err.message || "An error occurred while updating payout settings.",
        variant: "destructive",
      });
    } finally {
      setIsSavingPrizePayment(false);
    }
  };

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await logout();
    },
    onSuccess: () => {
      toast({ title: "Signed out" });
      setLocation("/");
    },
    onError: (error: any) => {
      toast({
        title: "Logout failed",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("/api/auth/account", { method: "DELETE" });
    },
    onSuccess: async () => {
      await logout();
      toast({ title: "Account deleted" });
      setLocation("/");
    },
    onError: (error: any) => {
      toast({
        title: "Delete account failed",
        description: error?.message ?? "Unable to remove account.",
        variant: "destructive",
      });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
    },
    onSuccess: () => {
      toast({ title: "Password updated" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (error: any) => {
      toast({
        title: "Change failed",
        description: error?.message ?? "Unable to update password.",
        variant: "destructive",
      });
    },
  });

  const tdCredentialsMutation = useMutation({
    mutationFn: async (body: any) => {
      return apiRequest("/api/auth/profile/td-credentials", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: async () => {
      toast({ title: "Director credentials saved" });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error?.message ?? "Unable to save director credentials.",
        variant: "destructive",
      });
    },
  });

  const [isPushEnabled, setIsPushEnabled] = useState(false);
  const [isPushEnabling, setIsPushEnabling] = useState(false);

  useEffect(() => {
    getPushSubscriptionStatus().then((status) => {
      setIsPushEnabled(status);
    });
  }, []);

  const handleTogglePush = async (checked: boolean) => {
    if (isPushEnabling) return;
    setIsPushEnabling(true);

    try {
      if (checked) {
        const success = await subscribeToPushNotifications();
        if (success) {
          setIsPushEnabled(true);
          toast({ 
            title: "Push notifications enabled",
            description: "You will now receive real-time alerts on this device."
          });
        } else {
          toast({
            title: "Setup incomplete",
            description: "Push notifications were blocked or failed to initialize. Please check your browser permissions.",
            variant: "destructive",
          });
        }
      } else {
        const success = await unsubscribeFromPushNotifications();
        if (success) {
          setIsPushEnabled(false);
          toast({ 
            title: "Push notifications disabled",
            description: "You will no longer receive alerts on this device."
          });
        }
      }
    } catch (err: any) {
      console.error("Error toggling push notifications:", err);
      toast({
        title: "Push toggle failed",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsPushEnabling(false);
    }
  };

  const handleChangePassword = () => {
    if (changePasswordMutation.isPending) return;

    if (!currentPassword || !newPassword) {
      toast({
        title: "Missing information",
        description: "Enter both your current and new password.",
        variant: "destructive",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords do not match",
        description: "Confirm password must match the new password.",
        variant: "destructive",
      });
      return;
    }

    changePasswordMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-transparent py-10">
      <div className="max-w-4xl mx-auto px-4 space-y-6">


        <Button
          variant="ghost"
          size="sm"
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground mb-2"
          onClick={() => setLocation("/")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Button>

        <div className="space-y-2">
          <h1 className="text-3xl font-semibold text-gray-900 dark:text-white">Settings</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Manage your account details, preferences, and security options.
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <User2 className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Profile</CardTitle>
              <p className="text-sm text-muted-foreground">Your basic account information.</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row items-center gap-6 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="relative group cursor-pointer w-24 h-24 rounded-full overflow-hidden border-2 border-indigo-100 dark:border-slate-800 shadow-inner flex items-center justify-center bg-indigo-50/50">
                {profilePicture && !imgError ? (
                  <img 
                    src={profilePicture} 
                    alt="Avatar" 
                    onError={() => setImgError(true)} 
                    className="w-full h-full object-cover" 
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-indigo-500 via-indigo-600 to-purple-600 flex items-center justify-center">
                    <User2 className="w-10 h-10 text-white" />
                  </div>
                )}
                <label className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                  <span className="text-[10px] text-white font-bold tracking-wide">CHANGE</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                </label>
              </div>
              <div className="space-y-1 text-center sm:text-left">
                <h3 className="font-bold text-slate-800 dark:text-slate-200">Profile Photo</h3>
                <p className="text-xs text-muted-foreground">JPEG, PNG or WEBP up to 5MB. Hover/tap to change.</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="first-name-input">First Name</Label>
                <Input 
                  id="first-name-input"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First Name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last-name-input">Last Name</Label>
                <Input 
                  id="last-name-input"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last Name"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="email-input">Email Address</Label>
                <Input 
                  id="email-input"
                  value={user?.email ?? ""}
                  readOnly
                  placeholder="Email Address"
                  className="bg-slate-50 dark:bg-slate-900 border-slate-200 text-slate-700 dark:text-slate-200 cursor-default font-normal"
                />
              </div>
              {user?.role === 'tournament_director' && (
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="org-name-input">Organization Name</Label>
                  <Input 
                    id="org-name-input"
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    placeholder="e.g. San Diego Chess Club"
                  />
                  <p className="text-xs text-muted-foreground">If set, this will be displayed as your public profile name.</p>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <Button 
                onClick={handleSaveProfile}
                disabled={updateProfileMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-700 font-semibold rounded-xl px-5 shadow-sm"
              >
                {updateProfileMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </CardContent>
        </Card>

        <UscfVerificationCard />
        <FideVerificationCard />

        {user?.role === 'tournament_director' && (
          <Card>
            <CardHeader className="flex flex-row items-center gap-3">
              <BadgeCheck className="h-5 w-5 text-primary" />
              <div>
                <CardTitle>Director Credentials</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Official USCF/FIDE credentials used for rating report generation.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="uscf-affiliate">USCF Affiliate ID</Label>
                  <Input 
                    id="uscf-affiliate" 
                    defaultValue={user?.uscfAffiliateId || ""}
                    placeholder="e.g. A1234567"
                    onBlur={(e) => tdCredentialsMutation.mutate({
                      uscfAffiliateId: e.target.value,
                      fideArbiterId: user?.fideArbiterId,
                      fideArbiterTitle: user?.fideArbiterTitle
                    })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fide-arbiter">FIDE Arbiter ID</Label>
                  <Input 
                    id="fide-arbiter" 
                    defaultValue={user?.fideArbiterId || ""}
                    placeholder="Optional"
                    onBlur={(e) => tdCredentialsMutation.mutate({
                      uscfAffiliateId: user?.uscfAffiliateId,
                      fideArbiterId: e.target.value,
                      fideArbiterTitle: user?.fideArbiterTitle
                    })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Arbiter Title</Label>
                <Select 
                  defaultValue={user?.fideArbiterTitle || "none"}
                  onValueChange={(val) => tdCredentialsMutation.mutate({
                    uscfAffiliateId: user?.uscfAffiliateId,
                    fideArbiterId: user?.fideArbiterId,
                    fideArbiterTitle: val === "none" ? null : val
                  })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select Title" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="NA">National Arbiter (NA)</SelectItem>
                    <SelectItem value="FA">FIDE Arbiter (FA)</SelectItem>
                    <SelectItem value="IA">International Arbiter (IA)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <SlidersHorizontal className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Notifications</CardTitle>
              <p className="text-sm text-muted-foreground">
                Control how and when you want to be notified.
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">How should we reach you?</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent/5">
                  <div className="flex flex-row items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-full">
                      <Mail className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <Label className="text-sm font-bold">Email Alerts</Label>
                      <p className="text-xs text-muted-foreground">Pairings, official receipts, and results.</p>
                    </div>
                  </div>
                  <Switch checked={notifyEmail} onCheckedChange={(checked) => handleTogglePreference("email", checked)} />
                </div>
                
                <div className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent/5">
                  <div className="flex flex-row items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-full">
                      <Smartphone className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <Label className="text-sm font-bold">Push Notifications</Label>
                      <p className="text-xs text-muted-foreground">Real-time alerts on this device.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isPushEnabling && <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />}
                    <Switch 
                      checked={isPushEnabled} 
                      onCheckedChange={handleTogglePush}
                      disabled={isPushEnabling}
                    />
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">What do you want to hear about?</h3>
              <div className="grid gap-4 md:grid-cols-1">
                <div className="flex items-center justify-between p-2">
                  <div className="flex flex-row items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-lg">
                      <Users className="h-4 w-4 text-blue-500" />
                    </div>
                    <div>
                      <Label className="text-sm font-medium">
                        {user?.role === 'tournament_director' ? "New Player Registrations" : "Registrations & Status"}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {user?.role === 'tournament_director'
                          ? "Get notified when new players register for your tournaments or submit entries."
                          : "Get notified when you register or when a director approves your entry."}
                      </p>
                    </div>
                  </div>
                  <Switch checked={notifyRegistration} onCheckedChange={(checked) => handleTogglePreference("registration", checked)} />
                </div>

                <div className="flex items-center justify-between p-2">
                  <div className="flex flex-row items-center gap-3">
                    <div className="p-2 bg-orange-500/10 rounded-lg">
                      <Trophy className="h-4 w-4 text-orange-500" />
                    </div>
                    <div>
                      <Label className="text-sm font-medium">
                        {user?.role === 'tournament_director' ? "Match & Round Submissions" : "Match Pairings & Round Results"}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {user?.role === 'tournament_director'
                          ? "Get notified when players submit match results or when rounds are completed."
                          : "Get notified immediately when your next match is ready."}
                      </p>
                    </div>
                  </div>
                  <Switch checked={notifyPairings} onCheckedChange={(checked) => handleTogglePreference("pairings", checked)} />
                </div>

                <div className="flex items-center justify-between p-2">
                  <div className="flex flex-row items-center gap-3">
                    <div className="p-2 bg-purple-500/10 rounded-lg">
                      <Bell className="h-4 w-4 text-purple-500" />
                    </div>
                    <div>
                      <Label className="text-sm font-medium">
                        {user?.role === 'tournament_director' ? "Tournament Status Updates" : "Tournament Announcements"}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {user?.role === 'tournament_director'
                          ? "Receive notifications about your tournament status changes and system updates."
                          : "General updates, start times, and important organizer messages."}
                      </p>
                    </div>
                  </div>
                  <Switch checked={notifyTournamentStatus} onCheckedChange={(checked) => handleTogglePreference("tournamentStatus", checked)} />
                </div>
              </div>
            </div>
            <div className="pt-6 flex items-center justify-end h-10 gap-2 text-sm">
              {updatePreferencesMutation.isPending ? (
                <div className="flex items-center gap-2 text-slate-400 font-medium">
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                  <span>Saving preferences...</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-emerald-600 font-medium">
                  <Check className="h-4 w-4" />
                  <span>Preferences saved</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Chat Settings Card */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <MessageSquare className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Chat Flow & Notifications</CardTitle>
              <p className="text-sm text-muted-foreground">
                Customize your messaging interface and chat notification preferences.
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Chat Behavior</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent/5">
                  <div>
                    <Label className="text-sm font-bold">Sound Chimes</Label>
                    <p className="text-xs text-muted-foreground">Play a tone for incoming direct and channel messages.</p>
                  </div>
                  <Switch checked={chatPlayChime} onCheckedChange={handleToggleChatPlayChime} />
                </div>

                <div className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent/5">
                  <div>
                    <Label className="text-sm font-bold">Press Enter to Send</Label>
                    <p className="text-xs text-muted-foreground">Pressing Enter sends the message, Shift+Enter starts a new line.</p>
                  </div>
                  <Switch checked={chatEnterToSend} onCheckedChange={handleToggleChatEnterToSend} />
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Channel Muting</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent/5">
                  <div>
                    <Label className="text-sm font-bold">Mute General Channels</Label>
                    <p className="text-xs text-muted-foreground">Silence unread badges and notifications for general chat rooms.</p>
                  </div>
                  <Switch checked={chatMuteGeneral} onCheckedChange={handleToggleChatMuteGeneral} />
                </div>

                <div className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent/5">
                  <div>
                    <Label className="text-sm font-bold">Mute Announcement Channels</Label>
                    <p className="text-xs text-muted-foreground">Silence unread badges and notifications for announcements.</p>
                  </div>
                  <Switch checked={chatMuteAnnouncements} onCheckedChange={handleToggleChatMuteAnnouncements} />
                </div>
              </div>
            </div>

            <Separator />

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-2">
              <div>
                <Label className="text-sm font-bold">Display Density</Label>
                <p className="text-xs text-muted-foreground">Adjust the text padding and avatar sizing in the message view.</p>
              </div>
              <Select value={chatDensity} onValueChange={handleChatDensityChange}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="Select Density" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cozy">Cozy (Spaced)</SelectItem>
                  <SelectItem value="compact">Compact (Dense)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Director Bank & Merchant Connection (Visible only to TDs) */}
        {user?.role === "tournament_director" && (
          <Card className="border border-indigo-100 shadow-sm overflow-hidden bg-gradient-to-br from-white to-slate-50/50">
            <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-600" />
            <CardHeader className="flex flex-row items-start gap-4">
              <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600">
                <BadgeCheck className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <CardTitle className="text-xl font-bold tracking-tight text-slate-900">
                  Director Merchant & Bank Connection
                </CardTitle>
                <p className="text-sm text-slate-500 max-w-xl leading-relaxed">
                  Connect your Stripe account globally. Future tournaments will automatically route player entry fees directly to this account with zero security risk.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
                <SlidersHorizontal className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-amber-800">🛡️ Zero Security Risk Connect Policy</p>
                  <p className="text-[11px] text-amber-700 leading-relaxed">
                    By using Stripe Connect Destination Charges, our platform securely routes registrations to your bank. You <strong>never</strong> need to provide your developer private keys or secret credentials.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="director-provider" className="text-sm font-semibold text-slate-700">Preferred Merchant Provider</Label>
                  <Select
                    value={directorProvider}
                    onValueChange={(value: "stripe" | "paypal") => setDirectorProvider(value)}
                  >
                    <SelectTrigger id="director-provider" className="w-full md:w-[250px]">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stripe">Stripe Connect (Recommended)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {directorProvider === "stripe" && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="stripe-account-id" className="text-sm font-semibold text-slate-700">Stripe Account ID (starts with acct_)</Label>
                        <Input
                          id="stripe-account-id"
                          value={stripeAccountId}
                          onChange={(e) => setStripeAccountId(e.target.value)}
                          placeholder="acct_1NJ934..."
                          className="font-mono"
                        />
                        <p className="text-[10px] text-slate-500 leading-normal">
                          Find this in your{" "}
                          <a href="https://dashboard.stripe.com" target="_blank" rel="noreferrer" className="text-indigo-600 underline hover:text-indigo-500">
                            Stripe Dashboard
                          </a>{" "}
                          under Settings &gt; Business Settings &gt; Account Details.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="payout-descriptor" className="text-sm font-semibold text-slate-700">Statement Descriptor (Max 22 characters)</Label>
                        <Input
                          id="payout-descriptor"
                          value={payoutStatementDescriptor}
                          onChange={(e) => setPayoutStatementDescriptor(e.target.value)}
                          placeholder="e.g. TOURNAMENT FEES"
                          maxLength={22}
                        />
                        <p className="text-[10px] text-slate-500 leading-normal">
                          This name is displayed on players' bank statements during checkout (e.g. AMERICAN OPEN CHESS).
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end border-t pt-4">
                <Button
                  type="button"
                  disabled={saveDirectorSettingsMutation.isPending || isLoadingDirectorSettings}
                  onClick={handleSaveDirectorSettings}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-sm transition px-5"
                >
                  {saveDirectorSettingsMutation.isPending ? "Connecting Account..." : "Save Merchant Connection"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Player Prize & Refund Destination Card */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <Trophy className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Player Prize & Refund Destination</CardTitle>
              <p className="text-sm text-muted-foreground">
                Manage your payment information to receive cash prizes and entry-fee refunds via Stripe or ACH.
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent/5">
              <div>
                <Label className="text-sm font-bold">Enable Prize Payments</Label>
                <p className="text-xs text-muted-foreground">Allow tournament directors to issue direct payouts and refunds.</p>
              </div>
              <Switch checked={prizePaymentEnabled} onCheckedChange={setPrizePaymentEnabled} />
            </div>

            {prizePaymentEnabled && (
              <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="prize-stripe-email">Stripe Email Address</Label>
                    <Input
                      id="prize-stripe-email"
                      type="email"
                      value={prizeStripeEmail}
                      onChange={(e) => setPrizeStripeEmail(e.target.value)}
                      placeholder="email@example.com"
                    />
                    <p className="text-[10px] text-muted-foreground">Connected to your Stripe account.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="prize-bank-routing">Bank Routing Number</Label>
                    <Input
                      id="prize-bank-routing"
                      value={prizeBankRouting}
                      onChange={(e) => setPrizeBankRouting(e.target.value)}
                      placeholder="9-digit routing number"
                    />
                    <p className="text-[10px] text-muted-foreground">Used for direct ACH payouts.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="prize-bank-account">Bank Account Number</Label>
                  <Input
                    id="prize-bank-account"
                    type="password"
                    value={prizeBankAccount}
                    onChange={(e) => setPrizeBankAccount(e.target.value)}
                    placeholder="Account number"
                  />
                  <p className="text-[10px] text-muted-foreground">Masked for your security.</p>
                </div>
              </div>
            )}

            <div className="flex justify-end border-t pt-4">
              <Button
                type="button"
                disabled={isSavingPrizePayment}
                onClick={handleSavePrizePayment}
                className="bg-primary hover:bg-primary/90 text-white font-semibold"
              >
                {isSavingPrizePayment ? "Saving..." : "Save Payout Details"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <p className="text-sm text-muted-foreground">
              Update your credentials to keep your account secure.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); handleChangePassword(); }} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder="Enter current password"
                  autoComplete="current-password"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder="Enter new password"
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Re-enter new password"
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <Button
                type="submit"
                className="w-full md:w-auto"
                disabled={changePasswordMutation.isPending}
              >
                {changePasswordMutation.isPending ? "Updating..." : "Update password"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-red-200 dark:border-red-900">
          <CardHeader className="flex flex-row items-center gap-3">
            <Trash2 className="h-5 w-5 text-red-600" />
            <div>
              <CardTitle>Danger zone</CardTitle>
              <p className="text-sm text-muted-foreground">
                Log out or delete your account permanently.
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              variant="outline"
              className="flex items-center gap-2"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
            >
              <LogOut className="h-4 w-4" />
              {logoutMutation.isPending ? "Signing out..." : "Log out"}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="flex items-center gap-2">
                  <Trash2 className="h-4 w-4" />
                  Delete account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes all tournaments, players, and sessions associated with your account. This action
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteAccountMutation.mutate()}
                    disabled={deleteAccountMutation.isPending}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    {deleteAccountMutation.isPending ? "Deleting..." : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
