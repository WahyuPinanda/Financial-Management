import type { Harvest, HarvestInput, Spk, SpkInput } from '@sawit/shared';
import { supabase } from './supabase';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!supabase) throw new Error('Koneksi belum disiapkan.');
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Sesi telah berakhir. Silakan login kembali.');
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
    });
  } catch {
    throw new Error('Tidak dapat terhubung ke server. Periksa koneksi Anda dan coba lagi.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message ?? 'Permintaan tidak dapat diproses.');
  return body as T;
}

export const harvestApi = {
  list: () => request<{ data: Harvest[]; server_time: string }>('/harvests'),
  create: (input: HarvestInput) =>
    request<{ data: Harvest }>('/harvests', { method: 'POST', body: JSON.stringify(input) }),
  createSpk: (harvestId: string, input: SpkInput) =>
    request<{ data: Spk }>(`/harvests/${harvestId}/spks`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateSpk: (id: string, input: SpkInput) =>
    request<{ data: Spk }>(`/spks/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
};
