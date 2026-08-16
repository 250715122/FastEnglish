const { getDefaultConfig } = require('expo/metro-config');
const { createDictStoreMiddleware } = require('./scripts/dictStore');
const { createOpenSubtitlesMiddleware } = require('./scripts/openSubtitlesProxy');
const { createSubtitleStoreMiddleware } = require('./scripts/subtitleStore');
const { createVocabStoreMiddleware } = require('./scripts/vocabStore');

const config = getDefaultConfig(__dirname);
const middlewares = [
  createOpenSubtitlesMiddleware(),
  createSubtitleStoreMiddleware(),
  createDictStoreMiddleware(),
  createVocabStoreMiddleware()
];

config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware) => (request, response, next) =>
    middlewares.reduceRight(
      (downstream, middleware) => () => middleware(request, response, downstream),
      () => metroMiddleware(request, response, next)
    )()
};

module.exports = config;
