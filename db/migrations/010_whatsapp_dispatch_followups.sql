ALTER TABLE whatsapp_dispatches
  ADD COLUMN purpose text NOT NULL DEFAULT 'contact'
    CHECK (purpose IN ('contact','quote_request','start_work','fitting','work_update','overdue','await_payment','paid','handover')),
  ADD COLUMN context_key text NOT NULL DEFAULT 'initial',
  ADD CHECK (purpose='contact' OR channel='partner');

CREATE INDEX whatsapp_dispatch_milestone ON whatsapp_dispatches(inquiry_id,channel,purpose,context_key);
