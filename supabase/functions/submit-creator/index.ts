import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const {
      full_name, email, whatsapp, instagram, tiktok,
      followers_instagram, followers_tiktok, video_skill,
      music_style, motivation, expected_value, qualification,
      qualification_score, city,
    } = body;

    // Validate required fields
    if (!full_name || typeof full_name !== "string" || full_name.trim().length < 2 || full_name.trim().length > 200) {
      return new Response(JSON.stringify({ error: "Nome inválido." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: "Email inválido." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!whatsapp || typeof whatsapp !== "string" || whatsapp.trim().length < 8) {
      return new Response(JSON.stringify({ error: "WhatsApp inválido." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!instagram || typeof instagram !== "string" || instagram.trim().length < 1) {
      return new Response(JSON.stringify({ error: "Instagram inválido." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!video_skill || !music_style || !motivation) {
      return new Response(JSON.stringify({ error: "Preencha todos os campos obrigatórios." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: inserted, error } = await supabase.from("crm_creators").insert({
      full_name: full_name.trim(),
      email: email.trim(),
      whatsapp: whatsapp.trim(),
      instagram: instagram.trim(),
      tiktok: tiktok?.trim() || null,
      followers_instagram: parseInt(String(followers_instagram)) || 0,
      followers_tiktok: parseInt(String(followers_tiktok)) || 0,
      video_skill: String(video_skill).slice(0, 100),
      music_style: String(music_style).slice(0, 100),
      motivation: String(motivation).slice(0, 2000),
      expected_value: parseInt(String(expected_value)) || 0,
      qualification: String(qualification || "🧪 Em Observação").slice(0, 100),
      qualification_score: parseInt(String(qualification_score)) || 0,
      city: String(city || "").trim().slice(0, 100),
    }).select("id").single();

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, creator_id: inserted?.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Submit creator error:", err);
    return new Response(JSON.stringify({ error: "Erro interno." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
