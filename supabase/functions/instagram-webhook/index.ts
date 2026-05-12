import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERIFY_TOKEN = Deno.env.get("INSTAGRAM_VERIFY_TOKEN") || "triade_instagram_verify_2024";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // GET = Meta webhook verification
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Instagram webhook verified successfully");
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // POST = incoming message/event from Meta
  if (req.method === "POST") {
    try {
      const body = await req.json();
      console.log("IG Webhook received:", JSON.stringify(body).slice(0, 800));

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const entry = body?.entry?.[0];
      if (!entry) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Instagram messaging webhooks come under entry[].messaging
      const messagingEvents = entry.messaging || [];

      for (const event of messagingEvents) {
        const senderId = event.sender?.id;
        const recipientId = event.recipient?.id;
        const timestamp = event.timestamp;

        if (!senderId) continue;

        // Determine if this is from us (our IG account) or from the user
        // We need to check if sender is our IG business account
        // recipientId = our account when receiving, senderId = our account when sending
        // For incoming messages: sender = user, recipient = us
        // For message echoes: sender = us, recipient = user

        if (event.message) {
          const msg = event.message;
          const isEcho = msg.is_echo === true;

          // Determine message type and content
          let msgType = "text";
          let msgText = msg.text || "";
          let mediaUrl: string | null = null;

          // Check for attachments
          if (msg.attachments && msg.attachments.length > 0) {
            const att = msg.attachments[0];
            const attType = att.type; // image, video, audio, share, story_mention, etc.

            if (attType === "story_mention") {
              msgType = "story_mention";
              mediaUrl = att.payload?.url || null;
              if (!msgText) msgText = "";
            } else if (attType === "share") {
              msgType = "media_share";
              mediaUrl = att.payload?.url || null;
              if (!msgText) msgText = "";
            } else if (attType === "image" || attType === "animated_image") {
              msgType = "image";
              mediaUrl = att.payload?.url || null;
            } else if (attType === "video") {
              msgType = "video";
              mediaUrl = att.payload?.url || null;
            } else if (attType === "audio") {
              msgType = "audio";
              mediaUrl = att.payload?.url || null;
            } else if (attType === "ig_reel") {
              msgType = "ig_reel";
              mediaUrl = att.payload?.url || null;
            } else {
              msgType = attType || "attachment";
              mediaUrl = att.payload?.url || null;
            }
          }

          // Try to get username from the sender
          // We'll try to look up existing contact_name from DB, or use sender ID
          let contactName: string | null = null;
          if (!isEcho) {
            const { data: existingMsg } = await supabase
              .from("whatsapp_messages")
              .select("contact_name")
              .eq("phone", senderId)
              .eq("channel", "instagram")
              .not("contact_name", "is", null)
              .limit(1)
              .maybeSingle();
            contactName = existingMsg?.contact_name || null;
          }

          // Check if message already exists (dedup by mid)
          if (msg.mid) {
            const { data: existing } = await supabase
              .from("whatsapp_messages")
              .select("id")
              .eq("wamid", msg.mid)
              .maybeSingle();

            if (existing) {
              console.log("Message already exists, skipping:", msg.mid);
              continue;
            }
          }

          const record = {
            phone: isEcho ? recipientId : senderId,
            contact_name: isEcho ? null : contactName,
            direction: isEcho ? "outgoing" : "incoming",
            message_type: msgType,
            message_text: msgText,
            media_url: mediaUrl,
            wamid: msg.mid || null,
            timestamp: timestamp
              ? new Date(Number(timestamp)).toISOString()
              : new Date().toISOString(),
            status: isEcho ? "sent" : "received",
            channel: "instagram",
            raw_payload: event,
          };

          const { error } = await supabase
            .from("whatsapp_messages")
            .insert(record);

          if (error) {
            console.error("Insert error:", error);
          } else {
            console.log(
              `IG message saved: ${isEcho ? "outgoing" : "incoming"} from ${record.phone} type=${msgType}`
            );
          }
        }

        // Handle message read receipts
        if (event.read) {
          console.log("IG read receipt from:", senderId, "watermark:", event.read.watermark);
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("IG Webhook error:", err);
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response("Method not allowed", { status: 405 });
});
