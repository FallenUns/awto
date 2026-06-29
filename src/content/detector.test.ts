import { describe, it, expect, vi, beforeEach } from "vitest";

(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: { get: () => Promise.resolve({}) },
    onChanged: { addListener: () => {} },
  },
};

const { startDetector } = await import("./detector");

describe("startDetector", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });

  it("reports 0 on a page with no inputs after initial debounce", () => {
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("reports field count on a page with inputs", () => {
    document.body.innerHTML = `
      <form>
        <label>First name <input name="firstname" /></label>
        <label>Email <input type="email" name="email" /></label>
      </form>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("re-reports after a mutation that adds personal-data inputs (debounced)", async () => {
    vi.useRealTimers();
    const onChange = vi.fn();
    startDetector(onChange);

    // Wait for initial scan
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(onChange).toHaveBeenLastCalledWith(0);

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <label>Full name <input type="text" name="fullname" /></label>
      <label>Email <input type="email" name="email" /></label>
    `;
    document.body.appendChild(wrapper);

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it("no-ops on chrome-extension:// pages", () => {
    const original = window.location.href;
    Object.defineProperty(window, "location", {
      value: { href: "chrome-extension://abc/x.html", protocol: "chrome-extension:" },
      writable: true,
    });
    const onChange = vi.fn();
    const stop = startDetector(onChange);
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
    stop();
    Object.defineProperty(window, "location", { value: { href: original }, writable: true });
  });

  it("ignores pages with only a search-style input (no personal signal)", () => {
    document.body.innerHTML = `
      <form>
        <label>Search <input name="q" type="search" /></label>
        <input type="text" name="filter" />
      </form>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("reports count when a name+email pair is present (strong + contact category)", () => {
    document.body.innerHTML = `
      <form>
        <label>Full name <input type="text" name="fullname" /></label>
        <label>Email <input type="email" name="email" /></label>
      </form>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("ignores YouTube-style page: search + one other utility input", () => {
    document.body.innerHTML = `
      <input type="search" name="search_query" placeholder="Search" />
      <input type="text" name="filter" placeholder="Filter results" />
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("ignores a GitHub-style repo page: Description + Topics + Website + email-notification toggle", () => {
    document.body.innerHTML = `
      <header><input type="search" placeholder="Search or jump to..." /></header>
      <main>
        <input type="text" placeholder="Go to file" />
        <textarea placeholder="Description"></textarea>
        <input type="text" placeholder="Website" value="https://example.com" />
        <input type="text" placeholder="Topics (separate with spaces)" />
        <label><input type="checkbox" name="notify_email" /> Include my email address so I can be contacted</label>
      </main>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("ignores a product-listing page whose option labels merely contain words like 'storage'", () => {
    document.body.innerHTML = `
      <main>
        <input type="search" name="q" aria-label="Search for products" />
        <label><input type="radio" name="variant-a" value="1" /> Option: FRIHETEN, Corner sofa-bed with storage, Skiftebo dark grey</label>
        <label><input type="radio" name="variant-a" value="2" /> Option: FRIHETEN, Corner sofa-bed with storage, Bomstad black</label>
        <label><input type="radio" name="variant-b" value="1" /> Option: VIMLE, 2-seat sofa-bed with storage, Gunnared beige</label>
        <label><input type="checkbox" name="cmp1" /> Compare — Corner sofa-bed with storage</label>
      </main>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("ignores a page with only an email subscribe field", () => {
    document.body.innerHTML = `
      <form>
        <label>Email <input type="email" name="email" /></label>
        <button type="submit">Subscribe</button>
      </form>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("ignores personal-looking fields inside <nav>, <header>, <footer>, <aside>", () => {
    document.body.innerHTML = `
      <nav>
        <input type="text" placeholder="Email me about updates" />
        <input type="text" placeholder="Your name" />
      </nav>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("triggers on a real signup form: name + email + password", () => {
    document.body.innerHTML = `
      <form>
        <label>Full name <input type="text" name="fullname" /></label>
        <label>Email <input type="email" name="email" /></label>
        <label>Password <input type="password" name="pw" /></label>
      </form>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("triggers on an address-only form (address category x 3 = strong signal)", () => {
    document.body.innerHTML = `
      <form>
        <label>Street <input type="text" name="street" /></label>
        <label>City <input type="text" name="city" /></label>
        <label>Postcode <input type="text" name="postcode" /></label>
      </form>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("ignores a single Website-only field on an otherwise unrelated page (too weak)", () => {
    document.body.innerHTML = `
      <main>
        <input type="text" placeholder="Website" />
        <textarea placeholder="Description"></textarea>
      </main>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("triggers on an ARIA-only Google-Forms-style survey (age + gender radiogroups)", () => {
    document.body.innerHTML = `
      <main>
        <div id="lbl-age">Age</div>
        <div role="radiogroup" aria-labelledby="lbl-age">
          <div role="radio">18-25</div>
          <div role="radio">26-35</div>
        </div>
        <div id="lbl-g">Gender</div>
        <div role="radiogroup" aria-labelledby="lbl-g">
          <div role="radio">Male</div>
          <div role="radio">Female</div>
        </div>
      </main>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("still rejects a single ARIA radiogroup with no other personal signal", () => {
    document.body.innerHTML = `
      <main>
        <div id="lbl-age">Age</div>
        <div role="radiogroup" aria-labelledby="lbl-age">
          <div role="radio">18-25</div>
          <div role="radio">26-35</div>
        </div>
      </main>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("excludes inputs under div role=banner (ARIA landmark)", () => {
    document.body.innerHTML = `
      <div role="banner">
        <input type="email" placeholder="Subscribe email" />
        <input type="text" placeholder="First name" />
      </div>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("excludes inputs under div role=contentinfo (footer landmark)", () => {
    document.body.innerHTML = `
      <div role="contentinfo">
        <input type="email" placeholder="Subscribe email" />
        <input type="text" placeholder="Full name" />
      </div>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("excludes inputs under div role=navigation", () => {
    document.body.innerHTML = `
      <div role="navigation">
        <input type="email" placeholder="Email address" />
        <input type="text" placeholder="Last name" />
      </div>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("does NOT trigger on a CMS page-editor with 'Title' + 'Description' (title alone is no longer a strong name signal)", () => {
    document.body.innerHTML = `
      <form>
        <label>Title <input name="title" placeholder="Page title" /></label>
        <label>Slug <input name="slug" /></label>
        <label>Description <textarea></textarea></label>
      </form>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("counts <input type=date> + <input type=time> fields toward personalCount", () => {
    document.body.innerHTML = `
      <form>
        <label>Date of birth <input type="date" name="dob" /></label>
        <label>Preferred time <input type="time" name="t" /></label>
        <label>Full name <input type="text" name="fn" /></label>
      </form>
    `;
    const onChange = vi.fn();
    startDetector(onChange);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith(3);
  });
});
