// Shared security-header data. Each worker keeps its native apply mechanism
// (raw Response cloning vs Hono secureHeaders) but pulls values from here.

// 1y HSTS, includeSubDomains; preload omitted intentionally (non-trivial to undo).
export const HSTS_VALUE = "max-age=31536000; includeSubDomains";

export interface CspProfile {
  baseUri?: readonly string[];
  connectSrc: readonly string[];
  defaultSrc: readonly string[];
  fontSrc: readonly string[];
  formAction?: readonly string[];
  frameAncestors: readonly string[];
  imgSrc: readonly string[];
  scriptSrc: readonly string[];
  styleSrc: readonly string[];
}

export const SPA_CSP: CspProfile = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", "data:", "https:"],
  fontSrc: ["'self'", "data:"],
  connectSrc: ["'self'"],
  frameAncestors: ["'none'"],
};

// admin-ui Vite injects runtime <style> tags — 'unsafe-inline' on style-src.
export const ADMIN_CONSOLE_CSP: CspProfile = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", "data:", "https:"],
  fontSrc: ["'self'", "data:"],
  connectSrc: ["'self'"],
  frameAncestors: ["'none'"],
};

const API_CSP_TEMPLATE = {
  defaultSrc: ["'self'"] as const,
  scriptSrc: ["'self'"] as const,
  styleSrc: ["'self'"] as const,
  fontSrc: ["'self'"] as const,
  connectSrc: ["'self'"] as const,
  frameAncestors: ["'none'"] as const,
  baseUri: ["'self'"] as const,
  formAction: ["'self'"] as const,
};

// `img-src` finalised at middleware build time with the per-deployment branding host.
export function apiCspProfile(brandingHost: string): CspProfile {
  const imgSrc: string[] = ["'self'", "data:"];
  if (brandingHost) {
    imgSrc.push(`https://${brandingHost}`);
  }
  return {
    ...API_CSP_TEMPLATE,
    imgSrc,
  };
}

export function cspToHeader(profile: CspProfile): string {
  const directives: string[] = [
    `default-src ${profile.defaultSrc.join(" ")}`,
    `img-src ${profile.imgSrc.join(" ")}`,
    `style-src ${profile.styleSrc.join(" ")}`,
    `script-src ${profile.scriptSrc.join(" ")}`,
    `font-src ${profile.fontSrc.join(" ")}`,
    `connect-src ${profile.connectSrc.join(" ")}`,
    `frame-ancestors ${profile.frameAncestors.join(" ")}`,
  ];
  if (profile.baseUri) {
    directives.push(`base-uri ${profile.baseUri.join(" ")}`);
  }
  if (profile.formAction) {
    directives.push(`form-action ${profile.formAction.join(" ")}`);
  }
  return directives.join("; ");
}

export function cspProfileToHonoOption(profile: CspProfile): {
  defaultSrc: string[];
  scriptSrc: string[];
  styleSrc: string[];
  imgSrc: string[];
  fontSrc: string[];
  connectSrc: string[];
  frameAncestors: string[];
  baseUri?: string[];
  formAction?: string[];
} {
  const out: ReturnType<typeof cspProfileToHonoOption> = {
    defaultSrc: [...profile.defaultSrc],
    scriptSrc: [...profile.scriptSrc],
    styleSrc: [...profile.styleSrc],
    imgSrc: [...profile.imgSrc],
    fontSrc: [...profile.fontSrc],
    connectSrc: [...profile.connectSrc],
    frameAncestors: [...profile.frameAncestors],
  };
  if (profile.baseUri) {
    out.baseUri = [...profile.baseUri];
  }
  if (profile.formAction) {
    out.formAction = [...profile.formAction];
  }
  return out;
}

export const OTHER_HEADERS = {
  xContentTypeOptions: "nosniff",
  referrerPolicy: "strict-origin-when-cross-origin",
  crossOriginOpenerPolicy: "same-origin",
  xFrameOptions: "DENY",
} as const;
