/** "fr-CA" → "fr". Falls back to English. */
export function baseLanguage(locale: string | null | undefined): string {
  const code = (locale ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(code) ? code : "en";
}

/** "de" → "German". Uses the runtime's ICU data. */
export function languageName(code: string): string {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "language" });
    return names.of(code) ?? "English";
  } catch {
    return "English";
  }
}
