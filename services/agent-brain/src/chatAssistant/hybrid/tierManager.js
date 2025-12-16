/**
 * Tier Manager - Управление переходами между tier'ами
 *
 * Tier State Structure:
 * - playbookId: ID активного playbook
 * - currentTier: 'snapshot' | 'drilldown' | 'actions'
 * - completedTiers: string[] - завершённые tier'ы
 * - snapshotData: Object - результаты snapshot tier
 * - transitionHistory: Array - история переходов
 * - pendingNextStep: Object|null - выбранный пользователем next step
 */

import { logger } from '../../lib/logger.js';
import { playbookRegistry } from './playbookRegistry.js';
import { evaluateCondition } from './expressionEvaluator.js';

/**
 * Допустимые tier'ы
 */
export const TIERS = {
  SNAPSHOT: 'snapshot',
  DRILLDOWN: 'drilldown',
  ACTIONS: 'actions'
};

/**
 * Порядок tier'ов (для валидации переходов)
 */
const TIER_ORDER = [TIERS.SNAPSHOT, TIERS.DRILLDOWN, TIERS.ACTIONS];

/**
 * TierManager class
 */
export class TierManager {
  /**
   * Создать начальный tier state для playbook
   * @param {string} playbookId
   * @param {Object} context - Дополнительный контекст
   * @returns {Object} tierState
   */
  createInitialState(playbookId, context = {}) {
    const playbook = playbookRegistry.getPlaybook(playbookId);

    if (!playbook) {
      logger.warn({ playbookId }, 'Playbook not found, using default state');
      return {
        playbookId,
        currentTier: TIERS.SNAPSHOT,
        completedTiers: [],
        snapshotData: null,
        transitionHistory: [{
          from: null,
          to: TIERS.SNAPSHOT,
          timestamp: Date.now(),
          reason: 'initial'
        }],
        pendingNextStep: null,
        createdAt: Date.now()
      };
    }

    return {
      playbookId,
      currentTier: TIERS.SNAPSHOT,
      completedTiers: [],
      snapshotData: null,
      transitionHistory: [{
        from: null,
        to: TIERS.SNAPSHOT,
        timestamp: Date.now(),
        reason: 'initial'
      }],
      pendingNextStep: null,
      createdAt: Date.now(),
      domain: playbook.domain
    };
  }

  /**
   * Проверить, можно ли перейти в target tier
   * @param {Object} tierState - Текущий state
   * @param {string} targetTier - Целевой tier
   * @param {Object} data - Данные для проверки условий
   * @returns {{ allowed: boolean, reason: string }}
   */
  canTransitionTo(tierState, targetTier, data = {}) {
    const { playbookId, currentTier, completedTiers } = tierState;

    // Проверяем, что tier существует
    if (!TIER_ORDER.includes(targetTier)) {
      return { allowed: false, reason: `Unknown tier: ${targetTier}` };
    }

    // Можно вернуться в уже пройденный tier
    if (completedTiers.includes(targetTier)) {
      return { allowed: true, reason: 'revisit_completed' };
    }

    // Нельзя перескочить через tier (snapshot → actions)
    const currentIndex = TIER_ORDER.indexOf(currentTier);
    const targetIndex = TIER_ORDER.indexOf(targetTier);

    if (targetIndex > currentIndex + 1) {
      return {
        allowed: false,
        reason: `Cannot skip tiers: ${currentTier} → ${targetTier}`
      };
    }

    // Проверяем enterIf условия для target tier
    const playbook = playbookRegistry.getPlaybook(playbookId);
    if (playbook && playbook.tiers[targetTier]?.enterIf) {
      const enterIf = playbook.tiers[targetTier].enterIf;
      const conditionsMet = this._checkEnterConditions(enterIf, data, tierState);

      if (!conditionsMet.passed) {
        return {
          allowed: false,
          reason: `Enter conditions not met: ${conditionsMet.failedConditions.join(', ')}`
        };
      }
    }

    return { allowed: true, reason: 'ok' };
  }

