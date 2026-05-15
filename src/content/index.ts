import type { AwtoMessage } from "@/shared/messages";
import { scanFields } from "./form-scanner";
import { fillFields } from "./form-filler";

chrome.runtime.onMessage.addListener(
  (
    message: AwtoMessage,
    _sender,
    sendResponse: (response: AwtoMessage) => void
  ) => {
    if (message.type === "scanForm") {
      const fields = scanFields(document);
      sendResponse({ type: "scanFormResult", fields });
      return true;
    }
    if (message.type === "fillForm") {
      const { filled, failed } = fillFields(document, message.values);
      sendResponse({ type: "fillFormResult", filled, failed });
      return true;
    }
    return true;
  }
);
