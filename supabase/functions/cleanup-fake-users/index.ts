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

    // Create admin client
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

    // Create client to verify admin
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

    // Verify user is admin/superadmin
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: roles } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .in('role', ['admin', 'superadmin'])

    if (!roles || roles.length === 0) {
      return new Response(JSON.stringify({ error: 'Forbidden - Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log('Admin verified, starting cleanup...')

    // Get all auth users
    const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers()
    if (authError) throw authError

    console.log('Total auth users:', authUsers.users.length)

    // Get all user_ids from profiles
    const { data: profiles } = await supabaseClient
      .from('user_profiles')
      .select('user_id')

    const profileUserIds = new Set(profiles?.map(p => p.user_id) || [])
    console.log('Users with profiles:', profileUserIds.size)

    // Find users without profiles
    const usersToDelete = authUsers.users.filter(u => !profileUserIds.has(u.id))
    console.log('Users to delete:', usersToDelete.length)

    // Delete each user
    let deletedCount = 0
    const errors = []

    for (const user of usersToDelete) {
      try {
        const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id)
        if (error) {
          console.error(`Failed to delete user ${user.id}:`, error)
          errors.push({ id: user.id, error: error.message })
        } else {
          deletedCount++
          console.log(`Deleted user ${user.id} (${user.email})`)
        }
      } catch (e) {
        console.error(`Exception deleting user ${user.id}:`, e)
        errors.push({ id: user.id, error: e.message })
      }
    }

    console.log(`Cleanup complete. Deleted ${deletedCount} users, ${errors.length} errors`)

    return new Response(JSON.stringify({ 
      success: true,
      deleted_count: deletedCount,
      errors: errors.length > 0 ? errors : undefined
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error in cleanup-fake-users:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
