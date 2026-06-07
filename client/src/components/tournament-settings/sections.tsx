import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type WebhookSyncConfig,
  type FideRegistrationData,
  type UscfReportData,
} from "@/lib/tournament-config";
import { cn } from "@/lib/utils";
import { Download, ExternalLink, Settings } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { parseISO, format as formatDate } from "date-fns";
export { ArenaSettingsCard } from "./ArenaSettingsCard";


interface FideRegistrationSectionProps {
  value: FideRegistrationData;
  onChange: (update: Partial<FideRegistrationData>) => void;
  tournamentName?: string;
  tournamentCity?: string;
  federationName?: string;
}

const fideToggleFields: Array<{ key: keyof FideRegistrationData; label: string }> = [
  { key: "nationalChampionship", label: "National Championship 1.43a" },
  { key: "titleNormsAvailable", label: "Title norms available" },
  { key: "femaleOnly", label: "Female players only" },
  { key: "allDigitalClocks", label: "All digital clocks" },
  { key: "officialCalendar", label: "Official FIDE calendar" },
  { key: "gmNormsAvailable", label: "GM/WGM norms available" },
  { key: "willProvidePgn", label: "Will PGN be provided" },
  { key: "internetTransmission", label: "Internet transmission" },
];

const fideAgeLimitOptions = [
  "None",
  "Under 8",
  "Under 10",
  "Under 12",
  "Under 14",
  "Under 16",
  "Under 18",
  "Under 20",
  "Senior 50+",
  "Senior 65+",
];

const US_STATES: Array<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

