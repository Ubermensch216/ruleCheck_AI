import { env } from '../config/env.js';
import { AppError } from '../errors.js';

interface OllamaModel { name: string; model?: string; modified_at?: string; size?: number }

async function ollamaFetch(pathname: string, init: RequestInit = {}, parentSignal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), env.OLLAMA_TIMEOUT_MS);
  const onAbort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(`${env.OLLAMA_URL}${pathname}`, { ...init, signal: controller.signal });
    return response;
  } catch (error) {
    if (parentSignal?.aborted) throw new AppError('REVIEW_CANCELLED', '검토가 취소되었습니다.', 409);
    if (controller.signal.aborted) throw new AppError('OLLAMA_TIMEOUT', 'Ollama 응답 시간이 초과되었습니다.', 504);
    throw new AppError('OLLAMA_UNAVAILABLE', 'Ollama에 연결할 수 없습니다.', 503, error instanceof Error ? error.message : undefined);
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', onAbort);
  }
}

export async function listModels(): Promise<OllamaModel[]> {
  const response = await ollamaFetch('/api/tags');
  if (!response.ok) throw new AppError('OLLAMA_ERROR', `Ollama 모델 목록 조회 실패 (${response.status})`, 502);
  const body = await response.json() as { models?: OllamaModel[] };
  return body.models ?? [];
}

export async function ensureModel(model: string): Promise<void> {
  let models: OllamaModel[];
  try {
    models = await listModels();
  } catch (error) {
    // 모델 목록 조회가 느린 것과 모델이 없는 것은 다릅니다.
    // 응답이 지연될 뿐이라면 검토 전체를 실패시키지 말고 실제 분석 요청에서 판단하게 둡니다.
    if (error instanceof AppError && error.code === 'OLLAMA_TIMEOUT') return;
    throw error;
  }
  if (!models.some((item) => item.name === model || item.model === model)) {
    throw new AppError('MODEL_NOT_INSTALLED', `Ollama 모델 '${model}'이 설치되어 있지 않습니다.`, 400);
  }
}

export async function modelContextLength(model: string): Promise<number> {
  try {
    const response = await ollamaFetch('/api/show', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model })
    });
    if (!response.ok) return 8192;
    const body = await response.json() as Record<string, any>;
    const modelInfo = body.model_info ?? {};
    const contextEntry = Object.entries(modelInfo).find(([key]) => key.endsWith('.context_length'));
    const declared = typeof contextEntry?.[1] === 'number' ? contextEntry[1] : env.OLLAMA_CONTEXT_LENGTH;
    return Math.min(declared, env.OLLAMA_CONTEXT_LENGTH);
  } catch { return env.OLLAMA_CONTEXT_LENGTH; }
}

export async function chatJson(input: {
  model: string;
  system: string;
  user: string;
  schema: object;
  signal?: AbortSignal;
  temperature?: number;
  contextLength?: number;
}): Promise<string> {
  const response = await ollamaFetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      stream: false,
      think: false,
      keep_alive: '15m',
      format: input.schema,
      messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.user }],
      options: {
        temperature: input.temperature ?? 0.1,
        top_p: 0.9,
        num_ctx: input.contextLength ?? env.OLLAMA_CONTEXT_LENGTH,
        num_predict: env.OLLAMA_MAX_OUTPUT_TOKENS
      }
    })
  }, input.signal);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AppError('OLLAMA_ERROR', `Ollama 분석 요청 실패 (${response.status})`, 502, detail.slice(0, 500));
  }
  const body = await response.json() as { message?: { content?: string } };
  if (!body.message?.content) throw new AppError('OLLAMA_EMPTY_RESPONSE', 'Ollama가 빈 응답을 반환했습니다.', 502);
  return body.message.content;
}

export async function ollamaHealthy(): Promise<boolean> {
  try { await listModels(); return true; } catch { return false; }
}
