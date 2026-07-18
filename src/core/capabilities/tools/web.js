// 联网工具：web_search / fetch_url / browser_read。
// 实现按职责拆分到 ./web/ 子模块，此处仅作 barrel 再导出，保持对外接口不变。
//   web/util.js         —— 共享底层（HTTP 头、HTML 处理、长文落盘）
//   web/browser.js      —— 共享 Chromium 单例
//   web/search.js       —— web_search 多引擎
//   web/browser-read.js —— browser_read（真实浏览器渲染）
//   web/fetch.js        —— fetch_url（Jina / 直连 / 浏览器兜底）
export { execWebSearch } from './web/search.js'
export { execFetchUrl } from './web/fetch.js'
export { execBrowserRead } from './web/browser-read.js'
