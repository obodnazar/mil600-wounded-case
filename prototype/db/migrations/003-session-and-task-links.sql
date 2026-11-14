-- CSRF-токен більше не зберігається: сервер виводить його з токена сесії.
-- Наявні навчальні сесії анулюються; користувач просто обирає роль знову.
DELETE FROM demo_session;
ALTER TABLE demo_session DROP COLUMN csrf_token;
ALTER TABLE demo_session DROP COLUMN csrf_hash;
-- Яка подія журналу відкрила задачу: таймлайн показує реального власника наступної дії.
ALTER TABLE task ADD COLUMN opened_by_event TEXT REFERENCES case_event(id);
