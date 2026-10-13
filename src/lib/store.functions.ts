import { createServerFn } from '@tanstack/react-start';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

function publicClient() {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_PUBLISHABLE_KEY'];
  if (!url || !key) throw new Error('Loja temporariamente indisponível');
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => {
    const headers = new Headers(init?.headers);
    if (key.startsWith('sb_') && headers.get('Authorization') === `Bearer ${key}`) headers.delete('Authorization');
    headers.set('apikey', key);
    return fetch(input, { ...init, headers });
  } } });
}
const columns = 'id,name,slug,description,event_date,event_time,venue,city,category,cover_url' as const;
export const listStoreEvents = createServerFn({ method: 'GET' }).handler(async () => {
  const sb = publicClient();
  const { data, error } = await sb.from('events').select(columns).eq('published', true).eq('approval_status', 'approved').order('event_date');
  if (error) throw new Error(error.message);
  return data ?? [];
});
export const getStoreEvent = createServerFn({ method: 'GET' }).inputValidator((d: { slug: string }) => ({ slug: String(d.slug).slice(0, 150) })).handler(async ({ data }) => {
  const sb = publicClient();
  const { data: event, error } = await sb.from('events').select(columns).eq('slug', data.slug).eq('published', true).eq('approval_status', 'approved').maybeSingle();
  if (error) throw new Error(error.message);
  if (!event) return null;
  const { data: groups, error: ge } = await sb.from('ticket_groups').select('id,name,ticket_type,price').eq('event_id', event.id).eq('for_sale', true).order('price');
  if (ge) throw new Error(ge.message);
  const stock = await Promise.all((groups ?? []).map(async g => {
    const { data: available, error: ae } = await sb.rpc('group_available', { _group: g.id });
    if (ae) throw new Error(ae.message);
    return { ...g, available: Math.max(0, available ?? 0) };
  }));
  return { event, groups: stock };
});
