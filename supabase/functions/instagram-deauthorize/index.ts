import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Webhook chamado pelo Instagram quando o usuário desautoriza o app
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
      const signedRequest = String(form.get("signed_request") || "");
      payload = { signed_request: signedRequest };
    }

    console.log("Deauthorize webhook payload:", JSON.stringify(payload));

    // O Instagram envia signed_request com user_id. Aqui marcamos a conta como revoked.
    // Para simplificar, marcamos todas as contas como inativas se o user_id puder ser identificado.
    const userId = payload.user_id || payload.instagram_user_id;

    if (userId) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await supabase
        .from("creator_instagram_accounts")
        .update({ status: "revoked" })
        .eq("instagram_user_id", String(userId));
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Deauthorize error:", err);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
