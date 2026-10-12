-- ============================================================
-- 009: show every account's chats to everyone in the chapter, grouped by
-- account. Run in the Supabase SQL editor.
--
-- chat_sessions.owner_uid already says WHICH account owns a chat (005). This
-- adds a human label for it (the Google display name / e-mail), written by the
-- app when a chat is created and back-filled the next time its owner opens
-- /chat. Until it is run the app still works: other people's chats are grouped
-- under "Account xxxxxx" instead of a name.
--
-- Safe to run more than once.
-- ============================================================
alter table public.chat_sessions
  add column if not exists owner_name text;
