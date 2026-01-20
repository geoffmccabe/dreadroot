import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Max items to process per call to prevent timeouts
const BATCH_SIZE = 50;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Parse world_id from request body
    const { world_id } = await req.json().catch(() => ({}));
    
    if (!world_id) {
      return new Response(JSON.stringify({ error: 'world_id required' }), {
        status: 400,
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

    console.log(`[fill-tree-holes] Processing world ${world_id}`)

    // Step 1: Get queued positions for this world (limit to BATCH_SIZE)
    const { data: queueItems, error: queueError } = await supabaseAdmin
      .from('overlap_check_queue')
      .select('id, position_x, position_y, position_z')
      .eq('world_id', world_id)
      .limit(BATCH_SIZE)

    if (queueError) {
      console.error('[fill-tree-holes] Queue fetch error:', queueError)
      throw queueError
    }

    if (!queueItems || queueItems.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        processed: 0,
        filled: 0,
        message: 'No queued positions to process' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log(`[fill-tree-holes] Found ${queueItems.length} queued positions`)

    const stats = {
      processed: 0,
      filled: 0,
      skipped: 0,
    }

    const queueIdsToDelete: string[] = []
    const blocksToInsert: any[] = []

    for (const item of queueItems) {
      stats.processed++
      queueIdsToDelete.push(item.id)

      // Step 2: Check if position already has a block in placed_blocks
      const { data: existingBlock } = await supabaseAdmin
        .from('placed_blocks')
        .select('id')
        .eq('world_id', world_id)
        .eq('position_x', item.position_x)
        .eq('position_y', item.position_y)
        .eq('position_z', item.position_z)
        .maybeSingle()

      if (existingBlock) {
        // Position is already occupied, skip
        stats.skipped++
        continue
      }

      // Step 3: Check if there's an overlap waiting for this position
      // Get the OLDEST tree's overlap (by tree_planted_at ASC)
      const { data: overlap, error: overlapError } = await supabaseAdmin
        .from('block_overlaps')
        .select(`
          id,
          block_type,
          tree_id,
          planted_trees!inner (
            id,
            seed_definition_id,
            planted_by,
            seed_definitions (
              trunk_texture_url,
              branch_texture_url,
              fruit_texture_url
            )
          )
        `)
        .eq('world_id', world_id)
        .eq('position_x', item.position_x)
        .eq('position_y', item.position_y)
        .eq('position_z', item.position_z)
        .order('tree_planted_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (overlapError) {
        console.error('[fill-tree-holes] Overlap fetch error:', overlapError)
        continue
      }

      if (!overlap) {
        // No overlap at this position, nothing to fill
        stats.skipped++
        continue
      }

      // Step 4: Determine texture from seed_definitions based on block_type
      const seedDef = (overlap.planted_trees as any)?.seed_definitions
      const plantedBy = (overlap.planted_trees as any)?.planted_by
      
      if (!seedDef || !plantedBy) {
        console.warn(`[fill-tree-holes] Missing seed def or owner for overlap ${overlap.id}`)
        stats.skipped++
        continue
      }

      // Decode block type to determine texture
      // Format: type_depth_tier (e.g., trunk_0_5, branch_1_3)
      const parts = overlap.block_type.split('_')
      const blockTypeBase = parts[0]
      
      let textureUrl: string | null = null
      if (blockTypeBase === 'trunk') {
        textureUrl = seedDef.trunk_texture_url
      } else if (['branch', 'spike', 'nob', 'cross', 'shroom', 'shroom_stem', 'shroom_cap'].includes(blockTypeBase)) {
        textureUrl = seedDef.branch_texture_url || seedDef.trunk_texture_url
      } else if (['leaf', 'fruit'].includes(blockTypeBase)) {
        textureUrl = seedDef.fruit_texture_url || seedDef.branch_texture_url
      }

      // Step 5: Queue block for insertion
      blocksToInsert.push({
        world_id,
        user_id: plantedBy,
        position_x: item.position_x,
        position_y: item.position_y,
        position_z: item.position_z,
        block_type: overlap.block_type,
        texture_url: textureUrl,
        chunk_x: Math.floor(item.position_x / 16),
        chunk_z: Math.floor(item.position_z / 16),
      })

      // Step 6: Delete this specific overlap (leave others for future fills)
      await supabaseAdmin
        .from('block_overlaps')
        .delete()
        .eq('id', overlap.id)

      stats.filled++
    }

    // Batch insert all blocks at once
    if (blocksToInsert.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from('placed_blocks')
        .insert(blocksToInsert)

      if (insertError) {
        console.error('[fill-tree-holes] Block insert error:', insertError)
      } else {
        console.log(`[fill-tree-holes] Inserted ${blocksToInsert.length} blocks`)
      }
    }

    // Batch delete processed queue items
    if (queueIdsToDelete.length > 0) {
      const { error: deleteError } = await supabaseAdmin
        .from('overlap_check_queue')
        .delete()
        .in('id', queueIdsToDelete)

      if (deleteError) {
        console.error('[fill-tree-holes] Queue cleanup error:', deleteError)
      }
    }

    console.log(`[fill-tree-holes] Complete: processed=${stats.processed}, filled=${stats.filled}, skipped=${stats.skipped}`)

    return new Response(JSON.stringify({
      success: true,
      ...stats,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[fill-tree-holes] Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})