export function FideRegistrationSection({
  value,
  onChange,
  tournamentName,
  tournamentCity,
  federationName,
}: FideRegistrationSectionProps) {
  const [activeTab, setActiveTab] = useState<"registration" | "norm">("registration");
  const toggleColumns = useMemo(() => {
    const midpoint = Math.ceil(fideToggleFields.length / 2);
    return [fideToggleFields.slice(0, midpoint), fideToggleFields.slice(midpoint)];
  }, []);

  return (
    <Tabs value={activeTab} onValueChange={(next) => setActiveTab(next as "registration" | "norm")} className="space-y-6">
      <TabsList className="grid w-full grid-cols-2 h-12 items-stretch bg-slate-100 p-1 rounded-xl border border-slate-200">
        <TabsTrigger
          value="registration"
          className="rounded-lg px-4 py-3 text-sm font-semibold text-slate-600 transition data-[state=active]:bg-white data-[state=active]:text-black data-[state=active]:shadow-sm"
        >
          FIDE Registration Form
        </TabsTrigger>
        <TabsTrigger
          value="norm"
          className="rounded-lg px-4 py-3 text-sm font-semibold text-slate-600 transition data-[state=active]:bg-white data-[state=active]:text-black data-[state=active]:shadow-sm"
        >
          FIDE / IA Norm Report Form
        </TabsTrigger>
      </TabsList>

      <TabsContent value="registration" className="focus-visible:outline-none">
        <Card className="shadow-sm">
          <CardHeader className="border-b pb-6">
            <CardTitle className="text-2xl font-semibold text-indigo-900">FIDE Registration Form</CardTitle>
            <CardDescription>Provide the details required by the Events Commission to list your tournament.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Details</h3>
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-slate-700">Organizer</Label>
                  <Input 
                    value={value.organizer ?? ""} 
                    onChange={(event) => onChange({ organizer: event.target.value })}
                    placeholder="Tournament organizer name"
                    className="border-slate-200 focus:border-indigo-500 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700">Prize fund</Label>
                  <Input 
                    value={value.prizeFund ?? ""} 
                    onChange={(event) => onChange({ prizeFund: event.target.value })}
                    placeholder="e.g. $5,000 guaranteed"
                    className="border-slate-200 focus:border-indigo-500 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700">Time control description</Label>
                <Input
                  placeholder="e.g. 90 minutes + 30 seconds increment"
                  value={value.timeControl ?? ""}
                  onChange={(event) => onChange({ timeControl: event.target.value })}
                  className="border-slate-200 focus:border-indigo-500 focus:ring-indigo-500"
                />
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                {toggleColumns.map((group, index) => (
                  <div key={index} className="space-y-3">
                    {group.map(({ key, label }) => (
                      <label key={key as string} className="flex items-start gap-3 text-sm leading-tight">
                        <Checkbox
                          checked={Boolean(value[key])}
                          onCheckedChange={(checked) =>
                            onChange({ [key]: checked === true } as Partial<FideRegistrationData>)
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Players</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Expected number of players</Label>
                  <Input value={value.expectedPlayers ?? ""} onChange={(event) => onChange({ expectedPlayers: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Maximum rating</Label>
                  <Input value={value.maxRating ?? ""} onChange={(event) => onChange({ maxRating: event.target.value })} />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Age limit</Label>
                  <Select value={value.ageLimit ?? "None"} onValueChange={(next) => onChange({ ageLimit: next })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select age limit" />
                    </SelectTrigger>
                    <SelectContent>
                      {fideAgeLimitOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Additional notes</Label>
                  <Textarea
                    rows={3}
                    placeholder="Include national or FIDE event identifiers, or special remarks."
                    value={value.remarks ?? ""}
                    onChange={(event) => onChange({ remarks: event.target.value })}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-6">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Arbiters</h3>
              
              <div className="grid gap-6 md:grid-cols-3">
                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">Chief Arbiter Name</Label>
                  <Input 
                    value={value.chiefArbiter ?? ""} 
                    onChange={(event) => onChange({ chiefArbiter: event.target.value })}
                    placeholder="e.g. John Doe"
                    className="border-slate-200 focus:border-indigo-500 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">Chief Arbiter FIDE ID</Label>
                  <Input 
                    value={(value as any).chiefArbiterId ?? ""} 
                    onChange={(event) => onChange({ chiefArbiterId: event.target.value } as any)}
                    placeholder="e.g. 1234567"
                    className="border-slate-200 focus:border-indigo-500 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">Chief Arbiter Title</Label>
                  <Select 
                    value={(value as any).chiefArbiterTitle || "None"} 
                    onValueChange={(val) => onChange({ chiefArbiterTitle: val === "None" ? "" : val } as any)}
                  >
                    <SelectTrigger className="border-slate-200 focus:border-indigo-500 focus:ring-indigo-500">
                      <SelectValue placeholder="Select Title" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="None">No Title</SelectItem>
                      <SelectItem value="IA">IA (International Arbiter)</SelectItem>
                      <SelectItem value="FA">FA (FIDE Arbiter)</SelectItem>
                      <SelectItem value="NA">NA (National Arbiter)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Other Assistant Arbiters</Label>
                <Input
                  placeholder="e.g. Bob Johnson, Alice Williams"
                  value={value.assistants ?? ""}
                  onChange={(event) => onChange({ assistants: event.target.value })}
                  className="border-slate-200 focus:border-indigo-500 focus:ring-indigo-500"
                />
                <p className="text-[11px] text-slate-400">List additional assistant arbiters separated by commas. Each will be listed as a Deputy Arbiter (code 112) in the TRF file.</p>
              </div>

              <div className="border border-slate-100 rounded-lg p-4 bg-slate-50/50 space-y-4">
                <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider">Primary Deputy Chief Arbiter Details (for norm forms)</h4>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label className="text-slate-700">Surname, name (Deputy)</Label>
                    <Input 
                      value={value.arbiterSurname ?? ""} 
                      onChange={(event) => onChange({ arbiterSurname: event.target.value })} 
                      placeholder="e.g. Smith, Jane"
                      className="bg-white border-slate-200"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-700">Role</Label>
                    <Input 
                      value={value.arbiterRole ?? ""} 
                      onChange={(event) => onChange({ arbiterRole: event.target.value })} 
                      placeholder="e.g. Deputy Chief Arbiter"
                      className="bg-white border-slate-200"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-700">Federation</Label>
                    <Input 
                      value={value.arbiterFederation ?? ""} 
                      onChange={(event) => onChange({ arbiterFederation: event.target.value })} 
                      placeholder="e.g. USA"
                      className="bg-white border-slate-200"
                    />
                  </div>
                </div>
              </div>
            </section>


          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="norm" className="focus-visible:outline-none">
        <Card className="shadow-sm">
          <CardHeader className="border-b pb-6">
            <CardTitle className="text-2xl font-semibold text-indigo-900">FIDE / International Arbiter Norm Report Form</CardTitle>
            <CardDescription>Record the details needed when uploading FA1 or IA1 forms.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Tournament</h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label className="text-slate-700">Tournament Name</Label>
                  <Input value={tournamentName ?? ""} readOnly className="bg-slate-50 border-slate-200" />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700">Venue / City</Label>
                  <Input
                    value={value.tournamentVenue ?? tournamentCity ?? ""}
                    onChange={(event) => onChange({ tournamentVenue: event.target.value })}
                    placeholder="City and venue name"
                    className="border-slate-200 focus:border-indigo-500 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700">Organizer</Label>
                  <Input 
                    value={value.organizer ?? ""} 
                    onChange={(event) => onChange({ organizer: event.target.value })}
                    placeholder="Organizer name"
                    className="border-slate-200 focus:border-indigo-500 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-slate-700">Chief Arbiter Name</Label>
                  <Input 
                    value={value.chiefArbiter ?? ""} 
                    onChange={(event) => onChange({ chiefArbiter: event.target.value })}
                    placeholder="e.g. John Doe"
                    className="border-slate-200 focus:border-indigo-500 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700">Other Assistant Arbiters</Label>
                  <Input
                    placeholder="e.g. Bob Johnson, Alice Williams"
                    value={value.assistants ?? ""}
                    onChange={(event) => onChange({ assistants: event.target.value })}
                    className="border-slate-200 focus:border-indigo-500 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-slate-700">Time control description</Label>
                  <Input
                    placeholder="e.g. 90 minutes + 30 seconds increment"
                    value={value.timeControl ?? ""}
                    onChange={(event) => onChange({ timeControl: event.target.value })}
                    className="border-slate-200 focus:border-indigo-500 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700">FIDE Event Code(s)</Label>
                  <Input 
                    value={value.eventCodes ?? ""} 
                    onChange={(event) => onChange({ eventCodes: event.target.value })}
                    placeholder="e.g. 12345, 67890"
                    className="border-slate-200 focus:border-indigo-500 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Norm for</h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label>Last name</Label>
                  <Input value={value.normLastName ?? ""} onChange={(event) => onChange({ normLastName: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>First name</Label>
                  <Input value={value.normFirstName ?? ""} onChange={(event) => onChange({ normFirstName: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>FIDE ID</Label>
                  <Input value={value.normFideId ?? ""} onChange={(event) => onChange({ normFideId: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Federation</Label>
                  <Input
                    value={value.normFederation ?? federationName ?? ""}
                    onChange={(event) => onChange({ normFederation: event.target.value })}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Signed by</h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label>Surname, name</Label>
                  <Input value={value.signedName ?? ""} onChange={(event) => onChange({ signedName: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Input value={value.signedRole ?? ""} onChange={(event) => onChange({ signedRole: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Federation</Label>
                  <Input
                    value={value.signedFederation ?? federationName ?? ""}
                    onChange={(event) => onChange({ signedFederation: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <div className="w-full">
                    <DatePicker 
                      date={value.signedDate ? parseISO(value.signedDate) : null}
                      setDate={(newDate) => onChange({ signedDate: newDate ? formatDate(newDate, "yyyy-MM-dd") : "" })}
                      className="h-10 border-slate-200"
                    />
                  </div>
                </div>
              </div>
            </section>


          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

interface UscfReportSectionProps {
  value: UscfReportData;
  onChange: (update: Partial<UscfReportData>) => void;
}

export function UscfReportSection({ value, onChange }: UscfReportSectionProps) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-2xl font-bold text-indigo-900">USCF Rating Report</CardTitle>
            <CardDescription className="text-slate-500 mt-1">
              Configure the tournament details for submission to the United States Chess Federation.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-8">
        <div className="rounded-xl bg-slate-50 p-6 border border-slate-200 space-y-4">
          <div className="flex items-center gap-2 text-indigo-900">
            <Settings className="h-5 w-5" />
            <h3 className="font-bold uppercase tracking-tight text-sm">Official USCF Post-Tournament Summary</h3>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            Please verify the following information. This data will be used to generate the official USCF tournament summary and rating report.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="uscf-state">State</Label>
          <Select
            value={value.state ?? "unset"}
            onValueChange={(next) => onChange({ state: next === "unset" ? undefined : next })}
          >
            <SelectTrigger id="uscf-state">
              <SelectValue placeholder="Select state" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">Select state</SelectItem>
              {US_STATES.map((state) => (
                <SelectItem key={state.code} value={state.code}>
                  {state.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>


        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="uscf-affiliate">Affiliate ID</Label>
            <Input
              id="uscf-affiliate"
              value={value.affiliateId ?? ""}
              onChange={(event) => onChange({ affiliateId: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="uscf-organizer">Organizer</Label>
            <Input
              id="uscf-organizer"
              value={value.organizer ?? ""}
              onChange={(event) => onChange({ organizer: event.target.value })}
            />
          </div>
        </div>

        <div className="border border-slate-100 rounded-lg p-4 bg-slate-50/50 space-y-4">
          <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider">Tournament Directors</h4>
          
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="uscf-director" className="text-slate-700 font-medium">Chief TD Name</Label>
              <Input
                id="uscf-director"
                value={value.tournamentDirector ?? value.chiefArbiter ?? ""}
                onChange={(event) => onChange({ tournamentDirector: event.target.value })}
                placeholder="e.g. John Doe"
                className="bg-white border-slate-200"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="uscf-director-id" className="text-slate-700 font-medium">
                Chief TD USCF ID (8 digits) <span className="text-red-500 font-bold">*</span>
              </Label>
              <Input
                id="uscf-director-id"
                value={(value as any).chiefTdId ?? ""}
                onChange={(event) => onChange({ chiefTdId: event.target.value } as any)}
                placeholder="e.g. 12345678"
                className="bg-white border-slate-200"
              />
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="uscf-assistant" className="text-slate-700 font-medium">Assistant TD Name</Label>
              <Input
                id="uscf-assistant"
                value={value.assistantDirector ?? value.assistants ?? ""}
                onChange={(event) => onChange({ assistantDirector: event.target.value })}
                placeholder="e.g. Jane Smith"
                className="bg-white border-slate-200"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="uscf-assistant-id" className="text-slate-700 font-medium">Assistant TD USCF ID (8 digits)</Label>
              <Input
                id="uscf-assistant-id"
                value={(value as any).assistantTdId ?? ""}
                onChange={(event) => onChange({ assistantTdId: event.target.value } as any)}
                placeholder="e.g. 87654321"
                className="bg-white border-slate-200"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="uscf-other-tds" className="text-slate-700 font-medium">Other Assistants / Arbiters</Label>
            <Input
              id="uscf-other-tds"
              placeholder="e.g. Bob Johnson, Alice Williams"
              value={value.assistants ?? ""}
              onChange={(event) => onChange({ assistants: event.target.value })}
              className="bg-white border-slate-200"
            />
            <p className="text-[11px] text-slate-400">List other directing staff separated by commas.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="uscf-timecontrol">Time control description</Label>
          <Input
            id="uscf-timecontrol"
            placeholder="e.g. G/90;inc30"
            value={value.timeControl ?? ""}
            onChange={(event) => onChange({ timeControl: event.target.value })}
          />
        </div>

        <div className="space-y-4">
          <Label className="text-slate-900 font-semibold">Send cross table to</Label>
          <RadioGroup
            value={value.sendCrossTableTo ?? "none"}
            onValueChange={(next) => onChange({ sendCrossTableTo: next as UscfReportData["sendCrossTableTo"] })}
            className="flex flex-col sm:flex-row gap-4 sm:gap-8"
          >
            {[
              { value: "affiliate", label: "Affiliate" },
              { value: "tournament_director", label: "Tournament Director" },
              { value: "none", label: "None" },
            ].map((option) => (
              <label 
                key={option.value} 
                className="flex items-center gap-3 text-sm text-slate-700 cursor-pointer group"
              >
                <RadioGroupItem value={option.value} id={`uscf-send-${option.value}`} />
                <span className="group-hover:text-indigo-600 transition-colors">{option.label}</span>
              </label>
            ))}
          </RadioGroup>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <Checkbox
            id="uscf-scholastic"
            checked={Boolean(value.scholastic)}
            onCheckedChange={(checked) => onChange({ scholastic: checked === true })}
          />
          <div className="space-y-1">
            <Label htmlFor="uscf-scholastic" className="text-sm font-medium text-slate-700">
              Scholastic event
            </Label>
            <p className="text-xs text-muted-foreground">Identify scholastic tournaments for USCF reporting.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="uscf-grand-prix">Grand Prix points (if any)</Label>
          <Input
            id="uscf-grand-prix"
            value={value.grandPrixPoints ?? ""}
            onChange={(event) => onChange({ grandPrixPoints: event.target.value })}
          />
        </div>


      </CardContent>
    </Card>
  );
}

interface WebhookSyncSettingsCardProps {
  value: WebhookSyncConfig;
  onChange: (update: Partial<WebhookSyncConfig>) => void;
  onTest: () => void;
  onSync: () => void;
  testing: boolean;
  syncing: boolean;
  disabled?: boolean;
  onDownload?: () => void;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

export function WebhookSyncSettingsCard({
  value,
  onChange,
  onTest,
  onSync,
  testing,
  syncing,
  disabled,
  onDownload,
  enabled,
  onEnabledChange,
}: WebhookSyncSettingsCardProps) {
  const syncDisabled = value.syncMode === "disabled" || disabled;

  return (
    <Card className="shadow-sm">
          <CardHeader className="border-b pb-6 flex flex-row items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Custom API Webhook Sync</Label>
              <p className="text-xs text-muted-foreground mt-1 text-slate-500">
                Send your tournament data to a custom JSON API endpoint. <br/>
                <strong className="text-amber-600">Note: Chess-Results.com does not support JSON APIs.</strong> To publish to Chess-Results, please use the <strong className="text-slate-700">FIDE TRF16 Export</strong> button on the General tab.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={onEnabledChange} />
          </CardHeader>
      {enabled && (
        <CardContent className="space-y-8 pt-6">
          <div className="grid gap-8 md:grid-cols-2">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Synchronization</h3>
              <RadioGroup
                value={value.syncMode}
                onValueChange={(next) => onChange({ syncMode: next as WebhookSyncConfig["syncMode"] })}
                className="space-y-3"
              >
                {[
                  { key: "disabled", label: "Disabled", hint: "Do not export or sync." },
                  { key: "manual", label: "Manual", hint: "Run exports on demand." },
                  { key: "automatic", label: "Automatic", hint: "Sync on a repeating schedule." },
                ].map((option) => (
                  <label
                    key={option.key}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm",
                      value.syncMode === option.key && "border-indigo-500"
                    )}
                  >
                    <RadioGroupItem value={option.key} className="mt-1" />
                    <div className="space-y-1">
                      <span className="text-sm font-medium text-slate-700">{option.label}</span>
                      <p className="text-xs text-muted-foreground">{option.hint}</p>
                    </div>
                    {value.syncMode === option.key && <Badge variant="secondary" className="ml-auto">Active</Badge>}
                  </label>
                ))}
              </RadioGroup>
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Export scope</h3>
              <RadioGroup
                value={value.exportMode}
                onValueChange={(next) => onChange({ exportMode: next as WebhookSyncConfig["exportMode"] })}
                className="space-y-3"
              >
                {[
                  { key: "page", label: "Tournament Page" },
                  { key: "participants", label: "Tournament Page + Participants" },
                  { key: "participants_standings", label: "Tournament Page + Participants + Standings" },
                  {
                    key: "participants_standings_rounds",
                    label: "Tournament Page + Participants + Standings + Rounds",
                  },
                ].map((option) => (
                  <label
                    key={option.key}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm",
                      value.exportMode === option.key && "border-indigo-500"
                    )}
                  >
                    <RadioGroupItem value={option.key} className="mt-1" />
                    <span className="text-sm font-medium text-slate-700">{option.label}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="webhook-endpoint">Webhook API Endpoint</Label>
              <Input
                id="webhook-endpoint"
                value={value.endpoint ?? ""}
                placeholder="https://example.com/api/webhook"
                onChange={(event) => onChange({ endpoint: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhook-tournament-id">Tournament Identifier</Label>
              <Input
                id="webhook-tournament-id"
                value={value.tournamentId ?? ""}
                placeholder="e.g. 842391"
                onChange={(event) => onChange({ tournamentId: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhook-username">Auth Username / ID</Label>
              <Input
                id="webhook-username"
                value={value.personalNumber ?? ""}
                placeholder="Assigned API user ID"
                onChange={(event) => onChange({ personalNumber: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhook-password">Auth Password / Token</Label>
              <Input
                id="webhook-password"
                type="password"
                value={value.password ?? ""}
                placeholder="••••••••"
                onChange={(event) => onChange({ password: event.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="webhook-organizer">Organizer name</Label>
              <Input
                id="webhook-organizer"
                value={value.organizerName ?? ""}
                onChange={(event) => onChange({ organizerName: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhook-email">Organizer email</Label>
              <Input
                id="webhook-email"
                type="email"
                value={value.organizerEmail ?? ""}
                onChange={(event) => onChange({ organizerEmail: event.target.value })}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="webhook-event-code">Event code or remarks</Label>
              <Input
                id="webhook-event-code"
                value={value.eventCode ?? ""}
                onChange={(event) => onChange({ eventCode: event.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="chess-results-interval">Auto-sync interval (minutes)</Label>
              <Input
                id="chess-results-interval"
                type="number"
                min={5}
                step={5}
                value={value.autoSyncIntervalMinutes ? String(value.autoSyncIntervalMinutes) : ""}
                onChange={(event) => {
                  const trimmed = event.target.value.trim();
                  if (!trimmed) {
                    onChange({ autoSyncIntervalMinutes: undefined });
                    return;
                  }
                  const parsed = Number(trimmed);
                  onChange({
                    autoSyncIntervalMinutes: Number.isFinite(parsed) ? parsed : value.autoSyncIntervalMinutes,
                  });
                }}
              />
            </div>
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
              Automatic mode will upload participants, pairings, and standings on the interval provided. Manual mode only
              syncs when you trigger it.
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <div>
              <p className="font-medium text-slate-700">Last synchronization</p>
              <p className="text-xs text-muted-foreground">
                {value.lastSyncAt ? new Date(value.lastSyncAt).toLocaleString() : "No syncs recorded yet."}
              </p>
              {value.lastSyncMessage && (
                <p className="text-xs text-muted-foreground">{value.lastSyncMessage}</p>
              )}
            </div>
            <Badge
              className={cn(
                value.lastSyncStatus === "success" && "bg-green-600 text-white",
                value.lastSyncStatus === "error" && "bg-red-600 text-white",
                value.lastSyncStatus === "pending" && "bg-yellow-500 text-white",
                !value.lastSyncStatus && "bg-slate-200 text-slate-600"
              )}
            >
              {value.lastSyncStatus ? value.lastSyncStatus.toUpperCase() : "NEVER"}
            </Badge>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onTest} disabled={testing || syncDisabled}>
              {testing ? "Testing..." : "Test connection"}
            </Button>
            <Button type="button" onClick={onSync} disabled={syncDisabled || syncing}>
              {syncing ? "Syncing..." : "Sync now"}
            </Button>
            <Button type="button" variant="outline" onClick={onDownload}>
              <Download className="mr-2 h-4 w-4" /> Download configuration
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
