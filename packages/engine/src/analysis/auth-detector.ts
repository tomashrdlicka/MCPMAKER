// ============================================================
// MCPMAKER Engine - Stage 5: Auth Pattern Detection
// Analyzes headers and cookies to identify auth mechanisms
// ============================================================

import type { NetworkEvent, Session, AuthPattern } from '../types.js';
import { detectAuthPatterns } from './llm.js';

// ---- Cookie Parsing ----

function parseCookieHeader(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const name = pair.substring(0, eqIdx).trim();
    const value = pair.substring(eqIdx + 1).trim();
    cookies[name] = value;
  }
  return cookies;
}

// ---- Heuristic Auth Detection ----

interface HeaderAnalysis {
  consistentHeaders: Record<string, string[]>;
  consistentCookies: Record<string, string[]>;
  consistentQueryParams: Record<string, string[]>;
}

function analyzeHeaders(sessions: Session[]): HeaderAnalysis {
  const headerValues = new Map<string, string[]>();
  const cookieValues = new Map<string, string[]>();
  const queryParamValues = new Map<string, string[]>();

  for (const session of sessions) {
    // Track headers seen in this session
    const sessionHeaders = new Map<string, Set<string>>();
    const sessionCookies = new Map<string, Set<string>>();
    const sessionQueryParams = new Map<string, Set<string>>();

    for (const event of session.networkEvents) {
      // Analyze request headers
      for (const [key, value] of Object.entries(event.requestHeaders)) {
        const lowerKey = key.toLowerCase();

        // Skip common non-auth headers
        if (['content-type', 'accept', 'user-agent', 'host', 'content-length', 'origin', 'referer'].includes(lowerKey)) {
          continue;
        }

        const headerSet = sessionHeaders.get(lowerKey) || new Set();
        headerSet.add(value);
        sessionHeaders.set(lowerKey, headerSet);
      }

      // Parse and analyze cookies
      const cookieHeader = event.requestHeaders['cookie'] || event.requestHeaders['Cookie'] || '';
      if (cookieHeader) {
        const cookies = parseCookieHeader(cookieHeader);
        for (const [name, value] of Object.entries(cookies)) {
          const cookieSet = sessionCookies.get(name) || new Set();
          cookieSet.add(value);
          sessionCookies.set(name, cookieSet);
        }
      }

      // Analyze query parameters that might be auth-related
      try {
        const url = new URL(event.url);
        for (const [key, value] of url.searchParams.entries()) {
          const lowerKey = key.toLowerCase();
          if (['key', 'api_key', 'apikey', 'token', 'access_token', 'auth'].includes(lowerKey)) {
            const paramSet = sessionQueryParams.get(key) || new Set();
            paramSet.add(value);
            sessionQueryParams.set(key, paramSet);
          }
        }
      } catch {
        // Skip malformed URLs
      }
    }

    // Accumulate per-session values
    for (const [key, values] of sessionHeaders) {
      const existing = headerValues.get(key) || [];
      existing.push([...values].join(','));
      headerValues.set(key, existing);
    }

    for (const [key, values] of sessionCookies) {
      const existing = cookieValues.get(key) || [];
      existing.push([...values].join(','));
      cookieValues.set(key, existing);
    }

    for (const [key, values] of sessionQueryParams) {
      const existing = queryParamValues.get(key) || [];
      existing.push([...values].join(','));
      queryParamValues.set(key, existing);
    }
  }

  // Find headers/cookies consistent across sessions
  const consistentHeaders: Record<string, string[]> = {};
  const consistentCookies: Record<string, string[]> = {};
  const consistentQueryParams: Record<string, string[]> = {};

  for (const [key, values] of headerValues) {
    // Present in all sessions
    if (values.length >= sessions.length) {
      consistentHeaders[key] = values;
    }
  }

  for (const [key, values] of cookieValues) {
    if (values.length >= sessions.length) {
      consistentCookies[key] = values;
    }
  }

  for (const [key, values] of queryParamValues) {
    if (values.length >= sessions.length) {
      consistentQueryParams[key] = values;
    }
  }

  return { consistentHeaders, consistentCookies, consistentQueryParams };
}

// ---- Heuristic Classification ----

