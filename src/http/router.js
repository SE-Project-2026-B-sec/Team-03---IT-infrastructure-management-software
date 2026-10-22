'use strict';

const { badRequest } = require('../lib/errors');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Minimal path router: "/api/v1/assets/:id/label.svg" style patterns. */
class Router {
  constructor() {
    this.routes = [];
  }

  add(method, path, handler, options = {}) {
    const keys = [];
    const source = path
      .split('/')
      .map((segment) =>
        segment.replace(/:([A-Za-z]+)|([^:]+)/g, (_, key, literal) => {
          if (key) {
            keys.push(key);
            return '([^/]+)';
          }
          return escapeRegex(literal);
        })
      )
      .join('/');
    // Patterns are built from route definitions in source code, never from request data.
    // eslint-disable-next-line security/detect-non-literal-regexp
    this.routes.push({ method, path, pattern: new RegExp(`^${source}$`), keys, handler, options });
    return this;
  }

  /** Returns { route, params }, { methodNotAllowed, allowed } or null. */
  match(method, pathname) {
    const allowed = [];
    for (const route of this.routes) {
      const m = route.pattern.exec(pathname);
      if (!m) continue;
      if (route.method !== method) {
        allowed.push(route.method);
        continue;
      }
      const params = {};
      route.keys.forEach((key, i) => {
        try {
          params[key] = decodeURIComponent(m[i + 1]);
        } catch {
          throw badRequest('Malformed URL path parameter');
        }
      });
      return { route, params };
    }
    return allowed.length ? { methodNotAllowed: true, allowed } : null;
  }
}

module.exports = { Router };
