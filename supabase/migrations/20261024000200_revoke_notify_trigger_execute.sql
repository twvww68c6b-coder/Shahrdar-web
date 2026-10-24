-- Applied after 20261024000100. The urgent trigger functions only run as triggers; no API caller needs them.
revoke execute on function public.notify_urgent_client(), public.notify_urgent_property() from public, anon, authenticated;
