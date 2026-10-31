import { useEffect, useRef, useState } from 'react';

import type { FleetMachineSnapshot, FleetTaskCreateMessage } from '../../../../core/src/messages.js';
import type { CloudPlaceNode } from './cloudFolders.js';
import { cloudHasRepo, pickMachine } from './cloudTaskPick.js';
import type { CloudRequest } from './FleetView.js';

type CloudEngine = NonNullable<FleetTaskCreateMessage['engine']>;

export interface CloudNewTask {
  readonly machine: string;
  readonly prompt: string;
  readonly engine: CloudEngine;
  /** The Project-tree node the request came from; its session then sits under that node, like a local one. */
  readonly nodeId?: string;
}

export interface CloudSessionsProps {
  readonly machines: readonly FleetMachineSnapshot[];
  /** Starts a cloud task; the board names it and opens its terminal once the machine has created it. */
  readonly onCreate: (task: CloudNewTask) => void;
  /** The last cloud action's failure, shown under the header. */
  readonly error: string | null;
  /** A cloud action is running: one at a time, so a double click never creates two tasks. */
  readonly busy: boolean;
  /** A right-click "Phiên mới · Claude/omp cloud": open the request box with that agent chosen. */
  readonly request: CloudRequest | null;
  /** The tree nodes that exist now: a failed create whose node is gone is shown at the foot of the tree. */
  readonly nodes: readonly CloudPlaceNode[];
}

/**
 * Shows a failed create whose tree node is gone. The cloud sessions themselves are rows of the tree.
 */
export function CloudSessionsSection({ request, nodes, error }: CloudSessionsProps) {
  // A failed create shows under the node that asked for it; only one whose node is gone is shown here.
  const shown = request?.nodeId !== undefined && nodes.some((node) => node.id === request.nodeId) ? null : error;
  if (shown === null) return null;
  return (
    <p role="alert" className="mx-2 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-xs text-warning">
      {shown}
    </p>
  );
}

/** The request box a right-click "Phiên mới · … cloud" opens under a tree node, and a create's failure. */
export function CloudFolderRows({ nodeId, depth, ...props }: CloudSessionsProps & { readonly nodeId: string; readonly depth: number }) {
  const { machines, request, busy, nodes } = props;
  const [formOpen, setFormOpen] = useState(false);
  useEffect(() => {
    if (request?.nodeId === nodeId) setFormOpen(true);
  }, [request, nodeId]);

  const error = request?.nodeId === nodeId ? props.error : null;
  if (!formOpen && error === null) return null;
  return (
    <div className="flex flex-col gap-1" style={{ paddingLeft: `${depth * 12}px` }}>
      {error !== null && (
        <p role="alert" className="mx-2 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-xs text-warning">
          {error}
        </p>
      )}
      {formOpen && request !== null && (
        <CloudNewForm
          key={request.token}
          machines={machines}
          busy={busy}
          initialEngine={request.engine}
          nodeId={nodeId}
          repoMissing={!cloudHasRepo(nodeId, nodes, machines)}
          onSubmit={(task) => {
            props.onCreate(task);
            setFormOpen(false);
          }}
        />
      )}
    </div>
  );
}

function CloudNewForm({
  machines,
  busy,
  initialEngine,
  nodeId,
  repoMissing,
  onSubmit,
}: {
  readonly machines: readonly FleetMachineSnapshot[];
  readonly busy: boolean;
  readonly initialEngine: CloudEngine;
  readonly nodeId?: string;
  /** No machine has this folder's repository: the task would run on other code, so nothing is created. */
  readonly repoMissing: boolean;
  readonly onSubmit: (task: CloudNewTask) => void;
}) {
  const [engine, setEngine] = useState<CloudEngine>(initialEngine);
  const [prompt, setPrompt] = useState('');
  const promptBox = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    promptBox.current?.focus();
  }, []);
  const target = pickMachine(machines);
  const agentName = engine === 'omp' ? 'omp' : 'Claude';
  const ready = !busy && !repoMissing && target !== null && prompt.trim() !== '';
  return (
    <form
      className="mx-2 flex flex-col gap-1 rounded-lg border border-white/5 bg-white/[0.03] p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || target === null) return;
        onSubmit({ machine: target, prompt: prompt.trim(), engine, ...(nodeId === undefined ? {} : { nodeId }) });
      }}
    >
      <textarea
        ref={promptBox}
        aria-label={`Việc cho ${agentName} cloud`}
        className="w-full rounded border border-hairline bg-transparent p-2 text-sm"
        rows={3}
        maxLength={20000}
        placeholder="Gõ việc cần làm, ví dụ: Sửa lỗi xếp sân đôi khi đổi giờ thi đấu"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <div className="flex items-center gap-1">
        <select
          aria-label="Agent"
          className="rounded bg-well px-1 py-1 text-xs text-text"
          value={engine}
          onChange={(event) => setEngine(event.target.value === 'omp' ? 'omp' : 'claude')}
        >
          <option value="claude">Claude</option>
          <option value="omp">omp</option>
        </select>
        <span className="min-w-0 flex-1 truncate text-2xs text-text-muted">
          {repoMissing ? 'Máy cloud chưa có repo của thư mục này' : target === null ? 'Chưa có máy rảnh đủ 3 repo' : `chạy trên ${target}`}
        </span>
        <button type="submit" disabled={!ready} className="company-btn company-btn-sm company-btn-primary">
          Tạo
        </button>
      </div>
    </form>
  );
}