  /**
   * Выполнить переход в новый tier
   * @param {Object} tierState - Текущий state
   * @param {string} targetTier - Целевой tier
   * @param {Object} context - Контекст перехода
   * @returns {Object} Новый tierState
   */
  transitionTo(tierState, targetTier, context = {}) {
    const { currentTier, completedTiers, transitionHistory } = tierState;

    // Добавляем текущий tier в completed, если ещё не там
    const newCompletedTiers = [...completedTiers];
    if (!newCompletedTiers.includes(currentTier)) {
      newCompletedTiers.push(currentTier);
    }

    const transition = {
      from: currentTier,
      to: targetTier,
      timestamp: Date.now(),
      reason: context.reason || 'user_request',
      triggeredBy: context.triggeredBy || null
    };

    logger.info({
      playbookId: tierState.playbookId,
      transition
    }, 'Tier transition');

    return {
      ...tierState,
      currentTier: targetTier,
      completedTiers: newCompletedTiers,
      transitionHistory: [...transitionHistory, transition],
      pendingNextStep: null,  // Сбрасываем после перехода
      lastTransitionAt: Date.now()
    };
  }

  /**
   * Сохранить данные snapshot tier
   * @param {Object} tierState
   * @param {Object} data - Данные для сохранения
   * @returns {Object} Обновлённый tierState
   */
  saveSnapshotData(tierState, data) {
    return {
      ...tierState,
      snapshotData: {
        ...tierState.snapshotData,
        ...data,
        savedAt: Date.now()
      }
    };
  }

  /**
   * Установить pending next step
   * @param {Object} tierState
   * @param {Object} nextStep - Выбранный next step
   * @returns {Object} Обновлённый tierState
   */
  setPendingNextStep(tierState, nextStep) {
    return {
      ...tierState,
      pendingNextStep: {
        ...nextStep,
        selectedAt: Date.now()
      }
    };
  }

  /**
   * Очистить pending next step
   * @param {Object} tierState
   * @returns {Object}
   */
  clearPendingNextStep(tierState) {
    return {
      ...tierState,
      pendingNextStep: null
    };
  }

  /**
   * Получить policy для текущего tier
   * @param {Object} tierState
   * @returns {Object} Policy
   */
  getCurrentPolicy(tierState) {
    return playbookRegistry.getTierPolicy(
      tierState.playbookId,
      tierState.currentTier
    );
  }

  /**
   * Проверить, завершён ли tier
   * @param {Object} tierState
   * @param {string} tier
   * @returns {boolean}
   */
  isTierCompleted(tierState, tier) {
    return tierState.completedTiers.includes(tier);
  }

  /**
   * Получить доступные next steps для текущего состояния
   * @param {Object} tierState
   * @param {Object} businessContext - Бизнес-контекст
   * @returns {Array}
   */
  getAvailableNextSteps(tierState, businessContext = {}) {
    const { playbookId, currentTier, snapshotData } = tierState;

    const allNextSteps = playbookRegistry.getNextSteps(playbookId, {
      ...snapshotData,
      ...businessContext,
      currentTier
    });

    // Фильтруем недоступные переходы
    return allNextSteps.filter(step => {
      const { allowed } = this.canTransitionTo(
        tierState,
        step.targetTier,
        { ...snapshotData, ...businessContext, user_chose_drilldown: true }
      );
      return allowed;
    });
  }

  /**
   * Вычислить enter conditions для всех tier'ов
   * @param {Object} tierState
   * @param {Object} data - Бизнес-данные
   * @returns {Object} - { tierName: { conditionName: boolean } }
   */
  evaluateAllEnterConditions(tierState, data) {
    const { playbookId } = tierState;
    const playbook = playbookRegistry.getPlaybook(playbookId);

    if (!playbook) return {};

    const results = {};
    for (const [tierName, tierConfig] of Object.entries(playbook.tiers)) {
      if (tierConfig.enterIf) {
        results[tierName] = {};
        for (const condition of tierConfig.enterIf) {
          results[tierName][condition] = this._evaluateSingleCondition(condition, data, tierState);
        }
      }
    }

    return results;
  }

