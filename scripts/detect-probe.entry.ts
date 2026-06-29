import { diagnose } from "../src/content/detector";

(globalThis as unknown as { __awtoDiagnose?: () => string }).__awtoDiagnose = () =>
  JSON.stringify(diagnose(document));
