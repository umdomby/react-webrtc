const webpack = require('webpack');
const path = require('path');

module.exports = function override(config) {
    // Добавляем полифиллы для Node.js модулей
    config.resolve.fallback = {
        ...config.resolve.fallback,
        "crypto": require.resolve("crypto-browserify"),
        "stream": require.resolve("stream-browserify"),
        "buffer": require.resolve("buffer"),
        "http": require.resolve("stream-http"),
        "https": require.resolve("https-browserify"),
        "url": require.resolve("url"),
        "os": require.resolve("os-browserify/browser"),
        "assert": require.resolve("assert")
    };

    // Добавляем плагины для глобальных переменных
    config.plugins = [
        ...(config.plugins || []),
        new webpack.ProvidePlugin({
            process: 'process/browser',
            Buffer: ['buffer', 'Buffer']
        })
    ];

    return config;
};