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

  const { batchSize = 100, maxBatches = 200 } = await req.json().catch(() => ({}))

  let totalEmails = 0
  let totalPurchases = 0
  let totalDeleted = 0
  let remaining = 0
  let batches = 0
  const start = Date.now()

  for (let i = 0; i < maxBatches; i++) {
    if (Date.now() - start > 50000) break

    const { data, error } = await supabase.rpc('dedup_customers_batch', { batch_size: batchSize })
    if (error) {
      return new Response(JSON.stringify({ error: error.message, batches, totalEmails, totalDeleted }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    batches++
    totalEmails += data.emails_processed ?? 0
    totalPurchases += data.purchases_moved ?? 0
    totalDeleted += data.customers_deleted ?? 0
    remaining = data.remaining ?? 0
    if (data.done) break
  }

  return new Response(
    JSON.stringify({ batches, totalEmails, totalPurchases, totalDeleted, remaining, elapsedMs: Date.now() - start }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
