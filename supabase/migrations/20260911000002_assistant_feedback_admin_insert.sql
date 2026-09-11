-- 👍/👎 on an assistant answer has never been insertable by an AION admin.
--
-- The insert policy requires profile_id = get_my_profile_id(), and an admin has
-- no row in profiles — get_my_profile_id() returns null, the check fails, and
-- the associate-facing toast says "Couldn't send feedback." Anyone at AION
-- testing the assistant (which is most of the people who ever pressed those
-- buttons) has been silently unable to rate an answer since the table shipped;
-- assistant_feedback is still empty. Same shape of fix as ai_chats_brand.
drop policy if exists "assistant_feedback: admin insert" on public.assistant_feedback;
create policy "assistant_feedback: admin insert"
  on public.assistant_feedback for insert
  with check (public.get_my_role() = 'admin');
