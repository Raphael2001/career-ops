// litellm_params.model (what /health and /spend/logs report) -> a human
// label for the provider actually serving it. Update this when
// deploy/litellm/config.yaml changes -- there's no way to derive "Z.ai"
// from "openai/glm-4.7-flash" (it's routed through the generic openai/
// provider) without this map. Shared between the Models (health) and
// Usage (spend) pages so labels stay consistent across both.
const PROVIDER_LABELS: Record<string, string> = {
  "nvidia_nim/nvidia/nemotron-3.5-lightning-30b-a3b": "NVIDIA NIM",
  "nvidia_nim/nvidia/nemotron-3-ultra-550b-a55b": "NVIDIA NIM",
  "groq/openai/gpt-oss-120b": "Groq",
  "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free": "OpenRouter",
  "openai/glm-4.7-flash": "Z.ai",
  "mistral/mistral-small-latest": "Mistral",
};

export function providerLabel(model: string): string {
  return PROVIDER_LABELS[model] ?? model.split("/")[0];
}
