-- Trigger: when a user confirms their email (email_confirmed_at becomes non-null),
-- update their profile status from 'pending' to 'verified'.

create or replace function public.handle_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Fire only when email_confirmed_at transitions from NULL → non-NULL
  if (old.email_confirmed_at is null and new.email_confirmed_at is not null) then
    update public.profiles
    set
      status = 'verified',
      email_confirmed_at = new.email_confirmed_at
    where user_id = new.id
      and status = 'pending';
  end if;
  return new;
end;
$$;

-- Drop if exists so re-running the migration is safe
drop trigger if exists on_email_confirmed on auth.users;

create trigger on_email_confirmed
  after update on auth.users
  for each row
  execute procedure public.handle_email_confirmed();
