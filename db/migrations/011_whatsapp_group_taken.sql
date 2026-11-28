ALTER TABLE whatsapp_dispatches
  DROP CONSTRAINT whatsapp_dispatches_purpose_check,
  DROP CONSTRAINT whatsapp_dispatches_check,
  ADD CONSTRAINT whatsapp_dispatches_purpose_check
    CHECK (purpose IN ('contact','group_taken','quote_request','start_work','fitting','work_update','overdue','await_payment','paid','handover')),
  ADD CONSTRAINT whatsapp_dispatches_purpose_channel_check
    CHECK (purpose='contact' OR channel=CASE WHEN purpose='group_taken' THEN 'group' ELSE 'partner' END);
