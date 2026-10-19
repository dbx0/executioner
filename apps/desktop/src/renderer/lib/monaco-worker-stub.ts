/**
 * Stands in for Monaco's web-worker entry points under Vitest.
 *
 * The real `?worker` imports are multi-megabyte bundles that jsdom cannot run,
 * and no unit test exercises the language services they provide. The vitest
 * config aliases every `monaco-editor/**\/*.worker?worker` specifier here.
 */
export default class MonacoWorkerStub {
  addEventListener(): void {}
  removeEventListener(): void {}
  postMessage(): void {}
  terminate(): void {}
}
