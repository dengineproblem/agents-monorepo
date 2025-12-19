# Chat Assistant Architecture

## Overview

Meta-Tools архитектура для обработки запросов пользователей через специализированных доменных агентов.

## Flow

```
User Message
     │
     ▼
┌─────────────────────────────────────────────────┐
│         orchestrator/index.js                    │
│  - Memory commands (запомни/забудь/заметки)     │
│  - Context gathering (integrations, specs)       │
│  - Route to MetaOrchestrator                     │
└────────────────────┬─────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────┐
│         MetaOrchestrator (GPT-5.2)              │
│         metaOrchestrator.js                      │
│                                                  │
│  1. Create MCP Session (sessionId)              │
│  2. META_TOOLS:                                  │
│     - getAvailableDomains() → список доменов    │
│     - getDomainTools(domain) → tools домена     │
│     - executeTools([...]) → выполнение + агент  │
│  3. Cleanup session in finally                  │
└────────────────────┬─────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────┐
│              domainRouter.js                     │
│  - Группирует tools по доменам                  │
│  - Вызывает mcpBridge.executeToolAdaptive()     │
│  - Вызывает domain agents для каждого домена    │
└────────────────────┬─────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────┐
│              mcpBridge.js (NEW)                  │
│  - Выполняет tools через MCP executor           │
│  - dangerousPolicy enforcement                  │
│  - allowedTools filtering                       │
│  - Возвращает approval_required для опасных     │
└────────────────────┬─────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────┐
│         domainAgents.js (GPT-4o-mini)           │
│  - Получает raw data от tools                   │
│  - Получает user question + context             │
│  - Формирует человеческий ответ                 │
└────────────────────┬─────────────────────────────┘
                     │
                     ▼
            Final Response → User
```

## Detailed Flow Diagram

