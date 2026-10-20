-- PENDING. NOT APPLIED. Apply only after the owner's explicit approval.
-- Step A (citizen search is only rendered after login; body.auth-required hides the shell until then):
revoke execute on function public.citizen_search_properties(text, text, numeric, numeric, numeric, integer) from anon;
-- Step B (ONLY after web-login is deployed AND the browser uses it; otherwise username login breaks):
-- revoke execute on function public.web_login_email(text) from anon;
