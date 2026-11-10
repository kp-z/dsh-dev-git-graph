/**
 * Client 半体的构建配置。
 *
 * 产物必须是**经典脚本**（宿主用 window.__ModuleLoader__.load 收口），所以 format: 'iife'；
 * react 由宿主模块表提供，必须 external（不打包、不解析）。
 */
export default {
  entry: ['src/client/client.js'],
  format: 'iife',
  platform: 'browser',
  outDir: 'lib',
  deps: { neverBundle: ['react'] },
  clean: false,
  minify: true,
  report: false,
  dts: false,
};
