import type {
  Harvest,
  HarvestInput,
  Spk,
  SpkInput,
  HarvestExpense,
  ExpenseInput,
} from '@sawit/shared';
import { supabase } from './supabase';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const mutationHeaders = (requestKey: string, version?: number) => ({
  'Idempotency-Key': requestKey,
  ...(version === undefined ? {} : { 'If-Match': String(version) }),
});

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!supabase) throw new Error('Koneksi belum disiapkan.');
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Sesi telah berakhir. Silakan login kembali.');
  let response: Response;
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${session.access_token}`);
  try {
    response = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/api${path}`, {
      ...options,
      headers,
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error(
      options.method && options.method !== 'GET'
        ? 'Status penyimpanan belum dapat dipastikan. Coba simpan lagi tanpa mengubah isian; permintaan yang sama tidak akan menggandakan transaksi. Periksa catatan sebelum membuat transaksi baru.'
        : 'Tidak dapat terhubung ke server. Periksa koneksi Anda dan coba lagi.',
    );
  }
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(response.status, body?.message ?? 'Permintaan tidak dapat diproses.');
  if (!body)
    throw new ApiError(502, 'Respons server tidak valid. Muat ulang untuk memeriksa penyimpanan.');
  return body as T;
}

export const harvestApi = {
  create: (input: HarvestInput, key: string) =>
    request<{ data: Harvest }>('/harvests', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: mutationHeaders(key),
    }),
  createSpk: (harvestId: string, input: SpkInput, key: string) =>
    request<{ data: Spk }>(`/harvests/${harvestId}/spks`, {
      method: 'POST',
      body: JSON.stringify(input),
      headers: mutationHeaders(key),
    }),
  updateSpk: (id: string, input: SpkInput, version: number, key: string) =>
    request<{ data: Spk }>(`/spks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      headers: mutationHeaders(key, version),
    }),
  createExpense: (harvestId: string, input: ExpenseInput, key: string) =>
    request<{ data: HarvestExpense }>(`/harvests/${harvestId}/expenses`, {
      method: 'POST',
      body: JSON.stringify(input),
      headers: mutationHeaders(key),
    }),
  updateExpense: (id: string, input: ExpenseInput, version: number, key: string) =>
    request<{ data: HarvestExpense }>(`/expenses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      headers: mutationHeaders(key, version),
    }),
};
