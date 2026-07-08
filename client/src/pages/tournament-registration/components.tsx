import React from "react";
import { useFormContext } from "react-hook-form";
import { AlertCircle } from "lucide-react";
import { RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { RegistrationFormValues } from "./types";

export function RadioOption({
  value,
  title,
  description,
  group,
}: {
  value: string;
  title: string;
  description: string;
  group: keyof RegistrationFormValues;
}) {
  const form = useFormContext<RegistrationFormValues>();
  const current = form.watch(group) as string | undefined;
  return (
    <label
      className={cn(
        "flex flex-1 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4 transition hover:border-blue-300",
        current === value && "border-blue-500 bg-blue-50/40",
      )}
    >
      <RadioGroupItem
        value={value}
        className={cn(
          "mt-0.5 shrink-0",
          current === value && "border-blue-600 bg-blue-600"
        )}
      />
      <div>
        <p className="text-sm font-medium text-slate-900">{title}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
    </label>
  );
}


export function Field({
  label,
  name,
  required,
  placeholder,
  valueAs,
  type = "text",
  description,
  disabled,
}: {
  label: string;
  name: any;
  required?: boolean;
  placeholder?: string;
  valueAs?: "email";
  type?: "text" | "number";
  description?: string;
  disabled?: boolean;
}) {
  const form = useFormContext<RegistrationFormValues>();
  
  const getNestedError = () => {
    const error = (form.formState.errors as Record<string, any>)[name];
    if (error) return error;
    if (typeof name === "string" && name.includes(".")) {
      const parts = name.split(".");
      let currentError: any = form.formState.errors;
      for (const part of parts) {
        if (!currentError) return undefined;
        currentError = currentError[part];
      }
      return currentError;
    }
    return undefined;
  };
  
  const error = getNestedError();

  const isSystemField = typeof name === "string" && [
    "firstName", "lastName", "email", "uscfId", "fideId", "uscfRating", "fideRating",
    "address1", "address2", "city", "state", "postalCode", "country",
    "sectionChoice", "ratingProvider", "pairingNotifications", "notes"
  ].includes(name);

  const showDescription = description && !isSystemField;

  return (
    <div className="group space-y-2">
      <Label className="text-sm font-medium text-slate-700 transition-colors group-focus-within:text-blue-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </Label>
      <Input
        placeholder={placeholder}
        type={valueAs === "email" ? "email" : type}
        autoComplete="new-password"
        {...form.register(name, { valueAsNumber: type === "number", disabled: Boolean(disabled) })}
        className={cn("focus:border-blue-400 focus:ring-blue-200 bg-white", disabled && "bg-slate-50/80 text-slate-900 font-semibold disabled:opacity-100 cursor-not-allowed border-slate-200")}
        disabled={disabled}
      />
      {showDescription && (
        <p className="text-[11px] text-slate-400 leading-normal mt-0.5">{description}</p>
      )}
      {error && <p className="text-xs text-red-500">{error.message as string}</p>}
    </div>
  );
}

