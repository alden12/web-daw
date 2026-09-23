-- Corrente: stamp the hosted MCP server's URL as the audience of tokens issued to connected apps
-- (AGENT-28). Paste into the Supabase SQL editor, then select it under Authentication -> Hooks ->
-- Customize Access Token (JWT) Claims. See docs/HOSTED-MCP.md.
--
-- ONLY tokens Supabase's OAuth server issues to a connected app carry `client_id`. The app's own
-- sign-in tokens do not, and they must keep `aud: "authenticated"`, or the app's API refuses them
-- and nobody can use Corrente. So everything without `client_id` passes through untouched.
--
-- If the deployed URL ever changes, change it here AND in the MCP_RESOURCE_URL secret: the server
-- accepts only tokens whose audience is exactly that URL.

create or replace function public.corrente_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb := event -> 'claims';
begin
  if claims ? 'client_id' then
    claims := jsonb_set(claims, '{aud}', to_jsonb('https://web-daw.fly.dev/mcp'::text));
    event := jsonb_set(event, '{claims}', claims);
  end if;
  return event;
end;
$$;

-- Only Supabase Auth may run it.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.corrente_access_token_hook to supabase_auth_admin;
revoke execute on function public.corrente_access_token_hook from authenticated, anon, public;
