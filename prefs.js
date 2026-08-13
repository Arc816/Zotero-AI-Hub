// zotero-ai-hub default preferences
// Loaded by the add-on manager; all keys live under extensions.zotero.aiHub.
pref("extensions.zotero.aiHub.providers", "[]"); // JSON array of ProviderConfig
pref("extensions.zotero.aiHub.defaultProviderId", "");
pref("extensions.zotero.aiHub.routingStrategy", "priority"); // priority | roundRobin
pref("extensions.zotero.aiHub.fallbackEnabled", true);
pref("extensions.zotero.aiHub.temperature", "0.7");
pref("extensions.zotero.aiHub.maxTokens", "4096");
pref("extensions.zotero.aiHub.autoSaveNotes", false);
pref("extensions.zotero.aiHub.taskModels", "{}");
pref("extensions.zotero.aiHub.outputLanguage", "auto"); // auto | zh | en
pref("extensions.zotero.aiHub.systemPrompt", "");

// RAG / embedding (optional)
pref("extensions.zotero.aiHub.rag.enabled", false);
pref("extensions.zotero.aiHub.rag.embeddingApi", "");
pref("extensions.zotero.aiHub.rag.embeddingKey", "");
pref("extensions.zotero.aiHub.rag.embeddingModel", "text-embedding-3-small");
pref("extensions.zotero.aiHub.rag.topK", "5");
pref("extensions.zotero.aiHub.rag.scope", "library"); // current | selected | library

// Embedded MCP server
pref("extensions.zotero.aiHub.mcp.enabled", true);
pref("extensions.zotero.aiHub.mcp.port", 23121);
pref("extensions.zotero.aiHub.mcp.allowRemote", false);
pref("extensions.zotero.aiHub.mcp.write.enabled", false);

// Logging
pref("extensions.zotero.aiHub.logLevel", "info"); // debug | info | warn | error

// Prompt templates
pref("extensions.zotero.aiHub.prompts.summary", "");
pref("extensions.zotero.aiHub.prompts.summaryDeep", "");
pref("extensions.zotero.aiHub.prompts.annotation", "");
pref("extensions.zotero.aiHub.prompts.chat", "");
pref("extensions.zotero.aiHub.prompts.translate", "");
pref("extensions.zotero.aiHub.prompts.review", "");
pref("extensions.zotero.aiHub.prompts.mindmap", "");
