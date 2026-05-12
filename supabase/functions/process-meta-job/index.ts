import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PIPEBOARD_MCP_URL = "https://meta-ads.mcp.pipeboard.co";
const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

type ToolAction = {
  tool_name: string;
  tool_arguments: Record<string, unknown>;
  success?: boolean;
  summary?: string;
  response_text?: string;
  response_json?: unknown;
  started_at?: string;
  finished_at?: string;
};

type WorkflowState = {
  actions: ToolAction[];
  next_action?: {
    tool_name: string;
    tool_arguments: Record<string, unknown>;
  } | null;
  stage_label?: string;
  final_status?: "campaign_created" | "partial" | "failed";
};

type JobContext = {
  event_name?: string | null;
  campaign_type?: string | null;
  page_id?: string | null;
  page_name?: string | null;
};

type KnownExecutionValues = {
  context: JobContext;
  accountId?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  adsetId?: string | null;
  creativeId?: string | null;
  imageHash?: string | null;
  latestMediaUrl?: string | null;
  objective?: string | null;
  dailyBudget?: number | null;
};

const REQUIRED_ARGS_BY_TOOL: Record<string, string[]> = {
  upload_ad_image: ["account_id", "image_url", "name"],
  create_campaign: ["account_id", "name", "objective"],
  create_adset: ["account_id", "campaign_id", "name"],
  create_ad_creative: ["account_id", "name"],
  create_ad: ["account_id", "adset_id", "name"],
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getValueAsString(value: unknown) {
  return isNonEmptyString(value) ? value : null;
}

function flattenMessageContent(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      const record = asRecord(part);
      if (record.type === "text" && isNonEmptyString(record.text)) return record.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function getConversationTranscript(aiMessages: any[] = []) {
  return aiMessages
    .map((message) => flattenMessageContent(message?.content))
    .filter(Boolean)
    .join("\n");
}

function extractJobContext(existingResult: Record<string, unknown>): JobContext {
  const context = asRecord(existingResult.context);

  return {
    event_name: getValueAsString(context.event_name),
    campaign_type: getValueAsString(context.campaign_type),
    page_id: getValueAsString(context.page_id),
    page_name: getValueAsString(context.page_name),
  };
}

function inferCampaignObjective(context: JobContext, aiMessages: any[] = []) {
  const transcript = `${context.campaign_type || ""}\n${getConversationTranscript(aiMessages)}`.toLowerCase();

  if (/(awareness|reconhecimento)/i.test(transcript)) return "OUTCOME_AWARENESS";
  if (/(traffic|tráfego)/i.test(transcript)) return "OUTCOME_TRAFFIC";
  if (/(engagement|engajamento)/i.test(transcript)) return "OUTCOME_ENGAGEMENT";
  if (/(lead|leads|geraç[aã]o de leads)/i.test(transcript)) return "OUTCOME_LEADS";
  if (/(vendas|convers|sales)/i.test(transcript)) return "OUTCOME_SALES";
  if (/retargeting/i.test(transcript)) return "OUTCOME_SALES";

  return null;
}

function inferDailyBudget(aiMessages: any[] = []) {
  const transcript = getConversationTranscript(aiMessages);
  const budgetMatch = transcript.match(/R\$\s*([\d.,]+)\s*\/\s*dia/i);
  if (!budgetMatch) return null;

  const parsedValue = Number(budgetMatch[1].replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(parsedValue)) return null;

  return Math.round(parsedValue * 100);
}

function getKnownExecutionValues(params: {
  actions: ToolAction[];
  existingResult: Record<string, unknown>;
  aiMessages?: any[];
  latestMediaUrl?: string | null;
}): KnownExecutionValues {
  const context = extractJobContext(params.existingResult);
  const latestUpload = getLatestSuccessfulAction(params.actions, /^upload_ad_image$/i);
  const latestCampaign = getLatestSuccessfulAction(params.actions, /^create_campaign$/i);
  const latestAdset = getLatestSuccessfulAction(params.actions, /^create_adset$/i);
  const latestCreative = getLatestSuccessfulAction(params.actions, /^create_ad_creative$/i);

  const latestUploadResponse = asRecord(latestUpload?.response_json);
  const latestCampaignResponse = asRecord(latestCampaign?.response_json);
  const latestAdsetResponse = asRecord(latestAdset?.response_json);
  const latestCreativeResponse = asRecord(latestCreative?.response_json);

  const fallbackActionWithAccount = params.actions.find((action) => getValueAsString(asRecord(action.tool_arguments).account_id));
  const fallbackActionArgs = asRecord(fallbackActionWithAccount?.tool_arguments);

  return {
    context,
    accountId: getValueAsString(latestUploadResponse.account_id)
      || getValueAsString(asRecord(latestUpload?.tool_arguments).account_id)
      || getValueAsString(fallbackActionArgs.account_id),
    campaignId: getValueAsString(latestCampaignResponse.id),
    campaignName: getValueAsString(latestCampaignResponse.name)
      || getValueAsString(latestUploadResponse.name)
      || getValueAsString(asRecord(latestUpload?.tool_arguments).name)
      || context.event_name,
    adsetId: getValueAsString(latestAdsetResponse.id),
    creativeId: getValueAsString(latestCreativeResponse.id),
    imageHash: getValueAsString(latestUploadResponse.image_hash),
    latestMediaUrl: params.latestMediaUrl || null,
    objective: inferCampaignObjective(context, params.aiMessages),
    dailyBudget: inferDailyBudget(params.aiMessages),
  };
}

function buildKnownValuesContext(knownValues: KnownExecutionValues) {
  let context = "";

  if (knownValues.context.event_name) context += `\n- event_name confirmado: ${knownValues.context.event_name}`;
  if (knownValues.context.page_id) context += `\n- page_id confirmado: ${knownValues.context.page_id}`;
  if (knownValues.context.page_name) context += `\n- page_name confirmada: ${knownValues.context.page_name}`;
  if (knownValues.accountId) context += `\n- account_id confirmado: ${knownValues.accountId}`;
  if (knownValues.campaignName) context += `\n- campaign_name sugerido: ${knownValues.campaignName}`;
  if (knownValues.objective) context += `\n- objective confirmado: ${knownValues.objective}`;
  if (knownValues.campaignId) context += `\n- campaign_id confirmado: ${knownValues.campaignId}`;
  if (knownValues.adsetId) context += `\n- adset_id confirmado: ${knownValues.adsetId}`;
  if (knownValues.creativeId) context += `\n- creative_id confirmado: ${knownValues.creativeId}`;
  if (knownValues.imageHash) context += `\n- image_hash confirmado: ${knownValues.imageHash}`;
  if (knownValues.latestMediaUrl) context += `\n- latest_media_url confirmada: ${knownValues.latestMediaUrl}`;
  if (typeof knownValues.dailyBudget === "number") context += `\n- daily_budget sugerido: ${knownValues.dailyBudget}`;

  return context;
}

function hydrateToolArguments(toolName: string, incomingArgs: Record<string, unknown>, knownValues: KnownExecutionValues) {
  const args = { ...incomingArgs };

  switch (toolName) {
    case "upload_ad_image":
      if (!isNonEmptyString(args.account_id) && knownValues.accountId) args.account_id = knownValues.accountId;
      if (!isNonEmptyString(args.image_url) && knownValues.latestMediaUrl) args.image_url = knownValues.latestMediaUrl;
      if (!isNonEmptyString(args.name) && knownValues.campaignName) args.name = knownValues.campaignName;
      break;
    case "create_campaign":
      if (!isNonEmptyString(args.account_id) && knownValues.accountId) args.account_id = knownValues.accountId;
      if (!isNonEmptyString(args.name) && knownValues.campaignName) args.name = knownValues.campaignName;
      if (!isNonEmptyString(args.objective) && knownValues.objective) args.objective = knownValues.objective;
      if (!isNonEmptyString(args.status)) args.status = "PAUSED";
      break;
    case "create_adset":
      if (!isNonEmptyString(args.account_id) && knownValues.accountId) args.account_id = knownValues.accountId;
      if (!isNonEmptyString(args.campaign_id) && knownValues.campaignId) args.campaign_id = knownValues.campaignId;
      if (!isNonEmptyString(args.name) && knownValues.campaignName) args.name = `${knownValues.campaignName} - Conjunto`;
      if (args.daily_budget === undefined && args.lifetime_budget === undefined && typeof knownValues.dailyBudget === "number") {
        args.daily_budget = knownValues.dailyBudget;
      }
      if (!isNonEmptyString(args.status)) args.status = "PAUSED";
      break;
    case "create_ad_creative":
      if (!isNonEmptyString(args.account_id) && knownValues.accountId) args.account_id = knownValues.accountId;
      if (!isNonEmptyString(args.page_id) && knownValues.context.page_id) args.page_id = knownValues.context.page_id;
      if (!isNonEmptyString(args.name) && knownValues.campaignName) args.name = `${knownValues.campaignName} - Criativo`;
      if (!isNonEmptyString(args.image_hash) && knownValues.imageHash) args.image_hash = knownValues.imageHash;
      if (!isNonEmptyString(args.image_url) && knownValues.latestMediaUrl) args.image_url = knownValues.latestMediaUrl;
      break;
    case "create_ad":
      if (!isNonEmptyString(args.account_id) && knownValues.accountId) args.account_id = knownValues.accountId;
      if (!isNonEmptyString(args.adset_id) && knownValues.adsetId) args.adset_id = knownValues.adsetId;
      if (!isNonEmptyString(args.creative_id) && knownValues.creativeId) args.creative_id = knownValues.creativeId;
      if (!isNonEmptyString(args.name) && knownValues.campaignName) args.name = `${knownValues.campaignName} - Anúncio`;
      if (!isNonEmptyString(args.status)) args.status = "PAUSED";
      break;
  }

  return args;
}

function getMissingRequiredArgs(toolName: string, args: Record<string, unknown>) {
  const requiredArgs = REQUIRED_ARGS_BY_TOOL[toolName] || [];

  return requiredArgs.filter((field) => {
    const value = args[field];
    if (value === null || value === undefined) return true;
    if (typeof value === "string") return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.keys(asRecord(value)).length === 0;
    return false;
  });
}

function buildExpectedToolInstructions(toolDefinitions: Array<Record<string, unknown>>, expectedToolName: string) {
  const tool = toolDefinitions.find((definition) => definition.name === expectedToolName);
  const schema = asRecord(tool?.inputSchema || tool?.input_schema || tool?.parameters || tool?.schema);
  const required = Array.isArray(schema.required)
    ? schema.required.map((field) => String(field))
    : (REQUIRED_ARGS_BY_TOOL[expectedToolName] || []);

  let instructions = `\n\nFERRAMENTA OBRIGATÓRIA AGORA: ${expectedToolName}`;
  if (isNonEmptyString(tool?.description)) instructions += `\n- Descrição: ${tool.description}`;
  if (required.length > 0) instructions += `\n- Campos obrigatórios mínimos: ${required.join(", ")}`;
  if (Object.keys(schema).length > 0) instructions += `\n- Schema JSON da ferramenta: ${JSON.stringify(schema)}`;
  instructions += "\n- NÃO retorne tool_arguments vazio ou incompleto se os dados já estiverem disponíveis acima.";

  return instructions;
}

function hasMeaningfulArgs(args: Record<string, unknown> | undefined | null) {
  if (!args) return false;

  return Object.values(args).some((value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
    return true;
  });
}

function getLatestSuccessfulAction(actions: ToolAction[], matcher: RegExp) {
  return [...actions].reverse().find((action) => action.success && matcher.test(action.tool_name));
}

function inferNextRequiredTool(actions: ToolAction[], latestMediaUrl?: string | null) {
  const { hasUpload, hasCampaign, hasAdSet, hasAdCreative, hasAd } = getWorkflowFlags(actions);

  if (!hasCampaign) return "create_campaign";
  if (!hasAdSet) return "create_adset";
  if (!hasAdCreative) {
    if (hasUpload || latestMediaUrl) return "create_ad_creative";
    return "upload_ad_image";
  }
  if (!hasAd) return "create_ad";
  return null;
}

function buildExecutionContext(actions: ToolAction[], latestMediaUrl?: string | null) {
  let context = "\n\nDADOS JÁ OBTIDOS DAS ETAPAS ANTERIORES (USE ESTES VALORES):";

  const successfulUploads = actions.filter((action) => action.success && /upload_ad_image/i.test(action.tool_name));
  const latestUpload = successfulUploads[successfulUploads.length - 1];
  const latestCampaign = getLatestSuccessfulAction(actions, /^create_campaign$/i);
  const latestAdset = getLatestSuccessfulAction(actions, /^create_adset$/i);
  const latestCreative = getLatestSuccessfulAction(actions, /^create_ad_creative$/i);

  for (const action of actions) {
    if (!action.success || !action.response_json) continue;
    const response = action.response_json as Record<string, unknown>;

    if (/upload_ad_image/i.test(action.tool_name)) {
      context += `\n- account_id: ${response.account_id || "N/A"}`;
      context += `\n- image_hash: ${response.image_hash || "N/A"}`;
      const images = Array.isArray(response.images) ? response.images as Array<Record<string, unknown>> : [];
      const firstImage = images[0];
      if (firstImage?.url) {
        context += `\n- image_url: ${firstImage.url}`;
      }
    }

    if (/^create_campaign$/i.test(action.tool_name) && response.id) {
      context += `\n- campaign_id: ${response.id}`;
      context += `\n- campaign_name: ${response.name || "N/A"}`;
    }

    if (/^create_adset$/i.test(action.tool_name) && response.id) {
      context += `\n- adset_id: ${response.id}`;
      context += `\n- adset_name: ${response.name || "N/A"}`;
    }

    if (/^create_ad_creative$/i.test(action.tool_name) && response.id) {
      context += `\n- creative_id: ${response.id}`;
    }
  }

  const knownAccountId = actions.find((action) => (action.tool_arguments as Record<string, unknown> | undefined)?.account_id)?.tool_arguments?.account_id;
  if (knownAccountId) context += `\n- account_id confirmado: ${knownAccountId}`;
  if (latestMediaUrl) context += `\n- latest_media_url: ${latestMediaUrl}`;
  if (latestUpload?.response_json && !(latestUpload.response_json as Record<string, unknown>).image_hash) {
    context += "\n- upload anterior executado, mas sem image_hash retornado. NÃO repita upload vazio.";
  }
  if (latestCampaign) context += "\n- campanha já criada com sucesso. NÃO repita create_campaign.";
  if (latestAdset) context += "\n- adset já criado com sucesso. NÃO repita create_adset.";
  if (latestCreative) context += "\n- criativo já criado com sucesso. NÃO repita create_ad_creative.";
  if (successfulUploads.length > 0) context += "\n- upload_ad_image já foi concluído com sucesso. SÓ repita se houver NOVA mídia, o que não aconteceu neste job.";

  return context;
}

async function requestNextToolCall(params: {
  systemPrompt: string;
  aiMessages: any[];
  actions: ToolAction[];
  apiKey: string;
  model: string;
  toolNames: string;
  expectedToolName: string;
  latestMediaUrl?: string | null;
  knownContextNote?: string;
  expectedToolInstructions?: string;
}) {
  const executionContext = buildExecutionContext(params.actions, params.latestMediaUrl);
  const followUp = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        {
          role: "system",
          content: `${params.systemPrompt}\n\nEXECUÇÃO MULTIETAPAS OBRIGATÓRIA:\n- Continue o fluxo sem perguntar nada ao usuário durante a execução.\n- A PRÓXIMA ETAPA OBRIGATÓRIA deste job é: ${params.expectedToolName}.\n- Retorne APENAS um tool_call execute_pipeboard_action com tool_name exatamente igual a ${params.expectedToolName}.\n- NÃO repita etapas já concluídas com sucesso.\n- Se a etapa esperada for create_ad_creative e já existir image_hash, use o image_hash retornado; se ainda não existir image_hash, use latest_media_url.\n- Se a etapa esperada for create_ad, use campaign_id/adset_id/creative_id já obtidos.\n- Preencha os argumentos obrigatórios com os valores já conhecidos; nunca responda com {}.${executionContext}${params.knownContextNote || ""}${params.expectedToolInstructions || ""}`,
        },
        ...(params.aiMessages || []),
        ...buildToolHistoryMessages(params.actions),
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "execute_pipeboard_action",
            description: `Execute uma ação no Meta Ads via Pipeboard MCP. Ferramentas disponíveis: ${params.toolNames}.`,
            parameters: {
              type: "object",
              properties: {
                tool_name: {
                  type: "string",
                  description: `Nome da ferramenta Pipeboard. Disponíveis: ${params.toolNames}`,
                },
                tool_arguments: {
                  type: "object",
                  description: "Argumentos para a ferramenta selecionada.",
                },
              },
              required: ["tool_name", "tool_arguments"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "execute_pipeboard_action" } },
      stream: false,
    }),
  });

  const followUpData = await followUp.json().catch(() => null);
  return { followUp, followUpData };
}

