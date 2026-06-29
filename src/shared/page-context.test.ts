import { describe, it, expect } from "vitest";
import { assessPageContext, buildPromptPageContext } from "./page-context";

const loc = (pathname: string, search = "", hostname = "example.com") => ({ hostname, pathname, search });

describe("assessPageContext — formKind from URL", () => {
  const cases: [string, string, string | null][] = [
    ["/login", "", "auth"],
    ["/account/sign-in", "", "auth"],
    ["/users/signup", "", "register"],
    ["/register", "", "register"],
    ["/careers/apply", "", "application"],
    ["/jobs/12345", "", "application"],
    ["/checkout/billing", "", "checkout"],
    ["/account/profile", "", "profile"],
    ["/", "", null],
    ["/cat/sofa-beds-10663", "", null],
    ["/weblogin-helper", "", null], // 'login' not on a word boundary
  ];
  for (const [path, search, expected] of cases) {
    it(`classifies ${path} as ${expected}`, () => {
      expect(assessPageContext(loc(path, search), []).formKind).toBe(expected);
    });
  }

  it("applies precedence register > application", () => {
    expect(assessPageContext(loc("/careers/signup"), []).formKind).toBe("register");
  });

  it("reads keywords from the query string too", () => {
    expect(assessPageContext(loc("/", "?flow=signup"), []).formKind).toBe("register");
  });
});

describe("assessPageContext — form signals", () => {
  it("detects a password field", () => {
    const ctx = assessPageContext(loc("/"), [{ type: "email" }, { type: "password" }]);
    expect(ctx.hasPassword).toBe(true);
    expect(ctx.hasFormContext).toBe(true);
  });

  it("hasFormContext is false on a plain page with no password and no URL match", () => {
    const ctx = assessPageContext(loc("/articles/123"), [{ type: "text" }]);
    expect(ctx.hasPassword).toBe(false);
    expect(ctx.formKind).toBeNull();
    expect(ctx.hasFormContext).toBe(false);
  });

  it("hasFormContext is true when only the URL matches", () => {
    expect(assessPageContext(loc("/login"), [{ type: "email" }]).hasFormContext).toBe(true);
  });
});

describe("buildPromptPageContext", () => {
  it("joins host + pathname and drops the query string", () => {
    const ctx = assessPageContext(loc("/signin"), [{ type: "password" }]);
    const p = buildPromptPageContext({ hostname: "acme.com", pathname: "/signin" }, "Sign in — Acme", ctx);
    expect(p).toEqual({ url: "acme.com/signin", title: "Sign in — Acme", formKind: "auth" });
  });
});