  /**
   * Проверить, нужно ли auto-escalate в следующий tier
   * @param {Object} tierState
   * @param {Object} data - Бизнес-данные
   * @returns {{ shouldEscalate: boolean, targetTier: string|null, reason: string|null }}
   */
  checkAutoEscalation(tierState, data) {
    const { playbookId, currentTier } = tierState;
    const playbook = playbookRegistry.getPlaybook(playbookId);

    if (!playbook) {
      return { shouldEscalate: false, targetTier: null, reason: null };
    }

    // Определяем следующий tier
    const currentIndex = TIER_ORDER.indexOf(currentTier);
    if (currentIndex >= TIER_ORDER.length - 1) {
      return { shouldEscalate: false, targetTier: null, reason: 'already_at_max_tier' };
    }

    const nextTier = TIER_ORDER[currentIndex + 1];
    const nextTierConfig = playbook.tiers[nextTier];

    if (!nextTierConfig || !nextTierConfig.enterIf) {
      return { shouldEscalate: false, targetTier: null, reason: 'no_auto_conditions' };
    }

    // Проверяем условия для auto-escalation (не user_chose_drilldown)
    for (const condition of nextTierConfig.enterIf) {
      if (condition === 'user_chose_drilldown') continue;

      if (this._evaluateSingleCondition(condition, data, tierState)) {
        return {
          shouldEscalate: true,
          targetTier: nextTier,
          reason: condition
        };
      }
    }

    return { shouldEscalate: false, targetTier: null, reason: null };
  }

  /**
   * Проверить enter conditions
   * @private
   */
  _checkEnterConditions(enterIf, data, tierState) {
    const failedConditions = [];

    for (const condition of enterIf) {
      // user_chose_drilldown — специальное условие, проверяется через data
      if (condition === 'user_chose_drilldown') {
        if (!data.user_chose_drilldown && !tierState.pendingNextStep) {
          failedConditions.push(condition);
        }
        continue;
      }

      // Вычисляем через evaluateCondition
      if (!this._evaluateSingleCondition(condition, data, tierState)) {
        failedConditions.push(condition);
      }
    }

    // enterIf — это ИЛИ (достаточно одного true), не И
    const passed = enterIf.length === 0 || failedConditions.length < enterIf.length;

    return { passed, failedConditions };
  }

  /**
   * Вычислить одно условие
   * @private
   */
  _evaluateSingleCondition(condition, data, tierState) {
    // Сначала проверяем предустановленные условия
    const presetConditions = {
      'user_chose_drilldown': () => !!data.user_chose_drilldown || !!tierState.pendingNextStep,
      'isHighCPL': () => evaluateCondition('isHighCPL', data),
      'isSmallSample': () => evaluateCondition('isSmallSample', data),
      'isZeroSpend': () => evaluateCondition('isZeroSpend', data),
      'isSpendNoLeads': () => evaluateCondition('isSpendNoLeads', data),
      'hasWhatsApp': () => !!data.integrations?.whatsapp,
      'hasWorstCreatives': () => (data.worstCreativesCount || 0) > 0
    };

    if (presetConditions[condition]) {
      return presetConditions[condition]();
    }

    // Иначе вычисляем как expression
    return evaluateCondition(condition, data);
  }

  /**
   * Сериализовать tierState для хранения в БД
   * @param {Object} tierState
   * @returns {Object}
   */
  serialize(tierState) {
    return {
      playbookId: tierState.playbookId,
      currentTier: tierState.currentTier,
      completedTiers: tierState.completedTiers,
      snapshotData: tierState.snapshotData,
      transitionHistory: tierState.transitionHistory.slice(-10),  // Last 10 only
      pendingNextStep: tierState.pendingNextStep,
      domain: tierState.domain,
      createdAt: tierState.createdAt,
      lastTransitionAt: tierState.lastTransitionAt
    };
  }

  /**
   * Десериализовать tierState из БД
   * @param {Object} data
   * @returns {Object}
   */
  deserialize(data) {
    if (!data) return null;

    return {
      playbookId: data.playbookId,
      currentTier: data.currentTier || TIERS.SNAPSHOT,
      completedTiers: data.completedTiers || [],
      snapshotData: data.snapshotData || null,
      transitionHistory: data.transitionHistory || [],
      pendingNextStep: data.pendingNextStep || null,
      domain: data.domain,
      createdAt: data.createdAt,
      lastTransitionAt: data.lastTransitionAt
    };
  }

  /**
   * Проверить, истёк ли tierState (TTL 1 час)
   * @param {Object} tierState
   * @returns {boolean}
   */
  isExpired(tierState) {
    if (!tierState || !tierState.createdAt) return true;

    const TTL_MS = 60 * 60 * 1000;  // 1 hour
    return Date.now() - tierState.createdAt > TTL_MS;
  }
}

// Singleton instance
export const tierManager = new TierManager();

export default tierManager;
