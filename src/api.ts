export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) throw new Error('API 서버가 올바른 응답을 반환하지 않았습니다. 포트 설정을 확인해 주세요.');
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? '요청 처리에 실패했습니다.');
  return data as T;
}
