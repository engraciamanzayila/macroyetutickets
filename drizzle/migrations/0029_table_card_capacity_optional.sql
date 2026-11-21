-- Table capacity is optional until an operator confirms the number of people.
-- Printing is blocked in the UI until a valid capacity is supplied.
ALTER TABLE public.event_table_cards ALTER COLUMN capacity DROP NOT NULL;
