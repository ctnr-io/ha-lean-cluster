/**
 * OAuth configuration options
 */
export interface OAuthConfig {
  /**
   * OAuth token endpoint URL
   */
  tokenUrl: string;
  
  /**
   * OAuth client ID
   */
  clientId: string;
  
  /**
   * OAuth client secret
   */
  clientSecret: string;
  
  /**
   * OAuth username (for password grant)
   */
  username?: string;
  
  /**
   * OAuth password (for password grant)
   */
  password?: string;
  
  /**
   * OAuth scope
   */
  scope?: string;
  
  /**
   * OAuth grant type (default: 'password')
   */
  grantType?: 'password' | 'client_credentials' | 'refresh_token';
  
  /**
   * OAuth refresh token
   */
  refreshToken?: string;
  
  /**
   * Custom fetch implementation (defaults to global fetch)
   */
  fetchImpl?: typeof fetch;
}

/**
 * OAuth token response
 */
interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * Creates a middleware that adds OAuth authentication to requests
 * 
 * @param oauthConfig OAuth configuration
 * @returns Middleware function
 * 
 * @example
 * // Create an OAuth middleware
 * const oauthMiddleware = createGetToken({
 *   tokenUrl: 'https://api.example.com/oauth2/token',
 *   clientId: 'your-client-id',
 *   clientSecret: 'your-client-secret',
 *   username: 'your-username',
 *   password: 'your-password',
 * });
 * 
 */
export function createGetToken(oauthConfig: OAuthConfig)  { 
  // Token storage
  let accessToken: string | null = null;
  let refreshToken: string | null = oauthConfig.refreshToken || null;
  let tokenExpiry: number = 0;
  
  /**
   * Gets a valid OAuth token, refreshing if necessary
   */
  async function getToken(): Promise<string> {
    // Check if token is still valid (with 60s buffer)
    if (accessToken && tokenExpiry > Date.now() + 60000) {
      return accessToken;
    }
    
    // Determine grant type and parameters
    const grantType = oauthConfig.grantType || 'password';
    const params: Record<string, string> = {
      grant_type: grantType,
      client_id: oauthConfig.clientId,
      client_secret: oauthConfig.clientSecret,
    };
    
    // Add grant type specific parameters
    if (grantType === 'password') {
      if (!oauthConfig.username || !oauthConfig.password) {
        throw new Error('Username and password are required for password grant');
      }
      params.username = oauthConfig.username;
      params.password = oauthConfig.password;
    } else if (grantType === 'refresh_token') {
      if (!refreshToken) {
        throw new Error('Refresh token is required for refresh_token grant');
      }
      params.refresh_token = refreshToken;
    }
    
    // Add scope if provided
    if (oauthConfig.scope) {
      params.scope = oauthConfig.scope;
    }
    
    // Request new token
    const fetchImpl = oauthConfig.fetchImpl || fetch;
    const response = await fetchImpl(oauthConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get OAuth token: ${response.statusText}`);
    }
    
    const data = await response.json() as TokenResponse;
    accessToken = data.access_token;
    if (data.refresh_token) {
      refreshToken = data.refresh_token;
    }
    tokenExpiry = Date.now() + (data.expires_in * 1000);
    
    if (!accessToken) {
      throw new Error('Failed to get access token from response');
    }
    
    return accessToken;
  }
  
	return getToken
}