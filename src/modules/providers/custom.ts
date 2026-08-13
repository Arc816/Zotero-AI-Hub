// custom.ts — generic OpenAI-compatible custom endpoint.
// Behaves identically to OpenAICompatProvider; kept as a distinct class so the
// registry/factory can label it separately and users understand it is "custom".
import { OpenAICompatProvider } from "./openaiCompat";

export class CustomProvider extends OpenAICompatProvider {}
