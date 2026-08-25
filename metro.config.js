/**
 * 后端接口已经拆到 server/ 独立跑（npm run server），不再寄生在这里。
 * 之前挂在这个文件上的四个中间件如果留着，会和后端同时读写同一批文件。
 */
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * data/ 是后端的地盘：数据库、抽出来的音轨、HLS 分片，没有一样是前端要打包的。
 *
 * 必须挡掉，不然有两个麻烦：HLS 分片是 .ts 后缀，跟 TypeScript 撞名，Metro 会
 * 当源码去解析；而且一部片子切出近八百个分片，白白压在文件监听上。
 */
const blocked = new RegExp(`^${path.join(__dirname, 'data').replace(/\\/g, '\\\\')}\\b.*`);
config.resolver.blockList = config.resolver.blockList
  ? [config.resolver.blockList, blocked].flat()
  : blocked;

module.exports = config;
