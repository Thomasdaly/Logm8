// Metro config. The workspace package @logmate/rules-engine is TypeScript source whose relative imports
// use ".js" suffixes (NodeNext style); map those to the extensionless .ts files for Metro.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (/[\\/]packages[\\/]rules-engine[\\/]/.test(context.originModulePath) && /^\.{1,2}\/.*\.js$/.test(moduleName)) {
    return context.resolveRequest(context, moduleName.replace(/\.js$/, ''), platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
