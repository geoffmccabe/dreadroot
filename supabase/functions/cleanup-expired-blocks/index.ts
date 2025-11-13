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
    // Create service role client to call the function
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

    console.log('Starting expired blocks cleanup...')

    // Call the delete_expired_blocks() database function
    const { data, error } = await supabaseAdmin.rpc('delete_expired_blocks')

    if (error) {
      console.error('Error calling delete_expired_blocks:', error)
      throw error
    }

    const deletedCount = data || 0
    console.log(`Cleanup complete. Deleted ${deletedCount} expired blocks`)

    return new Response(JSON.stringify({ 
      success: true,
      deleted_count: deletedCount,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error in cleanup-expired-blocks:', error)
    return new Response(JSON.stringify({ 
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
