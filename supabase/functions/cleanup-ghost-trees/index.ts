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

    // Create admin client with service role key (bypasses RLS)
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

    // Create client to verify caller
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

    console.log('Admin verified, starting ghost tree cleanup...')

    const TREE_BLOCK_TYPES = ['trunk', 'branch', 'leaf', 'fruit', 'spike', 'nob', 'cross', 'shroom', 'invisiblock']

    // Delete ALL tree blocks from placed_blocks (bypasses RLS)
    const { count: blocksCount, error: blocksError } = await supabaseAdmin
      .from('placed_blocks')
      .delete({ count: 'exact' })
      .in('block_type', TREE_BLOCK_TYPES)

    if (blocksError) {
      console.error('Error deleting placed_blocks:', blocksError)
    } else {
      console.log(`Deleted ${blocksCount} tree blocks from placed_blocks`)
    }

    // Delete ALL tree_blocks records
    const { count: treeBlocksCount, error: treeBlocksError } = await supabaseAdmin
      .from('tree_blocks')
      .delete({ count: 'exact' })
      .neq('id', '')

    if (treeBlocksError) {
      console.error('Error deleting tree_blocks:', treeBlocksError)
    } else {
      console.log(`Deleted ${treeBlocksCount} records from tree_blocks`)
    }

    // Delete ALL planted_trees records
    const { count: plantedCount, error: plantedError } = await supabaseAdmin
      .from('planted_trees')
      .delete({ count: 'exact' })
      .neq('id', '')

    if (plantedError) {
      console.error('Error deleting planted_trees:', plantedError)
    } else {
      console.log(`Deleted ${plantedCount} records from planted_trees`)
    }

    // Bump chunk versions to force all clients to refetch
    const { error: bumpError } = await supabaseAdmin
      .from('chunk_versions')
      .update({ 
        version: 999999,
        updated_at: new Date().toISOString() 
      })
      .gte('chunk_x', -1000)

    if (bumpError) {
      console.error('Error bumping chunk versions:', bumpError)
    }

    console.log('Ghost tree cleanup complete')

    return new Response(JSON.stringify({
      success: true,
      deleted: {
        placed_blocks: blocksCount || 0,
        tree_blocks: treeBlocksCount || 0,
        planted_trees: plantedCount || 0
      },
      errors: {
        blocks: blocksError?.message,
        treeBlocks: treeBlocksError?.message,
        planted: plantedError?.message
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error in cleanup-ghost-trees:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
