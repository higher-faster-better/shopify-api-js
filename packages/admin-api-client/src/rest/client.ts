import {
  CustomFetchApi,
  LogContentTypes,
  Logger,
  generateHttpFetch,
  getCurrentSupportedApiVersions,
  validateApiVersion,
  validateDomainAndGetStoreUrl,
  validateRetries,
} from "@shopify/graphql-client";

import {
  validateRequiredAccessToken,
  validateServerSideUsage,
} from "../validations";
import {
  ACCESS_TOKEN_HEADER,
  CLIENT,
  DEFAULT_CLIENT_VERSION,
  DEFAULT_CONTENT_TYPE,
  DEFAULT_RETRY_WAIT_TIME,
  RETRIABLE_STATUS_CODES,
} from "../constants";

import {
  AdminRestApiClient,
  AdminRestApiClientOptions,
  DeleteRequestOptions,
  GetRequestOptions,
  HeaderOptions,
  Method,
  PostRequestOptions,
  PutRequestOptions,
  RequestOptions,
  SearchParamFields,
  SearchParams,
} from "./types";

export function createAdminRestApiClient({
  storeDomain,
  apiVersion,
  accessToken,
  userAgentPrefix,
  logger,
  customFetchApi = fetch,
  retries: clientRetries = 0,
  scheme = "https",
  defaultRetryTime = DEFAULT_RETRY_WAIT_TIME,
  formatPaths = true,
}: AdminRestApiClientOptions): AdminRestApiClient {
  validateServerSideUsage();
  validateRequiredAccessToken(accessToken);
  validateRetries({ client: CLIENT, retries: clientRetries });

  const currentSupportedApiVersions = getCurrentSupportedApiVersions();
  const storeUrl = validateDomainAndGetStoreUrl({ client: CLIENT, storeDomain })
    .replace("https://", `${scheme}://`);

  const baseApiVersionValidationParams = { client: CLIENT, currentSupportedApiVersions, logger };
  validateApiVersion({ ...baseApiVersionValidationParams, apiVersion });

  const apiUrlFormatter = generateApiUrlFormatter(storeUrl, apiVersion, baseApiVersionValidationParams, formatPaths);
  const clientLogger = generateClientLogger(logger);
  const httpFetch = generateHttpFetch({
    customFetchApi,
    clientLogger,
    defaultRetryWaitTime,
    client: CLIENT,
    retriableCodes: RETRIABLE_STATUS_CODES,
  });

  const request = async (path: string, options: RequestOptions): ReturnType<CustomFetchApi> => {
    validateRetries({ client: CLIENT, retries: options.retries ?? 0 });

    const url = apiUrlFormatter(path, options.searchParams ?? {}, options.apiVersion);
    const headers = generateHeaders(options.headers, accessToken, userAgentPrefix);
    const body = options.data && typeof options.data !== "string" ? JSON.stringify(options.data) : options.data;

    return httpFetch(
      [url, { method: options.method, headers, ...(body ? { body } : undefined) }],
      1,
      options.retries ?? clientRetries,
    );
  };

  return {
    get: (path, options) => request(path, { method: Method.Get, ...options }),
    put: (path, options) => request(path, { method: Method.Put, ...options }),
    post: (path, options) => request(path, { method: Method.Post, ...options }),
    delete: (path, options) => request(path, { method: Method.Delete, ...options }),
  };
}

function generateApiUrlFormatter(
  storeUrl: string,
  defaultApiVersion: string,
  baseApiVersionValidationParams: Omit<Parameters<typeof validateApiVersion>[0], "apiVersion">,
  formatPaths = true,
) {
  return (path: string, searchParams: SearchParams, apiVersion?: string) => {
    if (apiVersion) validateApiVersion({ ...baseApiVersionValidationParams, apiVersion });

    let cleanPath = path.replace(/^\//, "");
    if (formatPaths) {
      cleanPath = formatApiPath(cleanPath, defaultApiVersion);
    }

    const queryString = buildQueryParams(searchParams);
    return `${storeUrl}/${cleanPath}${queryString}`;
  };
}

function formatApiPath(path: string, apiVersion: string): string {
  if (!path.startsWith("admin")) path = `admin/api/${apiVersion}/${path}`;
  if (!path.endsWith(".json")) path = `${path}.json`;
  return path;
}

function buildQueryParams(searchParams: SearchParams): string {
  const params = new URLSearchParams();

  function appendParams(key: string, value: SearchParamFields) {
    if (Array.isArray(value)) {
      value.forEach(val => appendParams(`${key}[]`, val));
    } else if (typeof value === "object") {
      Object.entries(value).forEach(([k, v]) => appendParams(`${key}[${k}]`, v));
    } else {
      params.append(key, String(value));
    }
  }

  Object.entries(searchParams || {}).forEach(([key, value]) => appendParams(key, value));
  return params.toString() ? `?${params.toString()}` : "";
}

function generateHeaders(requestHeaders: HeaderOptions = {}, accessToken: string, userAgentPrefix?: string) {
  const normalizedRequestHeaders = normalizeHeaders(requestHeaders);
  const userAgent = [
    ...(normalizedRequestHeaders["user-agent"] ? [normalizedRequestHeaders["user-agent"]] : []),
    ...(userAgentPrefix ? [userAgentPrefix] : []),
    `${CLIENT} v${DEFAULT_CLIENT_VERSION}`,
  ].join(" | ");

  return normalizeHeaders({
    "Content-Type": DEFAULT_CONTENT_TYPE,
    Accept: DEFAULT_CONTENT_TYPE,
    [ACCESS_TOKEN_HEADER]: accessToken,
    "User-Agent": userAgent,
    ...normalizedRequestHeaders,
  });
}

function normalizeHeaders(headers: HeaderOptions): Record<string, string> {
  return Object.entries(headers).reduce((acc, [key, value]) => {
    acc[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
    return acc;
  }, {} as Record<string, string>);
}

function generateClientLogger(logger?: Logger): Logger {
  return (logContent: LogContentTypes) => logger?.(logContent);
}
