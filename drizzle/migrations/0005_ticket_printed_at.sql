ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS printed_at timestamptz;
CREATE INDEX IF NOT EXISTS tickets_group_printed_idx ON public.tickets(group_id, printed_at);