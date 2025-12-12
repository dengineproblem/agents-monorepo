/**
 * Orchestrator - Coordinates specialized agents
 * Routes requests and combines responses
 */

import OpenAI from 'openai';
import { classifyRequest } from './classifier.js';
import { buildOrchestratorPrompt, buildSynthesisPrompt } from './systemPrompt.js';
import { AdsAgent } from '../agents/ads/index.js';
import { WhatsAppAgent } from '../agents/whatsapp/index.js';
import { CRMAgent } from '../agents/crm/index.js';
import { logger } from '../../lib/logger.js';

const MODEL = process.env.CHAT_ASSISTANT_MODEL || 'gpt-4o';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export class Orchestrator {
  constructor() {
    // Initialize all agents
    this.agents = {
      ads: new AdsAgent(),
      whatsapp: new WhatsAppAgent(),
      crm: new CRMAgent()
    };
  }

  /**
   * Process a user request
   * @param {Object} params
   * @param {string} params.message - User message
   * @param {Object} params.context - Business context
   * @param {string} params.mode - 'auto' | 'plan' | 'ask'
   * @param {Object} params.toolContext - Context for tool execution
   * @param {Array} params.conversationHistory - Previous messages
   * @returns {Promise<Object>} Response
   */
  async processRequest({ message, context, mode, toolContext, conversationHistory = [] }) {
    const startTime = Date.now();

    try {
      // 1. Classify the request
      const classification = await classifyRequest(message, context);

      logger.info({
        message: message.substring(0, 50),
        classification
      }, 'Request classified');

      // 2. Route to appropriate agent(s)
      let response;

      if (classification.agents.length === 1) {
        // Single agent - delegate directly
        response = await this.delegateToAgent(
          classification.agents[0],
          { message, context, mode, toolContext, conversationHistory }
        );
      } else {
        // Multiple agents - coordinate
        response = await this.coordinateAgents(
          classification.agents,
          { message, context, mode, toolContext, conversationHistory }
        );
      }

      const duration = Date.now() - startTime;
      logger.info({
        duration,
        agents: classification.agents,
        domain: classification.domain
      }, 'Orchestrator processed request');

      return {
        ...response,
        classification,
        duration
      };

    } catch (error) {
      logger.error({ error: error.message }, 'Orchestrator processing failed');
      throw error;
    }
  }

  /**
   * Delegate request to a single agent
   */
  async delegateToAgent(agentName, params) {
    const agent = this.agents[agentName];

    if (!agent) {
      throw new Error(`Unknown agent: ${agentName}`);
    }

    logger.info({ agent: agentName }, 'Delegating to agent');

    return await agent.process(params);
  }

  /**
   * Coordinate multiple agents and synthesize responses
   */
  async coordinateAgents(agentNames, params) {
    const { message, context, mode, toolContext, conversationHistory } = params;

    logger.info({ agents: agentNames }, 'Coordinating multiple agents');

    // Execute agents in parallel
    const agentPromises = agentNames.map(name =>
      this.delegateToAgent(name, { message, context, mode, toolContext, conversationHistory })
        .then(response => ({ name, response }))
        .catch(error => ({ name, error: error.message }))
    );

    const results = await Promise.all(agentPromises);

    // Collect successful responses
    const successfulResponses = results
      .filter(r => r.response && !r.error)
      .map(r => ({
        agent: r.name,
        content: r.response.content,
        executedActions: r.response.executedActions || []
      }));

    if (successfulResponses.length === 0) {
      throw new Error('All agents failed to respond');
    }

    // If only one succeeded, return it directly
    if (successfulResponses.length === 1) {
      return {
        agent: 'Orchestrator',
        delegatedTo: successfulResponses[0].agent,
        content: successfulResponses[0].content,
        executedActions: successfulResponses[0].executedActions,
        toolCalls: []
      };
    }

    // Synthesize multiple responses
    const synthesizedContent = await this.synthesizeResponses(successfulResponses);

    // Combine all executed actions
    const allActions = successfulResponses.flatMap(r => r.executedActions);

    return {
      agent: 'Orchestrator',
      delegatedTo: agentNames,
      content: synthesizedContent,
      executedActions: allActions,
      toolCalls: [],
      agentResponses: successfulResponses
    };
  }

  /**
   * Synthesize responses from multiple agents into one coherent response
   */
  async synthesizeResponses(agentResponses) {
    const synthesisPrompt = buildSynthesisPrompt(agentResponses);

    try {
      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: buildOrchestratorPrompt() },
          { role: 'user', content: synthesisPrompt }
        ],
        temperature: 0.7
      });

      return completion.choices[0].message.content;
    } catch (error) {
      logger.error({ error: error.message }, 'Response synthesis failed');

      // Fallback: concatenate responses
      return agentResponses
        .map(r => `**${r.agent}:**\n${r.content}`)
        .join('\n\n---\n\n');
    }
  }

  /**
   * Get available agents
   */
  getAgents() {
    return Object.keys(this.agents);
  }

  /**
   * Get agent by name
   */
  getAgent(name) {
    return this.agents[name];
  }
}

// Export singleton instance
export const orchestrator = new Orchestrator();
