import { Github, FileText, BookOpen } from "lucide-react";

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

export function AboutTab() {
  const version = readVersion();

  return (
    <div className="awto-tabpanel">
      <section className="awto-card" aria-labelledby="about-title">
        <h3 id="about-title" className="awto-card__title">
          About Awto
        </h3>
        <p className="awto-card__subtitle">
          Smart personal-detail autofill that understands what each field
          actually means.
        </p>
        <div className="awto-meta-row">
          <span>Version {version}</span>
          <span>·</span>
          <span>MIT License</span>
        </div>
      </section>

      <section className="awto-card" aria-labelledby="about-links">
        <h3 id="about-links" className="awto-section-title">
          Links
        </h3>
        <ul className="awto-about-list">
          <li>
            <Github size={16} strokeWidth={1.5} aria-hidden="true" />
            <a
              className="awto-link"
              href="https://github.com/FallenUns/awto"
              target="_blank"
              rel="noreferrer"
            >
              GitHub repository
            </a>
          </li>
          <li>
            <BookOpen size={16} strokeWidth={1.5} aria-hidden="true" />
            <a
              className="awto-link"
              href="https://github.com/FallenUns/awto#readme"
              target="_blank"
              rel="noreferrer"
            >
              Documentation
            </a>
          </li>
          <li>
            <FileText size={16} strokeWidth={1.5} aria-hidden="true" />
            <a
              className="awto-link"
              href="https://github.com/FallenUns/awto/blob/main/LICENSE"
              target="_blank"
              rel="noreferrer"
            >
              License (MIT)
            </a>
          </li>
        </ul>
      </section>

      <section className="awto-card" aria-labelledby="about-privacy">
        <h3 id="about-privacy" className="awto-section-title">
          Privacy
        </h3>
        <p className="awto-card__footer-note">
          Awto runs locally. Your profile is stored in your browser only. The
          extension contacts the local Ollama server you configure and,
          optionally, the Anthropic API using the key you provide. There is no
          telemetry.
        </p>
      </section>
    </div>
  );
}
