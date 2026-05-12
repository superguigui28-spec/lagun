import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Troca o code do OAuth Instagram Business Login por access token
// e vincula a conta IG ao creator
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { code, redirect_uri, creator_id } = await req.json();

    if (!code || !redirect_uri || !creator_id) {
      return new Response(JSON.stringify({ error: "Missing parameters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const IG_APP_ID = Deno.env.get("INSTAGRAM_APP_ID");
    const IG_APP_SECRET = Deno.env.get("INSTAGRAM_APP_SECRET");
    if (!IG_APP_ID || !IG_APP_SECRET) {
      return new Response(JSON.stringify({ error: "Instagram app not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Trocar code por short-lived token
    const tokenForm = new FormData();
    tokenForm.append("client_id", IG_APP_ID);
    tokenForm.append("client_secret", IG_APP_SECRET);
    tokenForm.append("grant_type", "authorization_code");
    tokenForm.append("redirect_uri", redirect_uri);
    tokenForm.append("code", code);

    const shortResp = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      body: tokenForm,
    });
    const shortData = await shortResp.json();
    if (!shortResp.ok || shortData.error_type) {
      console.error("IG short token error", shortData);
      return new Response(JSON.stringify({ error: shortData.error_message || "Token exchange failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shortToken: string = shortData.access_token;
    const igUserId: string = String(shortData.user_id);

    // 2. Trocar por long-lived token (60 dias)
    const longResp = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${IG_APP_SECRET}&access_token=${shortToken}`
    );
    const longData = await longResp.json();
    const longToken: string = longData.access_token || shortToken;
    const expiresIn: number = longData.expires_in || 60 * 24 * 60 * 60;

    // 3. Buscar info do perfil
    const profileResp = await fetch(
      `https://graph.instagram.com/v23.0/me?fields=id,username,account_type,profile_picture_url,followers_count,media_count&access_token=${longToken}`
    );
    const profile = await profileResp.json();
    if (!profileResp.ok) {
      console.error("IG profile error", profile);
    }

    // 4. Salvar no banco
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const { error: upsertErr } = await supabase
      .from("creator_instagram_accounts")
      .upsert({
        creator_id,
        instagram_user_id: igUserId,
        username: profile.username || "",
        profile_picture_url: profile.profile_picture_url || null,
        account_type: profile.account_type || null,
        access_token: longToken,
        token_expires_at: expiresAt,
        followers_count: profile.followers_count || 0,
        media_count: profile.media_count || 0,
        status: "active",
        connected_at: new Date().toISOString(),
      }, { onConflict: "instagram_user_id" });

    if (upsertErr) {
      console.error("Upsert error", upsertErr);
      return new Response(JSON.stringify({ error: upsertErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      username: profile.username,
      followers_count: profile.followers_count || 0,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("OAuth exchange error", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
