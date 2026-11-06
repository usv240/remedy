// Stands in for "@bryntum/gantt" in the bundle (see turbopack.resolveAlias in next.config.ts). The browser loads
// Bryntum's UMD build from /bryntum/gantt.umd.js first (ensureBryntumScript in ./bryntum.ts), which defines
// window.bryntum.gantt; this hands those exports to the page's code and to @bryntum/gantt-react. Types still come from
// the real package.
module.exports = (typeof globalThis !== "undefined" && globalThis.bryntum && globalThis.bryntum.gantt) || {};
