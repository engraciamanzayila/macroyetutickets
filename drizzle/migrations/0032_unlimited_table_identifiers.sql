-- Remove fixed inventory ceilings while preserving all existing table cards and assignments.
ALTER TABLE public.event_table_cards
  DROP CONSTRAINT IF EXISTS event_table_cards_identifier_pair,
  DROP CONSTRAINT IF EXISTS event_table_cards_card_number_check,
  DROP CONSTRAINT IF EXISTS event_table_cards_physical_identifier_number_check;

ALTER TABLE public.event_table_cards
  ADD CONSTRAINT event_table_cards_card_number_positive
    CHECK (card_number >= 1),
  ADD CONSTRAINT event_table_cards_physical_identifier_number_positive
    CHECK (physical_identifier_number IS NULL OR physical_identifier_number >= 1),
  ADD CONSTRAINT event_table_cards_identifier_pair
    CHECK (
      (physical_identifier_type IS NULL AND physical_identifier_number IS NULL)
      OR (
        physical_identifier_type IS NOT NULL
        AND physical_identifier_number IS NOT NULL
        AND physical_identifier_type = card_type
      )
    );

-- No rows are deleted or renumbered. Existing QR tokens and physical assignments remain unchanged.
