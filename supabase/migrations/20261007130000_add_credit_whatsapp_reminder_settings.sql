CREATE TABLE IF NOT EXISTS public.credit_whatsapp_reminder_settings (
    customer_mobile text PRIMARY KEY,
    enabled boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_whatsapp_reminder_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow all for authenticated"
    ON public.credit_whatsapp_reminder_settings
    TO authenticated
    USING (true)
    WITH CHECK (true);

GRANT ALL ON TABLE public.credit_whatsapp_reminder_settings TO authenticated;
GRANT ALL ON TABLE public.credit_whatsapp_reminder_settings TO service_role;