async function callPipeboard(method: string, params: Record<string, unknown>, apiKey: string) {
  const resp = await fetch(PIPEBOARD_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: method, arguments: params },
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Pipeboard error [${resp.status}]: ${JSON.stringify(data)}`);
  }

  return data;
}

async function listPipeboardTools(apiKey: string) {
  const resp = await fetch(PIPEBOARD_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Pipeboard tools error [${resp.status}]: ${JSON.stringify(data)}`);
  }

  return data;
}

function safeParseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isRawJsonLike(text: string) {
  const normalized = text.trim();
  return normalized.startsWith("{") || normalized.startsWith("[") || normalized.includes('"content":') || normalized.includes('"type": "text"');
}

function getStageLabel(toolName: string) {
  if (/upload_ad_image/i.test(toolName)) return "Enviando mídia ao Meta Ads...";
  if (/ad_creative|creative/i.test(toolName)) return "Criando criativo do anúncio...";
  if (/adset/i.test(toolName)) return "Criando conjunto de anúncios...";
  if (/campaign/i.test(toolName)) return "Criando campanha...";
  if (/(^|_)create_ad($|_)|(^|_)publish_ad($|_)|(^|_)update_ad($|_)/i.test(toolName)) return "Criando anúncio...";
  return "Executando ação no Meta Ads...";
}

