/**
 * This module provides a middleware system for the fetch API.
 * It allows you to enhance the fetch function with additional functionality.
 */

/**
 * Type for a fetch function
 */
export type FetchFunction = typeof fetch;

/**
 * Type for a fetch middleware
 * A middleware takes a fetch function and returns a new fetch function with enhanced functionality
 */
export type FetchMiddleware = (fetch: FetchFunction) => FetchFunction;

/**
 * Creates a fetch middleware from a handler function
 * 
 * @param handler Function that handles the request and can modify it before passing to the next middleware
 * @returns A fetch middleware
 * 
 * @example
 * // Create a middleware that adds a header
 * const authMiddleware = createFetchMiddleware(async (request, next) => {
 *   // Add authorization header
 *   request.headers = {
 *     ...request.headers,
 *     'Authorization': 'Bearer token123',
 *   };
 *   
 *   // Call the next middleware
 *   return next(request);
 * });
 * 
 * // Create a middleware that logs requests
 * const loggingMiddleware = createFetchMiddleware(async (request, next) => {
 *   console.log(`Request: ${request.method} ${request.url}`);
 *   
 *   // Call the next middleware and get the response
 *   const response = await next(request);
 *   
 *   console.log(`Response: ${response.status} ${response.statusText}`);
 *   
 *   // Return the response
 *   return response;
 * });
 */
export function createFetchMiddleware(
  handler: (
    request: Request,
    next: (request: Request) => Promise<Response>
  ) => Promise<Response>
): FetchMiddleware {
  return (fetch) => {
    return async (input, init) => {
      // Create a Request object
      const request = new Request(input, init);
      
      // Create a next function that calls the fetch function
      const next = (req: Request) => fetch(req);
      
      // Call the handler
      return handler(request, next);
    };
  };
}

/**
 * Creates a fetch function with middleware
 * 
 * @param middlewares Array of middleware functions to apply
 * @param baseFetch Base fetch function to enhance (defaults to global fetch)
 * @returns Enhanced fetch function
 * 
 * @example
 * // Create a logging middleware
 * const loggingMiddleware: FetchMiddleware = (fetch) => {
 *   return async (input, init) => {
 *     console.log(`Fetching ${input}`);
 *     const response = await fetch(input, init);
 *     console.log(`Received response from ${input}`);
 *     return response;
 *   };
 * };
 * 
 * // Create a fetch function with the logging middleware
 * const enhancedFetch = createFetchWithMiddleware([loggingMiddleware]);
 * 
 * // Use the enhanced fetch function
 * const response = await enhancedFetch('https://api.example.com/users');
 */
export function createFetchWithMiddleware(
  middlewares: FetchMiddleware[],
  baseFetch: FetchFunction = globalThis.fetch
): FetchFunction {
  // Apply middlewares in reverse order (last middleware is applied first)
  return middlewares.reduceRight(
    (fetch, middleware) => middleware(fetch),
    baseFetch
  );
}

/**
 * Creates a middleware that adds headers to requests
 * 
 * @param headers Headers to add to requests
 * @returns Middleware function
 * 
 * @example
 * // Create a middleware that adds headers
 * const headersMiddleware = createHeadersMiddleware({
 *   'Content-Type': 'application/json',
 *   'X-API-Key': 'your-api-key',
 * });
 * 
 * // Create a fetch function with the headers middleware
 * const enhancedFetch = createFetchWithMiddleware([headersMiddleware]);
 */
export function createHeadersMiddleware(headers: Record<string, string> | (() => Promise<Record<string, string>>)): FetchMiddleware {
  return createFetchMiddleware(async (request, next) => {
    // Add headers to the request
    const headersToAdd = typeof headers === 'function' ? await headers() : headers;
    
    for (const [key, value] of Object.entries(headersToAdd)) {
      request.headers.set(key, value);
    }
    
    // Call the next middleware
    return next(request);
  });
}

/**
 * Creates a middleware that adds base URL to requests
 * 
 * @param baseUrl Base URL to prepend to relative URLs
 * @returns Middleware function
 * 
 * @example
 * // Create a middleware that adds base URL
 * const baseUrlMiddleware = createBaseUrlMiddleware('https://api.example.com');
 * 
 * // Create a fetch function with the base URL middleware
 * const enhancedFetch = createFetchWithMiddleware([baseUrlMiddleware]);
 * 
 * // Use the enhanced fetch function with a relative URL
 * const response = await enhancedFetch('/users');
 * // This will fetch from https://api.example.com/users
 */
export function createBaseUrlMiddleware(baseUrl: string): FetchMiddleware {
  return createFetchMiddleware(async (request, next) => {
    // Only prepend base URL to relative URLs
    const url = new URL(request.url);
    
    if (url.origin === 'null' || url.origin === self.location?.origin) {
      // Create a new request with the base URL
      const newUrl = new URL(request.url, baseUrl);
      const newRequest = new Request(newUrl, request);
      
      // Call the next middleware with the new request
      return next(newRequest);
    }
    
    // Call the next middleware with the original request
    return next(request);
  });
}

