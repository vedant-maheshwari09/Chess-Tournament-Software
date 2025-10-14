export function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function tokenizeName(value: string | null | undefined): string[] {
  if (!value) return [];
  const canonical = stripDiacritics(value.toUpperCase()).replace(/[^A-Z0-9]+/g, " ");
  return canonical
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function makeNameKey(tokens: string[], federationCode: string | null | undefined): string {
  const fed = federationCode ? federationCode.trim().toUpperCase() : "";
  return `${tokens.join(" ")}|${fed}`;
}

const FEDERATION_CODE_MAP: Record<string, string> = {
  "united states": "USA",
  usa: "USA",
  "u.s.a.": "USA",
  america: "USA",
  "united kingdom": "ENG",
  england: "ENG",
  britain: "ENG",
  canada: "CAN",
  india: "IND",
  china: "CHN",
  australia: "AUS",
  france: "FRA",
  germany: "GER",
  spain: "ESP",
  mexico: "MEX",
  brazil: "BRA",
};

export function resolveFederationCode(value?: string | null): string {
  if (!value) return "";
  const normalized = value.trim();
  if (!normalized) return "";
  if (/^[A-Za-z]{2,3}$/.test(normalized)) {
    return normalized.toUpperCase();
  }

  const key = stripDiacritics(normalized.toLowerCase());
  const mapped = FEDERATION_CODE_MAP[key];
  if (mapped) return mapped;
  const letters = key.replace(/[^a-z]/g, "");
  if (!letters) return "";
  return letters.slice(0, 3).toUpperCase();
}