function normalizePipeboardResult(rawResult: any) {
  const pipeboard = rawResult?.result || rawResult;
  const text = pipeboard?.content?.[0]?.text || pipeboard?.structuredContent?.result || JSON.stringify(pipeboard, null, 2);
  const parsed = safeParseJson<Record<string, unknown>>(text, { raw: text });
  const success = pipeboard?.isError ? false : parsed?.success !== false;
  return { pipeboard, text, parsed, success };
}

function summarizeToolResult(toolName: string, parsed: Record<string, unknown>) {
  if (/upload_ad_image/i.test(toolName)) {
    return parsed.image_hash
      ? `Imagem enviada com hash ${parsed.image_hash}`
      : "Imagem enviada ao Meta Ads";
  }

  if (/campaign/i.test(toolName)) {
    return parsed.name
      ? `Campanha "${parsed.name}" criada/atualizada (ID: ${parsed.id || "N/A"})`
      : "Campanha criada/atualizada";
  }

  if (/adset/i.test(toolName)) {
    return parsed.name
      ? `Conjunto "${parsed.name}" criado/atualizado (ID: ${parsed.id || "N/A"})`
      : "Conjunto de anúncios criado/atualizado";
  }

  if (/(^|_)create_ad($|_)|(^|_)publish_ad($|_)/i.test(toolName)) {
    return parsed.name
      ? `Anúncio "${parsed.name}" criado/publicado (ID: ${parsed.id || "N/A"})`
      : "Anúncio criado/publicado";
  }

  if (/ad_creative|creative/i.test(toolName)) {
    return parsed.id
      ? `Criativo criado (ID: ${parsed.id})`
      : "Criativo criado";
  }

  return `Ação ${toolName} executada`;
}

