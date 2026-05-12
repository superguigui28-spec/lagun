import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { event_name, event_category, rows } = await req.json();

    if (!event_name || !rows || rows.length === 0) {
      return new Response(JSON.stringify({ error: "Missing event_name or rows" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (event_category) {
      await supabase.from("event_categories").upsert(
        { event_name, category: event_category },
        { onConflict: "event_name" }
      );
    }

    // Parse rows
    interface ParsedRow {
      buyerName: string; buyerEmail: string; buyerPhone: string | null;
      city: string | null; state: string | null; neighborhood: string | null;
      ticketCode: string | null; purchaseDate: string; ticketPrice: number;
      attendanceStatus: string; ticketType: string | null; ticketLot: string | null;
      channel: string | null; promoterCode: string | null; coupon: string | null;
    }

    const getVal = (row: Record<string, string>, ...keys: string[]) => {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") return String(row[k]).trim();
      }
      return null;
    };

    const parsedRows: ParsedRow[] = [];
    const uniqueEmails = new Set<string>();
    let skipped = 0;

    for (const row of rows) {
      const buyerName = getVal(row, "Nome do Comprador");
      const buyerEmail = getVal(row, "Email do Comprador")?.toLowerCase() || null;
      const status = getVal(row, "Status da compra");

      if (!buyerName || !buyerEmail || !(status || "").toLowerCase().trim().startsWith("finaliza")) {
        skipped++;
        continue;
      }

      const rawDate = getVal(row, "Data da compra") || "";
      let purchaseDate = new Date().toISOString().split("T")[0];
      if (rawDate) {
        const parts = rawDate.split(" ")[0]?.split("/");
        if (parts && parts.length === 3) purchaseDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }

      const rawPrice = getVal(row, "Valor do ingresso");
      const ticketPrice = rawPrice ? parseFloat(String(rawPrice).replace(",", ".")) : 0;
      const checkin = getVal(row, "Checkin");
      const attendanceStatus = checkin === "Realizado" ? "Compareceu" : checkin === "Não Realizado" ? "Não Compareceu" : "Pendente";

      uniqueEmails.add(buyerEmail);
      parsedRows.push({
        buyerName, buyerEmail,
        buyerPhone: getVal(row, "Telefone do Comprador"),
        city: getVal(row, "Cidade do Comprador"),
        state: getVal(row, "Estado do Comprador"),
        neighborhood: getVal(row, "Bairro do Comprador"),
        ticketCode: getVal(row, "Código do ingresso"),
        purchaseDate, ticketPrice, attendanceStatus,
        ticketType: getVal(row, "Tipo do Ingresso"),
        ticketLot: getVal(row, "Lote"),
        channel: getVal(row, "Canal de Compra"),
        promoterCode: getVal(row, "Código do Promotor"),
        coupon: getVal(row, "Código do Cupom"),
      });
    }

    // Batch fetch existing customers
    const emailList = Array.from(uniqueEmails);
    const customerByEmail = new Map<string, string>();
    for (let i = 0; i < emailList.length; i += 200) {
      const batch = emailList.slice(i, i + 200);
      const { data } = await supabase.from("crm_customers").select("id, email").in("email", batch);
      for (const c of (data || [])) {
        if (c.email) customerByEmail.set(c.email, c.id);
      }
    }

    // Batch insert new customers
    const newCustomersMap = new Map<string, any>();
    for (const r of parsedRows) {
      if (customerByEmail.has(r.buyerEmail) || newCustomersMap.has(r.buyerEmail)) continue;
      newCustomersMap.set(r.buyerEmail, {
        full_name: r.buyerName, email: r.buyerEmail,
        phone: r.buyerPhone, city: r.city, state: r.state, neighborhood: r.neighborhood,
      });
    }

    let customersCreated = 0;
    const newList = Array.from(newCustomersMap.values());
    for (let i = 0; i < newList.length; i += 50) {
      const chunk = newList.slice(i, i + 50);
      const { data: inserted, error } = await supabase.from("crm_customers").insert(chunk).select("id, email");
      if (error) {
        for (const c of chunk) {
          const { data: s, error: e } = await supabase.from("crm_customers").insert(c).select("id, email").single();
          if (!e && s?.email) { customerByEmail.set(s.email, s.id); customersCreated++; }
        }
      } else if (inserted) {
        for (const c of inserted) {
          if (c.email) customerByEmail.set(c.email, c.id);
          customersCreated++;
        }
      }
    }

    // Update existing customers
    let customersUpdated = 0;
    const updated = new Set<string>();
    for (const r of parsedRows) {
      const cid = customerByEmail.get(r.buyerEmail);
      if (!cid || newCustomersMap.has(r.buyerEmail) || updated.has(cid)) continue;
      if (r.buyerPhone || r.city || r.state || r.neighborhood) {
        const d: Record<string, string> = {};
        if (r.buyerPhone) d.phone = r.buyerPhone;
        if (r.city) d.city = r.city;
        if (r.state) d.state = r.state;
        if (r.neighborhood) d.neighborhood = r.neighborhood;
        await supabase.from("crm_customers").update(d).eq("id", cid);
        updated.add(cid);
        customersUpdated++;
      }
    }

    // Dedup existing purchases
    const existingCodes = new Set<string>();
    const codes = parsedRows.map(r => r.ticketCode).filter(Boolean) as string[];
    for (let i = 0; i < codes.length; i += 200) {
      const batch = codes.slice(i, i + 200);
      const { data } = await supabase.from("crm_purchases").select("coupon_used")
        .eq("event_name", event_name).in("coupon_used", batch);
      for (const p of (data || [])) {
        if (p.coupon_used) existingCodes.add(p.coupon_used);
      }
    }

    // Batch insert purchases
    const purchases: any[] = [];
    for (const r of parsedRows) {
      if (r.ticketCode && existingCodes.has(r.ticketCode)) { skipped++; continue; }
      const cid = customerByEmail.get(r.buyerEmail);
      if (!cid) { skipped++; continue; }
      purchases.push({
        customer_id: cid, event_name,
        purchase_date: r.purchaseDate,
        ticket_type: r.ticketType, ticket_lot: r.ticketLot,
        ticket_price: r.ticketPrice, quantity: 1, total_value: r.ticketPrice,
        acquisition_channel: r.channel, attendance_status: r.attendanceStatus,
        coupon_used: r.ticketCode || null, influencer_code: r.promoterCode,
        campaign_origin: r.coupon,
      });
    }

    let purchasesCreated = 0;
    for (let i = 0; i < purchases.length; i += 50) {
      const chunk = purchases.slice(i, i + 50);
      const { error } = await supabase.from("crm_purchases").insert(chunk);
      if (error) {
        for (const p of chunk) {
          const { error: e } = await supabase.from("crm_purchases").insert(p);
          if (!e) purchasesCreated++;
        }
      } else {
        purchasesCreated += chunk.length;
      }
    }

    return new Response(JSON.stringify({
      customersCreated, customersUpdated, purchasesCreated, skipped,
      processedRows: parsedRows.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Import error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