function heuristicDetect(analysis: HeaderAnalysis): AuthPattern {
  const credentialFields: AuthPattern['credentialFields'] = [];

  // Check for Bearer token
  if (analysis.consistentHeaders['authorization']) {
    const values = analysis.consistentHeaders['authorization'];
    if (values.some((v) => v.startsWith('Bearer '))) {
      credentialFields.push({
        name: 'bearerToken',
        description: 'Bearer authentication token (JWT or opaque token)',
        location: 'header',
      });

      // Also check for CSRF tokens
      addCsrfFields(analysis, credentialFields);

      return {
        type: 'bearer',
        credentialFields,
      };
    }
  }

  // Check for API key in headers
  const apiKeyHeaders = ['x-api-key', 'api-key', 'apikey'];
  for (const headerName of apiKeyHeaders) {
    if (analysis.consistentHeaders[headerName]) {
      credentialFields.push({
        name: 'apiKey',
        description: `API key passed in ${headerName} header`,
        location: 'header',
      });

      return {
        type: 'api_key',
        credentialFields,
      };
    }
  }

  // Check for API key in query params
  if (Object.keys(analysis.consistentQueryParams).length > 0) {
    for (const [key] of Object.entries(analysis.consistentQueryParams)) {
      credentialFields.push({
        name: key,
        description: `API key passed as query parameter "${key}"`,
        location: 'query',
      });
    }

    return {
      type: 'api_key',
      credentialFields,
    };
  }

  // Check for session cookies
  const sessionCookieNames = ['session', 'sessionid', 'session_id', 'sid', 'connect.sid', 'JSESSIONID', 'PHPSESSID', '_session'];
  for (const [cookieName] of Object.entries(analysis.consistentCookies)) {
    const lowerName = cookieName.toLowerCase();
    if (sessionCookieNames.some((sc) => lowerName.includes(sc.toLowerCase()))) {
      credentialFields.push({
        name: cookieName,
        description: `Session cookie "${cookieName}"`,
        location: 'cookie',
      });
    }
  }

  if (credentialFields.length > 0) {
    addCsrfFields(analysis, credentialFields);
    return {
      type: 'cookie',
      credentialFields,
    };
  }

  // If we found consistent cookies but couldn't identify session cookies
  if (Object.keys(analysis.consistentCookies).length > 0) {
    for (const [cookieName] of Object.entries(analysis.consistentCookies)) {
      credentialFields.push({
        name: cookieName,
        description: `Cookie "${cookieName}" (used consistently across sessions)`,
        location: 'cookie',
      });
    }

    addCsrfFields(analysis, credentialFields);
    return {
      type: 'cookie',
      credentialFields,
    };
  }

  // No auth detected
  return {
    type: 'custom',
    credentialFields: [],
  };
}

function addCsrfFields(
  analysis: HeaderAnalysis,
  credentialFields: AuthPattern['credentialFields']
): void {
  const csrfHeaders = ['x-csrf-token', 'x-xsrf-token', 'csrf-token', 'x-csrftoken'];
  for (const headerName of csrfHeaders) {
    if (analysis.consistentHeaders[headerName]) {
      credentialFields.push({
        name: 'csrfToken',
        description: `CSRF protection token in ${headerName} header`,
        location: 'header',
      });
      break;
    }
  }

  // Check for CSRF cookies
  const csrfCookieNames = ['csrf', 'xsrf', '_csrf'];
  for (const [cookieName] of Object.entries(analysis.consistentCookies)) {
    if (csrfCookieNames.some((c) => cookieName.toLowerCase().includes(c))) {
      credentialFields.push({
        name: `${cookieName}Cookie`,
        description: `CSRF cookie "${cookieName}"`,
        location: 'cookie',
      });
      break;
    }
  }
}

// ---- Full Auth Detection Pipeline ----

export async function detectAuth(sessions: Session[]): Promise<AuthPattern> {
  // Step 1: Analyze headers across all sessions
  const analysis = analyzeHeaders(sessions);

  // Step 2: Quick heuristic detection
  const heuristicResult = heuristicDetect(analysis);

  // If we didn't find any auth, return early
  if (heuristicResult.credentialFields.length === 0) {
    return heuristicResult;
  }

  // Step 3: LLM validation for better naming and descriptions
  try {
    const llmResult = await detectAuthPatterns(analysis);

    return {
      type: llmResult.type,
      credentialFields: llmResult.credentialFields,
    };
  } catch (error) {
    console.warn('LLM auth detection failed, using heuristic results:', (error as Error).message);
    return heuristicResult;
  }
}
