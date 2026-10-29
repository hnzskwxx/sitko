import type { ApiError } from '@shared/types';

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

const listeners = new Set<() => void>();
/** Zavolá se při 401, aplikace pak přesměruje na přihlášení. */
export const onUnauthorized = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

async function handle<T>(res: Response): Promise<T> {
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try { body = JSON.parse(text); } catch { body = null; }
  }
  if (!res.ok) {
    const err = (body as ApiError | null)?.error;
    if (res.status === 401) listeners.forEach((fn) => fn());
    throw new ApiFailure(
      res.status,
      err?.code ?? 'http_error',
      err?.message ?? (res.status >= 500 ? 'Server teď neodpovídá. Zkuste to prosím znovu.' : 'Požadavek se nepodařil.'),
      err?.fields ?? {},
    );
  }
  return body as T;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(method !== 'GET' ? { 'X-Sitko-Request': '1' } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiFailure(0, 'network', 'Nepodařilo se spojit se serverem. Zkontrolujte připojení.');
  }
  return handle<T>(res);
}

/** Zkratky, které rovnou vybalí `data`. */
export const api = {
  get: async <T>(path: string) => (await request<{ data: T }>('GET', path)).data,
  list: <T>(path: string) => request<{ data: T[]; meta: { page: number; pageSize: number; total: number } }>('GET', path),
  post: async <T>(path: string, body: unknown = {}) => (await request<{ data: T }>('POST', path, body)).data,
  put: async <T>(path: string, body: unknown) => (await request<{ data: T }>('PUT', path, body)).data,
  patch: async <T>(path: string, body: unknown) => (await request<{ data: T }>('PATCH', path, body)).data,
  del: async <T>(path: string) => (await request<{ data: T }>('DELETE', path)).data,
};

/** Multipart upload s průběhem (fetch průběh odesílání neumí). */
export function upload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1${path}`);
    xhr.setRequestHeader('X-Sitko-Request', '1');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onerror = () => reject(new ApiFailure(0, 'network', 'Nahrávání se přerušilo. Zkontrolujte připojení.'));
    xhr.onload = () => {
      const res = new Response(xhr.responseText, { status: xhr.status });
      handle<{ data: T }>(res).then((b) => resolve(b.data), reject);
    };
    xhr.send(form);
  });
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : 'Něco se nepovedlo.');
