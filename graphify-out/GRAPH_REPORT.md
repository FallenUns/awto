# Graph Report - /Users/patrickadrianus/awto  (2026-05-15)

## Corpus Check
- Corpus is ~4,342 words - fits in a single context window. You may not need a graph.

## Summary
- 84 nodes · 108 edges · 8 communities detected
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 16 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_UI & Design System|UI & Design System]]
- [[_COMMUNITY_LLM Strategy & Clients|LLM Strategy & Clients]]
- [[_COMMUNITY_Background Worker & Schemas|Background Worker & Schemas]]
- [[_COMMUNITY_Form Interaction Layer|Form Interaction Layer]]
- [[_COMMUNITY_Extension Shell & Build|Extension Shell & Build]]
- [[_COMMUNITY_Profile Storage|Profile Storage]]
- [[_COMMUNITY_Verification & Testing|Verification & Testing]]
- [[_COMMUNITY_Scope & Framing|Scope & Framing]]

## God Nodes (most connected - your core abstractions)
1. `Popup screen design` - 11 edges
2. `Background service worker` - 10 edges
3. `Popup UI (confirmation)` - 9 edges
4. `Decision 8: Form filling flow` - 8 edges
5. `Decision 6: Tech stack selection` - 7 edges
6. `Decision 5: Hybrid LLM strategy (Ollama default, Anthropic fallback)` - 6 edges
7. `Decision 7: Flat JSON profile storage (plain text v1)` - 6 edges
8. `Decision 10: UI design system (Minimal Single Column + Micro-interactions)` - 5 edges
9. `Content script` - 5 edges
10. `LLM local client (Ollama)` - 5 edges

## Surprising Connections (you probably didn't know these)
- `Always confirm before filling (anti-pattern: auto-fill without confirmation)` --semantically_similar_to--> `Decision 8: Form filling flow`  [INFERRED] [semantically similar]
  DESIGN_SYSTEM.md → CLAUDE.md
- `Form scanner unit tests with HTML fixtures` --semantically_similar_to--> `Manual test set (Seek, MyGov, Substack, Shopify, awkward labels)`  [INFERRED] [semantically similar]
  PLAN.md → CLAUDE.md
- `Options page (profile + LLM settings)` --implements--> `Options page screen design (3 tabs)`  [EXTRACTED]
  CLAUDE.md → DESIGN_SYSTEM.md
- `Decision 10: UI design system (Minimal Single Column + Micro-interactions)` --shapes--> `Minimal Single Column pattern`  [EXTRACTED]
  CLAUDE.md → DESIGN_SYSTEM.md
- `Decision 10: UI design system (Minimal Single Column + Micro-interactions)` --shapes--> `Micro-interactions style`  [EXTRACTED]
  CLAUDE.md → DESIGN_SYSTEM.md

## Hyperedges (group relationships)
- **Rejected approaches from original architectural blueprint** — rejected_multi_agent, rejected_graphrag, rejected_computer_vision, rejected_cov_evaluator_refiner, rejected_dom_readback, rejected_hardware_keystore, rejected_autonomous_research, rejected_form_submission_automation, rejected_original_blueprint [EXTRACTED 1.00]
- **Build pipeline tech stack** — tech_typescript, tech_react, tech_vite_crxjs, tech_zod, tech_manifest_v3 [INFERRED 0.85]
- **Popup UI sections (three-section confirmation)** — popup_section_will_fill, popup_section_needs_input, popup_section_skipped, popup_footer_fill_cta [EXTRACTED 1.00]

## Communities

### Community 0 - "UI & Design System"
Cohesion: 0.14
Nodes (18): Decision 10: UI design system (Minimal Single Column + Micro-interactions), Accessibility floor (>=4.5:1 contrast, focus rings), Color tokens (slate-900 bg, green-500 CTA), Forms design principles, Layout tokens (400px popup, 4pt spacing), Micro-interactions style, Minimal Single Column pattern, Motion tokens (150-300ms, ease-out) (+10 more)