/**
 * Creates a middleware that retries failed requests
 * 
 * @param options Retry options
 * @returns Middleware function
 * 
 * @example
 * // Create a middleware that retries failed requests
 * const retryMiddleware = createRetryMiddleware({
 *   maxRetries: 3,
 *   retryDelay: 1000,
 *   retryStatusCodes: [429, 503],
 * });
 * 
 * // Create a fetch function with the retry middleware
 * const enhancedFetch = createFetchWithMiddleware([retryMiddleware]);
 */
export function createRetryMiddleware(options: {
  maxRetries?: number;
  retryDelay?: number;
  retryStatusCodes?: number[];
} = {}): FetchMiddleware {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    retryStatusCodes = [429, 503],
  } = options;

  return (fetch) => {
    return async (input, init) => {
      let retries = 0;
      let lastError: Error | null = null;

      while (retries <= maxRetries) {
        try {
          const response = await fetch(input, init);
          
          // If response is ok or not in retry status codes, return it
          if (response.ok || !retryStatusCodes.includes(response.status)) {
            return response;
          }
          
          // Clone the response before consuming it
          const clonedResponse = response.clone();
          
          // If we've reached max retries, return the response
          if (retries === maxRetries) {
            return clonedResponse;
          }
          
          // Otherwise, increment retries and try again after delay
          retries++;
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } catch (error) {
          // If we've reached max retries, throw the error
          if (retries === maxRetries) {
            throw error;
          }
          
          // Otherwise, increment retries and try again after delay
          lastError = error as Error;
          retries++;
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
      
      // This should never happen, but TypeScript needs it
      throw lastError || new Error('Max retries reached');
    };
  };
}

/**
 * Creates a middleware that adds timeout to requests
 * 
 * @param timeout Timeout in milliseconds
 * @returns Middleware function
 * 
 * @example
 * // Create a middleware that adds timeout
 * const timeoutMiddleware = createTimeoutMiddleware(5000);
 * 
 * // Create a fetch function with the timeout middleware
 * const enhancedFetch = createFetchWithMiddleware([timeoutMiddleware]);
 */
export function createTimeoutMiddleware(timeout: number): FetchMiddleware {
  return (fetch) => {
    return async (input, init) => {
      // Create an abort controller
      const controller = new AbortController();
      
      // Set up timeout
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeout);
      
      try {
        // Make the request with the abort signal
        return await fetch(input, {
          ...init,
          signal: controller.signal,
        });
      } finally {
        // Clear the timeout
        clearTimeout(timeoutId);
      }
    };
  };
}

/**
 * Creates a middleware that logs requests and responses
 * 
 * @param options Logging options
 * @returns Middleware function
 * 
 * @example
 * // Create a middleware that logs requests and responses
 * const loggingMiddleware = createLoggingMiddleware();
 * 
 * // Create a fetch function with the logging middleware
 * const enhancedFetch = createFetchWithMiddleware([loggingMiddleware]);
 */
export function createLoggingMiddleware(options: {
  logRequest?: boolean;
  logResponse?: boolean;
  logger?: (message: string) => void;
} = {}): FetchMiddleware {
  const {
    logRequest = true,
    logResponse = true,
    logger = console.log,
  } = options;

  return (fetch) => {
    return async (input, init) => {
      // Log request
      if (logRequest) {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        logger(`Fetch request: ${init?.method || 'GET'} ${url}`);
      }
      
      // Make the request
      const startTime = Date.now();
      const response = await fetch(input, init);
      const endTime = Date.now();
      
      // Log response
      if (logResponse) {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        logger(`Fetch response: ${response.status} ${response.statusText} from ${url} (${endTime - startTime}ms)`);
      }
      
      return response;
    };
  };
}

/**
 * Example of combining multiple middlewares
 * 
 * @example
 * // Create middlewares
 * const baseUrlMiddleware = createBaseUrlMiddleware('https://api.example.com');
 * const headersMiddleware = createHeadersMiddleware({
 *   'Content-Type': 'application/json',
 *   'X-API-Key': 'your-api-key',
 * });
 * const retryMiddleware = createRetryMiddleware({ maxRetries: 3 });
 * const timeoutMiddleware = createTimeoutMiddleware(5000);
 * const loggingMiddleware = createLoggingMiddleware();
 * 
 * // Create a fetch function with all middlewares
 * const enhancedFetch = createFetchWithMiddleware([
 *   baseUrlMiddleware,
 *   headersMiddleware,
 *   retryMiddleware,
 *   timeoutMiddleware,
 *   loggingMiddleware,
 * ]);
 * 
 * // Use the enhanced fetch function
 * const response = await enhancedFetch('/users');
 * const data = await response.json();
 */
