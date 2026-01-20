import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ALL possible tree-related block types
const TREE_BLOCK_TYPES = [
  'trunk', 'branch', 'leaf', 'fruit', 'spike', 'nob', 'cross', 
  'shroom', 'shroom_stem', 'shroom_cap', 'invisiblock'
]

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

    console.log('Admin verified, starting COMPREHENSIVE ghost tree cleanup...')

    const stats = {
      planted_trees_preserved: 0,
      orphan_tree_blocks_deleted: 0,
      orphan_placed_blocks_deleted: 0,
      tree_fruits_deleted: 0,
    }

    // STEP 1: Get all valid tree IDs from planted_trees (source of truth)
    const { data: validTrees, error: validTreesError } = await supabaseAdmin
      .from('planted_trees')
      .select('id')

    if (validTreesError) {
      console.error('Error fetching planted_trees:', validTreesError)
      throw validTreesError
    }

    const validTreeIds = new Set((validTrees || []).map(t => t.id))
    stats.planted_trees_preserved = validTreeIds.size
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

    if (orphanTreeBlockIds.length > 0) {
      for (let i = 0; i < orphanTreeBlockIds.length; i += 500) {
        const batch = orphanTreeBlockIds.slice(i, i + 500)
        const { error } = await supabaseAdmin
          .from('tree_blocks')
          .delete()
          .in('id', batch)
        if (error) {
          console.error('Error deleting orphan tree_blocks batch:', error)
        } else {
          stats.orphan_tree_blocks_deleted += batch.length
        }
      }
      console.log(`Deleted ${stats.orphan_tree_blocks_deleted} orphan tree_blocks`)
    }

    // STEP 3: Delete orphan tree_fruits (those referencing non-existent trees)
    const { data: allTreeFruits, error: treeFruitsError } = await supabaseAdmin
      .from('tree_fruits')
      .select('id, tree_id')

    if (!treeFruitsError && allTreeFruits) {
      const orphanFruitIds = allTreeFruits
        .filter(tf => !validTreeIds.has(tf.tree_id))
        .map(tf => tf.id)

      if (orphanFruitIds.length > 0) {
        for (let i = 0; i < orphanFruitIds.length; i += 500) {
          const batch = orphanFruitIds.slice(i, i + 500)
          const { error } = await supabaseAdmin
            .from('tree_fruits')
            .delete()
            .in('id', batch)
          if (error) {
            console.error('Error deleting orphan tree_fruits batch:', error)
          } else {
            stats.tree_fruits_deleted += batch.length
          }
        }
        console.log(`Deleted ${stats.tree_fruits_deleted} orphan tree_fruits`)
      }
    }

    // STEP 4: Get all valid block positions from remaining tree_blocks
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

    // STEP 5: SIMPLIFIED - If tree_blocks is EMPTY and planted_trees is EMPTY,
    // ALL tree-type placed_blocks are orphans and should be deleted
    const { data: treePlacedBlocks, error: placedBlocksError } = await supabaseAdmin
      .from('placed_blocks')
      .select('id, world_id, position_x, position_y, position_z')
      .in('block_type', TREE_BLOCK_TYPES)

    if (placedBlocksError) {
      console.error('Error fetching placed_blocks:', placedBlocksError)
      throw placedBlocksError
    }

    let orphanPlacedBlockIds: string[] = []
    
    // If NO valid trees exist, ALL tree blocks in placed_blocks are orphans
    if (validTreeIds.size === 0 && validBlockKeys.size === 0) {
      console.log('No valid trees found - ALL tree-type placed_blocks are orphans')
      orphanPlacedBlockIds = (treePlacedBlocks || []).map(pb => pb.id)
    } else {
      // Normal orphan detection - check if placed_block has matching tree_block
      orphanPlacedBlockIds = (treePlacedBlocks || [])
        .filter(pb => !validBlockKeys.has(`${pb.world_id}:${pb.position_x},${pb.position_y},${pb.position_z}`))
        .map(pb => pb.id)
    }

    if (orphanPlacedBlockIds.length > 0) {
      console.log(`Found ${orphanPlacedBlockIds.length} orphan placed_blocks to delete`)
      for (let i = 0; i < orphanPlacedBlockIds.length; i += 500) {
        const batch = orphanPlacedBlockIds.slice(i, i + 500)
        const { error } = await supabaseAdmin
          .from('placed_blocks')
          .delete()
          .in('id', batch)
        if (error) {
          console.error('Error deleting orphan placed_blocks batch:', error)
        } else {
          stats.orphan_placed_blocks_deleted += batch.length
        }
      }
      console.log(`Deleted ${stats.orphan_placed_blocks_deleted} orphan placed_blocks`)
    }

    // STEP 6: Bump chunk versions to force clients to refetch
    if (stats.orphan_placed_blocks_deleted > 0 || stats.orphan_tree_blocks_deleted > 0) {
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

    console.log('Comprehensive ghost tree cleanup complete:', stats)

    return new Response(JSON.stringify({
      success: true,
      stats: {
        legitimate_trees_preserved: stats.planted_trees_preserved,
        valid_tree_blocks: validBlockKeys.size,
      },
      deleted: {
        orphan_tree_blocks: stats.orphan_tree_blocks_deleted,
        orphan_placed_blocks: stats.orphan_placed_blocks_deleted,
        orphan_tree_fruits: stats.tree_fruits_deleted,
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