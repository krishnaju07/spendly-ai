import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';

/**
 * Provider-independent LLM access. The rest of the app talks to `LlmProvider` and never to a
 * vendor SDK, and everything it asks of a model is optional: if no provider is configured, or a
 * call fails, callers fall back to the deterministic engine.
 */

export type AiErrorCode = 'rate_limited' | 'auth' | 'timeout' | 'unavailable' | 'bad_request' | 'refused' | 'truncated' | 'empty';

export class AiProviderError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface LlmImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  dataBase64: string;
}

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens?: number;
  /** Reasoning depth hint for models that support it; ignored elsewhere. */
  effort?: 'low' | 'medium' | 'high';
  image?: LlmImage;
}

export interface LlmResponse {
  text: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LlmProvider {
  readonly id: 'anthropic' | 'openai';
  readonly model: string;
  readonly supportsVision: boolean;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

// ── Anthropic ──────────────────────────────────────────────────────────────────────────────────

/** Models that accept `output_config.effort`. Others would reject it, so it is simply omitted. */
const EFFORT_MODELS = /^claude-(opus-(4-[5-8]|5)|sonnet-(4-6|5)|haiku-5|fable|mythos)/;

class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic' as const;
  readonly model: string;
  readonly supportsVision = true;
  private readonly client: Anthropic;

  constructor() {
    this.model = env.AI_MODEL ?? 'claude-opus-5-5';
    this.client = new Anthropic({
      apiKey: env.AI_API_KEY,
      baseURL: env.AI_BASE_URL || undefined,
      timeout: env.AI_TIMEOUT_MS,
      maxRetries: 1,
    });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    try {
      const content: Anthropic.MessageParam['content'] = req.image
        ? [
            { type: 'image', source: { type: 'base64', media_type: req.image.mediaType, data: req.image.dataBase64 } },
            { type: 'text', text: req.user },
          ]
        : req.user;
      // No temperature/top_p: current Claude models reject sampling parameters.
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? env.AI_MAX_OUTPUT_TOKENS,
        system: req.system,
        messages: [{ role: 'user', content }],
        ...(EFFORT_MODELS.test(this.model) ? { output_config: { effort: req.effort ?? 'low' } } : {}),
      });
      if (response.stop_reason === 'refusal') throw new AiProviderError('refused', 'The model declined this request');
      if (response.stop_reason === 'max_tokens') throw new AiProviderError('truncated', 'The model ran out of output tokens');
      const text = response.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('')
        .trim();
      if (!text) throw new AiProviderError('empty', 'The model returned no text');
      return { text, model: response.model, usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof Anthropic.APIConnectionTimeoutError) throw new AiProviderError('timeout', 'The AI provider timed out');
      if (error instanceof Anthropic.RateLimitError) throw new AiProviderError('rate_limited', 'The AI provider is rate limiting requests');
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new AiProviderError('auth', 'The AI provider rejected the configured credentials');
      }
      if (error instanceof Anthropic.BadRequestError) throw new AiProviderError('bad_request', 'The AI provider rejected the request');
      throw new AiProviderError('unavailable', 'The AI provider is unavailable');
    }
  }
}

// ── OpenAI-compatible (OpenAI, OpenRouter, Ollama, LM Studio, Azure-style gateways …) ───────────

class OpenAiCompatibleProvider implements LlmProvider {
  readonly id = 'openai' as const;
  readonly model: string;
  readonly supportsVision: boolean;
  private readonly baseUrl: string;

  constructor() {
    this.model = env.AI_MODEL ?? 'gpt-4o-mini';
    this.supportsVision = env.AI_VISION !== 'false';
    this.baseUrl = (env.AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  private async post(body: Record<string, unknown>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);
    try {
      return await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.AI_API_KEY}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const userContent = req.image
      ? [
          { type: 'text', text: req.user },
          { type: 'image_url', image_url: { url: `data:${req.image.mediaType};base64,${req.image.dataBase64}` } },
        ]
      : req.user;
    const base = {
      ...env.aiExtraBody,
      model: this.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: userContent },
      ],
    };
    const maxTokens = req.maxTokens ?? env.AI_MAX_OUTPUT_TOKENS;
    try {
      let res = await this.post({ ...base, max_tokens: maxTokens });
      if (res.status === 400) {
        // newer OpenAI models want max_completion_tokens instead
        const text = await res.clone().text();
        if (/max_completion_tokens/.test(text)) res = await this.post({ ...base, max_completion_tokens: maxTokens });
      }
      if (res.status === 401 || res.status === 403) throw new AiProviderError('auth', 'The AI provider rejected the configured credentials');
      if (res.status === 429) throw new AiProviderError('rate_limited', 'The AI provider is rate limiting requests');
      if (res.status >= 500) throw new AiProviderError('unavailable', 'The AI provider is unavailable');
      if (!res.ok) throw new AiProviderError('bad_request', 'The AI provider rejected the request');
      const json = (await res.json()) as {
        model?: string;
        choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = json.choices?.[0];
      if (choice?.finish_reason === 'length') throw new AiProviderError('truncated', 'The model ran out of output tokens');
      const text = stripThinking(choice?.message?.content ?? '');
      if (!text) throw new AiProviderError('empty', 'The model returned no text');
      return {
        text,
        model: json.model ?? this.model,
        usage: json.usage ? { inputTokens: json.usage.prompt_tokens ?? 0, outputTokens: json.usage.completion_tokens ?? 0 } : undefined,
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if ((error as Error).name === 'AbortError') throw new AiProviderError('timeout', 'The AI provider timed out');
      throw new AiProviderError('unavailable', 'The AI provider is unavailable');
    }
  }
}

/** Reasoning models (several on NVIDIA's free endpoint) can put their working inside <think> tags; only the answer is wanted. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
}

let cached: LlmProvider | null | undefined;

/** The configured provider, or null when AI is switched off (the default). */
export function getProvider(): LlmProvider | null {
  if (cached !== undefined) return cached;
  cached = env.AI_PROVIDER === 'anthropic' ? new AnthropicProvider() : env.AI_PROVIDER === 'openai' ? new OpenAiCompatibleProvider() : null;
  return cached;
}

/** Pulls the first JSON object out of a model reply, tolerating code fences and chatter around it. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new AiProviderError('empty', 'No JSON object in the model reply');
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new AiProviderError('bad_request', 'The model reply was not valid JSON');
  }
}
