import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { batchSize = 200, maxBatches = 50 } = await req.json().catch(() => ({}))

  let totalProcessed = 0
  let totalNew = 0
  let totalPurchases = 0
  let remaining = 0
  let batches = 0
  const start = Date.now()

  for (let i = 0; i < maxBatches; i++) {
    if (Date.now() - start > 50000) break // stop before edge function timeout

    const { data, error } = await supabase.rpc('process_import_batch', { batch_size: batchSize })
    if (error) {
      return new Response(JSON.stringify({ error: error.message, totalProcessed, batches }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    batches++
    totalProcessed += data.processed ?? 0
    totalNew += data.new_customers ?? 0
    totalPurchases += data.purchases_inserted ?? 0
    remaining = data.remaining ?? 0
    if (data.done || data.processed === 0) break
  }

  return new Response(
    JSON.stringify({
      batches,
      totalProcessed,
      totalNew,
      totalPurchases,
      remaining,
      elapsedMs: Date.now() - start,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