### Community 1 - "LLM Strategy & Clients"
Cohesion: 0.18
Nodes (13): LLM cloud client (Anthropic), LLM hybrid strategy (local -> cloud fallback), LLM local client (Ollama), Decision 5: Hybrid LLM strategy (Ollama default, Anthropic fallback), Anthropic CORS via dangerouslyAllowBrowser, Ollama Cloud does not support structured outputs, Rationale: One LLM call per form is enough, Rationale: Privacy-first — most fills never leave device (+5 more)

### Community 2 - "Background Worker & Schemas"
Cohesion: 0.2
Nodes (12): Background service worker, Mapping Zod schema (FieldMapping / LLMResponse), Profile Zod schema, Prompt template + JSON schema, Typed messages between contexts, Decision 9: LLM output schema (single-property union), Anthropic input_schema rejects top-level oneOf/anyOf/allOf, MV3 service workers terminate when idle (+4 more)

### Community 3 - "Form Interaction Layer"
Cohesion: 0.29
Nodes (11): Content script, Form filler, Form scanner, Popup UI (confirmation), Decision 8: Form filling flow, Always confirm before filling (anti-pattern: auto-fill without confirmation), React value setter trick (dispatch input + change events), Rationale: Human confirmation is the verifier (replaces CoV/read-back) (+3 more)

### Community 4 - "Extension Shell & Build"
Cohesion: 0.2
Nodes (11): Awto (Chrome Extension), Options page (profile + LLM settings), Decision 4: Chrome only for v1, Decision 3: Chrome browser extension as distribution model, Decision 6: Tech stack selection, Rationale: Chrome is simplest path; MV3 mandatory for store, Chrome Manifest V3, ollama JS library (+3 more)

### Community 5 - "Profile Storage"
Cohesion: 0.25
Nodes (8): Typed chrome.storage wrapper, Decision 7: Flat JSON profile storage (plain text v1), Rationale: Defer encryption to avoid password-recovery UX burden, Rationale: Profile is flat object — no relational traversal needed, Rejected: GraphRAG / Kuzu, Rejected: Hardware keystore (Keychain / Android Keystore), chrome.storage.local, Web Crypto API (deferred to v2)

### Community 6 - "Verification & Testing"
Cohesion: 0.29
Nodes (7): Decision 11: Verification target (>=85% fill, zero wrong), Rationale: Wrong values on tax/insurance/gov forms can be irreversible, Vitest (unit test runner), >=85% correct fill rate, Form scanner unit tests with HTML fixtures, Manual test set (Seek, MyGov, Substack, Shopify, awkward labels), Zero incorrect fills

### Community 7 - "Scope & Framing"
Cohesion: 0.5
Nodes (4): Decision 1: Problem framing — build the simplest thing, Decision 2: Product scope (v1), Rejected: Form submission automation, Rejected: Original 5000-word architectural blueprint (overengineered)

## Knowledge Gaps
- **30 isolated node(s):** `Typed chrome.storage wrapper`, `Ollama local runtime (llama3.2 3B)`, `claude-opus-4-7 (cloud model)`, `Inter typography (300/400/500/600/700)`, `Lucide SVG icons` (+25 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Background service worker` connect `Background Worker & Schemas` to `LLM Strategy & Clients`, `Form Interaction Layer`, `Profile Storage`?**
  _High betweenness centrality (0.464) - this node is a cross-community bridge._
- **Why does `Popup UI (confirmation)` connect `Form Interaction Layer` to `UI & Design System`, `Background Worker & Schemas`, `Extension Shell & Build`?**
  _High betweenness centrality (0.416) - this node is a cross-community bridge._
- **Why does `Popup screen design` connect `UI & Design System` to `Form Interaction Layer`?**
  _High betweenness centrality (0.336) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `Popup screen design` (e.g. with `Motion tokens (150-300ms, ease-out)` and `Forms design principles`) actually correct?**
  _`Popup screen design` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `Decision 8: Form filling flow` (e.g. with `Decision 2: Product scope (v1)` and `Always confirm before filling (anti-pattern: auto-fill without confirmation)`) actually correct?**
  _`Decision 8: Form filling flow` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Typed chrome.storage wrapper`, `Ollama local runtime (llama3.2 3B)`, `claude-opus-4-7 (cloud model)` to the rest of the system?**
  _30 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UI & Design System` be split into smaller, more focused modules?**
  _Cohesion score 0.14 - nodes in this community are weakly interconnected._