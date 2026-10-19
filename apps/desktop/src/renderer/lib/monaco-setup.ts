// No custom language registrations, no context-menu paste bridge, and no
// explicit stylesheet import: Monaco 0.56's ESM entry pulls its own CSS
// (codicon.css et al), unlike 0.55 which needed editor.main.css imported by hand.
//
// Worker subpaths omit the `esm/vs/` prefix: 0.56 ships an exports
// map of `"./*": "./esm/vs/*.js"`, so the prefix would resolve to
// `esm/vs/esm/vs/...` and fail.
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { typescript as monacoTS } from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

globalThis.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case 'json':
        return new jsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker()
      case 'typescript':
      case 'javascript':
        return new tsWorker()
      default:
        return new editorWorker()
    }
  },
}

// Monaco here is an editing surface, not a type checker — the sandboxed TS
// worker cannot resolve imports to project files, so semantic validation
// produces a long tail of false positives (unresolved modules, unused-import
// fades, bogus implicit-any). Disable all three categories; tokenization is
// untouched, and that is what actually gives useful reading affordance.
const diagnosticsOptions = {
  noSemanticValidation: true,
  noSuggestionDiagnostics: true,
  noSyntaxValidation: true,
}
monacoTS.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions)
monacoTS.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions)

// .tsx/.jsx share the base 'typescript'/'javascript' ids, so these compiler
// options apply to both. Without jsx enabled the worker raises TS17004 on every
// JSX tag. Preserve parses without forcing an emit transform — we never emit.
monacoTS.typescriptDefaults.setCompilerOptions({
  ...monacoTS.typescriptDefaults.getCompilerOptions(),
  jsx: monacoTS.JsxEmit.Preserve,
})
monacoTS.javascriptDefaults.setCompilerOptions({
  ...monacoTS.javascriptDefaults.getCompilerOptions(),
  jsx: monacoTS.JsxEmit.Preserve,
})

// Use the bundled editor rather than fetching from a CDN.
loader.config({ monaco })

export { monaco }
