-- PENDING. NOT APPLIED. Apply to production only after a verified backup and the owner's explicit approval.
-- Problem: the UPDATE policy's WITH CHECK requires created_by = caller for non-admins, so a consultant who
-- OWNS a record (owner_user_id) but did not CREATE it can see it yet cannot save edits.
-- Fix: allow the save when the caller is the owner OR the creator (same rule as USING).
-- Owner/creator fields are still set only by the server-side rules; the app never sends them on edit (EDIT_EXCLUDE).

drop policy if exists clients_update_own_or_admin on public.clients;
create policy clients_update_own_or_admin on public.clients
  for update to authenticated
  using (crm_is_admin() or owner_user_id = current_crm_user_id() or created_by = current_crm_telegram_id())
  with check (crm_is_admin() or owner_user_id = current_crm_user_id() or created_by = current_crm_telegram_id());

drop policy if exists properties_update_own_or_admin on public.properties;
create policy properties_update_own_or_admin on public.properties
  for update to authenticated
  using (crm_is_admin() or owner_user_id = current_crm_user_id() or created_by = current_crm_telegram_id())
  with check (crm_is_admin() or owner_user_id = current_crm_user_id() or created_by = current_crm_telegram_id());