```
╔══════════════════════════════════════════════════════════════════════════════════════════════╗
║                         ПОЛНАЯ СХЕМА ОБРАБОТКИ СООБЩЕНИЯ                                      ║
╚══════════════════════════════════════════════════════════════════════════════════════════════╝

┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 1: HTTP ENTRY POINT                                                                    │
│  chatAssistant/index.js                                                                       │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                               │
│  POST /api/brain/chat                    POST /api/brain/chat/stream                         │
│         │                                         │                                           │
│         ▼                                         ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                           processChat()                                                  │ │
│  │  1. resolveAdAccountId() → { dbId, fbId }                                                │ │
│  │  2. getAccessToken(userAccountId, dbId) → accessToken                                    │ │
│  │  3. getOrCreateConversation() → conversation.id                                          │ │
│  │  4. updateConversationTitle() (if first message)                                         │ │
│  │  5. gatherContext() → context { directions, recentMessages, ... }                        │ │
│  │  6. saveMessage(user) → Supabase ai_messages                                             │ │
│  │  7. Build conversationHistory (last 10 messages)                                         │ │
│  │  8. Build toolContext { accessToken, userAccountId, adAccountId, conversationId }        │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                         │                                                     │
└─────────────────────────────────────────┼─────────────────────────────────────────────────────┘
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 2: ORCHESTRATOR                                                                        │
│  chatAssistant/orchestrator/index.js → class Orchestrator                                    │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                               │
│  orchestrator.processRequest({ message, context, mode, toolContext, conversationHistory })   │
│         │                                                                                     │
│         ▼                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  0. MEMORY COMMAND CHECK                                                                 │ │
│  │     parseMemoryCommand(message)                                                          │ │
│  │     "запомни: ..." / "забудь: ..." / "заметки"                                          │ │
│  │     → handleMemoryCommand() → RETURN (short circuit)                                     │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│         │ (if not memory command)                                                             │
│         ▼                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  1. PARALLEL CONTEXT GATHERING                                                           │ │
│  │                                                                                          │ │
│  │  Promise.all([                                                                           │ │
│  │    memoryStore.getSpecs()           → specs (user preferences)                          │ │
│  │    memoryStore.getNotesDigest()     → notes (saved notes)                               │ │
│  │    getSummaryContext()              → rollingSummary (conversation summary)              │ │
│  │    getRecentBrainActions()          → brainActions (autopilot history)                  │ │
│  │    getIntegrations()                → integrations { fb, crm, whatsapp, roi }           │ │
│  │    getCachedAdAccountStatus()       → adAccountStatus (can_run_ads, status)             │ │
│  │  ])                                                                                      │ │
│  │                                                                                          │ │
│  │  enrichedContext = {                                                                     │ │
│  │    ...context, specs, notes, rollingSummary, brainActions,                              │ │
│  │    adAccountStatus, integrations, stack, stackCapabilities                               │ │
│  │  }                                                                                       │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│         │                                                                                     │
└─────────────────────────────────────────┼─────────────────────────────────────────────────────┘
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 3: META ORCHESTRATOR                                                                   │
│  chatAssistant/orchestrator/metaOrchestrator.js                                              │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                               │
│  processWithMetaTools({ message, context, conversationHistory, toolContext })                │
│         │                                                                                     │
│         ▼                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  1. CREATE MCP SESSION                                                                   │ │
│  │     sessionId = createSession({                                                          │ │
│  │       userAccountId, adAccountId, accessToken, conversationId,                           │ │
│  │       dangerousPolicy: 'block', integrations                                             │ │
│  │     })                                                                                   │ │
│  │                                                                                          │ │
│  │  2. BUILD ENRICHED TOOL CONTEXT                                                          │ │
│  │     enrichedToolContext = { ...toolContext, sessionId, dangerousPolicy: 'block' }       │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│         │                                                                                     │
│         ▼                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  3. BUILD SYSTEM PROMPT                                                                  │ │
│  │     buildMetaSystemPrompt(context) → includes:                                           │ │
│  │     - Directions (name, budget, target CPL)                                              │ │
│  │     - Notes & Specs                                                                      │ │
│  │     - Integration status                                                                 │ │
│  │     - Available domains                                                                  │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│         │                                                                                     │
│         ▼                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  4. TOOL LOOP (MAX 10 ITERATIONS)                                                        │ │
│  │                                                                                          │ │
│  │     messages = [system, ...conversationHistory, user]                                    │ │
│  │                                                                                          │ │
│  │     while (iterations < 10) {                                                            │ │
│  │       completion = openai.chat.completions.create({                                      │ │
│  │         model: 'gpt-5.2',                                                                │ │
│  │         messages,                                                                        │ │
│  │         tools: META_TOOLS  ──────────────────────────────────────────────────────────┐  │ │
│  │       })                                                                              │  │ │
│  │                                                                                       │  │ │
│  │       if (no tool_calls) → RETURN final response                                      │  │ │
│  │                                                                                       │  │ │
│  │       for each tool_call:                                                             │  │ │
│  │         META_TOOLS[name].handler(args, enrichedToolContext)  ─────────────────────────┘  │ │
│  │         │                                                                                │ │
│  │         └──────────────────────────┐                                                     │ │
│  │                                    ▼                                                     │ │
│  │       messages.push(tool_results)                                                        │ │
│  │     }                                                                                    │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│         │                                                                                     │
│         ▼ (finally)                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  5. CLEANUP MCP SESSION                                                                  │ │
│  │     deleteSession(sessionId)                                                             │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                               │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          │ META_TOOLS handler calls
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 4: META TOOLS                                                                          │
│  chatAssistant/metaTools/definitions.js                                                       │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                               │
│  META_TOOLS = {                                                                               │
│    ┌────────────────────────────────────────────────────────────────────────────────────┐    │
│    │  getAvailableDomains()                                                              │    │
│    │  → Returns: { domains: [                                                            │    │
│    │      { name: 'ads', available: integrations.fb },                                   │    │
│    │      { name: 'creative', available: integrations.fb },                              │    │
│    │      { name: 'crm', available: integrations.crm },                                  │    │
│    │      { name: 'whatsapp', available: integrations.whatsapp }                         │    │
│    │    ], hint: 'Используй getDomainTools()' }                                          │    │
│    └────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                               │
│    ┌────────────────────────────────────────────────────────────────────────────────────┐    │
│    │  getDomainTools({ domain })                                                         │    │
│    │  → Returns: { domain, tools: [                                                      │    │
│    │      { name, description, parameters, dangerous, timeout_ms }                       │    │
│    │    ]}                                                                               │    │
│    └────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                               │
│    ┌────────────────────────────────────────────────────────────────────────────────────┐    │
│    │  executeTools({ tools: [{name, args}], user_question })  ◄── MAIN TOOL             │    │
│    │         │                                                                           │    │
│    │         ▼                                                                           │    │
│    │    routeToolCallsToDomains(tools, context, user_question)                          │    │
│    │         │                                                                           │    │
│    │         └─────────────────────────────────────────────────────────────────────────►│    │
│    └────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                               │
│    ┌────────────────────────────────────────────────────────────────────────────────────┐    │
│    │  executeTool({ tool_name, arguments })  [DEPRECATED]                                │    │
│    │  → executeToolAdaptive(tool_name, args, context)                                    │    │
│    └────────────────────────────────────────────────────────────────────────────────────┘    │
│  }                                                                                            │
│                                                                                               │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          │ routeToolCallsToDomains()
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 5: DOMAIN ROUTER                                                                       │
│  chatAssistant/metaTools/domainRouter.js                                                      │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                               │
│  routeToolCallsToDomains(toolCalls, context, userMessage)                                    │
│         │                                                                                     │
│         ▼                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  1. GROUP BY DOMAIN                                                                      │ │
│  │     groupByDomain(toolCalls) →                                                           │ │
│  │     {                                                                                    │ │
│  │       ads: [{ name: 'getCampaigns', args: {...} }, { name: 'getSpendReport', args }],   │ │
│  │       creative: [{ name: 'getCreatives', args }],                                        │ │
│  │       crm: [{ name: 'getLeads', args }]                                                 │ │
│  │     }                                                                                    │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│         │                                                                                     │
│         ▼                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  2. PARALLEL DOMAIN PROCESSING                                                           │ │
│  │                                                                                          │ │
│  │     Promise.all([                                                                        │ │
│  │       ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐        │ │
│  │       │   ADS DOMAIN        │  │  CREATIVE DOMAIN    │  │    CRM DOMAIN       │        │ │
│  │       │                     │  │                     │  │                     │        │ │
│  │       │ executeToolsFor     │  │ executeToolsFor     │  │ executeToolsFor     │        │ │
│  │       │ Domain(adsCalls)    │  │ Domain(creativeCalls)│  │ Domain(crmCalls)    │        │ │
│  │       │        │            │  │        │            │  │        │            │        │ │
│  │       │        ▼            │  │        ▼            │  │        ▼            │        │ │
│  │       │ processDomain       │  │ processDomain       │  │ processDomain       │        │ │
│  │       │ Results()           │  │ Results()           │  │ Results()           │        │ │
│  │       └─────────────────────┘  └─────────────────────┘  └─────────────────────┘        │ │
│  │     ])                                                                                   │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│         │                                                                                     │
│         ▼                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  3. COMBINE RESULTS                                                                      │ │
│  │     {                                                                                    │ │
│  │       ads: { success: true, response: "...", toolsExecuted: [...], latency_ms },        │ │
│  │       creative: { success: true, response: "...", toolsExecuted: [...] },               │ │
│  │       crm: { success: true, response: "...", toolsExecuted: [...] }                     │ │
│  │     }                                                                                    │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                               │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                         executeToolsForDomain()
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 6: MCP BRIDGE                                                                          │
│  chatAssistant/metaTools/mcpBridge.js                                                         │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                               │
│  executeToolAdaptive(toolName, args, context)                                                │
│         │                                                                                     │
│         ▼                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  CHECK FEATURE FLAG                                                                      │ │
│  │                                                                                          │ │
│  │  if (USE_MCP_RUNTIME && context.sessionId) {                                            │ │
│  │    → executeMCPTool()                                                                    │ │
│  │  } else {                                                                                │ │
│  │    → executeToolByName() [legacy fallback]                                               │ │
│  │  }                                                                                       │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│         │                                                                                     │
│         ▼ (MCP path)                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  executeMCPTool(toolName, args, context)                                                 │ │
│  │                                                                                          │ │
│  │  1. Get domain: getDomainForTool(toolName)                                              │ │
│  │                                                                                          │ │
│  │  2. Execute with idempotency:                                                            │ │
│  │     executeWithIdempotency(toolName, args, context, async () => {                        │ │
│  │       mcpContext = { userAccountId, adAccountId, accessToken,                            │ │
│  │                      dangerousPolicy, conversationId, sessionId }                        │ │
│  │       → executeToolWithContext(toolName, args, mcpContext)                               │ │
│  │     })                                                                                   │ │
│  │                                                                                          │ │
│  │  3. Handle special responses:                                                            │ │
│  │     ┌──────────────────────────────────────────────────────────────────────────────┐    │ │
│  │     │ if (result.approval_required) {                                              │    │ │
│  │     │   return { success: false, approval_required: true,                          │    │ │
│  │     │            message: "⚠️ Действие требует подтверждения: ..." }               │    │ │
│  │     │ }                                                                            │    │ │
│  │     └──────────────────────────────────────────────────────────────────────────────┘    │ │
│  │     ┌──────────────────────────────────────────────────────────────────────────────┐    │ │
│  │     │ if (result.error === 'tool_call_limit_reached') {                            │    │ │
│  │     │   return { success: false, error_code: 'TOOL_CALL_LIMIT' }                   │    │ │
│  │     │ }                                                                            │    │ │
│  │     └──────────────────────────────────────────────────────────────────────────────┘    │ │
│  │                                                                                          │ │
│  │  4. Return result with _meta:                                                            │ │
│  │     { ...result, _meta: { tool, domain, latency_ms, via: 'mcp' } }                      │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                               │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                        executeToolWithContext()
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 7: MCP EXECUTOR                                                                        │
│  mcp/tools/executor.js                                                                        │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                               │
│  executeToolWithContext(name, args, context)                                                 │
│         │                                                                                     │
│         ▼                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  1. CHECK TOOL CALL LIMIT                                                                │ │
│  │     if (sessionId) {                                                                     │ │
│  │       limitCheck = incrementToolCalls(sessionId)                                         │ │
│  │       if (!limitCheck.allowed) → return { error: 'tool_call_limit_reached' }            │ │
│  │     }                                                                                    │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│         │                                                                                     │
│         ▼                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  2. VALIDATE ARGUMENTS (Zod)                                                             │ │
│  │     validation = validateToolArgs(name, args)                                            │ │
│  │     if (!validation.valid) → return { error: 'validation_error' }                        │ │
│  │     validatedArgs = validation.coerced                                                   │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│         │                                                                                     │
│         ▼                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  3. CHECK DANGEROUS TOOLS                                                                │ │
│  │     if (isDangerousTool(name) && dangerousPolicy === 'block') {                         │ │
│  │       return {                                                                           │ │
│  │         approval_required: true,                                                         │ │
│  │         tool: name,                                                                      │ │
│  │         args: validatedArgs,                                                             │ │
│  │         reason: getToolDangerReason(name)  // e.g. "Изменит бюджет адсета"              │ │
│  │       }                                                                                  │ │
│  │     }                                                                                    │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│         │                                                                                     │
│         ▼                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  4. EXECUTE HANDLER WITH TIMEOUT                                                         │ │
│  │                                                                                          │ │
│  │     toolContext = { userAccountId, adAccountId, accessToken }                           │ │
│  │                                                                                          │ │
│  │     result = await Promise.race([                                                        │ │
│  │       handler(validatedArgs, toolContext),                                               │ │
│  │       timeoutPromise(timeout)                                                            │ │
│  │     ])                                                                                   │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                               │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          │ handler execution
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 8: DOMAIN HANDLERS                                                                     │
│  chatAssistant/agents/{domain}/handlers.js                                                    │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                               │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐                   │
│  │   ads/handlers.js   │  │ creative/handlers.js│  │   crm/handlers.js   │                   │
│  │                     │  │                     │  │                     │                   │
│  │  getCampaigns()     │  │  getCreatives()     │  │  getLeads()         │                   │
│  │  getSpendReport()   │  │  getCreativeMetrics │  │  getLeadDetails()   │                   │
│  │  pauseCampaign()    │  │  launchCreative()   │  │  updateLeadStage()  │                   │
│  │  updateBudget()     │  │  pauseCreative()    │  │  getFunnelStats()   │                   │
│  │  getROIReport()     │  │  startCreativeTest()│  │  ...                │                   │
│  │  ...                │  │  ...                │  │                     │                   │
│  │                     │  │                     │  │                     │                   │
│  │  → Facebook API     │  │  → Creative Service │  │  → amoCRM API       │                   │
│  │  → Supabase         │  │  → Supabase         │  │  → Supabase         │                   │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘                   │
│                                                                                               │
│  ┌─────────────────────┐                                                                      │
│  │ whatsapp/handlers.js│                                                                      │
│  │                     │                                                                      │
│  │  getDialogs()       │                                                                      │
│  │  getDialogMessages()│                                                                      │
│  │  analyzeDialog()    │                                                                      │
│  │                     │                                                                      │
│  │  → Evolution API    │                                                                      │
│  │  → Supabase         │                                                                      │
│  └─────────────────────┘                                                                      │
│                                                                                               │
│  RETURN FORMAT:                                                                               │
│  {                                                                                            │
│    success: true/false,                                                                       │
│    data: {...},              // main data                                                     │
│    _entityMap: {...},        // entity refs for LLM                                          │
│    recommendations: [...],   // optional recommendations                                      │
│    verification: {...}       // for WRITE tools                                              │
│  }                                                                                            │
│                                                                                               │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          │ raw results
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 9: DOMAIN AGENTS                                                                       │
│  chatAssistant/metaTools/domainAgents.js                                                      │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                               │
│  processDomainResults(domain, toolCalls, rawResults, context, userMessage)                   │
│         │                                                                                     │
│         ▼                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  1. BUILD DOMAIN-SPECIFIC SYSTEM PROMPT                                                  │ │
│  │                                                                                          │ │
│  │  ADS:      "Ты эксперт-аналитик по рекламе Facebook/Instagram..."                       │ │
│  │            + Directions context (бюджеты, target CPL)                                    │ │
│  │                                                                                          │ │
│  │  CREATIVE: "Ты эксперт-аналитик по креативам..."                                        │ │
│  │            + Performance tiers (A/B/C/D)                                                 │ │
│  │                                                                                          │ │
│  │  CRM:      "Ты эксперт-аналитик по лидам и воронке..."                                  │ │
│  │            + Lead temperature (Hot / Warm / Cold)                                        │ │
│  │                                                                                          │ │
│  │  WHATSAPP: "Ты эксперт-аналитик по WhatsApp диалогам..."                                │ │
│  │            + Phone masking rules                                                         │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│         │                                                                                     │
│         ▼                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  2. BUILD USER PROMPT                                                                    │ │
│  │                                                                                          │ │
│  │  "Вопрос пользователя: {userMessage}                                                    │ │
│  │                                                                                          │ │
│  │   Выполненные запросы: [getCampaigns, getSpendReport]                                   │ │
│  │                                                                                          │ │
│  │   Полученные данные:                                                                     │ │
│  │   {formatted JSON of raw results}                                                        │ │
│  │                                                                                          │ │
│  │   Рекомендации из анализа:                                                               │ │
│  │   {extracted recommendations}                                                            │ │
│  │                                                                                          │ │
│  │   Дай конкретный ответ на вопрос пользователя."                                         │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│         │                                                                                     │
│         ▼                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  3. LLM CALL (GPT-4o-mini)                                                               │ │
│  │                                                                                          │ │
│  │  openai.chat.completions.create({                                                        │ │
│  │    model: 'gpt-4o-mini',                                                                 │ │
│  │    messages: [system, user],                                                             │ │
│  │    temperature: 0.3,                                                                     │ │
│  │    max_tokens: 1500                                                                      │ │
│  │  })                                                                                      │ │
│  │                                                                                          │ │
│  │  → Returns: Human-readable response in Russian                                           │ │
│  │     "Кампания 'Обучение' расходует $150/день, CPL=$12.5, что на 25% ниже целевого..."   │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                               │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          │ domain responses
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 10: RESPONSE ASSEMBLY                                                                  │
│  metaOrchestrator.js → OpenAI final call                                                      │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                               │
│  executeTools returns:                                                                        │
│  {                                                                                            │
│    success: true,                                                                             │
│    responses: {                                                                               │
│      ads: "Кампания расходует $150/день...",                                                 │
│      creative: "Топ-креатив: video_001 с retention 45%..."                                   │
│    },                                                                                         │
│    domains_called: ['ads', 'creative'],                                                       │
│    hint: 'Объедини ответы агентов в единый ответ'                                            │
│  }                                                                                            │
│         │                                                                                     │
│         ▼                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  GPT-5.2 FINAL RESPONSE                                                                  │ │
│  │                                                                                          │ │
│  │  - If single domain → uses domain agent response directly                                │ │
│  │  - If multiple domains → combines responses into coherent answer                         │ │
│  │  - Adds formatting, structure, actionable recommendations                                │ │
│  │                                                                                          │ │
│  │  → Final content returned to user                                                        │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                               │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 11: PERSISTENCE & RESPONSE                                                             │
│  chatAssistant/index.js                                                                       │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                               │
│  1. saveMessage({                                                                             │
│       conversationId,                                                                         │
│       role: 'assistant',                                                                      │
│       content: response.content,                                                              │
│       actionsJson: response.executedActions                                                   │
│     }) → Supabase ai_messages                                                                 │
│                                                                                               │
│  2. maybeUpdateRollingSummary() → async, fire and forget                                     │
│                                                                                               │
│  3. Return to client:                                                                         │
│     {                                                                                         │
│       conversationId,                                                                         │
│       response: "...",                                                                        │
│       executedActions: [...],                                                                 │
│       mode: 'auto',                                                                           │
│       agent: 'MetaOrchestrator',                                                              │
│       metadata: { iterations, tokens, runId }                                                 │
│     }                                                                                         │
│                                                                                               │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Domains

| Domain | Description | Tools |
|--------|-------------|-------|
| `ads` | Facebook/Instagram реклама | getCampaigns, getSpendReport, pauseCampaign, etc. |
| `creative` | Креативы и их анализ | getCreatives, getCreativeMetrics, launchCreative, etc. |
| `crm` | Лиды и воронка продаж | getLeads, getFunnelStats, updateLeadStage, etc. |
| `whatsapp` | WhatsApp диалоги | getDialogs, analyzeDialog, searchDialogSummaries, etc. |

## Key Files

### Entry Points
- `index.js` — API endpoints (/api/brain/chat, /api/brain/chat/stream)
- `orchestrator/index.js` — Main orchestrator with context gathering

### Meta-Tools Architecture
- `orchestrator/metaOrchestrator.js` — GPT-5.2 orchestrator with tool loop + MCP session management
- `orchestrator/metaSystemPrompt.js` — System prompt for orchestrator
- `metaTools/definitions.js` — META_TOOLS (getAvailableDomains, getDomainTools, executeTools)
- `metaTools/domainRouter.js` — Routes tools to domains, calls domain agents
- `metaTools/domainAgents.js` — GPT-4o-mini agents for data processing
- `metaTools/mcpBridge.js` — Bridge to MCP executor with approval_required support
- `metaTools/executor.js` — Legacy executor (fallback when USE_MCP_RUNTIME=false)
- `metaTools/formatters.js` — Formats tools for LLM

### Domain Handlers
- `agents/ads/handlers.js` — Facebook Ads API handlers
- `agents/creative/handlers.js` — Creative management handlers
- `agents/crm/handlers.js` — amoCRM integration handlers
- `agents/whatsapp/handlers.js` — WhatsApp dialog handlers

### Stores
- `stores/memoryStore.js` — User notes and specs
- `stores/unifiedStore.js` — Conversations and plans
- `stores/runsStore.js` — LLM run tracking

## Business Principles (ROI-ориентация)

Все агенты работают по единым принципам:

### Главные метрики (в порядке приоритета)
1. **ROI** — окупаемость: (revenue - spend) / spend × 100
2. **QCPL** — стоимость качественного лида (2+ сообщений в WhatsApp ИЛИ дошёл до ключевого этапа)
3. **CPL** — стоимость любого лида (первый контакт)

### Ключевые принципы
- **Качество > количество** — 10 горячих лидов лучше 100 холодных
- **Дешёвый CPL ≠ хороший креатив** — креатив с CPL $3 и QCPL $5 лучше, чем CPL $2 и QCPL $10
- **Связь доменов** — реклама → лиды → воронка → продажи → ROI

### Кросс-доменный анализ
Агенты понимают связи между доменами:
- **ADS** → знает о связи с CRM (качество лидов)
- **CREATIVE** → знает о влиянии на конверсию воронки
- **CRM** → знает об источнике лидов (какой креатив привёл)
- **WHATSAPP** → знает о влиянии качества диалога на рекламу

### Performance тиры креативов (ROI-ориентация)
| Тир | Условие | Действие |
|-----|---------|----------|
| **A** | ROI > 150% ИЛИ QCPL < target × 0.7 | МАСШТАБИРОВАТЬ |
| **B** | ROI 100-150% ИЛИ QCPL < target | ДЕРЖАТЬ |
| **C** | ROI 50-100% ИЛИ QCPL = target × 1.3 | ТЕСТИРОВАТЬ |
| **D** | ROI < 50% ИЛИ QCPL > target × 1.5 | ОПТИМИЗИРОВАТЬ/ВЫКЛЮЧИТЬ |

## Configuration

Environment variables:
```
META_ORCHESTRATOR_MODEL=gpt-5.2      # Model for orchestrator
DOMAIN_AGENT_MODEL=gpt-4o-mini       # Model for domain agents
META_MAX_ITERATIONS=10               # Max tool call iterations
ORCHESTRATOR_DEBUG=true              # Enable debug logging
USE_MCP_RUNTIME=true                 # Use MCP for tool execution (default: true)
```

## MCP Integration

Tools execution goes through MCP bridge:
- `dangerousPolicy='block'` — dangerous tools return `approval_required`
- `allowedTools` filtering per session
- Tool call limits per session
- Unified Zod validation

### MCP Session Lifecycle
```
createSession() ──► Tool Loop ──► deleteSession()
     │                  │                │
     ▼                  ▼                ▼
sessionId         incrementToolCalls   cleanup
dangerousPolicy   isToolAllowed
allowedTools      approval_required
integrations
```

### Dangerous Tools (require approval)
- **ads**: pauseCampaign, pauseAdSet, updateBudget, updateDirectionBudget, pauseDirection
- **creative**: launchCreative, pauseCreative, startCreativeTest

### Models Used
| Component | Model | Purpose |
|-----------|-------|---------|
| Meta Orchestrator | gpt-5.2 | Tool selection, final response |
| Domain Agents | gpt-4o-mini | Data analysis, formatting |

Fallback: Set `USE_MCP_RUNTIME=false` to use legacy direct handler calls.

## Adding New Tools

1. Add handler in `agents/{domain}/handlers.js`
2. Add tool definition in `agents/{domain}/toolDefs.js`
3. Register in `mcp/tools/definitions.js`

## Memory Commands

Direct commands (handled before LLM):
- `запомни: ...` — Save note
- `забудь: ...` — Delete note
- `заметки` — List all notes