function getWorkflowFlags(actions: ToolAction[]) {
  const names = actions.map((action) => action.tool_name);
  const hasUpload = names.some((name) => /upload_ad_image/i.test(name));
  const hasCampaign = names.some((name) => /campaign/i.test(name));
  const hasAdSet = names.some((name) => /adset/i.test(name));
  const hasAdCreative = names.some((name) => /ad_creative|creative/i.test(name));
  const hasAd = names.some((name) => !/upload_ad_image/i.test(name) && /(^|_)create_ad($|_)|(^|_)publish_ad($|_)|(^|_)update_ad($|_)/i.test(name));
  const fullCampaignCreated = hasCampaign && hasAdSet;

  return { hasUpload, hasCampaign, hasAdSet, hasAdCreative, hasAd, fullCampaignCreated };
}

function buildStatusReport(actions: ToolAction[], finalAssistantText?: string) {
  const { hasUpload, hasCampaign, hasAdSet, hasAdCreative, hasAd, fullCampaignCreated } = getWorkflowFlags(actions);
  const lines: string[] = [];

  if (fullCampaignCreated) {
    lines.push("✅ **Ação Concluída com Sucesso!**");
    lines.push("");
    lines.push("📋 **Relatório de Revisão:**");
  } else if (hasUpload && !hasCampaign && !hasAdSet && !hasAdCreative && !hasAd) {
    lines.push("⚠️ **Processo concluído parcialmente**");
    lines.push("");
    lines.push("📋 **Resumo do status:**");
    lines.push("**Status da campanha:** Não criada — apenas o upload da mídia foi concluído");
  } else {
    lines.push("⚠️ **Processo concluído parcialmente**");
    lines.push("");
    lines.push("📋 **Resumo do status:**");
    lines.push(`**Status da campanha:** ${hasCampaign ? "Campanha iniciada, mas fluxo não terminou" : "Fluxo interrompido antes da criação final"}`);
  }

  // Extract campaign details from actions
  const campaignAction = actions.find((a) => /campaign/i.test(a.tool_name));
  const adsetAction = actions.find((a) => /adset/i.test(a.tool_name));
  const campaignArgs = campaignAction?.tool_arguments || {};
  const adsetArgs = adsetAction?.tool_arguments || {};
  const campaignResult = campaignAction?.response_json as Record<string, unknown> | undefined;

  if (fullCampaignCreated) {
    // Show structured review
    lines.push(`- **Página:** ${(campaignArgs as any).page_id || "N/A"}`);
    lines.push(`- **Nome da Campanha:** ${(campaignArgs as any).name || campaignResult?.name || "N/A"}`);
    lines.push(`- **Objetivo:** ${(campaignArgs as any).objective || "N/A"}`);
    lines.push(`- **Orçamento:** ${(adsetArgs as any).daily_budget ? `R$ ${((adsetArgs as any).daily_budget / 100).toFixed(0)}/dia` : (adsetArgs as any).lifetime_budget ? `R$ ${((adsetArgs as any).lifetime_budget / 100).toFixed(0)} total` : "N/A"}`);
    lines.push(`- **Público:** ${(adsetArgs as any).targeting ? JSON.stringify((adsetArgs as any).targeting) : "Padrão"}`);
    lines.push(`- **Status:** Campanha criada e ativa no Meta Ads`);
  }

  if (actions.length > 0) {
    lines.push("");
    lines.push("**Etapas executadas:**");
    actions.forEach((action) => {
      lines.push(`${action.success ? "✅" : "❌"} ${action.summary || action.tool_name}`);
    });
  }

  if (hasUpload && !fullCampaignCreated) {
    lines.push("");
    lines.push("💡 **Próximo passo:** continuar da etapa seguinte da criação da campanha.");
  }

  if (finalAssistantText && finalAssistantText.trim() && !isRawJsonLike(finalAssistantText) && fullCampaignCreated) {
    lines.push("");
    lines.push(finalAssistantText.trim());
  }

  return {
    report: lines.join("\n"),
    finalStatus: fullCampaignCreated ? "campaign_created" : "partial",
  } as const;
}

