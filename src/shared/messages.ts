import type { Profile } from "./profile";
import type { FieldMapping } from "./mapping";
import type { ConsentLink, ConsentDecision } from "./consent";
import type { PromptPageContext } from "./page-context";

export interface ScannedField {
  id: number;
  selector: string;
  label: string;
  placeholder: string | null;
  type: string;
  required: boolean;
  options?: string[];
  autocomplete?: string;
  currentValue?: string;
  formatHint?: string;
  links?: ConsentLink[];
}

export interface FillValue {
  selector: string;
  value: string;
  label?: string;
  profileKey?: string;
}

export type AwtoMessage =
  | { type: "scanForm" }
  | { type: "scanFormResult"; fields: ScannedField[]; pageContext?: PromptPageContext }
  | {
      type: "mapFields";
      fields: ScannedField[];
      profile: Profile;
      tabId?: number;
      bypassCache?: boolean;
      pageContext?: PromptPageContext;
    }
  | { type: "mapFieldsProgress"; mappings: FieldMapping[] }
  | { type: "mapFieldsConsent"; consent: ConsentDecision[] }
  | {
      type: "mapFieldsComplete";
      mappings: FieldMapping[];
      source: "local" | "cloud" | "mixed";
    }
  | {
      type: "mapFieldsResult";
      mappings: FieldMapping[];
      source: "local" | "cloud" | "mixed";
    }
  | { type: "mapFieldsError"; error: string }
  | { type: "fillForm"; values: FillValue[] }
  | {
      type: "fillFormResult";
      filled: number;
      failed: Array<{ selector: string; reason: string }>;
    }
  | { type: "testOllama" }
  | {
      type: "testOllamaResult";
      ok: boolean;
      error?: string;
      models?: string[];
      modelInstalled?: boolean;
    }
  | { type: "openPopup" }
  | { type: "openPopupResult"; ok: boolean; error?: string };

export type AwtoMessageType = AwtoMessage["type"];

export async function sendMessage<T extends AwtoMessage>(
  message: T
): Promise<AwtoMessage> {
  return (await chrome.runtime.sendMessage(message)) as AwtoMessage;
}
