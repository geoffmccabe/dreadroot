import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Create client with service role to access auth.users
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Create client with user's token to verify permissions
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Verify user is authenticated
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      console.error('Auth error:', userError)
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Check if user has admin or superadmin role
    const { data: roles, error: roleError } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .in('role', ['admin', 'superadmin'])

    if (roleError || !roles || roles.length === 0) {
      console.error('Role check failed:', roleError)
      return new Response(JSON.stringify({ error: 'Forbidden - Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log('Admin access verified for user:', user.id)

    // Get all users from auth.users
    const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers()
    if (authError) {
      console.error('Error fetching auth users:', authError)
      throw authError
    }

    console.log('Found auth users:', authUsers.users.length)

    // Get all profiles, roles, inventory, and balances
    const [profiles, userRoles, inventory, balances] = await Promise.all([
      supabaseClient.from('user_profiles').select('*'),
      supabaseClient.from('user_roles').select('*'),
      supabaseClient.from('user_inventory').select('*'),
      supabaseClient.from('user_token_balances').select('*, token_themes(name, display_name)')
    ])

    console.log('Fetched data - Profiles:', profiles.data?.length, 'Roles:', userRoles.data?.length)

    // Combine all data
    const usersWithData = authUsers.users.map(authUser => {
      const profile = profiles.data?.find(p => p.user_id === authUser.id)
      const roles = userRoles.data?.filter(r => r.user_id === authUser.id).map(r => r.role) || []
      const userInventory = inventory.data?.filter(i => i.user_id === authUser.id) || []
      const userBalances = balances.data?.filter(b => b.user_id === authUser.id) || []

      return {
        id: authUser.id,
        email: authUser.email,
        created_at: authUser.created_at,
        last_sign_in_at: authUser.last_sign_in_at,
        has_profile: !!profile,
        profile: profile || null,
        roles,
        inventory_count: userInventory.reduce((sum, item) => sum + item.quantity, 0),
        token_balances: userBalances.map(b => ({
          theme_name: b.token_themes?.display_name || b.token_themes?.name || 'Unknown',
          coins: b.coins
        }))
      }
    })

    console.log('Returning users:', usersWithData.length)

    return new Response(JSON.stringify({ users: usersWithData }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error in get-all-users:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
