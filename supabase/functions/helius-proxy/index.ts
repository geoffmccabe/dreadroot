import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse({ error: 'No authorization header' }, 401)
    }

    // Service role client for reading secrets
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // User client for auth verification
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: authHeader } },
        auth: { autoRefreshToken: false, persistSession: false },
      }
    )

    // Verify user is authenticated
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    // Check admin role
    const { data: roles, error: roleError } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .in('role', ['admin', 'superadmin'])

    if (roleError || !roles || roles.length === 0) {
      return jsonResponse({ error: 'Forbidden - Admin access required' }, 403)
    }

    const body = await req.json()
    const { action, method, params, network = 'mainnet' } = body

    // --- Action: getKeyStatus ---
    if (action === 'getKeyStatus') {
      const { data, error } = await supabaseAdmin
        .from('app_secrets')
        .select('value, updated_at')
        .eq('key', 'helius_api_key')
        .single()

      if (error || !data) {
        return jsonResponse({ configured: false, lastFour: null, updatedAt: null })
      }

      const val = data.value as string
      return jsonResponse({
        configured: true,
        lastFour: val.slice(-4),
        updatedAt: data.updated_at,
      })
    }

    // --- Action: saveKey ---
    if (action === 'saveKey') {
      const { apiKey } = body
      if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 10) {
        return jsonResponse({ error: 'Invalid API key' }, 400)
      }

      const { error } = await supabaseAdmin
        .from('app_secrets')
        .upsert(
          { key: 'helius_api_key', value: apiKey, provider: 'helius', description: 'Helius RPC & DAS API key' },
          { onConflict: 'key' }
        )

      if (error) {
        console.error('Save key error:', error)
        return jsonResponse({ error: 'Failed to save key' }, 500)
      }

      return jsonResponse({ success: true, lastFour: apiKey.slice(-4) })
    }

    // --- All other actions require the API key ---
    const { data: secretData, error: secretError } = await supabaseAdmin
      .from('app_secrets')
      .select('value')
      .eq('key', 'helius_api_key')
      .single()

    if (secretError || !secretData) {
      return jsonResponse({ error: 'Helius API key not configured' }, 400)
    }

    const apiKey = secretData.value as string
    const rpcHost = network === 'devnet' ? 'devnet.helius-rpc.com' : 'mainnet.helius-rpc.com'
    const rpcUrl = `https://${rpcHost}/?api-key=${apiKey}`

    // --- Action: dasQuery (DAS API JSON-RPC) ---
    if (action === 'dasQuery') {
      if (!method) {
        return jsonResponse({ error: 'Missing method parameter' }, 400)
      }

      const rpcBody = {
        jsonrpc: '2.0',
        id: `helius-proxy-${Date.now()}`,
        method,
        params: params || {},
      }

      const resp = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rpcBody),
      })

      const data = await resp.json()
      return jsonResponse(data)
    }

    // --- Action: enhancedTransactions ---
    if (action === 'enhancedTransactions') {
      const { endpoint, queryParams } = body
      // Enhanced Transactions API uses REST endpoints
      const baseUrl = `https://api.helius.xyz/v0/${endpoint}?api-key=${apiKey}`
      const url = queryParams
        ? `${baseUrl}&${new URLSearchParams(queryParams).toString()}`
        : baseUrl

      if (body.requestBody) {
        // POST request (e.g., parse-transactions)
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body.requestBody),
        })
        const data = await resp.json()
        return jsonResponse(data)
      } else {
        // GET request
        const resp = await fetch(url)
        const data = await resp.json()
        return jsonResponse(data)
      }
    }

    // --- Action: webhooks ---
    if (action === 'webhooks') {
      const { webhookAction, webhookData } = body
      const baseUrl = `https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`

      if (webhookAction === 'list') {
        const resp = await fetch(baseUrl)
        const data = await resp.json()
        return jsonResponse(data)
      }

      if (webhookAction === 'create' && webhookData) {
        const resp = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookData),
        })
        const data = await resp.json()
        return jsonResponse(data)
      }

      if (webhookAction === 'delete' && body.webhookId) {
        const resp = await fetch(`https://api.helius.xyz/v0/webhooks/${body.webhookId}?api-key=${apiKey}`, {
          method: 'DELETE',
        })
        const data = await resp.json()
        return jsonResponse(data)
      }

      return jsonResponse({ error: 'Invalid webhook action' }, 400)
    }

    // --- Action: priorityFees ---
    if (action === 'priorityFees') {
      const rpcBody = {
        jsonrpc: '2.0',
        id: `helius-proxy-${Date.now()}`,
        method: 'getPriorityFeeEstimate',
        params: [params || {}],
      }

      const resp = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rpcBody),
      })

      const data = await resp.json()
      return jsonResponse(data)
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400)

  } catch (error) {
    console.error('Error in helius-proxy:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
