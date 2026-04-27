-- Compte les usage_events du jour (UTC) pour un user
CREATE OR REPLACE FUNCTION public.count_today_requests(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.usage_events
  WHERE user_id = _user_id
    AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC');
$$;

-- Retourne le plan (free / plus / ...) avec fallback "free"
CREATE OR REPLACE FUNCTION public.get_user_plan(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT plan FROM public.billing_accounts WHERE user_id = _user_id LIMIT 1),
    'free'
  );
$$;