import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.114.0';
import { hasRecentAuthentication } from './reauthentication.ts';

const authorizationHeader = 'Authorization';
const bearerPrefix = 'Bearer ';
const jsonHeaders = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
});
const millisecondsPerSecond = 1_000;

export type AuthorizedRequest = Readonly<{
  accountId: string;
  service: SupabaseClient;
}>;

export async function authorize(
  request: Request,
  requireRecentAuthentication = false,
): Promise<AuthorizedRequest | Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
  const authorization = request.headers.get(authorizationHeader);
  if (
    supabaseUrl === undefined ||
    publishableKey === undefined
  ) {
    return errorResponse('service_unavailable', 503);
  }
  if (
    authorization === null ||
    !authorization.startsWith(bearerPrefix)
  ) {
    return errorResponse('authentication_required', 401);
  }
  const token = authorization.slice(bearerPrefix.length);
  const verifier = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await verifier.auth.getUser(token);
  if (error !== null || data.user === null) {
    return errorResponse('authentication_required', 401);
  }
  if (requireRecentAuthentication) {
    const currentSeconds = Math.floor(Date.now() / millisecondsPerSecond);
    if (!hasRecentAuthentication(token, currentSeconds)) {
      return errorResponse('reauthentication_required', 401);
    }
  }
  return {
    accountId: data.user.id,
    service: serviceClient(),
  };
}

export function serviceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (supabaseUrl === undefined || serviceRoleKey === undefined) {
    throw new Error('Supabase service configuration is unavailable.');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: jsonHeaders,
  });
}

export function errorResponse(code: string, status: number): Response {
  return jsonResponse({ error: { code } }, status);
}

export async function readJson(request: Request): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export function methodNotAllowed(): Response {
  return errorResponse('method_not_allowed', 405);
}

export function serverFailure(): Response {
  return errorResponse('service_unavailable', 503);
}
