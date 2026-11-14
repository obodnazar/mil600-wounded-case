-- Рішення команди 2026-11-14 (ADR 0012): п’ятиденний строк довідки рахується від дня надходження
-- на лікування до закладу, а не від квитанції про отримання документа військовослужбовцем.
ALTER TABLE wound_case ADD COLUMN admitted_on TEXT;
UPDATE task SET kind='confirm_admission_date' WHERE kind='confirm_receipt_date';
