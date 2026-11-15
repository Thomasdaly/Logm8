// Metro config. The workspace packages @logm8/rules-engine and @logm8/diary-reader are TypeScript source whose relative imports
// use ".js" suffixes (NodeNext style); map those to the extensionless .ts files for Metro.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (/[\\/]packages[\\/](rules-engine|diary-reader)[\\/]/.test(context.originModulePath) && /^\.{1,2}\/.*\.js$/.test(moduleName)) {
    return context.resolveRequest(context, moduleName.replace(/\.js$/, ''), platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
