import { Github, BookOpen, FileText, ArrowUpRight, Shield } from "lucide-react";
import { AwtoLogo } from "../shared/AwtoLogo";

function readVersion(): string {
  try {
    const manifest =
      typeof chrome !== "undefined" && chrome.runtime?.getManifest
        ? chrome.runtime.getManifest()
        : null;
    if (manifest?.version) return manifest.version;
  } catch {
    // ignore; fall through to default
  }
  return "0.1.0";
}

const STEPS = [
  {
    n: "01",
    title: "Heuristic match",
    body: "Field labels, names, and autocomplete hints are matched against your profile instantly.",
    accent: "plain" as const,
  },
  {
    n: "02",
    title: "Local model",
    body: "Ambiguous fields go to your on-device Ollama model, which reads what each input means.",
    accent: "local" as const,
  },
  {
    n: "03",
    title: "Cloud fallback",
    body: "Optional. Only low-confidence fields are sent to your cloud provider, using your own API key.",
    accent: "cloud" as const,
  },
];

const LINKS = [
  {
    icon: Github,
    label: "GitHub repository",
    href: "https://github.com/FallenUns/awto",
  },
  {
    icon: BookOpen,
    label: "Documentation",
    href: "https://github.com/FallenUns/awto#readme",
  },
  {
    icon: FileText,
    label: "License (MIT)",
    href: "https://github.com/FallenUns/awto/blob/main/LICENSE",
  },
];

export function AboutTab() {
  const version = readVersion();

  return (
    <div className="awto-view">
      <div className="awto-view__head">
        <h1 className="awto-view__title">About</h1>
        <p className="awto-view__sub">
          Smart personal-detail autofill that understands what each field
          actually means.
        </p>
      </div>

      <section className="awto-sec" aria-labelledby="about-title">
        <h2 id="about-title" className="awto-sr-only">
          About Awto
        </h2>
        <div className="awto-brand-lockup">
          <AwtoLogo size={56} variant="tile" title="Awto" />
          <div>
            <div className="awto-brand-lockup__name">Awto</div>
            <div className="awto-meta-row">
              <span>Version {version}</span>
              <span className="awto-meta-dot" aria-hidden="true" />
              <span>MIT License</span>
            </div>
          </div>
        </div>
      </section>

      <section className="awto-sec" aria-labelledby="about-how">
        <h2 id="about-how" className="awto-sec__plain-title">
          How it works
        </h2>
        <div className="awto-how">
          {STEPS.map((step) => (
            <div key={step.n} className={`awto-how__card awto-how__card--${step.accent}`}>
              <div className="awto-how__num">{step.n}</div>
              <div className="awto-how__title">{step.title}</div>
              <p className="awto-how__body">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="awto-sec" aria-labelledby="about-links">
        <h2 id="about-links" className="awto-sec__plain-title">
          Links
        </h2>
        <div className="awto-links">
          {LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <a
                key={link.href}
                className="awto-link-row"
                href={link.href}
                target="_blank"
                rel="noreferrer"
              >
                <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
                <span>{link.label}</span>
                <ArrowUpRight
                  className="awto-link-row__ext"
                  size={15}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </a>
            );
          })}
        </div>
      </section>

      <section className="awto-sec awto-sec--privacy" aria-labelledby="about-privacy">
        <div className="awto-sec__head">
          <div className="awto-sec__icon awto-sec__icon--accent">
            <Shield size={17} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div>
            <div id="about-privacy" className="awto-sec__title">
              Privacy
            </div>
          </div>
        </div>
        <p className="awto-privacy-body">
          Awto runs locally. Your profile is stored in your browser only. The
          extension contacts the local Ollama server you configure and,
          optionally, your chosen cloud provider's API using the key you
          provide. There is no telemetry.
        </p>
      </section>
    </div>
  );
}
