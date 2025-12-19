/**
 * Domain Router
 *
 * Группирует tool calls по доменам и маршрутизирует в Domain Agents.
 * Domain Agent обрабатывает raw data и возвращает промежуточный ответ для оркестратора.
 */

import { executeToolAdaptive } from './mcpBridge.js';
import { getDomainForTool } from './formatters.js';
import { processDomainResults } from './domainAgents.js';
import { logger } from '../../lib/logger.js';

/**
 * Process tool calls through domain routing
 *
 * @param {Array<{name: string, args: Object}>} toolCalls - Tool calls from orchestrator
 * @param {Object} context - Execution context
 * @param {string} userMessage - Original user message for context
 * @returns {Promise<Object>} Domain agent responses by domain
 */
export async function routeToolCallsToDomains(toolCalls, context, userMessage = '') {
  const startTime = Date.now();
  const { layerLogger } = context;

  // 1. Group tool calls by domain
  const byDomain = groupByDomain(toolCalls);

  // Layer 5: Domain Router start
  layerLogger?.start(5, {
    domains: Object.keys(byDomain),
    toolCount: toolCalls.length
  });

  logger.info({
    domains: Object.keys(byDomain),
    toolCounts: Object.fromEntries(
      Object.entries(byDomain).map(([d, calls]) => [d, calls.length])
    )
  }, 'Domain router: grouped tool calls');

  // 2. Execute tools for each domain in parallel
  const domainPromises = Object.entries(byDomain).map(async ([domain, domainCalls]) => {
    const toolNames = domainCalls.map(c => c.name);
    logger.info({ domain, tools: toolNames }, 'Domain router: executing tools');

    layerLogger?.info(5, `Processing domain: ${domain}`, {
      domain,
      tools: toolNames
    });

    try {
      // Execute all tools for this domain
      const rawResults = await executeToolsForDomain(domainCalls, context);

      // Log results summary for debugging
      const resultsSummary = {};
      for (const [toolName, data] of Object.entries(rawResults)) {
        resultsSummary[toolName] = {
          hasResult: !!data?.result,
          success: data?.result?.success,
          error: data?.result?.error || data?.result?.message,
          dataKeys: data?.result ? Object.keys(data.result) : []
        };
      }
      logger.info({ domain, results: resultsSummary }, 'Domain router: tool results');

      // Pass raw results to domain agent for processing
      const processedResponse = await processDomainResults(
        domain,
        domainCalls,
        rawResults,
        context,
        userMessage
      );

      layerLogger?.info(5, `Domain ${domain} completed`, { success: true });

      return {
        domain,
        success: true,
        response: processedResponse,
        toolsExecuted: domainCalls.map(c => c.name),
        latency_ms: Date.now() - startTime
      };

    } catch (error) {
      layerLogger?.info(5, `Domain ${domain} failed`, { error: error.message });
      logger.error({ domain, error: error.message }, 'Domain router: domain processing failed');
      return {
        domain,
        success: false,
        error: error.message,
        toolsExecuted: domainCalls.map(c => c.name),
        latency_ms: Date.now() - startTime
      };
    }
  });

  // 3. Wait for all domains to complete
  const domainResults = await Promise.all(domainPromises);

  // 4. Combine results into single response
  const combined = {};
  for (const result of domainResults) {
    combined[result.domain] = result;
  }

  const totalLatency = Date.now() - startTime;

  layerLogger?.end(5, {
    domainsProcessed: Object.keys(combined),
    successCount: domainResults.filter(r => r.success).length
  });

  logger.info({
    domains: Object.keys(combined),
    totalLatency,
    successCount: domainResults.filter(r => r.success).length
  }, 'Domain router: completed');

  return combined;
}

/**
 * Group tool calls by their domain
 */
function groupByDomain(toolCalls) {
  const grouped = {};

  for (const call of toolCalls) {
    const domain = getDomainForTool(call.name);

    if (!domain) {
      logger.warn({ tool: call.name }, 'Domain router: unknown tool domain');
      continue;
    }

    if (!grouped[domain]) {
      grouped[domain] = [];
    }

    grouped[domain].push(call);
  }

  return grouped;
}

/**
 * Execute all tools for a single domain
 */
async function executeToolsForDomain(toolCalls, context) {
  const results = {};
  const { onToolEvent } = context;

  // Execute tools in parallel within domain (via MCP bridge)
  const promises = toolCalls.map(async (call) => {
    const startTime = Date.now();
    // Ensure args is always an object (GPT sometimes sends undefined or null)
    const safeArgs = call.args ?? {};

    // Emit tool_start event for streaming UI
    onToolEvent?.({ type: 'tool_start', name: call.name, args: safeArgs });

    try {
      const result = await executeToolAdaptive(call.name, safeArgs, context);
      const duration = Date.now() - startTime;

      // Emit tool_result event for streaming UI
      onToolEvent?.({ type: 'tool_result', name: call.name, success: true, duration });

      return { name: call.name, args: safeArgs, result };
    } catch (error) {
      const duration = Date.now() - startTime;

      // Emit tool_result event for streaming UI (error)
      onToolEvent?.({ type: 'tool_result', name: call.name, success: false, error: error.message, duration });

      throw error;
    }
  });

  const executed = await Promise.all(promises);

  for (const { name, args, result } of executed) {
    results[name] = {
      args,
      result
    };
  }

  return results;
}

/**
 * Check if any tool call requires domain routing
 * (vs simple direct execution)
 */
export function needsDomainRouting(toolCalls) {
  // Route through domain agents if:
  // 1. Multiple tools from same domain
  // 2. Any READ tool (to get processed response)
  if (!toolCalls || toolCalls.length === 0) return false;

  const domains = new Set(toolCalls.map(c => getDomainForTool(c.name)).filter(Boolean));

  // Multiple calls to same domain = needs aggregation
  if (toolCalls.length > 1 && domains.size === 1) {
    return true;
  }

  // For now, always route through domain agents for better responses
  return true;
}

export default {
  routeToolCallsToDomains,
  needsDomainRouting
};
