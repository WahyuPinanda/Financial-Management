import { createClient } from '@supabase/supabase-js';
import { boundedFetch } from './boundedFetch';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase =
  url && key && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_')
    ? createClient(url, key, { global: { fetch: boundedFetch() } })
    : null;
