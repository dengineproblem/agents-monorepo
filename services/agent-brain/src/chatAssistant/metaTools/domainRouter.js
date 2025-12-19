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

  // 1. Group tool calls by domain
  const byDomain = groupByDomain(toolCalls);

  logger.info({
    domains: Object.keys(byDomain),
    toolCounts: Object.fromEntries(
      Object.entries(byDomain).map(([d, calls]) => [d, calls.length])
    )
  }, 'Domain router: grouped tool calls');

  // 2. Execute tools for each domain in parallel
  const domainPromises = Object.entries(byDomain).map(async ([domain, domainCalls]) => {
    try {
      // Execute all tools for this domain
      const rawResults = await executeToolsForDomain(domainCalls, context);

      // Pass raw results to domain agent for processing
      const processedResponse = await processDomainResults(
        domain,
        domainCalls,
        rawResults,
        context,
        userMessage
      );

      return {
        domain,
        success: true,
        response: processedResponse,
        toolsExecuted: domainCalls.map(c => c.name),
        latency_ms: Date.now() - startTime
      };

    } catch (error) {
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

  // Execute tools in parallel within domain (via MCP bridge)
  const promises = toolCalls.map(async (call) => {
    const result = await executeToolAdaptive(call.name, call.args, context);
    return { name: call.name, args: call.args, result };
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
