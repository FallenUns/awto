import type { AwtoMessage } from "@/shared/messages";
import { scanFields } from "./form-scanner";
import { fillFields } from "./form-filler";
import { startDetector } from "./detector";
import { mountWidget } from "./widget";
import { hydrateAriaSettings } from "./aria-settings";
import { assessPageContext, buildPromptPageContext } from "@/shared/page-context";

void hydrateAriaSettings();

const widget = mountWidget(async () => {
  const reply = (await chrome.runtime.sendMessage({
    type: "openPopup",
  })) as AwtoMessage;
  if (reply.type !== "openPopupResult" || !reply.ok) {
    console.warn("Awto: openPopup unavailable.", reply);
  }
});

chrome.runtime.onMessage.addListener(
  (message: AwtoMessage, _sender, sendResponse) => {
    if (message.type === "scanForm") {
      const fields = scanFields(document);
      const ctx = assessPageContext(window.location, fields);
      const pageContext = buildPromptPageContext(window.location, document.title, ctx);
      sendResponse({ type: "scanFormResult", fields, pageContext });
    } else if (message.type === "fillForm") {
      fillFields(document, message.values)
        .then((result) => {
          sendResponse({ type: "fillFormResult", ...result });
          widget.setHidden("filled");
        })
        .catch((err: unknown) => {
          sendResponse({
            type: "fillFormResult",
            filled: 0,
            failed: [
              {
                selector: "*",
                reason: err instanceof Error ? err.message : String(err),
              },
            ],
          });
        });
    }
    return true;
  }
);

startDetector((count) => {
  if (count >= 2) widget.setCount(count);
  else widget.setHidden("no-fields");
});
