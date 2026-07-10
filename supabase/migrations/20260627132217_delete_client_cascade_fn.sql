-- Stored procedure used by the delete-client edge function.
-- Sets the bypass GUC and deletes all child rows + the client in one session.
CREATE OR REPLACE FUNCTION public.delete_client_cascade(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM set_config('app.allow_client_delete', 'true', true);

  DELETE FROM public.bookings                  WHERE client_id = p_client_id;
  DELETE FROM public.cancellation_reasons      WHERE client_id = p_client_id;
  DELETE FROM public.daily_summary_runs        WHERE client_id = p_client_id;
  DELETE FROM public.link_clicks               WHERE client_id = p_client_id;
  DELETE FROM public.middle_man_clicks         WHERE client_id = p_client_id;
  DELETE FROM public.middle_man_form_submissions WHERE client_id = p_client_id;
  DELETE FROM public.monthly_reports           WHERE client_id = p_client_id;
  DELETE FROM public.notifications_sent        WHERE client_id = p_client_id;
  DELETE FROM public.opt_outs                  WHERE client_id = p_client_id;
  DELETE FROM public.push_subscriptions        WHERE client_id = p_client_id;
  DELETE FROM public.sms_events                WHERE client_id = p_client_id;
  DELETE FROM public.unsubscribe_events        WHERE client_id = p_client_id;
  DELETE FROM public.unsubscribe_tokens        WHERE client_id = p_client_id;

  DELETE FROM public.clients WHERE id = p_client_id;
END;
$$;

-- Only service_role may call this function.
REVOKE ALL ON FUNCTION public.delete_client_cascade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_client_cascade(uuid) TO service_role;
