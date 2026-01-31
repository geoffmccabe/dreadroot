import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Server-side tree growth processor
 *
 * This edge function calls the process_tree_growth() PostgreSQL function
 * to grow trees based on elapsed time since planting.
 *
 * Can be triggered by:
 * - Supabase cron schedule (recommended: every 5-10 seconds)
 * - External cron service
 * - Manual call for testing
 *
 * Trees grow automatically regardless of whether clients are connected.
 * Growth is resumable - if server restarts, trees continue from where they left off.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const startTime = Date.now()

  try {
    // Check for cron secret or valid authorization
    const authHeader = req.headers.get('Authorization')
    const cronSecret = req.headers.get('X-Cron-Secret')
    const expectedCronSecret = Deno.env.get('CRON_SECRET')

    // Allow access if:
    // 1. Valid cron secret is provided (for scheduled jobs)
    // 2. Valid user auth is provided (for manual testing)
    let isAuthorized = false

    if (cronSecret && expectedCronSecret && cronSecret === expectedCronSecret) {
      isAuthorized = true
      console.log('[TreeGrowth] Triggered by cron')
    } else if (authHeader) {
      // Verify user is admin for manual calls
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        {
          global: { headers: { Authorization: authHeader } },
          auth: { autoRefreshToken: false, persistSession: false }
        }
      )

      const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
      if (!userError && user) {
        const { data: roles } = await supabaseClient
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .in('role', ['admin', 'superadmin'])

        if (roles && roles.length > 0) {
          isAuthorized = true
          console.log('[TreeGrowth] Triggered by admin:', user.id)
        }
      }
    }

    // Also allow internal Supabase calls (no auth needed for cron)
    const isInternalCall = req.headers.get('X-Supabase-Functions-Request-Id') !== null
    if (isInternalCall) {
      isAuthorized = true
      console.log('[TreeGrowth] Triggered by internal Supabase call')
    }

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Create admin client with service role key (bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: { autoRefreshToken: false, persistSession: false }
      }
    )

    // Call the database function that handles tree growth
    const { data, error } = await supabaseAdmin.rpc('process_tree_growth')

    if (error) {
      console.error('[TreeGrowth] RPC error:', error)
      return new Response(JSON.stringify({
        error: error.message,
        hint: 'Make sure the process_tree_growth() function exists. Run the migration first.'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const duration = Date.now() - startTime

    console.log('[TreeGrowth] Complete:', {
      ...data,
      duration_ms: duration
    })

    return new Response(JSON.stringify({
      ...data,
      duration_ms: duration
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('[TreeGrowth] Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
