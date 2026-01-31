import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Base tree block types - also matches encoded format type_depth_tier
// Includes short codes from new encoding: t, b, l, s, n, x, sm, ss, sc, ib, f
const TREE_BLOCK_BASE_TYPES = [
  'trunk', 'branch', 'leaf', 'fruit', 'spike', 'nob', 'cross', 
  'shroom', 'shroom_stem', 'shroom_cap', 'invisiblock'
]

const TREE_BLOCK_SHORT_CODES = ['t', 'b', 'l', 'f', 's', 'n', 'x', 'sm', 'ss', 'sc', 'ib']

/**
 * Check if a block_type is a tree block type (supports encoded format type_depth_tier)
 */
function isTreeBlockType(blockType: string): boolean {
  // Direct match for legacy types
  if (TREE_BLOCK_BASE_TYPES.includes(blockType)) return true;
  
  // Check if it's a short code directly
  if (TREE_BLOCK_SHORT_CODES.includes(blockType)) return true;
  
  // Encoded format: type_depth_tier (e.g., trunk_0_5, branch_2_3, t_-1_19)
  const parts = blockType.split('_');
  if (parts.length >= 2) {
    const baseType = parts[0];
    
    // Check short codes first (most common in new architecture)
    if (TREE_BLOCK_SHORT_CODES.includes(baseType)) return true;
    
    // Handle compound types like shroom_stem, shroom_cap
    if (parts[0] === 'shroom' && (parts[1] === 'stem' || parts[1] === 'cap')) {
      return true;
    }
    
    // Check full type names
    return TREE_BLOCK_BASE_TYPES.includes(baseType);
  }
  
  return false;
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

    console.log('Admin verified, starting ghost tree cleanup (NEW ARCHITECTURE)...')

    const stats = {
      planted_trees_preserved: 0,
      blueprints_checked: 0,
      orphan_placed_blocks_deleted: 0,
      tree_fruits_deleted: 0,
    }

    // STEP 1: Get all valid tree IDs from planted_trees (source of truth)
    const { data: validTrees, error: validTreesError } = await supabaseAdmin
      .from('planted_trees')
      .select('id, base_x, base_y, base_z')

    if (validTreesError) {
      console.error('Error fetching planted_trees:', validTreesError)
      throw validTreesError
    }

    const validTreeIds = new Set((validTrees || []).map(t => t.id))
    stats.planted_trees_preserved = validTreeIds.size
    console.log(`Found ${validTreeIds.size} legitimate trees in planted_trees`)

    // STEP 2: Get all tree blueprints to find valid block positions
    // NEW ARCHITECTURE: tree_blueprints is the source of truth for block positions
    const { data: blueprints, error: bpError } = await supabaseAdmin
      .from('tree_blueprints')
      .select('planted_tree_id, blueprint_data')

    if (bpError) {
      console.error('Error fetching tree_blueprints:', bpError)
      throw bpError
    }

    stats.blueprints_checked = (blueprints || []).length
    console.log(`Found ${stats.blueprints_checked} tree blueprints`)

    // Build set of valid block positions from blueprints
    const validBlockKeys = new Set<string>()
    for (const bp of blueprints || []) {
      if (!validTreeIds.has(bp.planted_tree_id)) continue; // Skip orphaned blueprints
      
      const data = bp.blueprint_data as { blocks?: Array<{ x: number; y: number; z: number }> }
      if (data?.blocks) {
        for (const block of data.blocks) {
          // We need world_id - get it from planted_trees
          const tree = validTrees?.find(t => t.id === bp.planted_tree_id)
          if (tree) {
            // Use a generic world key since blueprints don't store world_id
            validBlockKeys.add(`${block.x},${block.y},${block.z}`)
          }
        }
      }
    }
    console.log(`Found ${validBlockKeys.size} valid tree block positions from blueprints`)

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

    // STEP 4: Find orphan placed_blocks with tree block types
    // Delete blocks that are tree-type but NOT in any valid tree's blueprint
    console.log('Checking for orphan tree blocks in placed_blocks...')

    // CRITICAL: Supabase default limit is 1000 rows - need higher for world-wide cleanup
    const { data: allPlacedBlocks, error: placedBlocksError } = await supabaseAdmin
      .from('placed_blocks')
      .select('id, block_type, position_x, position_y, position_z')
      .limit(50000)

    if (placedBlocksError) {
      console.error('Error fetching placed_blocks:', placedBlocksError)
      throw placedBlocksError
    }

    // Filter to tree-type blocks
    const treePlacedBlocks = (allPlacedBlocks || []).filter(pb => isTreeBlockType(pb.block_type))
    console.log(`Found ${treePlacedBlocks.length} total tree-type placed_blocks`)

    // Find orphans - tree blocks that are NOT in any valid tree's blueprint
    const orphanTreeBlocks = treePlacedBlocks.filter(pb => {
      const posKey = `${pb.position_x},${pb.position_y},${pb.position_z}`
      return !validBlockKeys.has(posKey)
    })
    console.log(`Found ${orphanTreeBlocks.length} orphan tree blocks (not in any blueprint)`)

    if (orphanTreeBlocks.length > 0) {
      const orphanIds = orphanTreeBlocks.map(pb => pb.id)
      for (let i = 0; i < orphanIds.length; i += 500) {
        const batch = orphanIds.slice(i, i + 500)
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

    // STEP 5: Bump chunk versions to force clients to refetch
    if (stats.orphan_placed_blocks_deleted > 0 || stats.tree_fruits_deleted > 0) {
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

    console.log('Ghost tree cleanup complete (NEW ARCHITECTURE):', stats)

    return new Response(JSON.stringify({
      success: true,
      stats: {
        legitimate_trees_preserved: stats.planted_trees_preserved,
        blueprints_checked: stats.blueprints_checked,
        valid_block_positions: validBlockKeys.size,
      },
      deleted: {
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