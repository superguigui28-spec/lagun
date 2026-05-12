import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPERTICKET_BASE = "https://public-api.superticket.com.br";

async function runFullMaestriaSync() {
  const TOKEN = Deno.env.get("SUPERTICKET_MAESTRIA_TOKEN")!;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const stHeaders = { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" };

  // 1. Fetch ALL tickets from Maestria token (authoritative)
  const apiTickets = new Map<string, any>();
  let page = 1;
  while (true) {
    try {
      const r = await fetch(
        `${SUPERTICKET_BASE}/tickets?page=${page}&perPage=200`,
        { headers: stHeaders }
      );
      if (!r.ok) {
        console.error(`Page ${page} HTTP ${r.status} - retrying once`);
        await new Promise((res) => setTimeout(res, 2000));
        const r2 = await fetch(
          `${SUPERTICKET_BASE}/tickets?page=${page}&perPage=200`,
          { headers: stHeaders }
        );
        if (!r2.ok) {
          console.error(`Page ${page} retry failed - skipping`);
          page++;
          if (page > 100) break;
          continue;
        }
        const j = await r2.json();
        const items = j.data || [];
        if (items.length === 0) break;
        for (const t of items) {
          const tid = String(t.ticket_id || t.id || "");
          if (!tid) continue;
          apiTickets.set(`st:${tid}`, {
            order_id: t.order_id ? `order:${t.order_id}` : null,
            ticket_type: t.ticket_type || null,
            lot_name: t.lot_name || null,
            price: Number(t.price || 0),
            purchase_date: (t.purchase_date || "").split("T")[0] || t.completed_date || null,
            participant: t.participant || null,
            email: t.email || null,
            first_name: t.first_name || null,
            last_name: t.last_name || null,
            event_name: t.event_name || "Maestria",
          });
        }
        if (items.length < 200) break;
      } else {
        const j = await r.json();
        const items = j.data || [];
        if (items.length === 0) break;
        for (const t of items) {
          const tid = String(t.ticket_id || t.id || "");
          if (!tid) continue;
          apiTickets.set(`st:${tid}`, {
            order_id: t.order_id ? `order:${t.order_id}` : null,
            ticket_type: t.ticket_type || null,
            lot_name: t.lot_name || null,
            price: Number(t.price || 0),
            purchase_date: (t.purchase_date || "").split("T")[0] || t.completed_date || null,
            participant: t.participant || null,
            email: t.email || null,
            first_name: t.first_name || null,
            last_name: t.last_name || null,
            event_name: t.event_name || "Maestria",
          });
        }
        if (items.length < 200) break;
      }
      page++;
      if (page > 100) break;
    } catch (e) {
      console.error(`Page ${page} err:`, e);
      page++;
      if (page > 100) break;
    }
  }

  console.log(`✅ API authoritative: ${apiTickets.size} tickets`);

  // 2. Load existing customers once for matching
  const { data: existingCustomers } = await supabase
    .from("crm_customers")
    .select("id, email, full_name");

  const customerByEmail = new Map<string, string>();
  const customerByName = new Map<string, string>();
  for (const c of (existingCustomers || [])) {
    if (c.email) customerByEmail.set(c.email.trim().toLowerCase(), c.id);
    customerByName.set(c.full_name.trim().toLowerCase(), c.id);
  }

  // 3. Ensure fallback customer exists
  let fallbackId: string | null = null;
  const { data: fallbackCustomer } = await supabase
    .from("crm_customers")
    .select("id")
    .eq("full_name", "Maestria - Sem Identificação")
    .maybeSingle();

  if (fallbackCustomer) {
    fallbackId = fallbackCustomer.id;
  } else {
    const { data: createdFallback } = await supabase
      .from("crm_customers")
      .insert({ full_name: "Maestria - Sem Identificação" })
      .select("id")
      .single();
    fallbackId = createdFallback?.id || null;
  }

  // 4. Create missing customers referenced by API tickets
  const newCustomers = new Map<string, { full_name: string; email: string | null }>();
  for (const ticket of apiTickets.values()) {
    const email = (ticket.participant?.email || ticket.email || "").trim().toLowerCase() || null;
    const name = [
      ticket.participant?.first_name || ticket.first_name || "",
      ticket.participant?.last_name || ticket.last_name || "",
    ].join(" ").trim() || "Sem Nome";
    const normalizedName = name.toLowerCase();
    const key = email || `name:${normalizedName}`;

    if (email && customerByEmail.has(email)) continue;
    if (!email && customerByName.has(normalizedName)) continue;
    if (newCustomers.has(key)) continue;

    newCustomers.set(key, { full_name: name, email });
  }

  const newCustomersList = Array.from(newCustomers.values());
  for (let i = 0; i < newCustomersList.length; i += 200) {
    const chunk = newCustomersList.slice(i, i + 200);
    const { data: insertedCustomers, error } = await supabase
      .from("crm_customers")
      .insert(chunk)
      .select("id, email, full_name");

    if (error) {
      console.error("Customer batch insert failed:", error.message);
      continue;
    }

    for (const customer of insertedCustomers || []) {
      if (customer.email) customerByEmail.set(customer.email.trim().toLowerCase(), customer.id);
      customerByName.set(customer.full_name.trim().toLowerCase(), customer.id);
    }
  }

  // 5. Rebuild all Maestria purchases from authoritative API snapshot
  const existingMaestriaIds: string[] = [];
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from("crm_purchases")
      .select("id")
      .ilike("event_name", "maestria")
      .range(from, from + 999);

    if (!data || data.length === 0) break;
    existingMaestriaIds.push(...data.map((row) => row.id));
    if (data.length < 1000) break;
    from += 1000;
  }

  let deleted = 0;
  for (let i = 0; i < existingMaestriaIds.length; i += 500) {
    const chunk = existingMaestriaIds.slice(i, i + 500);
    const { error } = await supabase.from("crm_purchases").delete().in("id", chunk);
    if (!error) deleted += chunk.length;
  }

  const purchases = Array.from(apiTickets.entries()).map(([couponKey, ticket]) => {
    const email = (ticket.participant?.email || ticket.email || "").trim().toLowerCase() || null;
    const name = [
      ticket.participant?.first_name || ticket.first_name || "",
      ticket.participant?.last_name || ticket.last_name || "",
    ].join(" ").trim() || "Sem Nome";
    const customerId = (email && customerByEmail.get(email)) || customerByName.get(name.toLowerCase()) || fallbackId;

    return {
      customer_id: customerId,
      event_name: "Maestria",
      ticket_type: ticket.ticket_type,
      ticket_lot: ticket.lot_name,
      purchase_date: ticket.purchase_date || new Date().toISOString().split("T")[0],
      ticket_price: ticket.price,
      quantity: 1,
      total_value: ticket.price,
      attendance_status: "Pendente",
      acquisition_channel: "SuperTicket",
      coupon_used: couponKey,
      influencer_code: ticket.order_id,
    };
  }).filter((purchase) => Boolean(purchase.customer_id));

  let inserted = 0;
  for (let i = 0; i < purchases.length; i += 200) {
    const chunk = purchases.slice(i, i + 200);
    const { error } = await supabase.from("crm_purchases").insert(chunk);
    if (error) {
      console.error("Purchase batch insert failed:", error.message);
      continue;
    }
    inserted += chunk.length;
  }

  const totalRevenue = purchases.reduce((sum, purchase) => sum + Number(purchase.total_value || 0), 0);
  await supabase
    .from("events")
    .update({
      official_tickets: purchases.length,
      official_revenue: totalRevenue,
      updated_at: new Date().toISOString(),
    })
    .ilike("name", "maestria");

  console.log(`✅ DONE: API=${apiTickets.size} | deleted=${deleted} | inserted=${inserted} | revenue=${totalRevenue}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(runFullMaestriaSync().catch((e) => console.error("BG err:", e)));

  return new Response(
    JSON.stringify({ success: true, message: "Sync started in background. Check logs in ~3-5 min." }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
