import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { bucket, path, event_name, event_category, offset = 0, limit = 1000 } = await req.json();

    // Download file from storage
    const { data: fileData, error: dlErr } = await supabase.storage.from(bucket).download(path);
    if (dlErr || !fileData) {
      return new Response(JSON.stringify({ error: "File download failed" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const buffer = await fileData.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const allRows: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const rows = allRows.slice(offset, offset + limit);

    if (event_category && offset === 0) {
      await supabase.from("event_categories").upsert(
        { event_name, category: event_category },
        { onConflict: "event_name" }
      );
    }

    const getVal = (row: Record<string, string>, ...keys: string[]) => {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") return String(row[k]).trim();
      }
      return null;
    };

    // --- PHASE 1: Parse all rows and collect unique emails ---
    const parsedRows: {
      buyerName: string; buyerEmail: string; buyerPhone: string | null;
      city: string | null; state: string | null; neighborhood: string | null;
      ticketCode: string | null; purchaseDate: string; ticketPrice: number;
      attendanceStatus: string; ticketType: string | null; ticketLot: string | null;
      channel: string | null; promoterCode: string | null; coupon: string | null;
    }[] = [];

    let skipped = 0;
    const uniqueEmails = new Set<string>();

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

    console.log(`Parsed ${parsedRows.length} valid rows, ${skipped} skipped, ${uniqueEmails.size} unique emails`);

    // --- PHASE 2: Batch fetch existing customers by email ---
    const emailList = Array.from(uniqueEmails);
    const customerByEmail = new Map<string, string>();

    // Fetch in batches of 200 (Supabase IN limit)
    for (let i = 0; i < emailList.length; i += 200) {
      const batch = emailList.slice(i, i + 200);
      const { data } = await supabase.from("crm_customers").select("id, email").in("email", batch);
      for (const c of (data || [])) {
        if (c.email) customerByEmail.set(c.email, c.id);
      }
    }

    console.log(`Found ${customerByEmail.size} existing customers`);

    // --- PHASE 3: Batch insert new customers ---
    const newCustomersMap = new Map<string, { full_name: string; email: string; phone: string | null; city: string | null; state: string | null; neighborhood: string | null }>();
    
    for (const r of parsedRows) {
      if (customerByEmail.has(r.buyerEmail)) continue;
      if (newCustomersMap.has(r.buyerEmail)) continue;
      newCustomersMap.set(r.buyerEmail, {
        full_name: r.buyerName, email: r.buyerEmail,
        phone: r.buyerPhone, city: r.city, state: r.state, neighborhood: r.neighborhood,
      });
    }

    let customersCreated = 0;
    const newCustomersList = Array.from(newCustomersMap.values());

    for (let i = 0; i < newCustomersList.length; i += 50) {
      const chunk = newCustomersList.slice(i, i + 50);
      const { data: inserted, error } = await supabase.from("crm_customers").insert(chunk).select("id, email");
      if (error) {
        console.error("Batch customer insert error:", error.message);
        // Fallback: insert one by one
        for (const c of chunk) {
          const { data: single, error: sErr } = await supabase.from("crm_customers")
            .insert(c).select("id, email").single();
          if (!sErr && single) {
            if (single.email) customerByEmail.set(single.email, single.id);
            customersCreated++;
          }
        }
      } else if (inserted) {
        for (const c of inserted) {
          if (c.email) customerByEmail.set(c.email, c.id);
          customersCreated++;
        }
      }
    }

    // --- PHASE 4: Update existing customers with address/phone data ---
    let customersUpdated = 0;
    const updateMap = new Map<string, { phone?: string | null; city?: string | null; state?: string | null; neighborhood?: string | null }>();
    
    for (const r of parsedRows) {
      const cid = customerByEmail.get(r.buyerEmail);
      if (!cid || newCustomersMap.has(r.buyerEmail)) continue;
      if (updateMap.has(cid)) continue;
      if (r.buyerPhone || r.city || r.state || r.neighborhood) {
        updateMap.set(cid, { phone: r.buyerPhone, city: r.city, state: r.state, neighborhood: r.neighborhood });
      }
    }

    for (const [cid, data] of updateMap) {
      const cleanData: Record<string, string> = {};
      for (const [k, v] of Object.entries(data)) {
        if (v) cleanData[k] = v;
      }
      if (Object.keys(cleanData).length > 0) {
        await supabase.from("crm_customers").update(cleanData).eq("id", cid);
        customersUpdated++;
      }
    }

    // --- PHASE 5: Batch fetch existing purchases for dedup ---
    const existingTicketCodes = new Set<string>();
    const ticketCodesToCheck = parsedRows.map(r => r.ticketCode).filter(Boolean) as string[];

    for (let i = 0; i < ticketCodesToCheck.length; i += 200) {
      const batch = ticketCodesToCheck.slice(i, i + 200);
      const { data } = await supabase.from("crm_purchases").select("coupon_used")
        .eq("event_name", event_name).in("coupon_used", batch);
      for (const p of (data || [])) {
        if (p.coupon_used) existingTicketCodes.add(p.coupon_used);
      }
    }

    console.log(`Found ${existingTicketCodes.size} existing ticket codes for dedup`);

    // --- PHASE 6: Batch insert purchases ---
    const purchasesToInsert: any[] = [];

    for (const r of parsedRows) {
      if (r.ticketCode && existingTicketCodes.has(r.ticketCode)) {
        skipped++;
        continue;
      }

      const customerId = customerByEmail.get(r.buyerEmail);
      if (!customerId) { skipped++; continue; }

      purchasesToInsert.push({
        customer_id: customerId, event_name,
        purchase_date: r.purchaseDate,
        ticket_type: r.ticketType, ticket_lot: r.ticketLot,
        ticket_price: r.ticketPrice, quantity: 1, total_value: r.ticketPrice,
        acquisition_channel: r.channel, attendance_status: r.attendanceStatus,
        coupon_used: r.ticketCode || null, influencer_code: r.promoterCode,
        campaign_origin: r.coupon,
      });
    }

    let purchasesCreated = 0;
    for (let i = 0; i < purchasesToInsert.length; i += 50) {
      const chunk = purchasesToInsert.slice(i, i + 50);
      const { error } = await supabase.from("crm_purchases").insert(chunk);
      if (error) {
        console.error("Batch purchase insert error:", error.message);
        for (const p of chunk) {
          const { error: sErr } = await supabase.from("crm_purchases").insert(p);
          if (!sErr) purchasesCreated++;
        }
      } else {
        purchasesCreated += chunk.length;
      }
    }

    console.log(`Done chunk [${offset}-${offset + limit}]: ${customersCreated} created, ${customersUpdated} updated, ${purchasesCreated} purchases`);

    return new Response(JSON.stringify({
      totalRows: allRows.length, processedChunk: rows.length,
      offset, nextOffset: offset + limit < allRows.length ? offset + limit : null,
      customersCreated, customersUpdated, purchasesCreated, skipped,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Process error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
