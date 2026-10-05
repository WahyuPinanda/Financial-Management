import {
  calculateSpk,
  calculateExpense,
  EDIT_WINDOW_MS,
  type Harvest,
  type Spk,
} from '@sawit/shared';

/** Explicitly labeled, read-only development preview; never used for real accounts. */
export function previewHarvests(): Harvest[] {
  return Array.from({ length: 5 }, (_, i) => {
    const day = new Date(Date.now() - (4 - i) * 14 * 86_400_000).toISOString().slice(0, 10);
    const publishedAt = new Date(Date.now() - (4 - i) * 14 * 86_400_000).toISOString();
    const spks: Spk[] = Array.from({ length: i === 4 ? 3 : 2 }, (_, index) => {
      const input = {
        company_name: ['PT. Sawit Sejahtera', 'PT. Agro Lestari', 'PT. Karya Sawit'][index],
        delivery_date: day,
        bunch_count: 320 + i * 16 + index * 20,
        first_weight: 9100 + i * 170 + index * 200,
        second_weight: 3300,
        deduction_kg: 110 + index * 20,
        price_per_kg: 2850 + i * 25,
      };
      return {
        ...input,
        ...calculateSpk(input),
        id: `sample-${i}-${index}`,
        harvest_id: `harvest-${i}`,
        published_at: publishedAt,
        created_at: publishedAt,
        updated_at: publishedAt,
        editable: i === 4,
        edit_deadline: new Date(Date.parse(publishedAt) + EDIT_WINDOW_MS).toISOString(),
      };
    });
    return {
      id: `harvest-${i}`,
      name: `Panen kebun utama ${i + 1}`,
      harvest_date: day,
      created_at: publishedAt,
      spks,
      expenses: [
        {
          first_weight: 9100 + i * 170,
          second_weight: 3300,
          wage_per_kg: 250,
          driver_cost: 450000,
          ...calculateExpense({
            first_weight: 9100 + i * 170,
            second_weight: 3300,
            wage_per_kg: 250,
            driver_cost: 450000,
          }),
          id: `expense-${i}`,
          harvest_id: `harvest-${i}`,
          published_at: publishedAt,
          created_at: publishedAt,
          updated_at: publishedAt,
          editable: i === 4,
          edit_deadline: new Date(Date.parse(publishedAt) + EDIT_WINDOW_MS).toISOString(),
        },
      ],
    };
  }).reverse();
}
