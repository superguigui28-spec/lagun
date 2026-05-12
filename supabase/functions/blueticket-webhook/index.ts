import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let payload: any;

    if (req.method === "POST" || req.method === "PUT") {
      const contentType = req.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        payload = await req.json();
      } else if (contentType.includes("form")) {
        const formData = await req.formData();
        payload = Object.fromEntries(formData.entries());
      } else {
        payload = { raw: await req.text() };
      }
    } else if (req.method === "GET") {
      const url = new URL(req.url);
      payload = Object.fromEntries(url.searchParams.entries());
    } else {
      payload = { method: req.method };
    }

    // Add request metadata
    const logEntry = {
      payload,
      headers: Object.fromEntries(req.headers.entries()),
      method: req.method,
      timestamp: new Date().toISOString(),
    };

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error } = await supabase.from("webhook_logs").insert({
      source: "blueticket",
      payload: logEntry,
    });

    if (error) {
      console.error("Error saving webhook log:", error);
    }

    console.log("Blueticket webhook received:", JSON.stringify(logEntry).slice(0, 500));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
