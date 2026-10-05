import type { ZodType } from 'zod';

export interface HarvestInput {
  name: string;
  harvest_date: string;
}
export interface SpkInput {
  company_name: string;
  delivery_date: string;
  bunch_count: number;
  first_weight: number;
  second_weight: number;
  deduction_kg: number;
  price_per_kg: number;
  publish: boolean;
}
export interface Spk extends Omit<SpkInput, 'publish'> {
  id: string;
  harvest_id: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  gross_weight: number;
  net_weight: number;
  deduction_percent: number;
  total_income: number;
  editable: boolean;
  edit_deadline: string | null;
}
export interface Harvest extends HarvestInput {
  id: string;
  created_at: string;
  spks: Spk[];
}
export const EDIT_WINDOW_MS: number;
export const harvestSchema: ZodType<HarvestInput>;
export const spkSchema: ZodType<SpkInput>;
export function calculateSpk(
  value: Pick<SpkInput, 'first_weight' | 'second_weight' | 'deduction_kg' | 'price_per_kg'>,
): { gross_weight: number; net_weight: number; deduction_percent: number; total_income: number };
export function canEdit(publishedAt: string | null, now?: number): boolean;
export function summarize(spks: Spk[]): {
  income: number;
  net: number;
  gross: number;
  deduction: number;
  bunches: number;
  count: number;
  deductionPercent: number;
};
