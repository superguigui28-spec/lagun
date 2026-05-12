import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPERTICKET_BASE = "https://public-api.superticket.com.br";
const PAGE_SIZE = 200; // Maximize per-page to reduce request count (was 15)
const ZIG_EVENT_ID = "13195";

/**
 * Fetch pages from SuperTicket API.
 * - Uses perPage=200 to drastically reduce HTTP calls
 * - When `stopOnKnownId` is provided, stops as soon as a known ticket coupon key is seen
 *   (ordered desc by created_at so newest comes first => incremental sync)
 */
async function fetchAllPages(
  endpoint: string,
  headers: Record<string, string>,
  opts: { stopOnKnownIds?: Set<string>; orderDesc?: boolean; eventId?: string } = {}
): Promise<any[]> {
  const allData: any[] = [];
  const orderParam = opts.orderDesc
    ? "&orderBy=created_at&orderByDirection=desc"
    : "";
  const eventParam = opts.eventId ? `&eventId=${encodeURIComponent(opts.eventId)}` : "";

  let page = 1;
  while (true) {
    const url = `${endpoint}?page=${page}&perPage=${PAGE_SIZE}${orderParam}${eventParam}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`API error [${res.status}] page ${page}: ${txt.slice(0, 200)}`);
    }
    const json = await res.json();
    const items = Array.isArray(json) ? json : (json.data || []);
    if (items.length === 0) break;

    allData.push(...items);

    // Incremental early-exit: if we hit known ticket(s), stop
    if (opts.stopOnKnownIds && opts.stopOnKnownIds.size > 0) {
      const hitKnown = items.some((t: any) => {
        const id = String(t.ticket_id || t.id || "");
        return id && opts.stopOnKnownIds!.has(`st:${id}`);
      });
      if (hitKnown) {
        console.log(`  → early exit at page ${page} (hit known ticket)`);
        break;
      }
    }

    if (items.length < PAGE_SIZE) break;
    page++;

    // Safety: max 100 pages = 20k items per token per run
    if (page > 100) {
      console.warn(`  → safety stop at page ${page}`);
      break;
    }
  }

  return allData;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const tokenFilter = url.searchParams.get("token");
    const fullSync = url.searchParams.get("full") === "1";

    const tokensList: { token: string; label: string; eventId?: string }[] = [];
    const mainTok = Deno.env.get("SUPERTICKET_API_TOKEN");
    if (mainTok) tokensList.push({ token: mainTok, label: "main" });
    const doitTok = Deno.env.get("SUPERTICKET_DOIT_TOKEN");
    if (doitTok) tokensList.push({ token: doitTok, label: "doit" });
    const maestriaTok = Deno.env.get("SUPERTICKET_MAESTRIA_TOKEN");
    if (maestriaTok) tokensList.push({ token: maestriaTok, label: "maestria" });
    const zigTok = Deno.env.get("SUPERTICKET_ZIG_TOKEN");
    if (zigTok) tokensList.push({ token: zigTok, label: "zig", eventId: ZIG_EVENT_ID });

    const filteredTokens = tokenFilter
      ? tokensList.filter((t) => t.label === tokenFilter)
      : tokensList;

    if (filteredTokens.length === 0) throw new Error(`No SuperTicket tokens matched filter='${tokenFilter}'`);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Pre-load known ticket coupon keys for incremental early-exit
    const { data: existingPurchases } = await supabaseAdmin
      .from("crm_purchases").select("coupon_used");
    const existingTicketIds = new Set<string>();
    for (const p of (existingPurchases || [])) {
      if (p.coupon_used) existingTicketIds.add(p.coupon_used);
    }
    const stopSet = fullSync ? undefined : existingTicketIds;
    console.log(`Incremental mode: ${!fullSync} (${existingTicketIds.size} known tickets)`);

    // Fetch from all tokens in parallel
    const tickets: any[] = [];
    const participants: any[] = [];
    const buyers: any[] = [];

    const perToken = await Promise.all(filteredTokens.map(async (t) => {
      const stHeaders = { Authorization: `Bearer ${t.token}`, Accept: "application/json" };
      try {
        const [tk, pa, bu] = await Promise.all([
          fetchAllPages(`${SUPERTICKET_BASE}/tickets`, stHeaders, {
            stopOnKnownIds: stopSet,
            orderDesc: true,
            eventId: t.eventId,
          }),
          fetchAllPages(`${SUPERTICKET_BASE}/participants`, stHeaders, { eventId: t.eventId }),
          fetchAllPages(`${SUPERTICKET_BASE}/buyers`, stHeaders, { eventId: t.eventId }),
        ]);
        console.log(`[${t.label}] ${tk.length} tickets / ${pa.length} participants / ${bu.length} buyers`);
        return { tk, pa, bu };
      } catch (e: any) {
        console.error(`[${t.label}] failed: ${e.message}`);
        return { tk: [], pa: [], bu: [] };
      }
    }));
    for (const r of perToken) {
      tickets.push(...r.tk);
      participants.push(...r.pa);
      buyers.push(...r.bu);
    }

    console.log(`Fetched ${tickets.length} tickets, ${participants.length} participants, ${buyers.length} buyers`);

    // Build participant check-in map
    const checkedInMap = new Map<string, boolean>();
    for (const p of participants) {
      const code = p.access_code || "";
      if (code) checkedInMap.set(code, !!p.checked_in);
    }

    // Build buyer phone map: buyer email/name -> phone
    const buyerPhoneByEmail = new Map<string, string>();
    const buyerPhoneByName = new Map<string, string>();
    for (const b of buyers) {
      const phone = b.phone || null;
      if (!phone) continue;
      const cleanPhone = phone.replace(/\D/g, '');
      const normalizedPhone = cleanPhone.startsWith('55') && cleanPhone.length >= 12
        ? cleanPhone.substring(2)
        : cleanPhone;

      if (b.email) buyerPhoneByEmail.set(b.email, normalizedPhone);
      if (b.name) buyerPhoneByName.set(b.name.trim(), normalizedPhone);
    }

    console.log(`Built phone maps: ${buyerPhoneByEmail.size} by email, ${buyerPhoneByName.size} by name`);

    // Get all existing customers for fast dedup
    const { data: existingCustomers } = await supabaseAdmin
      .from("crm_customers").select("id, email, full_name, phone");

    const customerByEmail = new Map<string, string>();
    const customerByName = new Map<string, string>();
    for (const c of (existingCustomers || [])) {
      if (c.email) customerByEmail.set(c.email, c.id);
      customerByName.set(c.full_name, c.id);
    }

    // Collect new customers
    const newCustomersMap = new Map<string, { full_name: string; email: string | null; phone: string | null }>();
    for (const ticket of tickets) {
      const email = ticket.participant?.email || ticket.email || null;
      const name = [
        ticket.participant?.first_name || ticket.first_name || "",
        ticket.participant?.last_name || ticket.last_name || ""
      ].join(" ").trim() || "Sem Nome";

      const key = email || `name:${name}`;
      if (email && customerByEmail.has(email)) continue;
      if (!email && customerByName.has(name)) continue;
      if (newCustomersMap.has(key)) continue;

      const phone = (email && buyerPhoneByEmail.get(email)) || buyerPhoneByName.get(name) || null;
      newCustomersMap.set(key, { full_name: name, email, phone });
    }

    let customersCreated = 0;
    const newCustomersList = Array.from(newCustomersMap.values());

    if (newCustomersList.length > 0) {
      for (let i = 0; i < newCustomersList.length; i += 100) {
        const chunk = newCustomersList.slice(i, i + 100);
        const { data: inserted, error } = await supabaseAdmin
          .from("crm_customers")
          .insert(chunk)
          .select("id, email, full_name");

        if (error) {
          console.error("Batch customer insert error:", error.message);
          for (const c of chunk) {
            const { data: single, error: sErr } = await supabaseAdmin
              .from("crm_customers")
              .insert(c)
              .select("id, email, full_name")
              .single();
            if (!sErr && single) {
              if (single.email) customerByEmail.set(single.email, single.id);
              customerByName.set(single.full_name, single.id);
              customersCreated++;
            }
          }
        } else if (inserted) {
          for (const c of inserted) {
            if (c.email) customerByEmail.set(c.email, c.id);
            customerByName.set(c.full_name, c.id);
            customersCreated++;
          }
        }
      }
    }

    // Update existing customers missing phone
    let phonesUpdated = 0;
    for (const c of (existingCustomers || [])) {
      if (c.phone) continue;
      const phone = (c.email && buyerPhoneByEmail.get(c.email)) || buyerPhoneByName.get(c.full_name) || null;
      if (!phone) continue;

      const { error } = await supabaseAdmin
        .from("crm_customers")
        .update({ phone })
        .eq("id", c.id);
      if (!error) phonesUpdated++;
    }

    // Build purchases - dedupe by ticket_id across runs AND across tokens (Maestria/Zig overlap)
    const purchasesToInsert: any[] = [];
    const seenInThisRun = new Set<string>();
    for (const ticket of tickets) {
      const ticketExternalId = String(ticket.ticket_id || ticket.id || "");
      const couponKey = ticketExternalId ? `st:${ticketExternalId}` : null;
      if (!couponKey) continue;
      if (seenInThisRun.has(couponKey)) continue;
      seenInThisRun.add(couponKey);
      if (existingTicketIds.has(couponKey)) continue;
      existingTicketIds.add(couponKey);

      const email = ticket.participant?.email || ticket.email || null;
      const name = [
        ticket.participant?.first_name || ticket.first_name || "",
        ticket.participant?.last_name || ticket.last_name || ""
      ].join(" ").trim() || "Sem Nome";

      const customerId = (email && customerByEmail.get(email)) || customerByName.get(name);
      if (!customerId) continue;

      const ticketCode = ticket.ticket_code || ticket.id || "";
      const isCheckedIn = checkedInMap.get(ticketCode) || false;
      const rawEventName = (ticket.event_name || "Evento SuperTicket").trim();
      const normalizedEventName = rawEventName.toLowerCase() === "maestria" ? "Maestria" : rawEventName;
      const ticketPrice = Number(ticket.price || 0);
      const purchaseDate = ticket.purchase_date
        ? ticket.purchase_date.split("T")[0]
        : (ticket.completed_date || new Date().toISOString().split("T")[0]);

      purchasesToInsert.push({
        customer_id: customerId,
        event_name: normalizedEventName,
        ticket_type: ticket.ticket_type || null,
        ticket_lot: ticket.lot_name || null,
        purchase_date: purchaseDate,
        ticket_price: ticketPrice,
        quantity: 1,
        total_value: ticketPrice,
        attendance_status: isCheckedIn ? "Compareceu" : "Pendente",
        acquisition_channel: "SuperTicket",
        coupon_used: couponKey,
        // group tickets into orders via influencer_code (repurposed)
        influencer_code: ticket.order_id ? `order:${ticket.order_id}` : null,
      });
    }

    let purchasesCreated = 0;
    for (let i = 0; i < purchasesToInsert.length; i += 100) {
      const chunk = purchasesToInsert.slice(i, i + 100);
      const { error } = await supabaseAdmin.from("crm_purchases").insert(chunk);
      if (error) {
        console.error("Batch purchase insert error:", error.message);
        for (const p of chunk) {
          const { error: sErr } = await supabaseAdmin.from("crm_purchases").insert(p);
          if (!sErr) purchasesCreated++;
        }
      } else {
        purchasesCreated += chunk.length;
      }
    }

    console.log(`Done: ${customersCreated} customers, ${purchasesCreated} purchases, ${phonesUpdated} phones updated`);

    return new Response(
      JSON.stringify({
        success: true,
        mode: fullSync ? "full" : "incremental",
        customersCreated,
        purchasesCreated,
        phonesUpdated,
        totalTicketsFetched: tickets.length,
        totalParticipantsFetched: participants.length,
        totalBuyersFetched: buyers.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Sync error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
