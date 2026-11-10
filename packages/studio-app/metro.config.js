// Metro for the customer app: it imports the shared wire contract straight from the repo
// (../../src/studio/protocol.ts), so app and hub can't disagree within one commit. Only that one
// file is watched — never the daemon, the Mac app, or the hub.
const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const project = __dirname;
const repo = path.resolve(project, '../..');
const shared = [path.join(repo, 'src/studio')];

const config = getDefaultConfig(project);
config.watchFolders = shared;

// Everything the shared files import (zod) resolves from this package: one copy in the bundle.
config.resolver.nodeModulesPaths = [path.join(project, 'node_modules')];
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const from = context.originModulePath;
  const outside = from && !from.startsWith(project + path.sep);
  // The repo's TypeScript imports its siblings as './x.js' (Node's ESM): that's './x.ts' here.
  if (outside && moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const ts = path.resolve(path.dirname(from), moduleName.replace(/\.js$/, '.ts'));
    if (fs.existsSync(ts)) return { type: 'sourceFile', filePath: ts };
  }
  const ctx = outside && !moduleName.startsWith('.') && !path.isAbsolute(moduleName) ? { ...context, originModulePath: path.join(project, 'package.json') } : context;
  return upstream ? upstream(ctx, moduleName, platform) : ctx.resolveRequest(ctx, moduleName, platform);
};

module.exports = config;
