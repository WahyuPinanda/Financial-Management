const express = require('express');
const { resolve, sep, extname } = require('node:path');

function webSecurity(supabaseUrl) {
  const origins = ["'self'"];
  if (supabaseUrl) origins.push(new URL(supabaseUrl).origin);
  return { contentSecurityPolicy: { directives: { connectSrc: origins } } };
}

function createWebRouter(directory) {
  const router = express.Router();
  const root = resolve(directory);
  router.use(
    express.static(root, {
      index: false,
      setHeaders(res, path) {
        res.setHeader(
          'Cache-Control',
          path.startsWith(`${root}${sep}assets${sep}`)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        );
      },
    }),
  );
  router.get('/{*path}', (req, res, next) => {
    // Missing assets and API paths must never receive an HTML fallback.
    if (
      req.path === '/api' ||
      req.path.startsWith('/api/') ||
      extname(req.path) ||
      req.path.split('/').some((part) => part.startsWith('.'))
    )
      return next();
    if (!req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(resolve(root, 'index.html'), (error) => {
      if (error) next(error);
    });
  });
  return router;
}

module.exports = { createWebRouter, webSecurity };
