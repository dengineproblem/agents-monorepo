/**
 * MemoryStore - Mid-term memory for Chat Assistant agents
 * Stores and retrieves business specs and agent notes
 */

import { supabase } from '../../lib/supabaseClient.js';
import { logger } from '../../lib/logger.js';
import { v4 as uuidv4 } from 'uuid';

const MAX_NOTES_PER_DOMAIN = 20;
const DOMAINS = ['ads', 'creative', 'whatsapp', 'crm'];

export class MemoryStore {

  // ============================================================
  // SPECS METHODS (Procedural Memory)
  // ============================================================

  /**
   * Get business specs for user/account
   * @param {string} userAccountId
   * @param {string|null} accountId - For multi-account, null for legacy
   * @returns {Promise<Object>} { tracking, crm, kpi }
   */
  async getSpecs(userAccountId, accountId = null) {
    let query = supabase
      .from('user_briefing_responses')
      .select('tracking_spec, crm_spec, kpi_spec')
      .eq('user_id', userAccountId);

    if (accountId) {
      query = query.eq('account_id', accountId);
    } else {
      query = query.is('account_id', null);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      logger.warn({ error: error.message, userAccountId, accountId }, 'Failed to get specs');
      return { tracking: {}, crm: {}, kpi: {} };
    }

    return {
      tracking: data?.tracking_spec || {},
      crm: data?.crm_spec || {},
      kpi: data?.kpi_spec || {}
    };
  }

  /**
   * Update a specific spec (merge with existing)
   * @param {string} userAccountId
   * @param {string|null} accountId
   * @param {'tracking'|'crm'|'kpi'} specType
   * @param {Object} patch - Fields to merge
   */
  async updateSpec(userAccountId, accountId = null, specType, patch) {
    const columnName = `${specType}_spec`;

    // Get current value
    let query = supabase
      .from('user_briefing_responses')
      .select(columnName)
      .eq('user_id', userAccountId);

    if (accountId) {
      query = query.eq('account_id', accountId);
    } else {
      query = query.is('account_id', null);
    }

    const { data: current } = await query.maybeSingle();

    // Merge with patch
    const merged = { ...(current?.[columnName] || {}), ...patch };

    // Upsert
    const { error } = await supabase
      .from('user_briefing_responses')
      .upsert({
        user_id: userAccountId,
        account_id: accountId,
        [columnName]: merged,
        updated_at: new Date().toISOString()
      }, {
        onConflict: accountId ? 'user_id,account_id' : 'user_id'
      });

    if (error) {
      logger.error({ error: error.message, userAccountId, specType }, 'Failed to update spec');
      throw error;
    }

    logger.info({ userAccountId, specType, patchKeys: Object.keys(patch) }, 'Updated spec');
  }

  // ============================================================
  // NOTES METHODS (Mid-term Memory)
  // ============================================================

  /**
   * Get all agent notes for user/account
   * @param {string} userAccountId
   * @param {string|null} accountId
   * @returns {Promise<Object>} { ads: { notes: [...] }, creative: {...}, ... }
   */
  async getAllNotes(userAccountId, accountId = null) {
    let query = supabase
      .from('user_briefing_responses')
      .select('agent_notes')
      .eq('user_id', userAccountId);

    if (accountId) {
      query = query.eq('account_id', accountId);
    } else {
      query = query.is('account_id', null);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      logger.warn({ error: error.message, userAccountId }, 'Failed to get agent notes');
      return this._emptyNotes();
    }

    return data?.agent_notes || this._emptyNotes();
  }

  /**
   * Get notes for a specific domain
   * @param {string} userAccountId
   * @param {string|null} accountId
   * @param {string} domain - 'ads'|'creative'|'whatsapp'|'crm'
   * @returns {Promise<Array>} Array of notes
   */
  async getNotes(userAccountId, accountId, domain) {
    const allNotes = await this.getAllNotes(userAccountId, accountId);
    return allNotes[domain]?.notes || [];
  }

  /**
   * Get notes digest for prompt injection
   * Returns formatted notes from all domains, limited to most important
   * @param {string} userAccountId
   * @param {string|null} accountId
   * @param {string[]} domains - Which domains to include
   * @param {number} maxPerDomain - Max notes per domain
   * @returns {Promise<Object>} { ads: [...], creative: [...], ... }
   */
  async getNotesDigest(userAccountId, accountId, domains = DOMAINS, maxPerDomain = 10) {
    const allNotes = await this.getAllNotes(userAccountId, accountId);
    const digest = {};

    for (const domain of domains) {
      const notes = allNotes[domain]?.notes || [];
      // Sort by importance desc, then by date desc
      const sorted = notes
        .sort((a, b) => {
          if (b.importance !== a.importance) return b.importance - a.importance;
          return new Date(b.created_at) - new Date(a.created_at);
        })
        .slice(0, maxPerDomain);

      digest[domain] = sorted;
    }

    return digest;
  }

