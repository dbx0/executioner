import type { JSX } from 'react'
import { Button } from '../../ui/button.js'
import { Field, SelectField, TextareaField } from './fields.js'
import type { FormState, Parser } from './form-state.js'

/** The right pane: the whole custom-node form, from identity down to the emit spec. */
export function CustomNodeEditor({
  form,
  set,
  error,
  valid,
  busy,
  onNew,
  onSave,
}: {
  form: FormState
  set: (patch: Partial<FormState>) => void
  error: string | null
  valid: boolean
  busy: boolean
  onNew: () => void
  onSave: () => void
}): JSX.Element {
  return (
    <div className="min-w-0 flex-1 overflow-y-auto scrollbar-sleek p-4">
      <div className="mb-3 text-[13px] font-medium">
        {form.editingId === undefined ? 'New custom node' : 'Edit custom node'}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field
          label="Id (slug)"
          value={form.id}
          onChange={(v) => set({ id: v })}
          placeholder="my-scanner"
          disabled={form.editingId !== undefined}
        />
        <Field label="Name" value={form.name} onChange={(v) => set({ name: v })} placeholder="My Scanner" />
        <div className="col-span-2">
          <Field
            label="Description"
            value={form.description}
            onChange={(v) => set({ description: v })}
            placeholder="What this tool does"
          />
        </div>
        <Field label="Category" value={form.category} onChange={(v) => set({ category: v })} placeholder="custom" />
        <Field
          label="Accepts (comma-separated)"
          value={form.accepts}
          onChange={(v) => set({ accepts: v })}
          placeholder="domain, ip, url"
        />
      </div>

      <div className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Command</div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Program" value={form.program} onChange={(v) => set({ program: v })} placeholder="nmap" />
        <Field label="Timeout (ms)" value={form.timeout} onChange={(v) => set({ timeout: v })} placeholder="120000" />
      </div>
      <TextareaField
        label="Args (one per line, templates like {{ target.value }})"
        value={form.args}
        onChange={(v) => set({ args: v })}
        placeholder={'-sV\n{{ target.value }}'}
        rows={4}
      />

      <div className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Params (JSON, optional)</div>
      <TextareaField
        label={'A JSON map of name → param spec, e.g. {"ports": {"type": "string", "default": "1-1000"}}'}
        value={form.params}
        onChange={(v) => set({ params: v })}
        placeholder={'{\n  "ports": { "type": "string", "default": "1-1000" }\n}'}
        rows={5}
        mono
      />

      <div className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Output parser (emit)</div>
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label="Parser"
          value={form.parser}
          options={['json', 'regex', 'file']}
          onChange={(v) => set({ parser: v as Parser })}
        />
        <SelectField
          label="Source"
          value={form.source}
          options={['stdout', 'stderr']}
          onChange={(v) => set({ source: v as 'stdout' | 'stderr' })}
        />
        <Field label="Records (JSONPath-ish)" value={form.records} onChange={(v) => set({ records: v })} placeholder="$" />
        {form.parser === 'regex' && (
          <Field label="Pattern" value={form.pattern} onChange={(v) => set({ pattern: v })} placeholder="(?<host>\\S+)" />
        )}
        {form.parser === 'file' && (
          <>
            <Field label="Path" value={form.path} onChange={(v) => set({ path: v })} placeholder="out.json" />
            <SelectField
              label="Format"
              value={form.format}
              options={['json', 'jsonl']}
              onChange={(v) => set({ format: v as 'json' | 'jsonl' })}
            />
          </>
        )}
      </div>

      {error !== null && <p className="mt-3 whitespace-pre-wrap text-[12px] text-status-error">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        {form.editingId !== undefined && (
          <Button variant="ghost" size="xs" onClick={onNew}>
            New
          </Button>
        )}
        <Button size="xs" disabled={!valid || busy} onClick={onSave}>
          {form.editingId === undefined ? 'Create node' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}
