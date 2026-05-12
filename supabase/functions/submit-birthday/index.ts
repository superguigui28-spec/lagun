import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { full_name, email, whatsapp, birth_date, cpf, coupon } = body;

    // Validate required fields
    if (!full_name || typeof full_name !== "string" || full_name.trim().length < 2 || full_name.trim().length > 200) {
      return new Response(JSON.stringify({ error: "Nome inválido." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!whatsapp || typeof whatsapp !== "string" || !/^\d{10,13}$/.test(whatsapp.replace(/\D/g, ""))) {
      return new Response(JSON.stringify({ error: "WhatsApp inválido." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!coupon || typeof coupon !== "string" || coupon.trim().length < 3 || coupon.trim().length > 50) {
      return new Response(JSON.stringify({ error: "Cupom inválido." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!birth_date || typeof birth_date !== "string") {
      return new Response(JSON.stringify({ error: "Data de nascimento inválida." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (cpf && (typeof cpf !== "string" || !/^\d{11}$/.test(cpf))) {
      return new Response(JSON.stringify({ error: "CPF inválido." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (email && (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return new Response(JSON.stringify({ error: "Email inválido." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check duplicate coupon
    const { data: existing } = await supabase
      .from("maestria_birthday")
      .select("id")
      .eq("coupon", coupon.trim())
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ error: "Este cupom já foi cadastrado." }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error } = await supabase.from("maestria_birthday").insert({
      full_name: full_name.trim(),
      email: email?.trim() || null,
      whatsapp: whatsapp.replace(/\D/g, ""),
      birth_date,
      cpf: cpf || null,
      coupon: coupon.trim(),
    });

    if (error) {
      if (error.code === "23505") {
        return new Response(JSON.stringify({ error: "Este cupom já foi cadastrado." }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw error;
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Submit birthday error:", err);
    return new Response(JSON.stringify({ error: "Erro interno." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
