ALTER TABLE public.zoho_mail_config
  DROP CONSTRAINT IF EXISTS zoho_mail_config_sender_email_check;

ALTER TABLE public.zoho_mail_config
  ADD CONSTRAINT zoho_mail_config_sender_email_check
  CHECK (lower(sender_email) = 'myticket@macroyeto.com');