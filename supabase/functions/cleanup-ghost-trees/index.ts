import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TREE_BLOCK_TYPES = ['trunk', 'branch', 'leaf', 'fruit', 'spike', 'nob', 'cross', 'shroom', 'invisiblock']

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

    console.log('Admin verified, starting SMART ghost tree cleanup...')

    // STEP 1: Get all valid tree IDs from planted_trees (source of truth)
    const { data: validTrees, error: validTreesError } = await supabaseAdmin
      .from('planted_trees')
      .select('id')

    if (validTreesError) {
      console.error('Error fetching planted_trees:', validTreesError)
      throw validTreesError
    }

    const validTreeIds = new Set((validTrees || []).map(t => t.id))
    console.log(`Found ${validTreeIds.size} legitimate trees in planted_trees`)

    // STEP 2: Delete orphan tree_blocks (those referencing non-existent trees)
    const { data: allTreeBlocks, error: treeBlocksError } = await supabaseAdmin
      .from('tree_blocks')
      .select('id, tree_id')

    if (treeBlocksError) {
      console.error('Error fetching tree_blocks:', treeBlocksError)
      throw treeBlocksError
    }

    const orphanTreeBlockIds = (allTreeBlocks || [])
      .filter(tb => !validTreeIds.has(tb.tree_id))
      .map(tb => tb.id)

    let deletedTreeBlocks = 0
    if (orphanTreeBlockIds.length > 0) {
      // Delete in batches
      for (let i = 0; i < orphanTreeBlockIds.length; i += 500) {
        const batch = orphanTreeBlockIds.slice(i, i + 500)
        const { error } = await supabaseAdmin
          .from('tree_blocks')
          .delete()
          .in('id', batch)
        if (error) {
          console.error('Error deleting orphan tree_blocks batch:', error)
        } else {
          deletedTreeBlocks += batch.length
        }
      }
      console.log(`Deleted ${deletedTreeBlocks} orphan tree_blocks`)
    }

    // STEP 3: Get all valid block positions from remaining tree_blocks
    const { data: validBlocks, error: validBlocksError } = await supabaseAdmin
      .from('tree_blocks')
      .select('position_x, position_y, position_z, world_id')

    if (validBlocksError) {
      console.error('Error fetching valid tree_blocks:', validBlocksError)
      throw validBlocksError
    }

    const validBlockKeys = new Set(
      (validBlocks || []).map(b => `${b.world_id}:${b.position_x},${b.position_y},${b.position_z}`)
    )
    console.log(`Found ${validBlockKeys.size} valid tree block positions`)

    // STEP 4: Find orphan placed_blocks (tree types with no tree_blocks record)
    const { data: treePlacedBlocks, error: placedBlocksError } = await supabaseAdmin
      .from('placed_blocks')
      .select('id, world_id, position_x, position_y, position_z')
      .in('block_type', TREE_BLOCK_TYPES)

    if (placedBlocksError) {
      console.error('Error fetching placed_blocks:', placedBlocksError)
      throw placedBlocksError
    }

    const orphanPlacedBlockIds = (treePlacedBlocks || [])
      .filter(pb => !validBlockKeys.has(`${pb.world_id}:${pb.position_x},${pb.position_y},${pb.position_z}`))
      .map(pb => pb.id)

    let deletedPlacedBlocks = 0
    if (orphanPlacedBlockIds.length > 0) {
      // Delete in batches of 500 to avoid query limits
      for (let i = 0; i < orphanPlacedBlockIds.length; i += 500) {
        const batch = orphanPlacedBlockIds.slice(i, i + 500)
        const { error } = await supabaseAdmin
          .from('placed_blocks')
          .delete()
          .in('id', batch)
        if (error) {
          console.error('Error deleting orphan placed_blocks batch:', error)
        } else {
          deletedPlacedBlocks += batch.length
        }
      }
      console.log(`Deleted ${deletedPlacedBlocks} orphan placed_blocks`)
    }

    // Bump chunk versions to force clients to refetch if we deleted anything
    if (deletedPlacedBlocks > 0) {
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
    }

    console.log('Smart ghost tree cleanup complete')

    return new Response(JSON.stringify({
      success: true,
      stats: {
        legitimate_trees_preserved: validTreeIds.size,
        valid_tree_blocks: validBlockKeys.size,
      },
      deleted: {
        orphan_tree_blocks: deletedTreeBlocks,
        orphan_placed_blocks: deletedPlacedBlocks,
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