  /**
   * Add a note to a domain
   * @param {string} userAccountId
   * @param {string|null} accountId
   * @param {string} domain
   * @param {Object} note - { text, source, importance? }
   */
  async addNote(userAccountId, accountId, domain, note) {
    if (!DOMAINS.includes(domain)) {
      throw new Error(`Invalid domain: ${domain}`);
    }

    const allNotes = await this.getAllNotes(userAccountId, accountId);

    // Initialize domain if needed
    if (!allNotes[domain]) {
      allNotes[domain] = { notes: [], updated_at: null };
    }

    // Check for duplicate (same text)
    const exists = allNotes[domain].notes.some(n => n.text === note.text);
    if (exists) {
      logger.debug({ userAccountId, domain, text: note.text.slice(0, 50) }, 'Note already exists, skipping');
      return;
    }

    // Add new note
    const newNote = {
      id: uuidv4(),
      text: note.text,
      source: note.source || { type: 'unknown' },
      importance: note.importance || 0.5,
      created_at: new Date().toISOString()
    };

    allNotes[domain].notes.push(newNote);
    allNotes[domain].updated_at = new Date().toISOString();

    // Cleanup if over limit
    if (allNotes[domain].notes.length > MAX_NOTES_PER_DOMAIN) {
      allNotes[domain].notes = this._cleanupNotes(allNotes[domain].notes, MAX_NOTES_PER_DOMAIN);
    }

    // Save
    await this._saveNotes(userAccountId, accountId, allNotes);

    logger.info({ userAccountId, domain, noteId: newNote.id, text: note.text.slice(0, 50) }, 'Added note');
  }

  /**
   * Add multiple notes at once
   */
  async addNotes(userAccountId, accountId, domain, notes) {
    for (const note of notes) {
      await this.addNote(userAccountId, accountId, domain, note);
    }
  }

  /**
   * Remove a note by ID
   * @param {string} userAccountId
   * @param {string|null} accountId
   * @param {string} domain
   * @param {string} noteId
   */
  async removeNote(userAccountId, accountId, domain, noteId) {
    const allNotes = await this.getAllNotes(userAccountId, accountId);

    if (!allNotes[domain]?.notes) return;

    const initialLength = allNotes[domain].notes.length;
    allNotes[domain].notes = allNotes[domain].notes.filter(n => n.id !== noteId);

    if (allNotes[domain].notes.length < initialLength) {
      allNotes[domain].updated_at = new Date().toISOString();
      await this._saveNotes(userAccountId, accountId, allNotes);
      logger.info({ userAccountId, domain, noteId }, 'Removed note');
    }
  }

  /**
   * Remove note by text match (for "forget" commands)
   * @param {string} userAccountId
   * @param {string|null} accountId
   * @param {string} searchText - Text to search for
   * @returns {Promise<number>} Number of removed notes
   */
  async removeNoteByText(userAccountId, accountId, searchText) {
    const allNotes = await this.getAllNotes(userAccountId, accountId);
    const searchLower = searchText.toLowerCase();
    let removedCount = 0;

    for (const domain of DOMAINS) {
      if (!allNotes[domain]?.notes) continue;

      const initialLength = allNotes[domain].notes.length;
      allNotes[domain].notes = allNotes[domain].notes.filter(
        n => !n.text.toLowerCase().includes(searchLower)
      );

      if (allNotes[domain].notes.length < initialLength) {
        removedCount += initialLength - allNotes[domain].notes.length;
        allNotes[domain].updated_at = new Date().toISOString();
      }
    }

    if (removedCount > 0) {
      await this._saveNotes(userAccountId, accountId, allNotes);
      logger.info({ userAccountId, searchText, removedCount }, 'Removed notes by text');
    }

    return removedCount;
  }

  /**
   * Clear all notes for a domain
   */
  async clearNotes(userAccountId, accountId, domain) {
    const allNotes = await this.getAllNotes(userAccountId, accountId);

    if (allNotes[domain]) {
      allNotes[domain] = { notes: [], updated_at: new Date().toISOString() };
      await this._saveNotes(userAccountId, accountId, allNotes);
      logger.info({ userAccountId, domain }, 'Cleared domain notes');
    }
  }

  /**
   * List all notes (for chat commands)
   * @param {string} userAccountId
   * @param {string|null} accountId
   * @returns {Promise<Object>} { total, byDomain: { ads: 5, creative: 3, ... } }
   */
  async listNotesSummary(userAccountId, accountId) {
    const allNotes = await this.getAllNotes(userAccountId, accountId);

    const byDomain = {};
    let total = 0;

    for (const domain of DOMAINS) {
      const count = allNotes[domain]?.notes?.length || 0;
      byDomain[domain] = count;
      total += count;
    }

    return { total, byDomain };
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  _emptyNotes() {
    return {
      ads: { notes: [], updated_at: null },
      creative: { notes: [], updated_at: null },
      whatsapp: { notes: [], updated_at: null },
      crm: { notes: [], updated_at: null }
    };
  }

  _cleanupNotes(notes, maxNotes) {
    // Sort: low importance first, then oldest first
    const sorted = [...notes].sort((a, b) => {
      if (a.importance !== b.importance) return a.importance - b.importance;
      return new Date(a.created_at) - new Date(b.created_at);
    });

    // Remove lowest importance/oldest until under limit
    return sorted.slice(sorted.length - maxNotes);
  }

  async _saveNotes(userAccountId, accountId, allNotes) {
    const { error } = await supabase
      .from('user_briefing_responses')
      .upsert({
        user_id: userAccountId,
        account_id: accountId,
        agent_notes: allNotes,
        updated_at: new Date().toISOString()
      }, {
        onConflict: accountId ? 'user_id,account_id' : 'user_id'
      });

    if (error) {
      logger.error({ error: error.message, userAccountId }, 'Failed to save agent notes');
      throw error;
    }
  }
}

// Export singleton instance
export const memoryStore = new MemoryStore();