function buildToolHistoryMessages(actions: ToolAction[]) {
  return actions.flatMap((action, index) => {
    const toolCallId = `tc_${index + 1}`;
    return [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: toolCallId,
            type: "function",
            function: {
              name: "execute_pipeboard_action",
              arguments: JSON.stringify({
                tool_name: action.tool_name,
                tool_arguments: action.tool_arguments,
              }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: toolCallId,
        content: `Resultado da ação "${action.tool_name}":\n${action.response_text || JSON.stringify(action.response_json || {}, null, 2)}`,
      },
    ];
  });
}

// Use service role for internal recursive calls — no user auth needed
async function queueNextStep(jobId: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for recursive call");
    return;
  }

  fetch(`${supabaseUrl}/functions/v1/process-meta-job`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceRoleKey}`,
      "apikey": Deno.env.get("SUPABASE_ANON_KEY") || "",
    },
    body: JSON.stringify({ job_id: jobId, _internal: true }),
  }).catch((error) => console.error("Error requeueing job:", error));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey,
    );

    // Check if this is a service-role internal call or a user call
    const token = authHeader.replace("Bearer ", "");
    const isInternalCall = token === serviceRoleKey;

    let userId: string | null = null;

    if (isInternalCall) {
      // Internal recursive call — get user_id from the job itself
      // We'll validate below after parsing job_id
    } else {
      // User call — validate JWT
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );

      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }

    const { job_id } = await req.json();
    if (!job_id) {
      return new Response(JSON.stringify({ error: "job_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch job — for internal calls, don't filter by user_id
    let jobQuery = serviceClient
      .from("meta_ads_jobs")
      .select("*")
      .eq("id", job_id);

    if (!isInternalCall && userId) {
      jobQuery = jobQuery.eq("user_id", userId);
    }

    const { data: job, error: jobError } = await jobQuery.single();

    if (jobError || !job) {
      console.error("Job not found:", job_id, jobError);
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const existingResult = (job.result as Record<string, unknown> | null) ?? {};
    const existingWorkflow = (existingResult.workflow as WorkflowState | undefined) ?? { actions: [] };
    const actions = Array.isArray(existingWorkflow.actions) ? existingWorkflow.actions : [];

    // MAX ITERATIONS GUARD — prevent infinite loops
    const MAX_ITERATIONS = 8;
    if (actions.length >= MAX_ITERATIONS) {
      const fallback = buildStatusReport(actions);
      await serviceClient.from("meta_ads_jobs").update({
        status: "completed",
        progress: 100,
        error_message: `Limite de ${MAX_ITERATIONS} etapas atingido`,
        result: {
          ...existingResult,
          ai_response: fallback.report + `\n\n⚠️ Processo encerrado após ${MAX_ITERATIONS} etapas.`,
          workflow: { actions, next_action: null, stage_label: "Concluído", final_status: fallback.finalStatus },
        },
      }).eq("id", job_id);

      return new Response(JSON.stringify({ status: "completed", job_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawCurrentAction = existingWorkflow.next_action ?? {
      tool_name: job.tool_name as string,
      tool_arguments: safeParseJson<Record<string, unknown>>(job.tool_arguments, {}),
    };

    if (!rawCurrentAction?.tool_name) {
      await serviceClient.from("meta_ads_jobs").update({
        status: "failed",
        progress: 100,
        error_message: "Nenhuma ação pendente para executar",
      }).eq("id", job_id);

      return new Response(JSON.stringify({ error: "No action to execute" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const knownValues = getKnownExecutionValues({
      actions,
      existingResult,
      aiMessages: (job.ai_messages as any[]) || [],
      latestMediaUrl: job.latest_media_url as string | null | undefined,
    });

    const currentAction = {
      tool_name: rawCurrentAction.tool_name,
      tool_arguments: hydrateToolArguments(
        rawCurrentAction.tool_name,
        rawCurrentAction.tool_arguments || {},
        knownValues,
      ),
    };

    // REQUIRED ARGS GUARD — stop with exact missing fields after hydrating known values
    const argsRequiredTools = ["create_campaign", "create_adset", "create_ad_creative", "create_ad", "upload_ad_image"];
    const missingFields = getMissingRequiredArgs(currentAction.tool_name, currentAction.tool_arguments);
    if (argsRequiredTools.includes(currentAction.tool_name) && missingFields.length > 0) {
      console.error(`Blocking execution of ${currentAction.tool_name} due to missing fields: ${missingFields.join(", ")}`);
      const fallback = buildStatusReport(actions);
      await serviceClient.from("meta_ads_jobs").update({
        status: "failed",
        progress: 100,
        error_message: `Dados obrigatórios ausentes para ${currentAction.tool_name}: ${missingFields.join(", ")}`,
        result: {
          ...existingResult,
          ai_response: fallback.report + `\n\n❌ Erro: faltaram os campos **${missingFields.join(", ")}** para **${currentAction.tool_name}**. O fluxo foi interrompido antes de chamar a próxima etapa.`,
          workflow: { actions, next_action: null, stage_label: "Falhou", final_status: "failed" },
        },
      }).eq("id", job_id);

      return new Response(JSON.stringify({ status: "failed", job_id, error: "Missing required fields", missing_fields: missingFields }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // REPEATED FAILURE GUARD — if last action was the same tool and failed, stop
    const lastAction = actions[actions.length - 1];
    if (lastAction && !lastAction.success && lastAction.tool_name === currentAction.tool_name) {
      console.error(`Stopping: ${currentAction.tool_name} failed consecutively`);
      const fallback = buildStatusReport(actions);
      await serviceClient.from("meta_ads_jobs").update({
        status: "failed",
        progress: 100,
        error_message: `${currentAction.tool_name} falhou consecutivamente`,
        result: {
          ...existingResult,
          ai_response: fallback.report + `\n\n❌ A etapa "${currentAction.tool_name}" falhou duas vezes seguidas. Verifique os dados e tente novamente.`,
          workflow: { actions, next_action: null, stage_label: "Falhou", final_status: "failed" },
        },
      }).eq("id", job_id);

      return new Response(JSON.stringify({ status: "failed", job_id }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const PIPEBOARD_API_KEY = Deno.env.get("PIPEBOARD_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!PIPEBOARD_API_KEY) {
      await serviceClient.from("meta_ads_jobs").update({ status: "failed", error_message: "PIPEBOARD_API_KEY not configured", progress: 100 }).eq("id", job_id);
      return new Response(JSON.stringify({ error: "PIPEBOARD_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stageLabel = getStageLabel(currentAction.tool_name);
    const progressStart = Math.min(15 + actions.length * 20, 90);

    await serviceClient.from("meta_ads_jobs").update({
      status: "processing",
      progress: progressStart,
      tool_name: currentAction.tool_name,
      tool_arguments: JSON.stringify(currentAction.tool_arguments || {}),
      result: {
        ...existingResult,
        workflow: {
          ...existingWorkflow,
          actions,
          next_action: currentAction,
          stage_label: stageLabel,
        },
      },
    }).eq("id", job_id);

    try {
      console.log(`Executing Pipeboard action: ${currentAction.tool_name}`, JSON.stringify(currentAction.tool_arguments || {}).slice(0, 200));
      const rawResult = await callPipeboard(currentAction.tool_name, currentAction.tool_arguments || {}, PIPEBOARD_API_KEY);
      console.log(`Pipeboard result for ${currentAction.tool_name}:`, JSON.stringify(rawResult).slice(0, 500));
      const normalized = normalizePipeboardResult(rawResult);

      const completedActions: ToolAction[] = [
        ...actions,
        {
          tool_name: currentAction.tool_name,
          tool_arguments: currentAction.tool_arguments || {},
          success: normalized.success,
          summary: summarizeToolResult(currentAction.tool_name, normalized.parsed),
          response_text: normalized.text,
          response_json: normalized.parsed,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        },
      ];

      const workflowAfterAction: WorkflowState = {
        actions: completedActions,
        next_action: null,
        stage_label: "Analisando próximo passo...",
      };

      await serviceClient.from("meta_ads_jobs").update({
        status: "processing",
        progress: Math.min(progressStart + 10, 92),
        result: {
          ...existingResult,
          pipeboard: normalized.pipeboard,
          workflow: workflowAfterAction,
        },
      }).eq("id", job_id);

      if (!LOVABLE_API_KEY || !job.system_prompt || !job.ai_messages) {
        const fallback = buildStatusReport(completedActions);
        await serviceClient.from("meta_ads_jobs").update({
          status: "completed",
          progress: 100,
          result: {
            ...existingResult,
            pipeboard: normalized.pipeboard,
            ai_response: fallback.report,
            workflow: { ...workflowAfterAction, final_status: fallback.finalStatus, stage_label: "Concluído" },
          },
        }).eq("id", job_id);

        return new Response(JSON.stringify({ status: "completed", job_id }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const toolsResp = await listPipeboardTools(PIPEBOARD_API_KEY);
      const toolDefinitions = Array.isArray(toolsResp?.result?.tools) ? toolsResp.result.tools : [];
      const toolNames = toolDefinitions.map((tool: { name: string }) => tool.name).join(", ");

      const { fullCampaignCreated } = getWorkflowFlags(completedActions);
      const expectedNextTool = inferNextRequiredTool(completedActions, job.latest_media_url as string | null | undefined);

      let followUp = null;
      let followUpData: any = null;
      if (!fullCampaignCreated && expectedNextTool) {
        const response = await requestNextToolCall({
          systemPrompt: job.system_prompt as string,
          aiMessages: (job.ai_messages as any[]) || [],
          actions: completedActions,
          apiKey: LOVABLE_API_KEY,
          model: job.ai_model || "google/gemini-3-flash-preview",
          toolNames,
          expectedToolName: expectedNextTool,
          latestMediaUrl: job.latest_media_url as string | null | undefined,
          knownContextNote: buildKnownValuesContext(getKnownExecutionValues({
            actions: completedActions,
            existingResult,
            aiMessages: (job.ai_messages as any[]) || [],
            latestMediaUrl: job.latest_media_url as string | null | undefined,
          })),
          expectedToolInstructions: buildExpectedToolInstructions(toolDefinitions, expectedNextTool),
        });
        followUp = response.followUp;
        followUpData = response.followUpData;
      } else {
        const finalReport = buildStatusReport(completedActions);
        await serviceClient.from("meta_ads_jobs").update({
          status: "completed",
          progress: 100,
          result: {
            ...existingResult,
            pipeboard: normalized.pipeboard,
            ai_response: finalReport.report,
            workflow: {
              ...workflowAfterAction,
              final_status: finalReport.finalStatus,
              stage_label: "Concluído",
            },
          },
        }).eq("id", job_id);

        return new Response(JSON.stringify({ status: "completed", job_id }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!followUp.ok) {
        console.error("AI follow-up error:", followUp.status, JSON.stringify(followUpData).slice(0, 500));
        // If AI fails, still complete with status report
        const fallback = buildStatusReport(completedActions);
        await serviceClient.from("meta_ads_jobs").update({
          status: "completed",
          progress: 100,
          result: {
            ...existingResult,
            pipeboard: normalized.pipeboard,
            ai_response: fallback.report,
            workflow: { ...workflowAfterAction, final_status: fallback.finalStatus, stage_label: "Concluído" },
          },
        }).eq("id", job_id);

        return new Response(JSON.stringify({ status: "completed", job_id }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aiMessage = followUpData?.choices?.[0]?.message;
      const nextToolCall = aiMessage?.tool_calls?.find((toolCall: any) => toolCall?.function?.name === "execute_pipeboard_action");
      const finalAssistantText = aiMessage?.content || "";

      if (nextToolCall?.function?.arguments) {
        const nextArgs = safeParseJson<{ tool_name?: string; tool_arguments?: Record<string, unknown> }>(nextToolCall.function.arguments, {});
        if (!nextArgs.tool_name) {
          console.error("AI returned next action without tool_name");
          const fallback = buildStatusReport(completedActions, finalAssistantText);
          await serviceClient.from("meta_ads_jobs").update({
            status: "completed",
            progress: 100,
            result: {
              ...existingResult,
              pipeboard: normalized.pipeboard,
              ai_response: fallback.report,
              workflow: { ...workflowAfterAction, final_status: fallback.finalStatus, stage_label: "Concluído" },
            },
          }).eq("id", job_id);

          return new Response(JSON.stringify({ status: "completed", job_id }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const expectedNextTool = inferNextRequiredTool(completedActions, job.latest_media_url as string | null | undefined);
        if (expectedNextTool && nextArgs.tool_name !== expectedNextTool) {
          console.error(`AI attempted invalid next step ${nextArgs.tool_name}; expected ${expectedNextTool}`);
          await serviceClient.from("meta_ads_jobs").update({
            status: "failed",
            progress: 100,
            error_message: `Fluxo inválido: próxima etapa deveria ser ${expectedNextTool}, mas a IA tentou ${nextArgs.tool_name}`,
            result: {
              ...existingResult,
              pipeboard: normalized.pipeboard,
              ai_response: `❌ O fluxo foi interrompido para evitar repetição indevida. A próxima etapa esperada era **${expectedNextTool}**, mas o sistema tentou **${nextArgs.tool_name}**.`,
              workflow: { ...workflowAfterAction, final_status: "failed", stage_label: "Falhou", next_action: null },
            },
          }).eq("id", job_id);

          return new Response(JSON.stringify({ status: "failed", job_id }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const nextAction = {
          tool_name: nextArgs.tool_name,
          tool_arguments: hydrateToolArguments(
            nextArgs.tool_name,
            nextArgs.tool_arguments || {},
            getKnownExecutionValues({
              actions: completedActions,
              existingResult,
              aiMessages: (job.ai_messages as any[]) || [],
              latestMediaUrl: job.latest_media_url as string | null | undefined,
            }),
          ),
        };

        const priorSuccessfulEquivalent = completedActions.find((action) => action.success && action.tool_name === nextAction.tool_name);
        if (priorSuccessfulEquivalent && nextAction.tool_name === "upload_ad_image") {
          await serviceClient.from("meta_ads_jobs").update({
            status: "failed",
            progress: 100,
            error_message: "Tentativa bloqueada de repetir upload_ad_image no mesmo fluxo",
            result: {
              ...existingResult,
              pipeboard: normalized.pipeboard,
              ai_response: "❌ O processo foi interrompido para evitar repetir o upload da mesma mídia. A campanha não foi concluída.",
              workflow: { ...workflowAfterAction, final_status: "failed", stage_label: "Falhou", next_action: null },
            },
          }).eq("id", job_id);

          return new Response(JSON.stringify({ status: "failed", job_id }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        console.log(`Queueing next step: ${nextAction.tool_name}`);

        await serviceClient.from("meta_ads_jobs").update({
          status: "processing",
          progress: Math.min(25 + completedActions.length * 20, 95),
          tool_name: nextAction.tool_name,
          tool_arguments: JSON.stringify(nextAction.tool_arguments),
          result: {
            ...existingResult,
            pipeboard: normalized.pipeboard,
            ai_response: `⏳ ${getStageLabel(nextAction.tool_name)}`,
            workflow: {
              ...workflowAfterAction,
              next_action: nextAction,
              stage_label: getStageLabel(nextAction.tool_name),
            },
          },
        }).eq("id", job_id);

        // Use service role for recursive call
        await queueNextStep(job_id);

        return new Response(JSON.stringify({ status: "processing", job_id, next_action: nextAction.tool_name }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const finalReport = buildStatusReport(completedActions, finalAssistantText);
      const aiResponse = finalAssistantText && finalAssistantText.length > 40 && !isRawJsonLike(finalAssistantText) && finalReport.finalStatus === "campaign_created"
        ? finalAssistantText
        : finalReport.report;

      await serviceClient.from("meta_ads_jobs").update({
        status: "completed",
        progress: 100,
        result: {
          ...existingResult,
          pipeboard: normalized.pipeboard,
          ai_response: aiResponse,
          workflow: {
            ...workflowAfterAction,
            final_status: finalReport.finalStatus,
            stage_label: "Concluído",
          },
        },
      }).eq("id", job_id);

      return new Response(JSON.stringify({ status: "completed", job_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Job processing error:", error);
      await serviceClient.from("meta_ads_jobs").update({
        status: "failed",
        progress: 100,
        error_message: error instanceof Error ? error.message : "Erro desconhecido",
        result: {
          ...existingResult,
          workflow: {
            ...existingWorkflow,
            actions,
            next_action: null,
            stage_label: "Falhou",
            final_status: "failed",
          },
        },
      }).eq("id", job_id);

      return new Response(JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "Unknown error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    console.error("process-meta-job error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
