/**
 * Bizon365 API Adapter
 * 
 * Provides integration with Bizon365 webinar platform API
 * https://online.bizon365.ru/api/v1
 * 
 * @module adapters/bizon
 */

import fetch from 'node-fetch';

const BIZON_API_URL = process.env.BIZON_API_URL || 'https://online.bizon365.ru/api/v1';

/**
 * Bizon365 viewer data structure
 */
export interface BizonViewer {
  username?: string;
  email?: string;
  phone?: string;
  view?: number; // view duration in seconds (sometimes called viewDuration)
  viewDuration?: number;
  joinTime?: string;
  leaveTime?: string;
  webinarTime?: string;
  created?: string;
  
  // UTM tracking
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  url_marker?: string; // Partner/affiliate marker
  
  // Additional fields that may come from Bizon
  [key: string]: any;
}

/**
 * Bizon API response for getviewers endpoint
 */
interface BizonViewersResponse {
  list?: BizonViewer[];
  viewers?: BizonViewer[];
  total?: number;
  [key: string]: any;
}

/**
 * Options for fetching webinar viewers
 */
export interface FetchViewersOptions {
  webinarId: string;
  apiToken: string;
  limit?: number;
  skip?: number;
}

/**
 * Fetch viewers for a specific webinar from Bizon365 API
 * 
 * @param webinarId - Bizon365 webinar ID
 * @param apiToken - User's Bizon365 API token
 * @returns Array of viewer objects
 * 
 * @example
 * const viewers = await fetchWebinarViewers('webinar123', 'token_xyz');
 */
export async function fetchWebinarViewers(
  webinarId: string,
  apiToken: string
): Promise<BizonViewer[]> {
  const allViewers: BizonViewer[] = [];
  const limit = 1000; // Maximum allowed by Bizon API
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const url = `${BIZON_API_URL}/webinars/reports/getviewers?webinarId=${encodeURIComponent(webinarId)}&limit=${limit}&skip=${skip}`;
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Token': apiToken,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Bizon API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json() as BizonViewersResponse;
      
      // Bizon API may return viewers in 'list' or 'viewers' field
      const viewers = data.list || data.viewers || [];
      
      if (viewers.length === 0) {
        hasMore = false;
      } else {
        allViewers.push(...viewers);
        
        // If we got less than limit, we've reached the end
        if (viewers.length < limit) {
          hasMore = false;
        } else {
          skip += limit;
        }
      }
    } catch (error) {
      console.error('Error fetching webinar viewers from Bizon:', error);
      throw error;
    }
  }

  return allViewers;
}

/**
 * Fetch viewers with pagination control (for advanced use cases)
 * 
 * @param options - Fetch options with pagination parameters
 * @returns Object with viewers array and pagination info
 */
export async function fetchWebinarViewersPage(
  options: FetchViewersOptions
): Promise<{ viewers: BizonViewer[]; hasMore: boolean; total?: number }> {
  const { webinarId, apiToken, limit = 1000, skip = 0 } = options;
  
  const url = `${BIZON_API_URL}/webinars/reports/getviewers?webinarId=${encodeURIComponent(webinarId)}&limit=${limit}&skip=${skip}`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Token': apiToken,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bizon API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as BizonViewersResponse;
    const viewers = data.list || data.viewers || [];
    const total = data.total;
    const hasMore = viewers.length === limit;

    return {
      viewers,
      hasMore,
      total
    };
  } catch (error) {
    console.error('Error fetching webinar viewers page from Bizon:', error);
    throw error;
  }
}

/**
 * Test connection to Bizon365 API with given token
 * 
 * @param apiToken - API token to test
 * @returns true if token is valid
 */
export async function testBizonConnection(apiToken: string): Promise<boolean> {
  try {
    // Try to fetch webinars list as a connection test
    const url = `${BIZON_API_URL}/webinars`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Token': apiToken,
        'Content-Type': 'application/json'
      }
    });

    return response.ok;
  } catch (error) {
    console.error('Error testing Bizon connection:', error);
    return false;
  }
}

