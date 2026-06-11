import { callTauri, isTauriRuntime } from "./tauriClient";

export type AiClassificationSettings = {
  enabled: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
};

type RustAiClassificationSettings = {
  enabled: boolean;
  provider: string;
  model: string;
  base_url: string;
  has_api_key: boolean;
};

export async function getAiClassificationSettings(): Promise<AiClassificationSettings> {
  if (!isTauriRuntime()) {
    return { enabled: false, provider: "deepseek", model: "deepseek-v4-pro", baseUrl: "https://api.deepseek.com", hasApiKey: false };
  }
  return fromRustAiClassificationSettings(
    await callTauri<RustAiClassificationSettings>("get_ai_classification_settings"),
  );
}

export async function setAiClassificationSettings(
  enabled: boolean,
  apiKey?: string,
  provider?: string,
  model?: string,
  baseUrl?: string,
) {
  if (!isTauriRuntime()) {
    return {
      enabled,
      provider: provider ?? "deepseek",
      model: model ?? "deepseek-v4-pro",
      baseUrl: baseUrl ?? "https://api.deepseek.com",
      hasApiKey: Boolean(apiKey?.trim()),
    };
  }
  return fromRustAiClassificationSettings(
    await callTauri<RustAiClassificationSettings>("set_ai_classification_settings", {
      enabled,
      apiKey: apiKey?.trim() || null,
      provider: provider || null,
      model: model || null,
      baseUrl: baseUrl || null,
    }),
  );
}

export async function testAiConfig(): Promise<string> {
  if (!isTauriRuntime()) return "✓ Connected — mock responded successfully";
  return callTauri<string>("test_ai_config");
}

export async function reclassifyUnclassifiedWithAi(): Promise<number> {
  if (!isTauriRuntime()) return 0;
  return callTauri<number>("reclassify_unclassified_with_ai");
}

function fromRustAiClassificationSettings(settings: RustAiClassificationSettings): AiClassificationSettings {
  return {
    enabled: settings.enabled,
    provider: settings.provider,
    model: settings.model,
    baseUrl: settings.base_url,
    hasApiKey: settings.has_api_key,
  };
}
