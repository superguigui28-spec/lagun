import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Endpoint exigido pelo Instagram para solicitação de exclusão de dados do usuário
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let payload: Record<string, unknown> = {};
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      payload = await req.json();
    } else {
      const form = await req.formData();
      payload = { signed_request: String(form.get("signed_request") || "") };
    }

    const userId = payload.user_id || payload.instagram_user_id;
    const confirmationCode = `del-${crypto.randomUUID()}`;

    if (userId) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      // Apaga todas as detecções de conteúdo e a conta IG
      const { data: account } = await supabase
        .from("creator_instagram_accounts")
        .select("id")
        .eq("instagram_user_id", String(userId))
        .maybeSingle();

      if (account) {
        await supabase.from("creator_content_detections").delete().eq("instagram_account_id", account.id);
        await supabase.from("creator_instagram_accounts").delete().eq("id", account.id);
      }
    }

    // Resposta exigida pela Meta
    return new Response(JSON.stringify({
      url: `https://triadentretenimento.com.br/data-deletion-status?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Data deletion error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
