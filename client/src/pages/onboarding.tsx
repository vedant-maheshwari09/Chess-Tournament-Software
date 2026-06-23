import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { UscfVerificationCard } from "@/components/uscf-verification-card";
import { FideVerificationCard } from "@/components/fide-verification-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const tdCredentialsSchema = z.object({
  uscfAffiliateId: z.string().trim().optional(),
  fideArbiterId: z.string().trim().optional().refine(val => !val || /^\d+$/.test(val), {
    message: "FIDE Arbiter ID must be numeric only",
  }),
  fideArbiterTitle: z.string().optional(),
});

type TdCredentialsData = z.infer<typeof tdCredentialsSchema>;

export default function OnboardingPage() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Redirect if not logged in or already onboarded
  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
    } else if (!isLoading && user?.hasOnboarded) {
      setLocation("/");
    }
  }, [user, isLoading, setLocation]);

  const tdForm = useForm<TdCredentialsData>({
    resolver: zodResolver(tdCredentialsSchema),
    defaultValues: {
      uscfAffiliateId: user?.uscfAffiliateId || "",
      fideArbiterId: user?.fideArbiterId || "",
      fideArbiterTitle: user?.fideArbiterTitle || "",
    },
  });

  const tdMutation = useMutation({
    mutationFn: async (data: TdCredentialsData) => {
      const res = await apiRequest("/api/auth/profile/td-credentials", {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      return res;
    },
    onSuccess: () => {
      toast({ title: "Credentials saved." });
      completeOnboarding.mutate();
    },
    onError: (error) => {
      toast({ title: "Failed to save credentials", description: error.message, variant: "destructive" });
    }
  });

  const completeOnboarding = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/auth/onboard", { method: "POST" });
      return res;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/auth/me"], data.user);
      setLocation("/");
      toast({ title: "Welcome!", description: "Your account is fully set up." });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  if (isLoading || !user || user.hasOnboarded) {
    return null;
  }

  const isPlayer = user.role === "player";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white">
            Welcome to ChessSoftware
          </h1>
          <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">
            Let's get your account set up so you can start {isPlayer ? "playing" : "organizing tournaments"}.
          </p>
        </div>

        {isPlayer ? (
          <div className="space-y-6">
            <UscfVerificationCard />
            <FideVerificationCard />
            
            <div className="flex justify-end gap-3 pt-4">
              <Button 
                type="button" 
                variant="outline"
                size="lg"
                onClick={() => completeOnboarding.mutate()}
                disabled={completeOnboarding.isPending}
              >
                Skip
              </Button>
              <Button 
                size="lg" 
                onClick={() => completeOnboarding.mutate()}
                disabled={completeOnboarding.isPending}
              >
                {completeOnboarding.isPending ? "Continuing..." : "Continue"}
              </Button>
            </div>
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Director Credentials</CardTitle>
              <CardDescription>
                Configure your official credentials so your tournaments can be properly submitted for USCF and FIDE rating. You can also skip this and add them later in Settings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...tdForm}>
                <form onSubmit={tdForm.handleSubmit((data) => tdMutation.mutate(data))} className="space-y-6">
                  <FormField
                    control={tdForm.control}
                    name="uscfAffiliateId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>USCF Affiliate ID</FormLabel>
                        <FormControl>
                          <Input placeholder="A1234567" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={tdForm.control}
                      name="fideArbiterId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>FIDE Arbiter ID</FormLabel>
                          <FormControl>
                            <Input placeholder="Optional" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={tdForm.control}
                      name="fideArbiterTitle"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Arbiter Title</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select Title" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              <SelectItem value="NA">National Arbiter (NA)</SelectItem>
                              <SelectItem value="FA">FIDE Arbiter (FA)</SelectItem>
                              <SelectItem value="IA">International Arbiter (IA)</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={() => completeOnboarding.mutate()}
                      disabled={tdMutation.isPending || completeOnboarding.isPending}
                    >
                      Skip
                    </Button>
                    <Button 
                      type="submit"
                      disabled={tdMutation.isPending || completeOnboarding.isPending}
                    >
                      {tdMutation.isPending ? "Saving..." : "Save & Continue"}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
