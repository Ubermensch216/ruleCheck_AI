import { get, writable } from 'svelte/store';
import type { DocumentKind, DocumentSummary, Finding, ReviewSummary } from '../../shared/schemas';
import { api } from '../api';

interface ModelInfo { name: string; size?: number; modified_at?: string }
interface ReviewDetail { review: ReviewSummary; findings: Finding[] }

interface GrcState {
  models: ModelInfo[];
  model: string;
  policy?: DocumentSummary;
  target?: DocumentSummary;
  uploading?: DocumentKind;
  review?: ReviewSummary;
  findings: Finding[];
  history: ReviewSummary[];
  error: string;
  serverReady: boolean;
}

const initialState: GrcState = {
  models: [], model: 'gemma4:e2b', findings: [], history: [], error: '', serverReady: false
};

export const grcStore = writable<GrcState>({ ...initialState });
let events: EventSource | undefined;

function message(error: unknown): string {
  return error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
}

export async function initialize(): Promise<void> {
  try {
    const [models, history] = await Promise.all([
      api<{ models: ModelInfo[] }>('/api/models'),
      api<{ items: ReviewSummary[] }>('/api/reviews')
    ]);
    grcStore.update((state) => ({ ...state, models: models.models, history: history.items, serverReady: true, error: '' }));
  } catch (error) {
    grcStore.update((state) => ({ ...state, serverReady: false, error: message(error) }));
  }
}

export function setModel(model: string): void {
  grcStore.update((state) => ({ ...state, model }));
}

export async function uploadDocument(file: File, kind: DocumentKind): Promise<void> {
  grcStore.update((state) => ({ ...state, uploading: kind, error: '', review: undefined, findings: [] }));
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  try {
    const result = await api<{ document: DocumentSummary }>('/api/documents', { method: 'POST', body: form });
    grcStore.update((state) => ({ ...state, [kind]: result.document, uploading: undefined }));
  } catch (error) {
    grcStore.update((state) => ({ ...state, uploading: undefined, error: message(error) }));
  }
}

export async function startReview(): Promise<void> {
  const state = get(grcStore);
  if (!state.policy || !state.target) {
    grcStore.update((current) => ({ ...current, error: '기준 문서와 대상 문서를 모두 업로드해 주세요.' }));
    return;
  }
  grcStore.update((current) => ({ ...current, error: '', findings: [] }));
  try {
    const result = await api<{ review: ReviewSummary }>('/api/reviews', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        policyDocumentId: state.policy.id,
        targetDocumentId: state.target.id,
        model: state.model,
        title: `${state.target.filename} 내부검토`
      })
    });
    grcStore.update((current) => ({ ...current, review: result.review }));
    subscribe(result.review.id);
  } catch (error) {
    grcStore.update((current) => ({ ...current, error: message(error) }));
  }
}

export async function updateReviewTitle(id: string, title: string): Promise<boolean> {
  try {
    const result = await api<{ review: ReviewSummary }>(`/api/reviews/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    grcStore.update((state) => ({
      ...state,
      review: state.review?.id === id ? result.review : state.review,
      history: state.history.map((item) => item.id === id ? result.review : item),
      error: ''
    }));
    return true;
  } catch (error) {
    grcStore.update((state) => ({ ...state, error: message(error) }));
    return false;
  }
}

function subscribe(id: string): void {
  events?.close();
  events = new EventSource(`/api/reviews/${id}/events`);
  events.addEventListener('progress', async (event) => {
    const review = JSON.parse((event as MessageEvent).data) as ReviewSummary;
    grcStore.update((state) => ({ ...state, review }));
    if (['completed', 'failed', 'cancelled'].includes(review.status)) {
      events?.close();
      if (review.status === 'completed') await loadReview(review.id);
      await loadHistory();
    }
  });
  events.onerror = () => events?.close();
}

export async function cancelCurrentReview(): Promise<void> {
  const review = get(grcStore).review;
  if (!review) return;
  try {
    const result = await api<{ review: ReviewSummary }>(`/api/reviews/${review.id}/cancel`, { method: 'POST' });
    events?.close();
    grcStore.update((state) => ({ ...state, review: result.review }));
  } catch (error) { grcStore.update((state) => ({ ...state, error: message(error) })); }
}

export async function loadHistory(): Promise<void> {
  try {
    const result = await api<{ items: ReviewSummary[] }>('/api/reviews');
    grcStore.update((state) => ({ ...state, history: result.items }));
  } catch (error) { grcStore.update((state) => ({ ...state, error: message(error) })); }
}

export async function loadReview(id: string): Promise<void> {
  try {
    const result = await api<ReviewDetail>(`/api/reviews/${id}`);
    grcStore.update((state) => ({ ...state, review: result.review, findings: result.findings, error: '' }));
    if (!['completed', 'failed', 'cancelled'].includes(result.review.status)) subscribe(id);
  } catch (error) { grcStore.update((state) => ({ ...state, error: message(error) })); }
}

export async function deleteReview(id: string): Promise<void> {
  try {
    await api<void>(`/api/reviews/${id}`, { method: 'DELETE' });
    grcStore.update((state) => ({
      ...state,
      review: state.review?.id === id ? undefined : state.review,
      findings: state.review?.id === id ? [] : state.findings,
      policy: state.review?.id === id ? undefined : state.policy,
      target: state.review?.id === id ? undefined : state.target,
      history: state.history.filter((item) => item.id !== id)
    }));
  } catch (error) { grcStore.update((state) => ({ ...state, error: message(error) })); }
}

export function reset(): void {
  events?.close();
  const state = get(grcStore);
  grcStore.set({ ...initialState, models: state.models, history: state.history, serverReady: state.serverReady });
}
