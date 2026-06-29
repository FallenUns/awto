export type FormKind = "auth" | "register" | "application" | "checkout" | "profile";

export interface PageContext {
  formKind: FormKind | null;
  hasPassword: boolean;
  hasFormContext: boolean;
}

export interface PromptPageContext {
  url: string;
  title: string;
  formKind: FormKind | null;
}

const KEYWORDS: Record<FormKind, string[]> = {
  register: ["signup", "sign-up", "register", "registration", "join", "create-account", "createaccount", "new-account", "get-started"],
  application: ["apply", "application", "careers", "career", "jobs", "job", "onboarding", "recruit", "hr"],
  checkout: ["checkout", "billing", "payment", "order", "purchase"],
  profile: ["account", "profile", "settings", "my-details", "my-account"],
  auth: ["login", "log-in", "signin", "sign-in", "logon", "auth", "authenticate"],
};

const PRECEDENCE: FormKind[] = ["register", "application", "checkout", "auth", "profile"];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compile(keywords: string[]): RegExp {
  return new RegExp(`(?<![a-z0-9])(?:${keywords.map(escapeRegExp).join("|")})(?![a-z0-9])`, "i");
}

const RES: Record<FormKind, RegExp> = {
  register: compile(KEYWORDS.register),
  application: compile(KEYWORDS.application),
  checkout: compile(KEYWORDS.checkout),
  profile: compile(KEYWORDS.profile),
  auth: compile(KEYWORDS.auth),
};

function classifyUrl(location: { hostname: string; pathname: string; search: string }): FormKind | null {
  const haystack = `${location.hostname}${location.pathname}${location.search}`.toLowerCase();
  for (const kind of PRECEDENCE) {
    if (RES[kind].test(haystack)) return kind;
  }
  return null;
}

export function assessPageContext(
  location: { hostname: string; pathname: string; search: string },
  fields: { type: string }[]
): PageContext {
  const formKind = classifyUrl(location);
  const hasPassword = fields.some((f) => f.type === "password");
  return { formKind, hasPassword, hasFormContext: formKind !== null || hasPassword };
}

export function buildPromptPageContext(
  location: { hostname: string; pathname: string },
  title: string,
  ctx: PageContext
): PromptPageContext {
  return { url: `${location.hostname}${location.pathname}`, title, formKind: ctx.formKind };
}
