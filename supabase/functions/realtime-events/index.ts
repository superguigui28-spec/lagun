import { corsHeaders } from "../_shared/cors.ts";

const SUPERTICKET_BASE = "https://public-api.superticket.com.br";
const PAGE_SIZE = 15;
const ZIG_EVENT_ID = "13195";

interface TokenConfig {
  token: string;
  label: string;
  eventId?: string;
}

async function fetchAllPages(endpoint: string, headers: Record<string, string>, eventId?: string): Promise<any[]> {
  const allData: any[] = [];
  const eventParam = eventId ? `&eventId=${encodeURIComponent(eventId)}` : "";

  const firstRes = await fetch(`${endpoint}?page=1${eventParam}`, { headers });
  if (!firstRes.ok) throw new Error(`API error [${firstRes.status}]: ${await firstRes.text()}`);
  const firstJson = await firstRes.json();
  const firstItems = Array.isArray(firstJson) ? firstJson : (firstJson.data || []);
  allData.push(...firstItems);

  const total = firstJson.total || firstItems.length;
  if (total <= PAGE_SIZE || firstItems.length < PAGE_SIZE) return allData;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  for (let batchStart = 2; batchStart <= totalPages; batchStart += 10) {
    const batchEnd = Math.min(batchStart + 9, totalPages);
    const promises = [];
    for (let p = batchStart; p <= batchEnd; p++) {
      promises.push(
        fetch(`${endpoint}?page=${p}${eventParam}`, { headers })
          .then(r => r.ok ? r.json() : null)
      );
    }
    const results = await Promise.all(promises);
    for (const json of results) {
      if (!json) continue;
      const items = Array.isArray(json) ? json : (json.data || []);
      allData.push(...items);
    }
  }

  return allData;
}

async function fetchForToken(tokenConfig: TokenConfig) {
  const stHeaders = {
    Authorization: `Bearer ${tokenConfig.token}`,
    Accept: "application/json",
  };

  const [tickets, participants, buyers] = await Promise.all([
    fetchAllPages(`${SUPERTICKET_BASE}/tickets`, stHeaders, tokenConfig.eventId),
    fetchAllPages(`${SUPERTICKET_BASE}/participants`, stHeaders, tokenConfig.eventId),
    fetchAllPages(`${SUPERTICKET_BASE}/buyers`, stHeaders, tokenConfig.eventId),
  ]);

  return { tickets, participants, buyers, label: tokenConfig.label };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Collect all configured tokens
    const tokens: TokenConfig[] = [];

    const mainToken = Deno.env.get("SUPERTICKET_API_TOKEN");
    if (mainToken) tokens.push({ token: mainToken, label: "main" });

    const doitToken = Deno.env.get("SUPERTICKET_DOIT_TOKEN");
    if (doitToken) tokens.push({ token: doitToken, label: "doit" });

    const maestriaToken = Deno.env.get("SUPERTICKET_MAESTRIA_TOKEN");
    if (maestriaToken) tokens.push({ token: maestriaToken, label: "maestria" });

    const zigToken = Deno.env.get("SUPERTICKET_ZIG_TOKEN");
    if (zigToken) tokens.push({ token: zigToken, label: "zig", eventId: ZIG_EVENT_ID });

    if (tokens.length === 0) throw new Error("No SuperTicket API tokens configured");

    // Fetch all tokens in parallel
    const results = await Promise.all(tokens.map(fetchForToken));

    // Merge all data
    let allTickets: any[] = [];
    let allParticipants: any[] = [];
    let allBuyers: any[] = [];

    for (const r of results) {
      allTickets = allTickets.concat(r.tickets);
      allParticipants = allParticipants.concat(r.participants);
      allBuyers = allBuyers.concat(r.buyers);
    }

    const checkedIn = allParticipants.filter((p: any) => !!p.checked_in).length;

    // Group tickets by event
    const eventMap = new Map<string, { sold: number; revenue: number; checkedIn: number }>();

    for (const t of allTickets) {
      const name = (t.event_name || "Evento").trim();
      const curr = eventMap.get(name) || { sold: 0, revenue: 0, checkedIn: 0 };
      curr.sold++;
      curr.revenue += Number(t.price || 0);
      eventMap.set(name, curr);
    }

    for (const p of allParticipants) {
      if (!p.checked_in) continue;
      const eventName = (p.event_name || "Evento").trim();
      const curr = eventMap.get(eventName);
      if (curr) curr.checkedIn++;
    }

    const events = Array.from(eventMap.entries()).map(([name, data]) => ({
      name,
      ticketsSold: data.sold,
      revenue: data.revenue,
      checkedIn: data.checkedIn,
    }));

    console.log(`Realtime: ${allTickets.length} tickets, ${allParticipants.length} participants, ${events.length} events from ${tokens.length} tokens`);

    return new Response(
      JSON.stringify({
        totalTickets: allTickets.length,
        totalParticipants: allParticipants.length,
        totalBuyers: allBuyers.length,
        totalCheckedIn: checkedIn,
        events,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Realtime events error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
