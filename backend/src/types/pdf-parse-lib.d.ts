// pdf-parse's package entry point (index.js) ends with a debug block guarded by
// `!module.parent`:
//
//     let isDebugMode = !module.parent;
//     if (isDebugMode) { Fs.readFileSync('./test/data/05-versions-space.pdf') ... }
//
// Under CommonJS `module.parent` is set and the block never runs. The parser
// worker, however, is loaded through the ESM loader, where there is no
// `module.parent` — so merely importing 'pdf-parse' there executes the debug
// path and throws ENOENT for a test fixture that is not shipped. It failed every
// upload, .txt included, because it happens at import time rather than at parse
// time.
//
// lib/pdf-parse.js is the actual implementation with no such block, so the
// worker imports it directly. @types/pdf-parse only declares the package entry,
// hence this declaration for the subpath.
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
    text: string;
  }
  function pdfParse(data: Buffer): Promise<PdfParseResult>;
  export = pdfParse;
}
